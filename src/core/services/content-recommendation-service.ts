import type { ProjectService } from "./project-service";
import type { ContentRecommendationRepository } from "../ports/content-recommendation-repository";
import type {
  ContentRecommendationProvider,
  DeterministicRecommendationProvider,
  RefinementRecommendationProvider,
} from "../ports/content-recommendation-provider";
import { RecommendationContextBuilder } from "./recommendation-context-builder";
import { ContentRecommendationValidator } from "./content-recommendation-validator";
import { buildIntentDraft } from "./recommendation-intent-builder";
import { diversifyByChannel } from "./recommendation-diversity";
import { buildOpportunityKey, indexOpportunityKeys } from "../../lib/recommendation-key";
import { analyzeContentHistory, type ContentHistory } from "./content-history-analyzer";
import { CONTENT_TYPES } from "../domain/content-type";
import {
  RecommendationError,
  type ContentOpportunity,
  type ContentOpportunityView,
  type OpportunityStatus,
  toOpportunityView,
} from "../domain/content-opportunity";
import type { RecommendationContext } from "../domain/recommendation-context";
import type { ContentIntentService } from "./content-intent-service";

/**
 * The lifecycle: generate, list, read, update, select, dismiss, refresh.
 *
 * Three invariants hold across all of it.
 *
 * The score never leaves: every outward shape is a view, so no route can leak it
 * by forgetting to strip it.
 *
 * Status survives refresh. A refresh re-derives candidates, but the stored key
 * is what decides identity, so a dismissal or a selection is carried across and
 * rows the user acted on are never deleted by a re-run.
 *
 * The project boundary is checked before anything is read or written. Every
 * lookup goes through the project it belongs to, so an id from another project
 * is indistinguishable from one that does not exist.
 */

export type ContentRecommendationServiceDeps = {
  projectService: ProjectService;
  repository: ContentRecommendationRepository;
  contextBuilder: RecommendationContextBuilder;
  validator: ContentRecommendationValidator;
  providers: ContentRecommendationProvider[];
  contentIntentService: Pick<ContentIntentService, "resolve">;
  now?: () => string;
};

const DEFAULT_MAXIMUM = 12;

/**
 * Whether existing content already covers this recommendation. Reads the one
 * authoritative coverage definition, so ranking, the panel and this flag cannot
 * disagree about what "already covered" means.
 */
function isCoveredBy(
  row: ContentOpportunity,
  history: ContentHistory,
): boolean {
  if (!row.subjectId) return false;
  return history.isCovered([row.subjectId], row.contentTypeId, row.platform);
}

export class ContentRecommendationService {
  constructor(private readonly deps: ContentRecommendationServiceDeps) {
    // The deterministic provider is required, not preferred: recommendations
    // must exist with no model configured, so a provider list that could be
    // empty would make the whole feature conditional on AI availability. Every
    // other provider is optional refinement and runs after it.
    const hasDeterministic = deps.providers.some(
      (provider) => provider.kind === "DETERMINISTIC",
    );
    if (!hasDeterministic) {
      throw new Error(
        "ContentRecommendationService requires a deterministic provider",
      );
    }
  }

  private get deterministicProvider(): DeterministicRecommendationProvider {
    const provider = this.deps.providers.find(
      (candidate): candidate is DeterministicRecommendationProvider =>
        candidate.kind === "DETERMINISTIC",
    );
    if (!provider) {
      throw new Error("Deterministic provider is not configured");
    }
    return provider;
  }

  private get refinementProviders(): RefinementRecommendationProvider[] {
    return this.deps.providers.filter(
      (provider): provider is RefinementRecommendationProvider =>
        provider.kind === "AI_REFINEMENT",
    );
  }

  /**
   * Derives opportunities from current project data. Refinement providers may
   * run afterwards, but only to reword or reorder what the deterministic pass
   * produced, and only within the grounding the validator will accept.
   */
  async generate(
    projectId: string,
    userId: string,
  ): Promise<ContentOpportunityView[]> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    return this.refresh(projectId);
  }

  /**
   * The panel's re-sync: the same reconciliation `generate` performs, behind the
   * same authorization.
   *
   * `refresh` itself takes no user because `generate` has already authorized by
   * the time it calls it — giving the reconciler its own user parameter would
   * suggest the check happened there, where a second caller could skip it. This
   * is the entry point for anything that is not `generate`.
   */
  async refreshForUser(
    projectId: string,
    userId: string,
  ): Promise<ContentOpportunityView[]> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    return this.refresh(projectId);
  }

  async list(
    projectId: string,
    userId: string,
    filter?: { status?: OpportunityStatus },
  ): Promise<ContentOpportunityView[]> {
    await this.deps.projectService.getAuthorized(projectId, userId);

    // Coverage is a reading of current project state, so it is resolved here
    // rather than read off the row. Listing recommendations and the content that
    // already exists are both project-scoped reads, and running them together
    // keeps `isProgress` from ever being served from a stored value that a new
    // intent or storyboard has since made wrong.
    const [rows, context] = await Promise.all([
      this.deps.repository.listByProject(projectId, filter),
      this.deps.contextBuilder.build(projectId),
    ]);

    return this.views(rows, context);
  }

  async get(
    projectId: string,
    userId: string,
    recommendationId: string,
  ): Promise<ContentOpportunityView> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const found = await this.require(projectId, recommendationId);
    const context = await this.deps.contextBuilder.build(projectId);
    return this.view(found, context);
  }

  async update(
    projectId: string,
    userId: string,
    recommendationId: string,
    changes: { status?: OpportunityStatus },
  ): Promise<ContentOpportunityView> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const found = await this.require(projectId, recommendationId);

    const updated = await this.deps.repository.updateStatus(
      projectId,
      recommendationId,
      {
        status: changes.status ?? found.status,
        // Dismissing records when; un-dismissing clears it so the row does not
        // carry a dismissal timestamp it is no longer subject to.
        dismissedAt:
          (changes.status ?? found.status) === "DISMISSED"
            ? found.dismissedAt ?? this.timestamp()
            : null,
        selectedIntentId: found.selectedIntentId,
        updatedAt: this.timestamp(),
      },
    );

    if (!updated) {
      throw new RecommendationError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation not found",
      );
    }

    return this.view(updated, await this.deps.contextBuilder.build(projectId));
  }

  async dismiss(
    projectId: string,
    userId: string,
    recommendationId: string,
  ): Promise<ContentOpportunityView> {
    return this.update(projectId, userId, recommendationId, {
      status: "DISMISSED",
    });
  }

  /**
   * Creates a CP09 Content Intent from a recommendation. The draft is phrased for
   * CP09's parser and then resolved by CP09 itself: this service sets no
   * contentTypeId, platforms or subjects of its own accord, because CP09 owns
   * those decisions and duplicating them here is how the two drift apart.
   */
  async select(
    projectId: string,
    userId: string,
    recommendationId: string,
  ): Promise<{ recommendation: ContentOpportunityView; intentId: string }> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const found = await this.require(projectId, recommendationId);

    if (found.status === "SELECTED" && found.selectedIntentId) {
      return {
        recommendation: this.view(
          found,
          await this.deps.contextBuilder.build(projectId),
        ),
        intentId: found.selectedIntentId,
      };
    }

    const context = await this.deps.contextBuilder.build(projectId);
    const draft = buildIntentDraft(found, context);

    const resolved = await this.deps.contentIntentService.resolve({
      projectId,
      userId,
      request: draft.request,
      // Real Source documents the recommendation was grounded in. These were
      // resolved from CP06 provenance at generation time and CP09 validates them
      // against actual Source rows, so this is the only thing that may appear
      // here: an intelligence entity id would produce an intent whose provenance
      // cannot resolve.
      sourceIds: found.evidence.sourceIds,
      // The recommendation already recorded the entity it is about, so the
      // subject does not have to be re-derived from the draft's wording. It is
      // passed as a subject, never as a source.
      subjects: found.subjectId
        ? [{ type: found.subjectType, id: found.subjectId }]
        : [],
    });

    const updated = await this.deps.repository.updateStatus(
      projectId,
      recommendationId,
      {
        status: "SELECTED",
        selectedIntentId: resolved.intent.id,
        dismissedAt: null,
        updatedAt: this.timestamp(),
      },
    );

    if (!updated) {
      throw new RecommendationError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation not found",
      );
    }

    return {
      recommendation: this.view(updated, context),
      intentId: resolved.intent.id,
    };
  }

  /**
   * Re-derives opportunities and reconciles them with what is stored.
   *
   * Reconciliation is by stable key, so a recommendation the user has already
   * dismissed or selected keeps its status even as its id, score and wording are
   * rebuilt. Anything the new run no longer produces is deleted only while it is
   * still ACTIVE: a row a user acted on is kept so the record of that decision
   * survives.
   */
  async refresh(projectId: string): Promise<ContentOpportunityView[]> {
    const context = await this.deps.contextBuilder.build(projectId);
    const generated = await this.produce(context);

    const stored = await this.deps.repository.listByProject(projectId);
    const { index, collisions } = indexOpportunityKeys(
      stored.map((row) => ({
        id: row.id,
        key: buildOpportunityKey({
          contentTypeId: row.contentTypeId,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          platform: row.platform,
          subjectLabel: row.subjectLabel,
        }),
        subjectType: row.subjectType,
        subjectId: row.subjectId,
      })),
    );

    // Two stored rows claiming one identity would mean one row's status quietly
    // overwrites the other's on the next pass. The database's unique constraint on
    // (projectId, key) should make this unreachable, so reaching it means the
    // constraint is not doing its job and the pass must not paper over it.
    if (collisions.length > 0) {
      throw new RecommendationError(
        "RECOMMENDATION_KEY_COLLISION",
        `Stored recommendations share an identity: ${collisions.join(", ")}`,
      );
    }

    const now = this.timestamp();
    const kept: ContentOpportunity[] = [];

    for (const opportunity of generated) {
      const key = opportunity.key;
      const existingId = index.keyToOpportunity.get(key);

      if (existingId) {
        const existing = stored.find((row) => row.id === existingId);
        if (!existing) continue;

        // A row the user acted on is kept as it is: its status is the user's
        // decision, and its wording was already shown to them.
        if (existing.status !== "ACTIVE") {
          kept.push(existing);
          continue;
        }

        kept.push({
          ...opportunity,
          id: existing.id,
          createdAt: existing.createdAt,
          status: existing.status,
          selectedIntentId: existing.selectedIntentId,
          dismissedAt: existing.dismissedAt,
          updatedAt: now,
        });
        continue;
      }

      kept.push(opportunity);
    }

    // Only ACTIVE rows absent from the new run are removed.
    const generatedKeys = new Set(generated.map((opportunity) => opportunity.key));

    const staleActiveIds = stored
      .filter((row) => {
        if (row.status !== "ACTIVE") return false;
        const key = buildOpportunityKey({
          contentTypeId: row.contentTypeId,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          platform: row.platform,
          subjectLabel: row.subjectLabel,
        });
        return !generatedKeys.has(key);
      })
      .map((row) => row.id);

    if (staleActiveIds.length > 0) {
      await this.deps.repository.deleteStaleActive(
        projectId,
        kept.map((r) => r.id),
      );
    }

    const { selected } = diversifyByChannel(kept, DEFAULT_MAXIMUM);

    // Persist: existing rows are updated in place, new ones inserted.
    const persisted: ContentOpportunity[] = [];
    for (const opportunity of selected) {
      const isExisting = opportunity.id.length > 0;
      const row = isExisting
        ? await this.deps.repository.replaceGenerated(projectId, opportunity)
        : await this.deps.repository.create({
            projectId,
            templateId: opportunity.templateId,
            key: opportunity.key,
            contentTypeId: opportunity.contentTypeId,
            channel: opportunity.channel,
            platform: opportunity.platform,
            subjectType: opportunity.subjectType,
            subjectId: opportunity.subjectId,
            subjectLabel: opportunity.subjectLabel,
            title: opportunity.title,
            rationale: opportunity.rationale,
            reasons: opportunity.reasons,
            missingInputs: opportunity.missingInputs,
            priorityScore: opportunity.priorityScore,
            sourceIds: opportunity.evidence.sourceIds,
            evidenceIds: opportunity.evidence.evidenceIds,
            entityIds: opportunity.evidence.entityIds,
            generatedAt: now,
          });

      if (row) persisted.push(row);
    }

    return this.views(persisted, context);
  }

  /**
   * Deterministic generation, then validated refinement. The deterministic pass
   * is authoritative: a provider that returns nothing usable, or anything the
   * validator rejects, leaves the original recommendations in place.
   */
  private async produce(context: RecommendationContext): Promise<ContentOpportunity[]> {
    const generated = await this.deterministicProvider.recommend(context, {
      maximum: DEFAULT_MAXIMUM,
      now: this.timestamp(),
    });

    const { isValid } = this.deps.validator.validate(generated, context);
    if (!isValid) {
      // A deterministic pass that fails its own validator is a bug, not input.
      throw new RecommendationError(
        "RECOMMENDATION_INVALID_INPUT",
        "Deterministic recommendations failed validation",
      );
    }

    let refined = generated;

    for (const provider of this.refinementProviders) {
      const proposal = await provider
        .refine(context, refined)
        .catch(() => null);
      if (!proposal) continue;

      const acceptable = this.deps.validator.filterValid(proposal, context);
      // Refinement may only reorder and reword; it may not introduce items, and
      // it may not drop any. Anything else is discarded wholesale.
      if (acceptable.length !== refined.length) continue;
      refined = acceptable;
      break;
    }

    return refined;
  }

  private async require(
    projectId: string,
    recommendationId: string,
  ): Promise<ContentOpportunity> {
    const found = await this.deps.repository.getById(projectId, recommendationId);
    if (!found) {
      throw new RecommendationError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation not found",
      );
    }
    return found;
  }

  /**
   * Outward shapes for a set of stored rows.
   *
   * `isProgress` is computed here from the shared coverage history rather than
   * stored, so it answers "does existing content already cover this?" against
   * current project state. One history serves the whole set.
   */
  private views(
    rows: readonly ContentOpportunity[],
    context: RecommendationContext,
  ): ContentOpportunityView[] {
    const history = this.history(context);
    return rows.map((row) => toOpportunityView(row, isCoveredBy(row, history)));
  }

  private view(
    row: ContentOpportunity,
    context: RecommendationContext,
  ): ContentOpportunityView {
    return toOpportunityView(row, isCoveredBy(row, this.history(context)));
  }

  private history(context: RecommendationContext): ContentHistory {
    return analyzeContentHistory(
      context,
      CONTENT_TYPES.map((contentType) => contentType.id),
    );
  }

  private timestamp(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}
