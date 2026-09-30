/**
 * The service owns the whole lifecycle of a creative direction: gathering the
 * context, asking a director for proposals, refusing anything the project cannot
 * stand behind, and keeping the rules about selection and user edits.
 *
 * Two rules here are the reason this is a service and not a route handler:
 *
 *  - A regeneration never overwrites a direction a human has edited. Those rows
 *    are the user's work, not a cache of a model's output.
 *  - Exactly one direction is selected per intent. Selecting a second one demotes
 *    the first, in the same database statement, so two concurrent selections
 *    cannot both succeed.
 */

import { CreativeError, type CreativeDirection, type CreativeDirectionStatus, type CreativeMode, type CreativeAngle } from "../domain/creative-direction";
import type { CreativeDirectionDraft } from "../domain/creative-direction";
import type { CreativeContext } from "../domain/creative-context";
import { toBrandExecutionProfile } from "../domain/brand";
import type { CreativeDirectionRepository } from "../ports/creative-direction-repository";
import type {
  CreativeDirector,
  CreativeDirectorResult,
} from "../ports/creative-director";
import type { ContentIntentRepository } from "../ports/content-intent-repository";
import type { IntelligenceRepository } from "../ports/intelligence-repository";
import type { BrandRepository } from "../ports/brand-repository";
import type { AssetRepository } from "../ports/asset-repository";
import type { ProjectService } from "./project-service";
import { buildCreativeContext } from "./creative-context-builder";
import { getCreativeModePolicy } from "./creative-mode-policy";
import { scoreDirection } from "./creative-strength";
import {
  CreativeValidationFailure,
  validateCreativeDirection,
} from "./creative-direction-validator";
import { createId } from "../../lib/id";
import { pgTimestampToIso } from "../../lib/time";

/** Three to five is the useful range: fewer is a decision, more is a list. */
export const MIN_DIRECTIONS = 3;
export const MAX_DIRECTIONS = 5;
export const DEFAULT_DIRECTIONS = 3;

export type GenerateCreativeDirectionsInput = {
  projectId: string;
  userId: string;
  intentId: string;
  mode: string;
  count?: number;
};

export type CreativeDirectionGeneration = {
  directions: CreativeDirection[];
  mode: CreativeMode;
  creativeRunId: string;
  provider: string;
  model: string | null;
  /** Set when an AI director failed and the deterministic one stood in. */
  fallbackFrom: string | null;
  fallbackReason: string | null;
};

export type UpdateCreativeDirectionInput = {
  projectId: string;
  userId: string;
  directionId: string;
  patch: Partial<CreativeDirectionDraft> & { status?: CreativeDirectionStatus };
};

export interface CreativeDirectorServiceDependencies {
  projectService: Pick<ProjectService, "getAuthorized">;
  intentRepository: Pick<ContentIntentRepository, "getById">;
  repository: CreativeDirectionRepository;
  intelligenceRepository: Pick<IntelligenceRepository, "readGraph" | "latestSnapshot">;
  brandRepository: Pick<BrandRepository, "getByProjectId">;
  assetRepository: Pick<AssetRepository, "listByProject">;
  directors: CreativeDirector[];
  createId?: (prefix: string) => string;
  now?: () => Date;
}

function clampCount(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DIRECTIONS;
  if (!Number.isInteger(value)) {
    throw new CreativeError(
      "CREATIVE_DIRECTION_INVALID",
      "Direction count must be a whole number",
    );
  }
  return Math.max(MIN_DIRECTIONS, Math.min(MAX_DIRECTIONS, value));
}

export class CreativeDirectorService {
  private readonly createId: (prefix: string) => string;
  private readonly now: () => Date;

  constructor(private readonly deps: CreativeDirectorServiceDependencies) {
    this.createId = deps.createId ?? ((prefix) => createId(prefix));
    this.now = deps.now ?? (() => new Date());
  }

  async generate(
    input: GenerateCreativeDirectionsInput,
  ): Promise<CreativeDirectionGeneration> {
    const policy = getCreativeModePolicy(input.mode);
    const count = clampCount(input.count);

    const context = await this.buildContext(input.projectId, input.userId, input.intentId, policy.mode);

    // Guided work is defined by showing the real thing, so it cannot be faked by
    // writing about it. Saying so plainly beats generating directions that break
    // the moment someone tries to film them.
    if (policy.requireProductUi) {
      const hasProductUi = context.assets.some(
        (asset) =>
          asset.isProductUi ||
          asset.type === "PRODUCT_UI" ||
          asset.type === "SCREENSHOT" ||
          asset.role === "PRODUCT_UI" ||
          asset.role === "FEATURE_PROOF",
      );
      if (!hasProductUi) {
        throw new CreativeError(
          "CREATIVE_MODE_CONFLICT",
          "Guided mode needs captured product UI. Capture some screens, or generate in Balanced mode.",
        );
      }
    }

    let result: CreativeDirectorResult | null = null;
    let fallbackFrom: string | null = null;
    let fallbackReason: string | null = null;
    for (const director of this.deps.directors) {
      if (director.id === "deterministic-creative-director") continue;
      try {
        const proposal = await director.generate({
          context,
          count,
          angles: policy.allowedAngles,
        });
        if (proposal.proposals.length > 0) {
          result = proposal;
          break;
        }
        fallbackReason = `${director.id} returned no directions`;
      } catch (error) {
        fallbackReason =
          error instanceof CreativeValidationFailure
            ? error.issues.map((issue) => issue.message).join("; ")
            : error instanceof Error
              ? error.message
              : "Unknown provider failure";
      }
      fallbackFrom ??= director.id;
    }

    if (!result) {
      const deterministic = this.deps.directors.find(
        (director) => director.id === "deterministic-creative-director",
      );
      if (!deterministic) {
        throw new CreativeError(
          "CREATIVE_DIRECTION_FAILED",
          "No creative director is available",
        );
      }
      result = await deterministic.generate({
        context,
        count,
        angles: policy.allowedAngles,
      });
    }

    // A director that can build nothing from the recorded material has not
    // failed - it is telling the truth. Answering with an empty list would
    // leave the user staring at a blank panel with nothing to act on, so the
    // refusal is made explicit and says what would fix it.
    if (result.proposals.length === 0) {
      throw new CreativeError(
        "CREATIVE_INSUFFICIENT_CONTEXT",
        "This project does not have enough recorded product material to build a direction from. Run the intelligence pass on more source material, or capture product UI, and try again.",
      );
    }

    const creativeRunId = this.createId("crun");
    const timestamp = pgTimestampToIso(this.now().toISOString());
    const usedFallback =
      result.provider === "deterministic-creative-director" && fallbackFrom !== null;

    // Everything is validated before anything is written. A provider that fails
    // its third direction must not leave the first two behind, because a
    // half-written run is a set of options the user never chose between.
    const prepared: CreativeDirection[] = result.proposals.map((proposal) => {
      const draft = proposal.draft;
      const direction: CreativeDirection = {
        ...draft,
        visualStrategy: {
          ...draft.visualStrategy,
          assetIds: [...(draft.visualStrategy.assetIds ?? [])],
        },
        proofStrategy: {
          ...draft.proofStrategy,
          claimIds: [...(draft.proofStrategy.claimIds ?? [])],
          evidenceIds: [...(draft.proofStrategy.evidenceIds ?? [])],
        },
        id: this.createId("cdir"),
        projectId: context.projectId,
        intentId: context.intentId,
        mode: context.mode,
        status: "DRAFT",
        strengthScore: scoreDirection(draft, context),
        creativeRunId,
        editedByUser: false,
        brandVersion: context.brandVersion,
        intelligenceVersion: context.intelligenceVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      validateCreativeDirection(direction, context);
      return direction;
    });

    const directions: CreativeDirection[] = [];
    for (const direction of prepared) {
      directions.push(await this.deps.repository.create(direction));
    }

    return {
      directions,
      mode: context.mode,
      creativeRunId,
      provider: result.provider,
      model: result.model,
      fallbackFrom: usedFallback ? fallbackFrom : null,
      fallbackReason: usedFallback ? fallbackReason : null,
    };
  }

  async list(
    projectId: string,
    userId: string,
    options: { intentId?: string; status?: CreativeDirectionStatus } = {},
  ): Promise<CreativeDirection[]> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    return this.deps.repository.listByProject(projectId, options);
  }

  async get(
    projectId: string,
    userId: string,
    directionId: string,
  ): Promise<CreativeDirection> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const direction = await this.deps.repository.getById(directionId);

    if (!direction || direction.projectId !== projectId) {
      throw new CreativeError(
        "CREATIVE_DIRECTION_NOT_FOUND",
        "Creative direction not found",
      );
    }

    return direction;
  }

  /**
   * A user edit revalidates against the project's current context. Someone who
   * types a claim into the proof box is held to the same rule a model is, and
   * the edit is marked as theirs so a later regeneration leaves it alone.
   */
  async update(input: UpdateCreativeDirectionInput): Promise<CreativeDirection> {
    const existing = await this.get(
      input.projectId,
      input.userId,
      input.directionId,
    );
    const context = await this.buildContext(
      input.projectId,
      input.userId,
      existing.intentId,
      existing.mode,
    );

    const merged: CreativeDirectionDraft = {
      name: input.patch.name ?? existing.name,
      angle: (input.patch.angle as CreativeAngle) ?? existing.angle,
      thesis: input.patch.thesis ?? existing.thesis,
      hook: input.patch.hook ?? existing.hook,
      audienceAngle: input.patch.audienceAngle ?? existing.audienceAngle,
      emotionalAngle: input.patch.emotionalAngle ?? existing.emotionalAngle,
      narrativeSummary: input.patch.narrativeSummary ?? existing.narrativeSummary,
      visualStrategy: input.patch.visualStrategy ?? existing.visualStrategy,
      proofStrategy: input.patch.proofStrategy ?? existing.proofStrategy,
      voiceDirection: input.patch.voiceDirection ?? existing.voiceDirection,
      musicDirection: input.patch.musicDirection ?? existing.musicDirection,
      soundDirection: input.patch.soundDirection ?? existing.soundDirection,
      cta: input.patch.cta === undefined ? existing.cta : input.patch.cta,
      rationale: input.patch.rationale ?? existing.rationale,
    };

    const updated: CreativeDirection = {
      ...existing,
      ...merged,
      status: input.patch.status ?? existing.status,
      strengthScore: scoreDirection(merged, context),
      editedByUser: true,
      updatedAt: pgTimestampToIso(this.now().toISOString()),
    };

    validateCreativeDirection(updated, context);

    const saved = await this.deps.repository.update(updated.id, updated);
    if (!saved) {
      throw new CreativeError(
        "CREATIVE_DIRECTION_NOT_FOUND",
        "Creative direction not found",
      );
    }
    return saved;
  }

  async select(
    projectId: string,
    userId: string,
    directionId: string,
  ): Promise<{ selected: CreativeDirection; demoted: CreativeDirection[] }> {
    // Read it first: this is the check that the caller may see this direction
    // and that it exists at all. The switch itself is the repository's job.
    await this.get(projectId, userId, directionId);
    const timestamp = pgTimestampToIso(this.now().toISOString());

    const outcome = await this.deps.repository.selectForIntent(directionId, timestamp);
    if (!outcome) {
      throw new CreativeError(
        "CREATIVE_DIRECTION_NOT_FOUND",
        "Creative direction not found",
      );
    }

    return outcome;
  }

  async buildContext(
    projectId: string,
    userId: string,
    intentId: string,
    mode: string,
  ): Promise<CreativeContext> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const policy = getCreativeModePolicy(mode);

    const intent = await this.deps.intentRepository.getById(intentId);
    if (!intent || intent.projectId !== projectId) {
      throw new CreativeError(
        "CREATIVE_INTENT_NOT_FOUND",
        "Content request not found for this project",
      );
    }
    if (intent.status !== "RESOLVED") {
      throw new CreativeError(
        "CREATIVE_INTENT_NOT_RESOLVED",
        "Resolve the content request before generating creative directions",
      );
    }

    const [graph, snapshot, brand, assets] = await Promise.all([
      this.deps.intelligenceRepository.readGraph(projectId),
      this.deps.intelligenceRepository.latestSnapshot(projectId),
      this.deps.brandRepository.getByProjectId(projectId),
      this.deps.assetRepository.listByProject(projectId),
    ]);

    return buildCreativeContext({
      intent,
      graph,
      brand: brand ? toBrandExecutionProfile(brand) : null,
      assets,
      mode: policy.mode,
      intelligenceVersion: snapshot?.version ?? null,
    });
  }
}
