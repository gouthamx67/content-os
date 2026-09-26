import { createId as defaultCreateId } from "../../lib/id";
import {
  IntelligenceError,
  type AssertionKind,
  type AudienceSignal,
  type Benefit,
  type BrandSignal,
  type Claim,
  type EvidenceKind,
  type Feature,
  type IntelligenceAsset,
  type IntelligenceEntityType,
  type IntelligenceGraph,
  type IntelligenceRun,
  type IntelligenceSnapshot,
  type Problem,
  type VerificationStatus,
  type Workflow,
} from "../domain/intelligence";
import {
  MAX_LEXICAL_DIFFERENCE,
  canonicalEvidenceKey,
  lexicalDifference,
  normalizeIntelligenceText,
} from "../domain/intelligence-canonical";
import {
  draftEvidenceMap,
  emptyIntelligenceDraft,
  mergeDrafts,
  methodForDraftKind,
  type DraftClaim,
  type IntelligenceDraft,
} from "../domain/intelligence-draft";
import type {
  AssetValues,
  AudienceSignalValues,
  BenefitValues,
  BrandSignalValues,
  ClaimValues,
  CreateIntelligenceRunInput,
  EvidenceValues,
  FeatureValues,
  IntelligencePersistencePlan,
  IntelligenceRepository,
  ProblemValues,
  ProductValues,
  RelationshipValues,
  UpdateAssetInput,
  UpdateAudienceSignalInput,
  UpdateBenefitInput,
  UpdateBrandSignalInput,
  UpdateClaimInput,
  UpdateFeatureInput,
  UpdateProblemInput,
  UpdateProductInput,
  UpdateWorkflowInput,
  WorkflowValues,
} from "../ports/intelligence-repository";
import type {
  IntelligenceInterpretationProvider,
  IntelligenceInterpretationRequest,
} from "../ports/intelligence-provider";
import type { SourceAnalyzerRegistry } from "../ports/source-analyzer";
import type { SourceRepository } from "../ports/source-repository";
import type { Source } from "../domain/source";
import type { StorageProvider } from "../ports/storage-provider";
import type { ProjectService } from "./project-service";

export type IntelligenceTrigger = "INITIAL" | "MANUAL" | "REFRESH" | "SOURCE_CHANGED";

export interface IntelligenceRunOptions {
  trigger?: IntelligenceTrigger;
  sourceIds?: string[];
  model?: string;
  signal?: AbortSignal;
}

export interface IntelligenceSummary {
  project: { id: string; name: string };
  product: IntelligenceGraph["product"];
  counts: {
    features: number;
    problems: number;
    benefits: number;
    claims: number;
    workflows: number;
    audienceSignals: number;
    brandSignals: number;
    assets: number;
    evidence: number;
    relationships: number;
  };
  lastRun: IntelligenceRun | null;
  lastSnapshot: IntelligenceSnapshot | null;
}

export interface IntelligenceRunReport {
  run: IntelligenceRun;
  snapshot: IntelligenceSnapshot | null;
  graph: IntelligenceGraph;
  aiApplied: boolean;
  aiErrorCode: string | null;
  notes: string[];
}

export interface IntelligenceServiceDependencies {
  projectService: Pick<ProjectService, "getAuthorized">;
  sourceRepository: Pick<SourceRepository, "listByProject">;
  storageProvider: Pick<StorageProvider, "get">;
  analyzers: SourceAnalyzerRegistry;
  repository: IntelligenceRepository;
  interpretationProvider?: IntelligenceInterpretationProvider | null;
  now?: () => Date;
  createId?: (prefix: string) => string;
}

const TECHNICAL_EVIDENCE_KINDS = new Set<EvidenceKind>([
  "REPOSITORY_FILE",
  "SOURCE_FRAGMENT",
]);

const NEGATION_TERMS =
  "not|no|never|without|cannot|can't|doesn't|does not|isn't|is not|unsupported|lacks?|fails? to|neither|nor";

/** Global form is only safe with `replace`; never with `test`. */
const NEGATION_GLOBAL = new RegExp(`\\b(?:${NEGATION_TERMS})\\b`, "gi");
/** Non-global form is safe for `test` because it carries no lastIndex. */
const NEGATION_TEST = new RegExp(`\\b(?:${NEGATION_TERMS})\\b`, "i");

const MAX_CONFLICT_SCAN = 500;

interface PlanContext {
  projectId: string;
  now: string;
  newId: (prefix: string) => string;
  graph: IntelligenceGraph;
  pendingEvidence: EvidenceValues[];
  evidenceIds: Map<string, string>;
  entityIds: Map<IntelligenceEntityType, Map<string, string>>;
  derivedKeys: Set<string>;
  notes: string[];
}

export class IntelligenceService {
  private readonly projectService: IntelligenceServiceDependencies["projectService"];
  private readonly sourceRepository: IntelligenceServiceDependencies["sourceRepository"];
  private readonly storageProvider: IntelligenceServiceDependencies["storageProvider"];
  private readonly analyzers: SourceAnalyzerRegistry;
  private readonly repository: IntelligenceRepository;
  private readonly interpretationProvider: IntelligenceInterpretationProvider | null;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(dependencies: IntelligenceServiceDependencies) {
    this.projectService = dependencies.projectService;
    this.sourceRepository = dependencies.sourceRepository;
    this.storageProvider = dependencies.storageProvider;
    this.analyzers = dependencies.analyzers;
    this.repository = dependencies.repository;
    this.interpretationProvider = dependencies.interpretationProvider ?? null;
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? defaultCreateId;
  }

  async analyze(
    projectId: string,
    userId: string,
    options: IntelligenceRunOptions = {},
  ): Promise<IntelligenceRunReport> {
    await this.projectService.getAuthorized(projectId, userId);
    const active = await this.repository.findActiveRun(projectId);
    if (active) {
      throw new IntelligenceError(
        "INTELLIGENCE_ALREADY_RUNNING",
        `An intelligence run is already in progress for this project (run ${active.id})`,
      );
    }

    const allSources = await this.sourceRepository.listByProject(projectId);
    const eligible = allSources.filter((source) => source.status === "READY");
    const scoped = selectSources(eligible, options.sourceIds ?? null);
    if (scoped.length === 0) {
      throw new IntelligenceError(
        "INTELLIGENCE_INVALID_INPUT",
        "No readable sources are available to analyze",
      );
    }

    const run = await this.repository.createRun({
      id: this.createId("run"),
      projectId,
      status: "RUNNING",
      sourceIds: scoped.map((source) => source.id),
      provider: null,
      model: null,
      trigger: options.trigger ?? "MANUAL",
    } satisfies CreateIntelligenceRunInput);

    const notes: string[] = [];
    try {
      const deterministic = await this.runDeterministicAnalyzers(
        projectId,
        scoped,
        options.signal ?? null,
        notes,
      );
      await this.repository.updateRun(run.id, { startedAt: this.now().toISOString() });

      if (isEmptyDraft(deterministic)) {
        throw new IntelligenceError(
          "INTELLIGENCE_SOURCE_UNREADABLE",
          "Analysis of the selected sources produced no intelligence",
        );
      }

      const graphBefore = await this.repository.readGraph(projectId);
      let merged = deterministic;
      let aiApplied = false;
      let aiErrorCode: string | null = null;
      let provider: string | null = null;
      let model: string | null = null;

      if (this.interpretationProvider) {
        const outcome = await this.interpret(projectId, scoped, deterministic);
        if (outcome.error) {
          aiErrorCode = outcome.error.code;
          notes.push(`AI interpretation skipped: ${outcome.error.message}`);
        } else {
          merged = mergeDrafts(deterministic, outcome.result.draft);
          aiApplied = true;
          provider = outcome.result.provider;
          model = outcome.result.model;
        }
      } else {
        notes.push("AI interpretation disabled; deterministic analysis only");
      }

      const context = this.createPlanContext(projectId, graphBefore, notes);
      const plan = this.buildPlan(merged, context);
      await this.repository.applyGraph(projectId, plan);

      const graph = await this.repository.readGraph(projectId);
      const snapshot = await this.createSnapshot(run, graph, aiApplied);
      const completed = await this.repository.updateRun(run.id, {
        status: "COMPLETED",
        provider,
        model,
        errorCode: aiErrorCode,
        errorMessage: null,
        completedAt: this.now().toISOString(),
      });

      return {
        run: completed ?? { ...run, status: "COMPLETED" },
        snapshot,
        graph,
        aiApplied,
        aiErrorCode,
        notes,
      };
    } catch (cause) {
      const code = cause instanceof IntelligenceError ? cause.code : "INTELLIGENCE_SOURCE_UNREADABLE";
      const message = cause instanceof Error ? cause.message : "Intelligence analysis failed";
      await this.repository.updateRun(run.id, {
        status: "FAILED",
        errorCode: code,
        errorMessage: message,
        completedAt: this.now().toISOString(),
      });
      if (cause instanceof IntelligenceError) throw cause;
      throw new IntelligenceError("INTELLIGENCE_SOURCE_UNREADABLE", message);
    }
  }

  async refresh(projectId: string, userId: string): Promise<IntelligenceRunReport> {
    await this.projectService.getAuthorized(projectId, userId);
    const sources = await this.sourceRepository.listByProject(projectId);
    const ready = sources.filter((source) => source.status === "READY");
    if (ready.length === 0) {
      throw new IntelligenceError(
        "INTELLIGENCE_INVALID_INPUT",
        "No readable sources are available to refresh",
      );
    }

    const lastRun = (await this.repository.listRuns(projectId, 1))[0] ?? null;
    const changed = selectChangedSources(ready, lastRun);
    if (lastRun && changed.length === 0) {
      return {
        run: lastRun,
        snapshot: await this.repository.latestSnapshot(projectId),
        graph: await this.repository.readGraph(projectId),
        aiApplied: false,
        aiErrorCode: null,
        notes: ["No new or changed sources since the last analysis"],
      };
    }

    return this.analyze(projectId, userId, {
      trigger: "REFRESH",
      sourceIds: changed.map((source) => source.id),
    });
  }

  async getSummary(projectId: string, userId: string): Promise<IntelligenceSummary> {
    const project = await this.projectService.getAuthorized(projectId, userId);
    const graph = await this.repository.readGraph(projectId);
    const [lastRun, lastSnapshot] = await Promise.all([
      this.repository.listRuns(projectId, 1).then((runs) => runs[0] ?? null),
      this.repository.latestSnapshot(projectId),
    ]);

    return {
      project: { id: project.id, name: project.name },
      product: graph.product,
      counts: {
        features: graph.features.length,
        problems: graph.problems.length,
        benefits: graph.benefits.length,
        claims: graph.claims.length,
        workflows: graph.workflows.length,
        audienceSignals: graph.audienceSignals.length,
        brandSignals: graph.brandSignals.length,
        assets: graph.assets.length,
        evidence: graph.evidence.length,
        relationships: graph.relationships.length,
      },
      lastRun,
      lastSnapshot,
    };
  }

  async getProduct(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.getProduct(projectId);
  }

  async getGraph(projectId: string, userId: string): Promise<IntelligenceGraph> {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.readGraph(projectId);
  }

  async listSnapshots(projectId: string, userId: string, limit = 20) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listSnapshots(projectId, limit);
  }

  async listFeatures(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listFeatures(projectId);
  }

  async listProblems(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listProblems(projectId);
  }

  async listBenefits(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listBenefits(projectId);
  }

  async listClaims(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listClaims(projectId);
  }

  async listWorkflows(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listWorkflows(projectId);
  }

  async listAudienceSignals(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listAudienceSignals(projectId);
  }

  async listBrandSignals(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listBrandSignals(projectId);
  }

  async listAssets(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listAssets(projectId);
  }

  async listEvidence(projectId: string, userId: string) {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listEvidence(projectId);
  }

  async listRuns(projectId: string, userId: string, limit = 20): Promise<IntelligenceRun[]> {
    await this.projectService.getAuthorized(projectId, userId);
    return this.repository.listRuns(projectId, Math.min(Math.max(limit, 1), 100));
  }

  /**
   * User corrections keep the original canonical key as the entity identity.
   * Re-analysis re-derives that same key from the source, so a corrected name
   * is preserved instead of producing a duplicate.
   */
  async correctProduct(
    projectId: string,
    userId: string,
    changes: UpdateProductInput,
  ) {
    await this.projectService.getAuthorized(projectId, userId);
    const existing = await this.repository.getProduct(projectId);
    if (!existing) {
      throw new IntelligenceError("INTELLIGENCE_NOT_FOUND", "No product intelligence to correct");
    }
    return this.repository.updateProduct(projectId, { ...changes, userLocked: true });
  }

  async correctFeature(
    projectId: string,
    userId: string,
    canonicalKey: string,
    changes: UpdateFeatureInput,
  ): Promise<Feature | null> {
    await this.authorizeCorrection(projectId, userId, canonicalKey);
    return this.requireCorrection(
      await this.repository.updateFeature(projectId, canonicalKey, { ...changes, userLocked: true }),
      "feature",
      canonicalKey,
    );
  }

  async correctProblem(
    projectId: string,
    userId: string,
    canonicalKey: string,
    changes: UpdateProblemInput,
  ): Promise<Problem | null> {
    await this.authorizeCorrection(projectId, userId, canonicalKey);
    return this.requireCorrection(
      await this.repository.updateProblem(projectId, canonicalKey, { ...changes, userLocked: true }),
      "problem",
      canonicalKey,
    );
  }

  async correctBenefit(
    projectId: string,
    userId: string,
    canonicalKey: string,
    changes: UpdateBenefitInput,
  ): Promise<Benefit | null> {
    await this.authorizeCorrection(projectId, userId, canonicalKey);
    return this.requireCorrection(
      await this.repository.updateBenefit(projectId, canonicalKey, { ...changes, userLocked: true }),
      "benefit",
      canonicalKey,
    );
  }

  async correctClaim(
    projectId: string,
    userId: string,
    canonicalKey: string,
    changes: UpdateClaimInput,
  ): Promise<Claim | null> {
    await this.authorizeCorrection(projectId, userId, canonicalKey);
    return this.requireCorrection(
      await this.repository.updateClaim(projectId, canonicalKey, { ...changes, userLocked: true }),
      "claim",
      canonicalKey,
    );
  }

  async correctWorkflow(
    projectId: string,
    userId: string,
    canonicalKey: string,
    changes: UpdateWorkflowInput,
  ): Promise<Workflow | null> {
    await this.authorizeCorrection(projectId, userId, canonicalKey);
    return this.requireCorrection(
      await this.repository.updateWorkflow(projectId, canonicalKey, { ...changes, userLocked: true }),
      "workflow",
      canonicalKey,
    );
  }

  async correctAudienceSignal(
    projectId: string,
    userId: string,
    canonicalKey: string,
    changes: UpdateAudienceSignalInput,
  ): Promise<AudienceSignal | null> {
    await this.authorizeCorrection(projectId, userId, canonicalKey);
    return this.requireCorrection(
      await this.repository.updateAudienceSignal(projectId, canonicalKey, {
        ...changes,
        userLocked: true,
      }),
      "audience signal",
      canonicalKey,
    );
  }

  async correctBrandSignal(
    projectId: string,
    userId: string,
    canonicalKey: string,
    changes: UpdateBrandSignalInput,
  ): Promise<BrandSignal | null> {
    await this.authorizeCorrection(projectId, userId, canonicalKey);
    return this.requireCorrection(
      await this.repository.updateBrandSignal(projectId, canonicalKey, { ...changes, userLocked: true }),
      "brand signal",
      canonicalKey,
    );
  }

  async correctAsset(
    projectId: string,
    userId: string,
    canonicalKey: string,
    changes: UpdateAssetInput,
  ): Promise<IntelligenceAsset | null> {
    await this.authorizeCorrection(projectId, userId, canonicalKey);
    return this.requireCorrection(
      await this.repository.updateAsset(projectId, canonicalKey, { ...changes, userLocked: true }),
      "asset",
      canonicalKey,
    );
  }

  private async authorizeCorrection(
    projectId: string,
    userId: string,
    canonicalKey: string,
  ): Promise<void> {
    await this.projectService.getAuthorized(projectId, userId);
    if (canonicalKey.trim().length === 0) {
      throw new IntelligenceError("INTELLIGENCE_INVALID_INPUT", "A canonical key is required");
    }
  }

  private requireCorrection<TEntity>(
    updated: TEntity | null,
    label: string,
    canonicalKey: string,
  ): TEntity {
    if (updated === null) {
      throw new IntelligenceError(
        "INTELLIGENCE_NOT_FOUND",
        `No ${label} with canonical key ${canonicalKey} to correct`,
      );
    }
    return updated;
  }

  private async runDeterministicAnalyzers(
    projectId: string,
    sources: readonly Source[],
    signal: AbortSignal | null,
    notes: string[],
  ): Promise<IntelligenceDraft> {
    let draft = emptyIntelligenceDraft();

    for (const source of sources) {
      if (signal?.aborted) {
        throw new IntelligenceError("INTELLIGENCE_INVALID_INPUT", "Analysis was cancelled");
      }

      const analyzer = this.analyzers.find(source);
      if (!analyzer) {
        notes.push(`No analyzer supports source ${source.id} (${source.type})`);
        continue;
      }

      let bytes: Uint8Array | null = null;
      if (source.storageKey) {
        try {
          bytes = await this.storageProvider.get(source.storageKey);
        } catch (cause) {
          notes.push(
            `Could not read stored bytes for source ${source.id}: ${
              cause instanceof Error ? cause.message : "unknown error"
            }`,
          );
        }
      } else {
        notes.push(`Source ${source.id} has no stored bytes; only metadata was analyzed`);
      }

      try {
        const result = await analyzer.analyze({
          projectId,
          source,
          bytes,
          signal: signal ?? undefined,
        });
        draft = mergeDrafts(draft, result.draft);
        notes.push(...result.notes);
      } catch (cause) {
        notes.push(
          `Analyzer ${analyzer.id} failed for source ${source.id}: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
        );
      }
    }

    return draft;
  }

  private async interpret(
    projectId: string,
    sources: readonly Source[],
    draft: IntelligenceDraft,
  ): Promise<
    | { result: Awaited<ReturnType<IntelligenceInterpretationProvider["interpret"]>>; error?: never }
    | { error: IntelligenceError; result?: never }
  > {
    const evidence = [...draftEvidenceMap(draft).values()].map((item) => ({
      key: item.key,
      sourceId: item.sourceId,
      kind: item.kind,
      locator: item.locator,
    }));

    const request: IntelligenceInterpretationRequest = {
      projectId,
      sources: sources.map((source) => ({
        id: source.id,
        type: source.type,
        name: source.name,
      })),
      evidence,
      observations: buildObservations(sources, draft),
    };

    try {
      return { result: await this.interpretationProvider!.interpret(request) };
    } catch (cause) {
      if (cause instanceof IntelligenceError) return { error: cause };
      return {
        error: new IntelligenceError(
          "INTELLIGENCE_AI_UNAVAILABLE",
          cause instanceof Error ? cause.message : "Intelligence model call failed",
        ),
      };
    }
  }

  private createPlanContext(
    projectId: string,
    graph: IntelligenceGraph,
    notes: string[],
  ): PlanContext {
    const entityIds = new Map<IntelligenceEntityType, Map<string, string>>();
    const index = <T extends { id: string; canonicalKey: string }>(
      type: IntelligenceEntityType,
      items: readonly T[],
    ) => {
      const map = new Map<string, string>();
      for (const item of items) map.set(item.canonicalKey, item.id);
      entityIds.set(type, map);
    };

    index("FEATURE", graph.features);
    index("PROBLEM", graph.problems);
    index("BENEFIT", graph.benefits);
    index("CLAIM", graph.claims);
    index("WORKFLOW", graph.workflows);
    index("AUDIENCE_SIGNAL", graph.audienceSignals);
    index("BRAND_SIGNAL", graph.brandSignals);
    index("ASSET", graph.assets);

    const evidenceIds = new Map<string, string>();
    for (const item of graph.evidence) {
      evidenceIds.set(canonicalEvidenceKey(item.sourceId, item.kind, item.locator), item.id);
    }

    return {
      projectId,
      now: this.now().toISOString(),
      newId: this.createId,
      graph,
      pendingEvidence: [],
      evidenceIds,
      entityIds,
      derivedKeys: new Set<string>(),
      notes,
    };
  }

  private idFor(context: PlanContext, type: IntelligenceEntityType, key: string): string {
    const table = context.entityIds.get(type);
    if (!table) throw new IntelligenceError("INTELLIGENCE_INVALID_INPUT", `Unknown type ${type}`);
    const existing = table.get(key);
    if (existing) return existing;
    const created = context.newId(idPrefixFor(type));
    table.set(key, created);
    return created;
  }

  private buildPlan(draft: IntelligenceDraft, context: PlanContext): IntelligencePersistencePlan {
    const evidence = this.planEvidence(draft, context);
    context.pendingEvidence = evidence;
    const product = this.planProduct(draft, context);
    const claims = this.planClaims(draft, context);

    return {
      product,
      features: this.planFeatures(draft, context),
      problems: this.planProblems(draft, context),
      benefits: this.planBenefits(draft, context),
      claims,
      workflows: this.planWorkflows(draft, context),
      audienceSignals: this.planAudienceSignals(draft, context),
      brandSignals: this.planBrandSignals(draft, context),
      assets: this.planAssets(draft, context),
      evidence,
      relationships: this.planRelationships(draft, context),
    };
  }

  private planEvidence(draft: IntelligenceDraft, context: PlanContext): EvidenceValues[] {
    const known = new Map(
      context.graph.evidence.map((item) => [
        canonicalEvidenceKey(item.sourceId, item.kind, item.locator),
        item,
      ]),
    );
    const planned = draft.evidence.map((item) => {
      const existing = known.get(item.key);
      const id = existing?.id ?? context.newId("evd");
      context.evidenceIds.set(item.key, id);
      return {
        id,
        key: item.key,
        sourceId: item.sourceId,
        kind: item.kind,
        locator: item.locator,
        excerpt: item.excerpt ?? existing?.excerpt ?? null,
        metadata: item.metadata ?? existing?.metadata ?? null,
      };
    });
    context.pendingEvidence = planned;
    return planned;
  }

  /**
   * A user correction wins over anything re-derived from the sources. The rule
   * lives here, not in each repository, so every storage backend preserves
   * corrections identically. Provenance still refreshes, and the evidence union
   * is kept so the analyzer trail behind a corrected entity is not lost.
   */
  private pickContent<TDerived extends object>(
    existing: { userLocked: boolean } | null,
    derived: TDerived,
    userLocked: boolean,
    fields: readonly (keyof TDerived)[],
  ): TDerived {
    if (!userLocked || !existing) return derived;
    const picked: Record<string, unknown> = { ...(derived as object) } as Record<string, unknown>;
    const source = existing as unknown as Record<string, unknown>;
    for (const field of fields) {
      if (field in source) picked[field as string] = source[field as string];
    }
    return picked as TDerived;
  }

  private resolveMethod(
    existing: { userLocked: boolean } | null,
    derived: AssertionKind,
  ): ReturnType<typeof methodForDraftKind> {
    if (existing?.userLocked) return "USER_INPUT";
    return methodForDraftKind(derived);
  }

  private resolveEvidence(
    existing: { provenance: { evidenceIds: string[] } | null } | null,
    userLocked: boolean,
    derived: string[],
  ): string[] {
    if (!userLocked || !existing) return derived;
    return unique([...(existing.provenance?.evidenceIds ?? []), ...derived]);
  }

  private evidenceIdList(context: PlanContext, keys: readonly string[]): string[] {
    const ids: string[] = [];
    for (const key of keys) {
      const id = context.evidenceIds.get(key);
      if (id) ids.push(id);
    }
    return unique(ids);
  }

  private planProduct(draft: IntelligenceDraft, context: PlanContext) {
    if (!draft.product) return null;
    const existing = context.graph.product;
    const locked = existing?.userLocked ?? false;
    const keep = this.pickContent(existing, draft.product, locked, [
      "name",
      "shortDescription",
      "longDescription",
      "category",
      "purpose",
      "valueProposition",
      "targetUserSummary",
      "confidence",
      "assertionKind",
    ]);
    const values: ProductValues = {
      name: keep.name,
      shortDescription: keep.shortDescription,
      longDescription: keep.longDescription,
      category: keep.category,
      purpose: keep.purpose,
      valueProposition: keep.valueProposition,
      targetUserSummary: keep.targetUserSummary,
      confidence: keep.confidence,
      assertionKind: keep.assertionKind,
      userLocked: locked,
      sourceIds: keep.sourceIds,
      evidenceIds: this.resolveEvidence(existing, locked, this.evidenceIdList(context, draft.product.evidenceKeys)),
      method: this.resolveMethod(existing, draft.product.assertionKind),
      extractedAt: context.now,
    };
    return { id: context.projectId, isNew: existing === null, values };
  }

  private planFeatures(draft: IntelligenceDraft, context: PlanContext) {
    return draft.features.map((feature) => {
      const key = feature.key;
      const existing = context.graph.features.find((item) => item.canonicalKey === key) ?? null;
      const locked = existing?.userLocked ?? false;
      const keep = this.pickContent(existing, feature, locked, [
        "name",
        "description",
        "category",
        "importance",
        "confidence",
        "assertionKind",
      ]);
      const values: FeatureValues = {
        name: keep.name,
        description: keep.description,
        category: keep.category,
        importance: keep.importance,
        confidence: keep.confidence,
        assertionKind: keep.assertionKind,
        userLocked: locked,
        canonicalKey: key,
        sourceIds: locked && existing?.provenance ? existing.provenance.sourceIds : feature.sourceIds,
        evidenceIds: this.resolveEvidence(existing, locked, this.evidenceIdList(context, feature.evidenceKeys)),
        method: this.resolveMethod(existing, feature.assertionKind),
        extractedAt: context.now,
      };
      context.derivedKeys.add(key);
      return { id: this.idFor(context, "FEATURE", key), isNew: existing === null, values };
    });
  }

  private planProblems(draft: IntelligenceDraft, context: PlanContext) {
    return draft.problems.map((problem) => {
      const key = problem.key;
      const existing = context.graph.problems.find((item) => item.canonicalKey === key) ?? null;
      const locked = existing?.userLocked ?? false;
      const keep = this.pickContent(existing, problem, locked, [
        "name",
        "description",
        "confidence",
        "assertionKind",
      ]);
      const values: ProblemValues = {
        name: keep.name,
        description: keep.description,
        confidence: keep.confidence,
        assertionKind: keep.assertionKind,
        userLocked: locked,
        canonicalKey: key,
        sourceIds: locked && existing?.provenance ? existing.provenance.sourceIds : problem.sourceIds,
        evidenceIds: this.resolveEvidence(existing, locked, this.evidenceIdList(context, problem.evidenceKeys)),
        method: this.resolveMethod(existing, problem.assertionKind),
        extractedAt: context.now,
      };
      context.derivedKeys.add(key);
      return { id: this.idFor(context, "PROBLEM", key), isNew: existing === null, values };
    });
  }

  private planBenefits(draft: IntelligenceDraft, context: PlanContext) {
    return draft.benefits.map((benefit) => {
      const key = benefit.key;
      const existing = context.graph.benefits.find((item) => item.canonicalKey === key) ?? null;
      const locked = existing?.userLocked ?? false;
      const linkedFeatureIds = this.resolveKeys(context, "FEATURE", benefit.linkedFeatureKeys);
      const keep = this.pickContent(existing, benefit, locked, [
        "name",
        "description",
        "confidence",
        "assertionKind",
      ]);
      const values: BenefitValues = {
        name: keep.name,
        description: keep.description,
        linkedFeatureIds: locked && existing ? existing.linkedFeatureIds : linkedFeatureIds,
        confidence: keep.confidence,
        assertionKind: keep.assertionKind,
        userLocked: locked,
        canonicalKey: key,
        sourceIds: locked && existing?.provenance ? existing.provenance.sourceIds : benefit.sourceIds,
        evidenceIds: this.resolveEvidence(existing, locked, this.evidenceIdList(context, benefit.evidenceKeys)),
        method: this.resolveMethod(existing, benefit.assertionKind),
        extractedAt: context.now,
      };
      context.derivedKeys.add(key);
      return { id: this.idFor(context, "BENEFIT", key), isNew: existing === null, values };
    });
  }

  private planClaims(draft: IntelligenceDraft, context: PlanContext) {
    const prepared = draft.claims.map((claim) => ({
      claim,
      id: this.idFor(context, "CLAIM", claim.key),
      isNew: !context.graph.claims.some((item) => item.canonicalKey === claim.key),
    }));
    const conflicts = detectClaimConflicts(prepared.map((item) => item.claim));

    return prepared.map(({ claim, id, isNew }) => {
      const existing = context.graph.claims.find((item) => item.canonicalKey === claim.key) ?? null;
      const evidenceIds = this.evidenceIdList(context, claim.evidenceKeys);
      const technical = evidenceIds.some((evidenceId) =>
        this.isTechnicalEvidence(context, evidenceId),
      );
      const conflictingKey = conflicts.get(claim.key) ?? null;
      const conflictingId = conflictingKey
        ? this.idFor(context, "CLAIM", conflictingKey)
        : null;
      const verification = resolveVerification(
        claim.assertionKind,
        technical,
        conflictingId !== null,
      );
      const locked = existing?.userLocked ?? false;
      const keep = this.pickContent(
        existing,
        {
          text: claim.text,
          claimType: claim.claimType,
          verification,
          confidence: claim.confidence,
          assertionKind: claim.assertionKind,
        },
        locked,
        ["text", "claimType", "verification", "confidence", "assertionKind"],
      );
      const values: ClaimValues = {
        text: keep.text,
        claimType: keep.claimType,
        sourceId: claim.sourceId,
        verification: keep.verification,
        conflictsWithClaimId: conflictingId,
        confidence: keep.confidence,
        assertionKind: keep.assertionKind,
        userLocked: locked,
        canonicalKey: claim.key,
        sourceIds: locked && existing?.provenance ? existing.provenance.sourceIds : claim.sourceIds,
        evidenceIds: this.resolveEvidence(existing, locked, evidenceIds),
        method: this.resolveMethod(existing, claim.assertionKind),
        extractedAt: context.now,
      };
      context.derivedKeys.add(claim.key);
      return { id, isNew, values };
    });
  }

  private isTechnicalEvidence(context: PlanContext, evidenceId: string): boolean {
    const found = context.graph.evidence.find((item) => item.id === evidenceId);
    if (found) return TECHNICAL_EVIDENCE_KINDS.has(found.kind);
    const pending = context.pendingEvidence?.find((item) => item.id === evidenceId);
    return pending ? TECHNICAL_EVIDENCE_KINDS.has(pending.kind) : false;
  }

  private planWorkflows(draft: IntelligenceDraft, context: PlanContext) {
    return draft.workflows.map((workflow) => {
      const key = workflow.key;
      const existing = context.graph.workflows.find((item) => item.canonicalKey === key) ?? null;
      const locked = existing?.userLocked ?? false;
      const steps = workflow.steps.map((step) => ({
        order: step.order,
        action: step.action,
        description: step.description,
        featureIds: this.resolveKeys(context, "FEATURE", step.featureKeys),
      }));
      const keep = this.pickContent(
        existing,
        {
          name: workflow.name,
          description: workflow.description,
          steps,
          confidence: workflow.confidence,
          assertionKind: workflow.assertionKind,
        },
        locked,
        ["name", "description", "steps", "confidence", "assertionKind"],
      );
      const values: WorkflowValues = {
        name: keep.name,
        description: keep.description,
        steps: keep.steps,
        featureIds: locked && existing ? existing.featureIds : this.resolveKeys(context, "FEATURE", workflow.featureKeys),
        confidence: keep.confidence,
        assertionKind: keep.assertionKind,
        userLocked: locked,
        canonicalKey: key,
        sourceIds: locked && existing?.provenance ? existing.provenance.sourceIds : workflow.sourceIds,
        evidenceIds: this.resolveEvidence(existing, locked, this.evidenceIdList(context, workflow.evidenceKeys)),
        method: this.resolveMethod(existing, workflow.assertionKind),
        extractedAt: context.now,
      };
      context.derivedKeys.add(key);
      return { id: this.idFor(context, "WORKFLOW", key), isNew: existing === null, values };
    });
  }

  private planAudienceSignals(draft: IntelligenceDraft, context: PlanContext) {
    return draft.audienceSignals.map((signal) => {
      const key = signal.key;
      const existing =
        context.graph.audienceSignals.find((item) => item.canonicalKey === key) ?? null;
      const locked = existing?.userLocked ?? false;
      const keep = this.pickContent(existing, signal, locked, [
        "segment",
        "description",
        "kind",
        "confidence",
        "assertionKind",
      ]);
      const values: AudienceSignalValues = {
        segment: keep.segment,
        description: keep.description,
        kind: keep.kind,
        confidence: keep.confidence,
        assertionKind: keep.assertionKind,
        userLocked: locked,
        canonicalKey: key,
        sourceIds: locked && existing?.provenance ? existing.provenance.sourceIds : signal.sourceIds,
        evidenceIds: this.resolveEvidence(existing, locked, this.evidenceIdList(context, signal.evidenceKeys)),
        method: this.resolveMethod(existing, signal.assertionKind),
        extractedAt: context.now,
      };
      context.derivedKeys.add(key);
      return { id: this.idFor(context, "AUDIENCE_SIGNAL", key), isNew: existing === null, values };
    });
  }

  private planBrandSignals(draft: IntelligenceDraft, context: PlanContext) {
    return draft.brandSignals.map((signal) => {
      const key = signal.key;
      const existing =
        context.graph.brandSignals.find((item) => item.canonicalKey === key) ?? null;
      const locked = existing?.userLocked ?? false;
      const keep = this.pickContent(existing, signal, locked, [
        "kind",
        "label",
        "value",
        "confidence",
        "assertionKind",
      ]);
      const values: BrandSignalValues = {
        kind: keep.kind,
        label: keep.label,
        value: keep.value,
        confidence: keep.confidence,
        assertionKind: keep.assertionKind,
        userLocked: locked,
        canonicalKey: key,
        sourceIds: locked && existing?.provenance ? existing.provenance.sourceIds : signal.sourceIds,
        evidenceIds: this.resolveEvidence(existing, locked, this.evidenceIdList(context, signal.evidenceKeys)),
        method: this.resolveMethod(existing, signal.assertionKind),
        extractedAt: context.now,
      };
      context.derivedKeys.add(key);
      return { id: this.idFor(context, "BRAND_SIGNAL", key), isNew: existing === null, values };
    });
  }

  private planAssets(draft: IntelligenceDraft, context: PlanContext) {
    return draft.assets.map((asset) => {
      const key = asset.key;
      const existing = context.graph.assets.find((item) => item.canonicalKey === key) ?? null;
      const locked = existing?.userLocked ?? false;
      const keep = this.pickContent(
        existing,
        {
          name: asset.name,
          role: asset.role,
          confidence: asset.confidence,
          assertionKind: asset.assertionKind,
        },
        locked,
        ["name", "role", "confidence", "assertionKind"],
      );
      const values: AssetValues = {
        sourceId: asset.sourceId,
        name: keep.name,
        mediaType: asset.mediaType,
        role: keep.role,
        storageKey: null,
        mimeType: null,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        qualitySignals: asset.qualitySignals,
        relatedFeatureIds: this.resolveKeys(context, "FEATURE", asset.relatedFeatureKeys),
        relatedClaimIds: this.resolveKeys(context, "CLAIM", asset.relatedClaimKeys),
        confidence: keep.confidence,
        assertionKind: keep.assertionKind,
        userLocked: locked,
        canonicalKey: key,
        sourceIds: locked && existing?.provenance ? existing.provenance.sourceIds : asset.sourceIds,
        evidenceIds: this.resolveEvidence(existing, locked, this.evidenceIdList(context, asset.evidenceKeys)),
        method: this.resolveMethod(existing, asset.assertionKind),
        extractedAt: context.now,
      };
      context.derivedKeys.add(key);
      return { id: this.idFor(context, "ASSET", key), isNew: existing === null, values };
    });
  }

  private resolveKeys(
    context: PlanContext,
    type: IntelligenceEntityType,
    keys: readonly string[],
  ): string[] {
    const ids: string[] = [];
    for (const key of keys) {
      const id = context.entityIds.get(type)?.get(key);
      if (id) ids.push(id);
    }
    return unique(ids);
  }

  /**
   * Derived relationships replace any existing relationship that touches a
   * re-derived entity, so a partial re-analysis cannot orphan edges that were
   * produced by sources outside the current run.
   */
  private planRelationships(draft: IntelligenceDraft, context: PlanContext) {
    const derived: RelationshipValues[] = [];
    const seen = new Set<string>();

    for (const relationship of draft.relationships) {
      const fromId = context.entityIds.get(relationship.fromType)?.get(relationship.fromKey);
      const toId = toEntityId(context, relationship);
      if (!fromId || !toId) continue;

      const dedupe = `${relationship.type}:${fromId}:${toId}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      derived.push({
        type: relationship.type,
        fromType: relationship.fromType,
        fromId,
        toType: relationship.toType,
        toId,
        confidence: relationship.confidence,
      });
    }

    const carried = carryForwardRelationships(context.graph, derived, context.derivedKeys);
    return [...derived, ...carried];
  }

  private async createSnapshot(
    run: IntelligenceRun,
    graph: IntelligenceGraph,
    aiApplied: boolean,
  ): Promise<IntelligenceSnapshot> {
    const previous = await this.repository.latestSnapshot(run.projectId);
    const counts = {
      features: graph.features.length,
      problems: graph.problems.length,
      benefits: graph.benefits.length,
      claims: graph.claims.length,
      workflows: graph.workflows.length,
      audienceSignals: graph.audienceSignals.length,
      brandSignals: graph.brandSignals.length,
      assets: graph.assets.length,
      evidence: graph.evidence.length,
      relationships: graph.relationships.length,
      verifiedClaims: graph.claims.filter((claim) => claim.verification === "SUPPORTED").length,
      unverifiedClaims: graph.claims.filter((claim) => claim.verification === "UNVERIFIED").length,
    };

    const summary = [
      graph.product?.name ? `Product: ${graph.product.name}` : "Product: not yet identified",
      `${counts.features} features, ${counts.workflows} workflows, ${counts.assets} assets`,
      `${counts.verifiedClaims} supported / ${counts.unverifiedClaims} unverified claims`,
      aiApplied ? "AI interpretation applied" : "Deterministic analysis only",
    ].join(" | ");

    return this.repository.createSnapshot({
      id: this.createId("snap"),
      projectId: run.projectId,
      version: (previous?.version ?? 0) + 1,
      runId: run.id,
      summary,
      entityCounts: JSON.stringify(counts),
    });
  }
}

/**
 * A run must not silently succeed with nothing to show. An empty deterministic
 * result means every analyzer failed or every source was unreadable, which is a
 * failed run rather than a successful empty graph.
 */
function isEmptyDraft(draft: IntelligenceDraft): boolean {
  return (
    draft.product === null &&
    draft.features.length === 0 &&
    draft.problems.length === 0 &&
    draft.benefits.length === 0 &&
    draft.claims.length === 0 &&
    draft.workflows.length === 0 &&
    draft.audienceSignals.length === 0 &&
    draft.brandSignals.length === 0 &&
    draft.assets.length === 0 &&
    draft.relationships.length === 0
  );
}

function toEntityId(context: PlanContext, relationship: { toType: IntelligenceEntityType; toKey: string }): string | undefined {
  if (relationship.toType === "EVIDENCE") return context.evidenceIds.get(relationship.toKey);
  return context.entityIds.get(relationship.toType)?.get(relationship.toKey);
}

function selectSources(sources: readonly Source[], filter: string[] | null): Source[] {
  if (!filter) return [...sources];
  const wanted = new Set(filter);
  return sources.filter((source) => wanted.has(source.id));
}

/**
 * A refresh only re-reads sources that the previous run did not cover, or that
 * were written after it finished. Everything the previous run derived stays in
 * the graph, so a partial refresh adds knowledge instead of replacing it.
 */
function selectChangedSources(sources: readonly Source[], lastRun: IntelligenceRun | null): Source[] {
  if (!lastRun) return [...sources];
  const analyzed = new Set(lastRun.sourceIds);
  const analyzedAt = parseTimestamp(lastRun.completedAt ?? lastRun.startedAt ?? lastRun.createdAt);
  return sources.filter((source) => {
    if (!analyzed.has(source.id)) return true;
    const writtenAt = parseTimestamp(source.updatedAt);
    if (writtenAt === null) return true;
    if (analyzedAt === null) return true;
    return writtenAt > analyzedAt;
  });
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function idPrefixFor(type: IntelligenceEntityType): string {
  switch (type) {
    case "FEATURE":
      return "feat";
    case "PROBLEM":
      return "prob";
    case "BENEFIT":
      return "benf";
    case "CLAIM":
      return "clm";
    case "WORKFLOW":
      return "flow";
    case "AUDIENCE_SIGNAL":
      return "aud";
    case "BRAND_SIGNAL":
      return "brnd";
    case "ASSET":
      return "asst";
    case "EVIDENCE":
      return "evd";
    case "PRODUCT":
      return "prd";
    default:
      return "intel";
  }
}

function stripNegation(text: string): string {
  return normalizeIntelligenceText(text.replace(NEGATION_GLOBAL, " "));
}

/**
 * Two claims contradict each other when they state the same thing with opposite
 * polarity, e.g. "Exports to CSV" and "Does not export to CSV". Polarity is
 * stripped before comparison, so a negated claim that was previously stored
 * cannot be silently overwritten by its positive twin.
 */
/**
 * `lexicalDifference` is deliberately conservative because it guards entity
 * dedup, where a false merge is worse than a missed one. Contradiction
 * detection needs the opposite bias, so the comparison stems trivial
 * inflections first: "Exports to CSV" and "Does not export to CSV" are the same
 * statement with opposite polarity.
 */
function stemToken(token: string): string {
  return token
    .replace(/ies$/i, "y")
    .replace(/(?:es|s)$/i, "")
    .replace(/(?:ing|ed)$/i, "");
}

function conflictBody(text: string): string {
  return stripNegation(text)
    .split(" ")
    .map(stemToken)
    .filter((token) => token.length > 1)
    .sort()
    .join(" ");
}

function detectClaimConflicts(claims: readonly DraftClaim[]): Map<string, string> {
  const result = new Map<string, string>();
  const scanned = claims.slice(0, MAX_CONFLICT_SCAN).map((claim) => ({
    key: claim.key,
    body: conflictBody(claim.text),
    text: claim.text,
    negated: NEGATION_TEST.test(claim.text),
  }));

  for (const claim of scanned) {
    if (claim.body.length < 6) continue;
    for (const other of scanned) {
      if (other.key === claim.key) continue;
      if (other.negated === claim.negated) continue;
      if (other.body.length < 6) continue;
      const sameStatement =
        claim.body === other.body ||
        lexicalDifference(claim.body, other.body) <= MAX_LEXICAL_DIFFERENCE;
      if (!sameStatement) continue;
      result.set(claim.key, other.key);
      break;
    }
  }

  return result;
}

/**
 * Only technical evidence can verify a claim. Marketing prose on a website is
 * never enough: a claim that cites nothing but URL or document sections stays
 * UNVERIFIED. Technical evidence fully supports a plain capability claim, but
 * only partially supports a marketing claim, because code cannot confirm the
 * promotional framing.
 */
function resolveVerification(
  assertionKind: AssertionKind,
  hasTechnicalEvidence: boolean,
  hasConflict: boolean,
): VerificationStatus {
  if (hasConflict) return "CONFLICTING";
  if (!hasTechnicalEvidence) return "UNVERIFIED";
  return assertionKind === "MARKETING_CLAIM" ? "PARTIALLY_SUPPORTED" : "SUPPORTED";
}

function carryForwardRelationships(
  graph: IntelligenceGraph,
  derived: readonly RelationshipValues[],
  derivedKeys: ReadonlySet<string>,
): RelationshipValues[] {
  const keyByEntity = new Map<string, string>();
  for (const entity of graphEntitiesWithKeys(graph)) {
    keyByEntity.set(entity.id, entity.canonicalKey);
  }

  const derivedPairs = new Set(derived.map((item) => `${item.fromId}:${item.toId}:${item.type}`));
  const carried: RelationshipValues[] = [];
  const seen = new Set<string>();

  for (const relationship of graph.relationships) {
    const pair = `${relationship.fromId}:${relationship.toId}:${relationship.type}`;
    if (derivedPairs.has(pair)) continue;
    if (seen.has(pair)) continue;
    seen.add(pair);

    const fromKey = keyByEntity.get(relationship.fromId);
    const toKey = keyByEntity.get(relationship.toId);
    if (fromKey && derivedKeys.has(fromKey)) continue;
    if (toKey && derivedKeys.has(toKey)) continue;

    carried.push({
      type: relationship.type,
      fromType: relationship.fromType,
      fromId: relationship.fromId,
      toType: relationship.toType,
      toId: relationship.toId,
      confidence: relationship.confidence,
    });
  }

  return carried;
}

function graphEntitiesWithKeys(graph: IntelligenceGraph): { id: string; canonicalKey: string }[] {
  return [
    ...graph.features,
    ...graph.problems,
    ...graph.benefits,
    ...graph.claims,
    ...graph.workflows,
    ...graph.audienceSignals,
    ...graph.brandSignals,
    ...graph.assets,
  ];
}

function buildObservations(sources: readonly Source[], draft: IntelligenceDraft): string {
  const lines: string[] = [`Analyzed sources: ${sources.map((source) => `${source.type}:${source.name}`).join(", ")}`];

  if (draft.product) {
    lines.push(`Observed product name: ${draft.product.name ?? "unknown"}`);
  }
  if (draft.features.length > 0) {
    lines.push(`Observed feature candidates: ${draft.features.map((item) => item.name).join("; ")}`);
  }
  if (draft.claims.length > 0) {
    lines.push(`Observed claim candidates: ${draft.claims.map((item) => item.text).join("; ")}`);
  }
  if (draft.evidence.length > 0) {
    lines.push(`Gathered ${draft.evidence.length} evidence records.`);
  }
  return lines.join("\n");
}

export const __testables = {
  detectClaimConflicts,
  resolveVerification,
  carryForwardRelationships,
  buildObservations,
  selectSources,
  stripNegation,
  idPrefixFor,
};
