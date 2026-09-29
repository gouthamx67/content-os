/**
 * The service is the only place that knows the order of the pipeline: normalise,
 * parse, optionally interpret, resolve, validate, persist. Everything it needs
 * to say "I need one more detail" instead of guessing is decided here.
 *
 * Context is loaded lazily and narrowly. A text request does not read the brand
 * profile, and no request reads brand material facts the intent does not need.
 */

import { canonicalSlug } from "../domain/intelligence-canonical";
import {
  CONTENT_TYPES,
  getContentType,
  type ContentTypeDefinition,
} from "../domain/content-type";
import { PLATFORMS } from "../domain/platform";
import {
  ContentIntentError,
  isAspectRatio,
  type AspectRatio,
  type ContentIntent,
  type IntentClarification,
  type IntentSubject,
  type IntentSubjectType,
} from "../domain/content-intent";
import type { BrandRepository } from "../ports/brand-repository";
import type { ContentIntentRepository } from "../ports/content-intent-repository";
import type { ContentIntentInterpretationProvider } from "../ports/content-intent-interpreter";
import type { IntelligenceRepository } from "../ports/intelligence-repository";
import type { ProjectService } from "./project-service";
import { ContentIntentParser, type ParsedIntent } from "./content-intent-parser";
import {
  ContentIntentResolver,
  type ContentIntentEdit,
  type IntentResolutionContext,
} from "./content-intent-resolver";
import { ContentIntentValidator } from "./content-intent-validator";
import type { BrandProfile } from "../domain/brand";

const MAX_REQUEST_LENGTH = 2_000;
const MAX_EDIT_VALUES = {
  tone: 60,
  style: 60,
  language: 12,
  audience: 120,
  cta: 120,
  purpose: 60,
};

export type ResolveContentIntentInput = {
  projectId: string;
  userId: string;
  request: string;
  sourceIds?: string[];
};

export type ContentIntentView = {
  intent: ContentIntent;
  clarifications: IntentClarification[];
};

export type ContentIntentResolution = ContentIntentView & {
  aiApplied: boolean;
  aiErrorCode: string | null;
  notes: string[];
};

export interface ContentIntentServiceDependencies {
  projectService: Pick<ProjectService, "getAuthorized">;
  repository: ContentIntentRepository;
  validator: ContentIntentValidator;
  brand?: Pick<BrandRepository, "getByProjectId">;
  intelligence?: Pick<
    IntelligenceRepository,
    | "latestSnapshot"
    | "getProduct"
    | "listFeatures"
    | "listWorkflows"
    | "listProblems"
    | "listBenefits"
    | "listClaims"
  >;
  interpretationProvider?: ContentIntentInterpretationProvider | null;
}

export class ContentIntentService {
  private readonly parser = new ContentIntentParser();
  private readonly resolver = new ContentIntentResolver();
  private readonly validator: ContentIntentValidator;

  constructor(private readonly deps: ContentIntentServiceDependencies) {
    this.validator = deps.validator;
  }

  async resolve(
    input: ResolveContentIntentInput,
  ): Promise<ContentIntentResolution> {
    const rawRequest = input.request.trim();

    if (!rawRequest) {
      throw new ContentIntentError(
        "INTENT_REQUEST_EMPTY",
        "A content request is required",
      );
    }
    if (rawRequest.length > MAX_REQUEST_LENGTH) {
      throw new ContentIntentError(
        "INTENT_INVALID_INPUT",
        `A content request may be at most ${MAX_REQUEST_LENGTH} characters`,
      );
    }

    await this.deps.projectService.getAuthorized(input.projectId, input.userId);

    const parsed = this.parser.parse(rawRequest);
    const notes: string[] = [];
    let aiApplied = false;
    let aiErrorCode: string | null = null;
    let interpretation = null;

    // Deterministic parsing goes first. The model is only asked to fill what the
    // rules could not, and its answer is dropped - not merged - when it is wrong.
    if (this.deps.interpretationProvider && needsInterpretation(parsed)) {
      try {
        interpretation = await this.deps.interpretationProvider.interpret(
          this.buildInterpretationRequest(input.projectId, rawRequest, parsed),
        );
        aiApplied = true;
        notes.push(...interpretation.notes);
      } catch (error) {
        if (error instanceof ContentIntentError) {
          aiErrorCode = error.code;
        } else {
          aiErrorCode = "INTENT_AI_UNAVAILABLE";
        }
        notes.push(
          "Model interpretation was rejected; the deterministic result is used instead.",
        );
      }
    }

    const context = await this.buildContext(
      input.projectId,
      parsed,
      input.sourceIds ?? [],
    );

    const intent = this.resolver.resolve(
      rawRequest,
      parsed,
      context,
      interpretation,
    );

    const issues = this.validator.validate(intent, {
      allowUnresolvedType: intent.resolutionMode === "NEEDS_CLARIFICATION",
    });

    // An unresolved content type is a draft, not an error: the user is asked
    // what they meant. Everything else is refused.
    if (issues.length > 0) {
      throw new ContentIntentError(
        "INTENT_VALIDATION_FAILED",
        `This request cannot be turned into a content intent: ${issues.join(", ")}`,
        issues,
      );
    }

    const created = await this.deps.repository.create(intent);

    return {
      intent: created,
      clarifications: this.clarificationsFor(created),
      aiApplied,
      aiErrorCode,
      notes,
    };
  }

  async get(
    projectId: string,
    intentId: string,
    userId: string,
  ): Promise<ContentIntentView> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const intent = await this.requireOwnedIntent(projectId, intentId);
    return { intent, clarifications: this.clarificationsFor(intent) };
  }

  async list(projectId: string, userId: string): Promise<ContentIntentView[]> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const intents = await this.deps.repository.listForProject(projectId);
    return intents.map((intent) => ({
      intent,
      clarifications: this.clarificationsFor(intent),
    }));
  }

  async update(
    projectId: string,
    intentId: string,
    userId: string,
    edit: ContentIntentEdit,
  ): Promise<ContentIntentView> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const existing = await this.requireOwnedIntent(projectId, intentId);
    const normalized = this.normalizeEdit(edit);

    const updated = this.resolver.applyUserEdit(existing, normalized);

    const issues = this.validator.validate(updated);
    if (issues.length > 0) {
      throw new ContentIntentError(
        "INTENT_VALIDATION_FAILED",
        `This intent change cannot be saved: ${issues.join(", ")}`,
        issues,
      );
    }

    const saved = await this.deps.repository.update(updated);
    return { intent: saved, clarifications: this.clarificationsFor(saved) };
  }

  /**
   * Clarifications are derived, never stored: the answer to "what is still
   * missing" is a function of the current intent, so an edit can only ever
   * reduce the list.
   *
   * Only material gaps are asked about. Nothing is asked before the content type
   * is known, and a video without a platform is not blocked - it can be made
   * first and distributed later.
   */
  clarificationsFor(intent: ContentIntent): IntentClarification[] {
    const clarifications: IntentClarification[] = [];

    if (!intent.contentTypeId) {
      clarifications.push({
        field: "contentType",
        question: "What would you like to create?",
        options: contentTypeOptions(),
      });
      return clarifications;
    }

    const type = getContentType(intent.contentTypeId);
    if (!type) return clarifications;

    if (type.channel === "CAMPAIGN" && intent.platforms.length === 0) {
      clarifications.push({
        field: "platform",
        question: "Where should this campaign run?",
        options: platformOptions(type),
      });
    }

    if (type.supportsDuration && intent.durationSeconds === undefined) {
      clarifications.push({
        field: "duration",
        question: `How long should the ${type.name.toLowerCase()} be?`,
      });
    }

    if (type.channel === "CAMPAIGN" && !intent.audience) {
      clarifications.push({
        field: "audience",
        question: "Who is this campaign for?",
      });
    }

    if (intent.quantity > 1) {
      clarifications.push({
        field: "quantity",
        question: `You asked for ${intent.quantity} - should they differ from each other?`,
      });
    }

    return clarifications;
  }

  private async requireOwnedIntent(
    projectId: string,
    intentId: string,
  ): Promise<ContentIntent> {
    const intent = await this.deps.repository.getById(intentId);
    if (!intent || intent.projectId !== projectId) {
      // A project that does not own the intent and an intent that does not
      // exist are the same answer, so ownership cannot be probed.
      throw new ContentIntentError(
        "INTENT_NOT_FOUND",
        "This content intent was not found",
      );
    }
    return intent;
  }

  private async buildContext(
    projectId: string,
    parsed: ParsedIntent,
    sourceIds: string[],
  ): Promise<IntentResolutionContext> {
    const context: IntentResolutionContext = {
      projectId,
      sourceIds,
    };

    // The brand profile is only read when it can still change the reading. If
    // the user stated a tone and a style, brandTone and brandStyle would be
    // ignored by the resolver, so the read would be a query with no use.
    if (parsed.tone === undefined || parsed.style === undefined) {
      const brand = await this.loadBrand(projectId);
      if (brand) {
        context.brandVersion = brand.version;
        if (parsed.tone === undefined) {
          const tone = toneFromBrand(brand);
          if (tone) context.brandTone = tone;
        }
        if (parsed.style === undefined) {
          const style = styleFromBrand(brand);
          if (style) context.brandStyle = style;
        }
      }
    }

    if (this.deps.intelligence) {
      const snapshot = await this.deps.intelligence
        .latestSnapshot(projectId)
        .catch(() => null);
      if (snapshot) {
        context.intelligenceSnapshotVersion = snapshot.version;
      }

      if (parsed.subjectMentions.length > 0) {
        context.subjects = await this.linkSubjects(projectId, parsed);
      }
    }

    return context;
  }

  private async loadBrand(projectId: string): Promise<BrandProfile | null> {
    if (!this.deps.brand) return null;
    try {
      return await this.deps.brand.getByProjectId(projectId);
    } catch {
      // A brand that cannot be read is a missing brand, not a failed request:
      // the intent is still resolvable without it.
      return null;
    }
  }

  /**
   * Subject mentions become references only when a real entity matches. An
   * unlinked mention is left unresolved rather than pointed at a guess.
   */
  private async linkSubjects(
    projectId: string,
    parsed: ParsedIntent,
  ): Promise<IntentSubject[]> {
    const intelligence = this.deps.intelligence;
    if (!intelligence) return [];

    const subjects: IntentSubject[] = [];
    const linked = new Set<string>();

    for (const mention of parsed.subjectMentions) {
      const slug = canonicalSlug(mention.label);
      if (!slug) continue;

      if (mention.type === "PRODUCT") {
        const product = await intelligence.getProduct(projectId).catch(() => null);
        if (product && !linked.has(product.id)) {
          linked.add(product.id);
          subjects.push({ type: "PRODUCT", id: product.id });
        }
        continue;
      }

      const match = await this.findEntity(projectId, mention.type, slug);
      if (match && !linked.has(match.id)) {
        linked.add(match.id);
        subjects.push({ type: mention.type, id: match.id });
      }
    }

    return subjects;
  }

  private async findEntity(
    projectId: string,
    type: IntentSubjectType,
    slug: string,
  ): Promise<{ id: string; name: string } | null> {
    const intelligence = this.deps.intelligence;
    if (!intelligence) return null;

    const entities = await this.loadEntities(projectId, type);
    if (entities.length === 0) return null;

    const exact = entities.find((entity) => canonicalSlug(entity.name) === slug);
    if (exact) return exact;

    // A mention is often a fragment of a longer name ("analytics" inside
    // "analytics reporting"). A single containing match is a reference; several
    // are a genuine ambiguity, so nothing is linked.
    const containing = entities.filter((entity) =>
      canonicalSlug(entity.name).includes(slug),
    );
    return containing.length === 1 ? containing[0] : null;
  }

  private async loadEntities(
    projectId: string,
    type: IntentSubjectType,
  ): Promise<{ id: string; name: string }[]> {
    const intelligence = this.deps.intelligence!;
    try {
      switch (type) {
        case "FEATURE":
          return await intelligence.listFeatures(projectId);
        case "WORKFLOW":
          return await intelligence.listWorkflows(projectId);
        case "PROBLEM":
          return await intelligence.listProblems(projectId);
        case "BENEFIT":
          return await intelligence.listBenefits(projectId);
        case "CLAIM":
          // A claim is identified by its text, not a name.
          return (await intelligence.listClaims(projectId)).map((claim) => ({
            id: claim.id,
            name: claim.text,
          }));
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  private buildInterpretationRequest(
    projectId: string,
    rawRequest: string,
    parsed: ParsedIntent,
  ) {
    return {
      projectId,
      rawRequest,
      contentTypes: CONTENT_TYPES.map((contentType) => ({
        id: contentType.id,
        name: contentType.name,
        description: contentType.description,
        channel: contentType.channel,
        supportedPlatforms: contentType.supportedPlatforms,
      })),
      platforms: PLATFORMS.map((platform) => ({
        id: platform.id,
        name: platform.name,
        channels: platform.channels,
      })),
      projectContext: [
        parsed.platforms.length > 0
          ? `Platforms already stated: ${parsed.platforms.join(", ")}`
          : "Platforms already stated: -",
        parsed.subjectMentions.length > 0
          ? `Subjects mentioned: ${parsed.subjectMentions
              .map((mention) => `${mention.type}:${mention.label}`)
              .join(", ")}`
          : "Subjects mentioned: -",
      ].join("\n"),
    };
  }

  private normalizeEdit(edit: ContentIntentEdit): ContentIntentEdit {
    const normalized: ContentIntentEdit = {};

    if (edit.contentTypeId !== undefined) {
      const contentTypeId = edit.contentTypeId?.trim() ?? "";
      if (contentTypeId && !getContentType(contentTypeId)) {
        throw new ContentIntentError(
          "INTENT_INVALID_INPUT",
          `"${contentTypeId}" is not a supported content type`,
          ["CONTENT_TYPE_UNSUPPORTED"],
        );
      }
      normalized.contentTypeId = contentTypeId;
    }

    if (edit.platforms !== undefined) {
      const platforms = (edit.platforms ?? []).map((platform) => platform.trim().toLowerCase());
      normalized.platforms = [...new Set(platforms.filter(Boolean))];
    }

    if (edit.durationSeconds !== undefined) {
      normalized.durationSeconds = edit.durationSeconds;
    }

    if (edit.aspectRatio !== undefined) {
      if (edit.aspectRatio !== null && !isAspectRatio(edit.aspectRatio)) {
        throw new ContentIntentError(
          "INTENT_INVALID_INPUT",
          `"${String(edit.aspectRatio)}" is not a supported aspect ratio`,
          ["INVALID_ASPECT_RATIO"],
        );
      }
      normalized.aspectRatio = edit.aspectRatio as AspectRatio | null;
      normalized.customAspectRatio = edit.customAspectRatio ?? null;
    }

    if (edit.quantity !== undefined) {
      normalized.quantity = edit.quantity;
    }

    for (const key of [
      "tone",
      "style",
      "language",
      "audience",
      "cta",
      "purpose",
    ] as const) {
      if (edit[key] === undefined) continue;
      const value = edit[key];
      if (value === null) {
        normalized[key] = null;
        continue;
      }
      const trimmed = value.trim();
      if (trimmed.length > MAX_EDIT_VALUES[key]) {
        throw new ContentIntentError(
          "INTENT_INVALID_INPUT",
          `${key} may be at most ${MAX_EDIT_VALUES[key]} characters`,
        );
      }
      normalized[key] = trimmed;
    }

    if (Object.keys(normalized).length === 0) {
      throw new ContentIntentError(
        "INTENT_INVALID_INPUT",
        "At least one intent field is required",
      );
    }

    return normalized;
  }
}

function contentTypeOptions(): IntentClarification["options"] {
  // Registry order, not a ranking: recommending an asset is Checkpoint 12.
  return [
    ...CONTENT_TYPES.map((contentType) => ({
      value: contentType.id,
      label: contentType.name,
    })),
    { value: "other", label: "Something else" },
  ];
}

function platformOptions(
  type: ContentTypeDefinition,
): NonNullable<IntentClarification["options"]> {
  return type.supportedPlatforms
    .map((id) => {
      const platform = PLATFORMS.find((entry) => entry.id === id);
      return platform ? { value: platform.id, label: platform.name } : null;
    })
    .filter((option): option is { value: string; label: string } => option !== null);
}

/**
 * A tone is only read off the brand when the brand itself states one that CP09
 * recognises. Brand prose is not mined for adjectives: a guess from a sentence is
 * exactly the kind of inference a user cannot see and cannot correct.
 */
function toneFromBrand(brand: BrandProfile): string | undefined {
  return voiceSignalValue(brand, ["TONE", "TONE_OF_VOICE", "REGISTER"]);
}

function styleFromBrand(brand: BrandProfile): string | undefined {
  return voiceSignalValue(brand, ["VISUAL_STYLE", "STYLE"]);
}

function voiceSignalValue(
  brand: BrandProfile,
  kinds: readonly string[],
): string | undefined {
  for (const kind of kinds) {
    for (const signal of brand.voiceSignals) {
      if (signal.kind !== kind) continue;
      return signal.value.trim().toLowerCase() || undefined;
    }
  }
  return undefined;
}

/**
 * The model is asked only when the rules left a real gap: no content type, or a
 * type that was guessed rather than stated.
 */
function needsInterpretation(parsed: ParsedIntent): boolean {
  if (!parsed.contentTypeId) return true;
  if (parsed.contentTypeOrigin === "INFERRED") return true;
  return false;
}
