import { describe, expect, it } from "vitest";

import {
  IntelligenceError,
  type IntelligenceGraph,
  type IntelligenceRun,
  type IntelligenceRunStatus,
  type IntelligenceSnapshot,
  type WorkflowStep,
} from "../domain/intelligence";
import {
  canonicalEntityKey,
  canonicalEvidenceKey,
} from "../domain/intelligence-canonical";
import type { Project } from "../domain/project";
import type { Feature } from "../domain/intelligence";
import {
  addDraftEvidence,
  emptyIntelligenceDraft,
  type DraftFeature,
  type IntelligenceDraft,
} from "../domain/intelligence-draft";
import type {
  CreateIntelligenceRunInput,
  IntelligencePersistencePlan,
  IntelligenceRepository,
  UpdateIntelligenceRunInput,
  UpdateAssetInput,
  UpdateAudienceSignalInput,
  UpdateBenefitInput,
  UpdateBrandSignalInput,
  UpdateClaimInput,
  UpdateFeatureInput,
  UpdateProblemInput,
  UpdateProductInput,
  UpdateWorkflowInput,
} from "../ports/intelligence-repository";
import { SourceAnalyzerRegistry } from "../ports/source-analyzer";
import type { Source } from "../domain/source";
import { IntelligenceService } from "./intelligence-service";

interface FakeRow {
  id: string;
  userLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

const PROJECT_ID = "proj_1";
const USER_ID = "user_1";
const REPO_SOURCE: Source = {
  id: "src_repo",
  projectId: PROJECT_ID,
  type: "GITHUB",
  name: "acme/content-os",
  uri: "https://github.com/acme/content-os",
  metadata: null,
  status: "READY",
  mimeType: null,
  sizeBytes: 10,
  contentHash: "hash_1",
  storageKey: "uploads/repo.zip",
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const SITE_SOURCE: Source = {
  ...REPO_SOURCE,
  id: "src_site",
  type: "WEBSITE",
  name: "acme.test",
  storageKey: null,
  contentHash: "hash_2",
};

function project(id: string, workspaceId = "ws_1"): Project {
  return {
    id,
    workspaceId,
    name: "Launch",
    status: "created",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sources: [],
    assets: [],
  };
}

function provenanceOf(values: {
  sourceIds: string[];
  evidenceIds: string[];
  method: string;
  extractedAt: string;
}) {
  return {
    sourceIds: values.sourceIds,
    evidenceIds: values.evidenceIds,
    method: values.method,
    extractedAt: values.extractedAt,
  } as NonNullable<Feature["provenance"]>;
}

function correctRow<TEntity extends { canonicalKey: string; userLocked: boolean }, TChanges extends object>(
  collection: TEntity[],
  canonicalKey: string,
  changes: TChanges,
): TEntity | null {
  const index = collection.findIndex((row) => row.canonicalKey === canonicalKey);
  if (index < 0) return null;
  const updated = { ...collection[index], ...changes } as TEntity;
  collection[index] = updated;
  return updated;
}

class InMemoryIntelligenceRepository implements IntelligenceRepository {
  graph: IntelligenceGraph = {
    product: null,
    features: [],
    problems: [],
    benefits: [],
    claims: [],
    workflows: [],
    audienceSignals: [],
    brandSignals: [],
    assets: [],
    evidence: [],
    relationships: [],
  };
  runs: IntelligenceRun[] = [];
  snapshots: IntelligenceSnapshot[] = [];
  applied: IntelligencePersistencePlan[] = [];
  openRunId: string | null = null;
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }

  private stamp(): string {
    return "2026-01-01T00:00:00.000Z";
  }

  async getProduct(projectId: string) {
    void projectId;
    return this.graph.product;
  }

  async updateProduct(projectId: string, changes: UpdateProductInput) {
    void projectId;
    if (!this.graph.product) return null;
    this.graph.product = { ...this.graph.product, ...changes } as IntelligenceGraph["product"];
    return this.graph.product;
  }

  async updateFeature(_p: string, key: string, changes: UpdateFeatureInput) {
    return correctRow(this.graph.features, key, changes);
  }
  async updateProblem(_p: string, key: string, changes: UpdateProblemInput) {
    return correctRow(this.graph.problems, key, changes);
  }
  async updateBenefit(_p: string, key: string, changes: UpdateBenefitInput) {
    return correctRow(this.graph.benefits, key, changes);
  }
  async updateClaim(_p: string, key: string, changes: UpdateClaimInput) {
    return correctRow(this.graph.claims, key, changes);
  }
  async updateWorkflow(_p: string, key: string, changes: UpdateWorkflowInput) {
    if (!changes.steps) return correctRow(this.graph.workflows, key, changes);
    const row = correctRow(this.graph.workflows, key, changes);
    if (!row) return null;
    const steps: WorkflowStep[] = changes.steps.map((step, index) => ({
      ...step,
      id: `step_${index}`,
      workflowId: row.id,
    }));
    this.graph.workflows = this.graph.workflows.map((item) =>
      item.canonicalKey === key ? { ...item, steps } : item,
    );
    return this.graph.workflows.find((item) => item.canonicalKey === key) ?? null;
  }
  async updateAudienceSignal(_p: string, key: string, changes: UpdateAudienceSignalInput) {
    return correctRow(this.graph.audienceSignals, key, changes);
  }
  async updateBrandSignal(_p: string, key: string, changes: UpdateBrandSignalInput) {
    return correctRow(this.graph.brandSignals, key, changes);
  }
  async updateAsset(_p: string, key: string, changes: UpdateAssetInput) {
    return correctRow(this.graph.assets, key, changes);
  }

  async listFeatures() {
    return this.graph.features;
  }
  async listProblems() {
    return this.graph.problems;
  }
  async listBenefits() {
    return this.graph.benefits;
  }
  async listClaims() {
    return this.graph.claims;
  }
  async listWorkflows() {
    return this.graph.workflows;
  }
  async listAudienceSignals() {
    return this.graph.audienceSignals;
  }
  async listBrandSignals() {
    return this.graph.brandSignals;
  }
  async listAssets() {
    return this.graph.assets;
  }
  async listEvidence() {
    return this.graph.evidence;
  }
  async listRelationships() {
    return this.graph.relationships;
  }
  async findFeature(_p: string, key: string) {
    return this.graph.features.find((item) => item.canonicalKey === key) ?? null;
  }
  async findProblem(_p: string, key: string) {
    return this.graph.problems.find((item) => item.canonicalKey === key) ?? null;
  }
  async findBenefit(_p: string, key: string) {
    return this.graph.benefits.find((item) => item.canonicalKey === key) ?? null;
  }
  async findClaim(_p: string, key: string) {
    return this.graph.claims.find((item) => item.canonicalKey === key) ?? null;
  }
  async findWorkflow(_p: string, key: string) {
    return this.graph.workflows.find((item) => item.canonicalKey === key) ?? null;
  }
  async findAudienceSignal(_p: string, key: string) {
    return this.graph.audienceSignals.find((item) => item.canonicalKey === key) ?? null;
  }
  async findBrandSignal(_p: string, key: string) {
    return this.graph.brandSignals.find((item) => item.canonicalKey === key) ?? null;
  }
  async findAsset(_p: string, key: string) {
    return this.graph.assets.find((item) => item.canonicalKey === key) ?? null;
  }
  async findEvidenceByKey(_p: string, key: string) {
    return this.graph.evidence.find((item) => item.id === key) ?? null;
  }

  async applyGraph(_projectId: string, plan: IntelligencePersistencePlan): Promise<void> {
    this.applied.push(plan);
    const stamp = this.stamp();

    for (const item of plan.evidence) {
      const existingIndex = this.graph.evidence.findIndex((row) => row.id === item.id);
      const row = { ...item, projectId: PROJECT_ID, createdAt: stamp } as IntelligenceGraph["evidence"][number];
      if (existingIndex >= 0) this.graph.evidence[existingIndex] = row;
      else this.graph.evidence.push(row);
    }

    const upsertInto = <T extends FakeRow, V extends { userLocked: boolean }>(
      collection: T[],
      rows: { id: string; isNew: boolean; values: V }[],
      build: (id: string, values: V, createdAt: string) => T,
    ) => {
      for (const entry of rows) {
        const index = collection.findIndex((row) => row.id === entry.id);
        const existing = index >= 0 ? collection[index] : undefined;
        // A user correction wins over anything the analyzer re-derived.
        const values = existing
          ? { ...entry.values, userLocked: existing.userLocked }
          : entry.values;
        const row = build(entry.id, values, existing?.createdAt ?? stamp);
        if (existing) collection[index] = row;
        else collection.push(row);
      }
    };

    if (plan.product) {
      const values = plan.product.values;
      const existing = this.graph.product;
      this.graph.product = {
        id: PROJECT_ID,
        projectId: PROJECT_ID,
        ...values,
        userLocked: existing?.userLocked ?? values.userLocked,
        provenance: {
          sourceIds: values.sourceIds,
          evidenceIds: values.evidenceIds,
          method: values.method,
          extractedAt: values.extractedAt,
        },
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
      } as IntelligenceGraph["product"];
    }

    upsertInto(
      this.graph.features,
      plan.features,
      (id, values, createdAt): Feature => ({
          id,
          projectId: PROJECT_ID,
          name: values.name,
          description: values.description,
          category: values.category,
          importance: values.importance,
          confidence: values.confidence,
          assertionKind: values.assertionKind,
          userLocked: values.userLocked,
          canonicalKey: values.canonicalKey,
          provenance: {
            sourceIds: values.sourceIds,
            evidenceIds: values.evidenceIds,
            method: values.method,
            extractedAt: values.extractedAt,
          },
          createdAt,
          updatedAt: stamp,
        }),
    );

    upsertInto(
      this.graph.claims,
      plan.claims,
      (id, values, createdAt) => ({
          id,
          projectId: PROJECT_ID,
          text: values.text,
          claimType: values.claimType,
          sourceId: values.sourceId,
          verification: values.verification,
          conflictsWithClaimId: values.conflictsWithClaimId,
          confidence: values.confidence,
          assertionKind: values.assertionKind,
          userLocked: values.userLocked,
          canonicalKey: values.canonicalKey,
          provenance: {
            sourceIds: values.sourceIds,
            evidenceIds: values.evidenceIds,
            method: values.method,
            extractedAt: values.extractedAt,
          },
          createdAt,
          updatedAt: stamp,
        }),
    );

    upsertInto(
      this.graph.problems,
      plan.problems,
      (id, values, createdAt) => ({
        id,
        projectId: PROJECT_ID,
        name: values.name,
        description: values.description,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        provenance: provenanceOf(values),
        createdAt,
        updatedAt: stamp,
      }),
    );

    upsertInto(
      this.graph.benefits,
      plan.benefits,
      (id, values, createdAt) => ({
        id,
        projectId: PROJECT_ID,
        name: values.name,
        description: values.description,
        linkedFeatureIds: values.linkedFeatureIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        provenance: provenanceOf(values),
        createdAt,
        updatedAt: stamp,
      }),
    );

    upsertInto(
      this.graph.workflows,
      plan.workflows,
      (id, values, createdAt) => ({
        id,
        projectId: PROJECT_ID,
        name: values.name,
        description: values.description,
        steps: values.steps.map((step) => ({
          id: `${id}_step_${step.order}`,
          workflowId: id,
          order: step.order,
          action: step.action,
          description: step.description,
          featureIds: step.featureIds,
        })),
        featureIds: values.featureIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        provenance: provenanceOf(values),
        createdAt,
        updatedAt: stamp,
      }),
    );

    upsertInto(
      this.graph.audienceSignals,
      plan.audienceSignals,
      (id, values, createdAt) => ({
        id,
        projectId: PROJECT_ID,
        segment: values.segment,
        description: values.description,
        kind: values.kind,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        provenance: provenanceOf(values),
        createdAt,
        updatedAt: stamp,
      }),
    );

    upsertInto(
      this.graph.brandSignals,
      plan.brandSignals,
      (id, values, createdAt) => ({
        id,
        projectId: PROJECT_ID,
        kind: values.kind,
        label: values.label,
        value: values.value,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        provenance: provenanceOf(values),
        createdAt,
        updatedAt: stamp,
      }),
    );

    upsertInto(
      this.graph.assets,
      plan.assets,
      (id, values, createdAt) => ({
        id,
        projectId: PROJECT_ID,
        sourceId: values.sourceId,
        name: values.name,
        mediaType: values.mediaType,
        role: values.role,
        storageKey: values.storageKey,
        mimeType: values.mimeType,
        width: values.width,
        height: values.height,
        durationMs: values.durationMs,
        qualitySignals: values.qualitySignals,
        relatedFeatureIds: values.relatedFeatureIds,
        relatedClaimIds: values.relatedClaimIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        provenance: provenanceOf(values),
        createdAt,
        updatedAt: stamp,
      }),
    );

    this.graph.relationships = plan.relationships.map((row) => ({
      id: `rel_${row.fromId}_${row.toId}_${row.type}`,
      projectId: PROJECT_ID,
      ...row,
    })) as IntelligenceGraph["relationships"];
  }

  async readGraph() {
    return structuredClone(this.graph);
  }

  async createRun(input: CreateIntelligenceRunInput): Promise<IntelligenceRun> {
    const run: IntelligenceRun = {
      id: input.id,
      projectId: input.projectId,
      status: input.status,
      sourceIds: input.sourceIds,
      provider: input.provider,
      model: input.model,
      trigger: input.trigger,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: this.stamp(),
      updatedAt: this.stamp(),
    };
    this.runs.unshift(run);
    if (run.status === "RUNNING") this.openRunId = run.id;
    return run;
  }

  async updateRun(id: string, changes: UpdateIntelligenceRunInput) {
    const run = this.runs.find((item) => item.id === id);
    if (!run) return null;
    Object.assign(run, changes, { updatedAt: this.stamp() });
    if (changes.status && changes.status !== "RUNNING" && changes.status !== "QUEUED") {
      this.openRunId = null;
    }
    return run;
  }

  async findActiveRun() {
    if (!this.openRunId) return null;
    return this.runs.find((item) => item.id === this.openRunId) ?? null;
  }

  async listRuns(_projectId: string, limit: number) {
    return this.runs.slice(0, limit);
  }

  async createSnapshot(input: {
    id: string;
    projectId: string;
    version: number;
    runId: string;
    summary: string | null;
    entityCounts: string | null;
  }): Promise<IntelligenceSnapshot> {
    const snapshot: IntelligenceSnapshot = { ...input, createdAt: this.stamp() };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async latestSnapshot() {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  async listSnapshots(_projectId: string, limit: number) {
    return this.snapshots.slice(-limit).reverse();
  }
}

function featureDraft(): IntelligenceDraft {
  const draft = emptyIntelligenceDraft();
  const key = addDraftEvidence(draft, {
    sourceId: REPO_SOURCE.id,
    kind: "REPOSITORY_FILE",
    locator: "README.md",
    excerpt: "Launch analytics dashboard",
    metadata: null,
  }).key;
  draft.features.push({
    key: canonicalEntityKey("FEATURE", "Launch Analytics"),
    name: "Launch Analytics",
    description: "Tracks launch performance",
    category: "ANALYTICS",
    importance: "SECONDARY",
    confidence: "HIGH",
    assertionKind: "FACT",
    sourceIds: [REPO_SOURCE.id],
    evidenceKeys: [key],
  });
  return draft;
}

function claimDraft(text: string, options: { kind: "REPOSITORY_FILE" | "URL_SECTION"; marketing: boolean }) {
  const draft = emptyIntelligenceDraft();
  const key = addDraftEvidence(draft, {
    sourceId: options.kind === "REPOSITORY_FILE" ? REPO_SOURCE.id : SITE_SOURCE.id,
    kind: options.kind,
    locator: options.kind === "REPOSITORY_FILE" ? "src/analyzer.ts" : "h1:hero",
    excerpt: text,
    metadata: null,
  }).key;
  draft.claims.push({
    key: canonicalEntityKey("CLAIM", text),
    text,
    claimType: "CAPABILITY",
    sourceId: options.kind === "REPOSITORY_FILE" ? REPO_SOURCE.id : SITE_SOURCE.id,
    confidence: "HIGH",
    assertionKind: options.marketing ? "MARKETING_CLAIM" : "FACT",
    sourceIds: [options.kind === "REPOSITORY_FILE" ? REPO_SOURCE.id : SITE_SOURCE.id],
    evidenceKeys: [key],
  });
  return draft;
}

function richDraft(): IntelligenceDraft {
  const draft = emptyIntelligenceDraft();
  const evidence = addDraftEvidence(draft, {
    sourceId: REPO_SOURCE.id,
    kind: "REPOSITORY_FILE",
    locator: "README.md",
    excerpt: "Everything the product does",
    metadata: null,
  }).key;
  const featureKey = canonicalEntityKey("FEATURE", "Launch Analytics");
  const base = {
    confidence: "HIGH",
    assertionKind: "FACT",
    sourceIds: [REPO_SOURCE.id],
    evidenceKeys: [evidence],
  } satisfies Omit<DraftFeature, "key" | "name" | "description" | "category" | "importance">;

  draft.features.push({ ...base, key: featureKey, name: "Launch Analytics", description: "Tracks launches", category: "ANALYTICS", importance: "SECONDARY" });
  draft.problems.push({ ...base, key: canonicalEntityKey("PROBLEM", "Copy takes too long"), name: "Copy takes too long", description: "Teams rewrite per channel" });
  draft.benefits.push({ ...base, key: canonicalEntityKey("BENEFIT", "Ship faster"), name: "Ship faster", description: "Fewer rewrites", linkedFeatureKeys: [featureKey] });
  draft.claims.push({ ...base, key: canonicalEntityKey("CLAIM", "Exports every launch to CSV"), text: "Exports every launch to CSV", claimType: "FORMAT", sourceId: REPO_SOURCE.id });
  draft.workflows.push({
    ...base,
    key: canonicalEntityKey("WORKFLOW", "Plan a launch"),
    name: "Plan a launch",
    description: null,
    steps: [{ order: 0, action: "Draft the brief", description: null, featureKeys: [] }],
    featureKeys: [featureKey],
  });
  draft.audienceSignals.push({ ...base, key: canonicalEntityKey("AUDIENCE_SIGNAL", "marketing teams"), segment: "marketing teams", description: null, kind: "EXPLICIT_SEGMENT" });
  draft.brandSignals.push({ ...base, key: canonicalEntityKey("BRAND_SIGNAL", "Tone: confident"), kind: "TONE", label: "Tone", value: "confident" });
  draft.assets.push({
    ...base,
    key: canonicalEntityKey("ASSET", "hero.png"),
    sourceId: REPO_SOURCE.id,
    name: "hero.png",
    mediaType: "OTHER",
    role: "HERO",
    storageKey: null,
    mimeType: "image/png",
    width: 1200,
    height: 600,
    durationMs: null,
    qualitySignals: null,
    relatedFeatureKeys: [],
    relatedClaimKeys: [],
  });

  return draft;
}

function buildService(options: {
  draft?: IntelligenceDraft;
  perSourceDraft?: (sourceId: string) => IntelligenceDraft;
  sources?: Source[];
  interpret?: "none" | "valid" | "invalid" | "unavailable" | "throws";
  repository?: InMemoryIntelligenceRepository;
}) {
  const repository = options.repository ?? new InMemoryIntelligenceRepository();
  const sources = options.sources ?? [REPO_SOURCE, SITE_SOURCE];
  let call = 0;

  const interpretationProvider = {
    id: "test-ai",
    interpret: async () => {
      call += 1;
      const repoKey = canonicalEvidenceKey(REPO_SOURCE.id, "REPOSITORY_FILE", "README.md");
      if (options.interpret === "unavailable") {
        throw new IntelligenceError("INTELLIGENCE_AI_UNAVAILABLE", "model offline");
      }
      if (options.interpret === "throws") throw new Error("socket hang up");
      if (options.interpret === "invalid") {
        throw new IntelligenceError("INTELLIGENCE_AI_INVALID_OUTPUT", "bad shape");
      }
      const draft = emptyIntelligenceDraft();
      if (options.interpret === "valid") {
        draft.problems.push({
          key: canonicalEntityKey("PROBLEM", "Launch copy takes too long"),
          name: "Launch copy takes too long",
          description: "Teams rewrite copy per channel",
          confidence: "MEDIUM",
          assertionKind: "INFERENCE",
          sourceIds: [REPO_SOURCE.id],
          evidenceKeys: [repoKey],
        });
      }
      return { provider: "test-ai", model: "test-model", draft };
    },
  };

  const service = new IntelligenceService({
    projectService: { getAuthorized: async (id: string) => project(id) },
    sourceRepository: { listByProject: async () => sources },
    storageProvider: { get: async () => new Uint8Array([1, 2, 3]) },
    analyzers: new SourceAnalyzerRegistry([
      {
        id: "stub",
        supports: () => true,
        analyze: async ({ source }) => ({
          draft: options.perSourceDraft
            ? options.perSourceDraft(source.id)
            : (options.draft ?? featureDraft()),
          notes: [],
        }),
      },
    ]),
    repository,
    interpretationProvider:
      options.interpret === "none" || options.interpret === undefined ? null : interpretationProvider,
    now: () => new Date("2026-02-02T00:00:00.000Z"),
    createId: (() => {
      let n = 0;
      return (prefix: string) => {
        n += 1;
        return `${prefix}_${n}`;
      };
    })(),
  });

  return { service, repository, aiCalls: () => call };
}

describe("IntelligenceService", () => {
  it("rejects a project the user cannot access", async () => {
    const { service } = buildService({});
    const failing = new IntelligenceService({
      projectService: {
        getAuthorized: async () => {
          throw new Error("forbidden");
        },
      },
      sourceRepository: { listByProject: async () => [] },
      storageProvider: { get: async () => new Uint8Array() },
      analyzers: new SourceAnalyzerRegistry([]),
      repository: new InMemoryIntelligenceRepository(),
    });
    void service;
    await expect(failing.analyze(PROJECT_ID, USER_ID)).rejects.toThrowError(/forbidden/);
  });

  it("refuses to start a second concurrent run", async () => {
    const { service, repository } = buildService({});
    repository.openRunId = "run_existing";
    repository.runs = [
      {
        id: "run_existing",
        projectId: PROJECT_ID,
        status: "RUNNING" as IntelligenceRunStatus,
        sourceIds: [REPO_SOURCE.id],
        provider: null,
        model: null,
        trigger: "MANUAL",
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    await expect(service.analyze(PROJECT_ID, USER_ID)).rejects.toThrowError(/already in progress/);
  });

  it("refuses to analyze when no source is readable", async () => {
    const { service } = buildService({ sources: [{ ...REPO_SOURCE, status: "FAILED" }] });
    await expect(service.analyze(PROJECT_ID, USER_ID)).rejects.toThrowError(/No readable sources/);
  });

  it("persists features with provenance and a completed run", async () => {
    const { service, repository } = buildService({});

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.run.status).toBe("COMPLETED");
    expect(report.snapshot?.version).toBe(1);
    expect(report.graph.features).toHaveLength(1);
    const feature = report.graph.features[0];
    expect(feature.name).toBe("Launch Analytics");
    expect(feature.provenance?.method).toBe("DETERMINISTIC");
    expect(feature.provenance?.evidenceIds).toHaveLength(1);
    expect(feature.userLocked).toBe(false);
    expect(repository.graph.evidence).toHaveLength(1);
    expect(report.notes.join(" ")).toContain("AI interpretation disabled");
  });

  it("increments the snapshot version on every completed run", async () => {
    const { service } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    const second = await service.analyze(PROJECT_ID, USER_ID);

    expect(second.snapshot?.version).toBe(2);
  });

  it("does not duplicate entities when the same sources are re-analyzed", async () => {
    const { service, repository } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    const firstIds = repository.graph.features.map((item) => item.id);
    await service.analyze(PROJECT_ID, USER_ID);

    expect(repository.graph.features).toHaveLength(1);
    expect(repository.graph.features.map((item) => item.id)).toEqual(firstIds);
    expect(repository.applied[1]?.features[0]?.isNew).toBe(false);
  });

  it("analyzes only the requested sources", async () => {
    const { service, repository } = buildService({});

    const report = await service.analyze(PROJECT_ID, USER_ID, { sourceIds: [REPO_SOURCE.id] });

    expect(report.run.sourceIds).toEqual([REPO_SOURCE.id]);
    expect(repository.graph.features).toHaveLength(1);
  });

  describe("refresh change detection", () => {
    it("analyzes every ready source when nothing has run yet", async () => {
      const { service, repository } = buildService({});

      const report = await service.refresh(PROJECT_ID, USER_ID);

      expect(report.run.trigger).toBe("REFRESH");
      expect(report.run.sourceIds).toEqual([REPO_SOURCE.id, SITE_SOURCE.id]);
      expect(repository.runs).toHaveLength(1);
    });

    it("is a no-op when no source changed", async () => {
      const { service, repository } = buildService({});

      await service.analyze(PROJECT_ID, USER_ID);
      const report = await service.refresh(PROJECT_ID, USER_ID);

      expect(report.notes).toContain("No new or changed sources since the last analysis");
      expect(report.run.trigger).toBe("MANUAL");
      expect(report.snapshot?.version).toBe(1);
      expect(repository.runs).toHaveLength(1);
      expect(repository.applied).toHaveLength(1);
    });

    it("re-analyzes only sources written after the last run", async () => {
      const sources = [{ ...REPO_SOURCE }, { ...SITE_SOURCE }];
      const { service, repository } = buildService({ sources });

      await service.analyze(PROJECT_ID, USER_ID);
      sources[0] = { ...sources[0], updatedAt: "2026-03-01T00:00:00.000Z" };

      const report = await service.refresh(PROJECT_ID, USER_ID);
      expect(repository.applied).toHaveLength(2);

      expect(report.run.trigger).toBe("REFRESH");
      expect(report.run.sourceIds).toEqual([REPO_SOURCE.id]);
      expect(report.snapshot?.version).toBe(2);
    });

    it("re-analyzes only newly added sources and keeps earlier knowledge", async () => {
      const sources = [{ ...REPO_SOURCE }];
      const { service, repository } = buildService({ sources });

      await service.analyze(PROJECT_ID, USER_ID);
      const before = repository.graph.features.map((item) => item.canonicalKey);

      sources.push({ ...SITE_SOURCE, id: "src_new", name: "docs" });
      const report = await service.refresh(PROJECT_ID, USER_ID);

      expect(report.run.sourceIds).toEqual(["src_new"]);
      expect(report.snapshot?.version).toBe(2);
      expect(repository.graph.features.map((item) => item.canonicalKey)).toEqual(
        expect.arrayContaining(before),
      );
    });

    it("still reports a project with no readable sources", async () => {
      const { service } = buildService({ sources: [] });

      await expect(service.refresh(PROJECT_ID, USER_ID)).rejects.toMatchObject({
        code: "INTELLIGENCE_INVALID_INPUT",
      });
    });
  });

  it("verifies a claim backed by repository evidence", async () => {
    const draft = claimDraft("Exports every launch to CSV", { kind: "REPOSITORY_FILE", marketing: false });
    const { service } = buildService({ draft });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.graph.claims[0]?.verification).toBe("SUPPORTED");
  });

  it("keeps a website-only marketing claim unverified", async () => {
    const draft = claimDraft("AI video generation in seconds", {
      kind: "URL_SECTION",
      marketing: true,
    });
    const { service } = buildService({ draft });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.graph.claims[0]?.verification).toBe("UNVERIFIED");
  });

  it("only partially verifies a marketing claim that has repository evidence", async () => {
    const draft = claimDraft("Generate videos 10x faster", {
      kind: "REPOSITORY_FILE",
      marketing: true,
    });
    const { service } = buildService({ draft });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.graph.claims[0]?.verification).toBe("PARTIALLY_SUPPORTED");
  });

  it("marks opposing-polarity claims as conflicting and links them", async () => {
    const draft = claimDraft("Exports to CSV", { kind: "REPOSITORY_FILE", marketing: false });
    const negative = claimDraft("Does not export to CSV", {
      kind: "REPOSITORY_FILE",
      marketing: false,
    });
    draft.claims.push(...negative.claims);
    draft.evidence.push(...negative.evidence);
    const { service } = buildService({ draft });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    const claimIds = report.graph.claims.map((claim) => claim.id);
    for (const claim of report.graph.claims) {
      expect(claim.verification).toBe("CONFLICTING");
      expect(claimIds).toContain(claim.conflictsWithClaimId);
      expect(claim.conflictsWithClaimId).not.toBe(claim.id);
    }
  });

  it("applies the AI interpretation when it is valid", async () => {
    const { service } = buildService({ interpret: "valid" });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.aiApplied).toBe(true);
    expect(report.run.provider).toBe("test-ai");
    expect(report.run.model).toBe("test-model");
    expect(report.graph.problems).toHaveLength(1);
    expect(report.graph.features).toHaveLength(1);
  });

  it("keeps deterministic results and completes the run when the AI output is invalid", async () => {
    const { service } = buildService({ interpret: "invalid" });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.run.status).toBe("COMPLETED");
    expect(report.aiApplied).toBe(false);
    expect(report.aiErrorCode).toBe("INTELLIGENCE_AI_INVALID_OUTPUT");
    expect(report.graph.features).toHaveLength(1);
    expect(report.snapshot?.summary).toContain("Deterministic analysis only");
  });

  it("keeps deterministic results when the AI provider is unavailable", async () => {
    const { service } = buildService({ interpret: "unavailable" });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.run.status).toBe("COMPLETED");
    expect(report.aiErrorCode).toBe("INTELLIGENCE_AI_UNAVAILABLE");
    expect(report.graph.features).toHaveLength(1);
  });

  it("keeps deterministic results when the AI provider throws an unexpected error", async () => {
    const { service } = buildService({ interpret: "throws" });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.run.status).toBe("COMPLETED");
    expect(report.aiErrorCode).toBe("INTELLIGENCE_AI_UNAVAILABLE");
    expect(report.graph.features).toHaveLength(1);
  });

  it("fails the run when every analyzer fails", async () => {
    const repository = new InMemoryIntelligenceRepository();
    const service = new IntelligenceService({
      projectService: { getAuthorized: async (id: string) => project(id) },
      sourceRepository: { listByProject: async () => [REPO_SOURCE] },
      storageProvider: { get: async () => new Uint8Array() },
      analyzers: new SourceAnalyzerRegistry([
        {
          id: "broken",
          supports: () => true,
          analyze: async () => {
            throw new IntelligenceError("INTELLIGENCE_SOURCE_UNREADABLE", "corrupt archive");
          },
        },
      ]),
      repository,
    });

    await expect(service.analyze(PROJECT_ID, USER_ID)).rejects.toThrowError(
      /produced no intelligence/,
    );
    expect(repository.runs[0]?.status).toBe("FAILED");
    expect(repository.runs[0]?.errorCode).toBe("INTELLIGENCE_SOURCE_UNREADABLE");
  });

  it("preserves a user correction when the source is re-analyzed", async () => {
    const { service, repository } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    const featureId = repository.graph.features[0].id;
    await repository.updateProduct(PROJECT_ID, {});
    repository.graph.features[0].name = "Corrected Feature Name";
    repository.graph.features[0].userLocked = true;

    await service.analyze(PROJECT_ID, USER_ID);

    const feature = repository.graph.features.find((item) => item.id === featureId);
    expect(feature?.name).toBe("Corrected Feature Name");
    expect(feature?.userLocked).toBe(true);
    expect(repository.graph.features).toHaveLength(1);
  });

  it("locks the product when a user corrects it", async () => {
    const { service, repository } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    const product = emptyIntelligenceDraft();
    product.product = {
      name: "Content OS",
      shortDescription: null,
      longDescription: null,
      category: null,
      purpose: null,
      valueProposition: null,
      targetUserSummary: null,
      confidence: "MEDIUM",
      assertionKind: "FACT",
      sourceIds: [REPO_SOURCE.id],
      evidenceKeys: [],
    };
    repository.applied.push({
      product: { id: PROJECT_ID, isNew: true, values: product.product as never },
      features: [],
      problems: [],
      benefits: [],
      claims: [],
      workflows: [],
      audienceSignals: [],
      brandSignals: [],
      assets: [],
      evidence: [],
      relationships: [],
    });
    await repository.applyGraph(PROJECT_ID, repository.applied[repository.applied.length - 1]);

    await service.correctProduct(PROJECT_ID, USER_ID, { name: "Content OS (edited)" });

    expect(repository.graph.product?.name).toBe("Content OS (edited)");
    expect(repository.graph.product?.userLocked).toBe(true);
  });

  it("rejects a product correction when no product intelligence exists", async () => {
    const { service } = buildService({});
    await expect(
      service.correctProduct(PROJECT_ID, USER_ID, { name: "Nope" }),
    ).rejects.toThrowError(/No product intelligence/);
  });

  describe("entity corrections", () => {
    async function analyzed() {
      const built = buildService({ sources: [REPO_SOURCE], draft: richDraft() });
      const report = await built.service.analyze(PROJECT_ID, USER_ID, {
        sourceIds: [REPO_SOURCE.id],
      });
      return { ...built, graph: report.graph };
    }

    it("corrects a feature and locks it against re-analysis", async () => {
      const { service, repository, graph } = await analyzed();
      const target = graph.features[0]!;

      const corrected = await service.correctFeature(PROJECT_ID, USER_ID, target.canonicalKey, {
        name: "Launch Analytics (confirmed)",
        importance: "PRIMARY",
      });

      expect(corrected?.name).toBe("Launch Analytics (confirmed)");
      expect(corrected?.importance).toBe("PRIMARY");
      expect(corrected?.userLocked).toBe(true);

      await service.analyze(PROJECT_ID, USER_ID, { sourceIds: [REPO_SOURCE.id] });
      expect(repository.graph.features[0]?.userLocked).toBe(true);
      expect(repository.graph.features).toHaveLength(1);
    });

    it("corrects the remaining entity types", async () => {
      const { service, graph } = await analyzed();

      const problem = await service.correctProblem(
        PROJECT_ID,
        USER_ID,
        graph.problems[0]!.canonicalKey,
        { name: "Copy review is slow" },
      );
      const benefit = await service.correctBenefit(
        PROJECT_ID,
        USER_ID,
        graph.benefits[0]!.canonicalKey,
        { name: "Launch in one afternoon" },
      );
      const claim = await service.correctClaim(
        PROJECT_ID,
        USER_ID,
        graph.claims[0]!.canonicalKey,
        { text: "Exports every launch to CSV and PNG", verification: "SUPPORTED" },
      );
      const workflow = await service.correctWorkflow(
        PROJECT_ID,
        USER_ID,
        graph.workflows[0]!.canonicalKey,
        {
          name: "Plan and ship a launch",
          steps: [
            { order: 0, action: "Draft the brief", description: null, featureIds: [] },
            { order: 1, action: "Review with the team", description: null, featureIds: [] },
          ],
        },
      );
      const audience = await service.correctAudienceSignal(
        PROJECT_ID,
        USER_ID,
        graph.audienceSignals[0]!.canonicalKey,
        { segment: "content teams" },
      );
      const brand = await service.correctBrandSignal(
        PROJECT_ID,
        USER_ID,
        graph.brandSignals[0]!.canonicalKey,
        { value: "playful" },
      );
      const asset = await service.correctAsset(
        PROJECT_ID,
        USER_ID,
        graph.assets[0]!.canonicalKey,
        { name: "hero-final.png", role: "FEATURE_PROOF" },
      );

      expect(problem?.name).toBe("Copy review is slow");
      expect(benefit?.name).toBe("Launch in one afternoon");
      expect(claim?.verification).toBe("SUPPORTED");
      expect(claim?.text).toBe("Exports every launch to CSV and PNG");
      expect(workflow?.name).toBe("Plan and ship a launch");
      expect(workflow?.steps.map((step) => step.action)).toEqual([
        "Draft the brief",
        "Review with the team",
      ]);
      expect(audience?.segment).toBe("content teams");
      expect(brand?.value).toBe("playful");
      expect(asset?.name).toBe("hero-final.png");
      expect(asset?.role).toBe("FEATURE_PROOF");

      expect([
        problem,
        benefit,
        claim,
        workflow,
        audience,
        brand,
        asset,
      ].every((entity) => entity?.userLocked === true)).toBe(true);
    });

    it("keeps every corrected field when the same source is analyzed again", async () => {
      const { service, repository, graph } = await analyzed();

      await service.correctClaim(PROJECT_ID, USER_ID, graph.claims[0]!.canonicalKey, {
        text: "Exports every launch to CSV and PNG",
        claimType: "FORMAT",
        assertionKind: "USER_PROVIDED",
      });
      await service.correctWorkflow(PROJECT_ID, USER_ID, graph.workflows[0]!.canonicalKey, {
        name: "Plan and ship a launch",
        steps: [{ order: 0, action: "Review with the team", description: null, featureIds: [] }],
      });
      await service.correctAudienceSignal(
        PROJECT_ID,
        USER_ID,
        graph.audienceSignals[0]!.canonicalKey,
        { segment: "content teams" },
      );
      await service.correctBrandSignal(
        PROJECT_ID,
        USER_ID,
        graph.brandSignals[0]!.canonicalKey,
        { value: "playful" },
      );
      await service.correctAsset(PROJECT_ID, USER_ID, graph.assets[0]!.canonicalKey, {
        name: "hero-final.png",
        role: "FEATURE_PROOF",
      });

      await service.analyze(PROJECT_ID, USER_ID, { sourceIds: [REPO_SOURCE.id] });

      expect(repository.graph.claims[0]).toMatchObject({
        text: "Exports every launch to CSV and PNG",
        claimType: "FORMAT",
        assertionKind: "USER_PROVIDED",
        userLocked: true,
      });
      expect(repository.graph.workflows[0]).toMatchObject({
        name: "Plan and ship a launch",
        userLocked: true,
      });
      expect(repository.graph.workflows[0]?.steps.map((step) => step.action)).toEqual([
        "Review with the team",
      ]);
      expect(repository.graph.audienceSignals[0]).toMatchObject({
        segment: "content teams",
        userLocked: true,
      });
      expect(repository.graph.brandSignals[0]).toMatchObject({
        value: "playful",
        userLocked: true,
      });
      expect(repository.graph.assets[0]).toMatchObject({
        name: "hero-final.png",
        role: "FEATURE_PROOF",
        userLocked: true,
      });
    });

    it("reports a correction for an unknown canonical key", async () => {
      const { service } = await analyzed();

      await expect(
        service.correctFeature(PROJECT_ID, USER_ID, "feature:missing", { name: "Nope" }),
      ).rejects.toMatchObject({ code: "INTELLIGENCE_NOT_FOUND" });

      await expect(
        service.correctFeature(PROJECT_ID, USER_ID, "  ", { name: "Nope" }),
      ).rejects.toMatchObject({ code: "INTELLIGENCE_INVALID_INPUT" });
    });
  });

  it("carries forward relationships that the current run did not re-derive", async () => {
    const repository = new InMemoryIntelligenceRepository();
    const siteFeature = emptyIntelligenceDraft();
    const siteKey = addDraftEvidence(siteFeature, {
      sourceId: SITE_SOURCE.id,
      kind: "URL_SECTION",
      locator: "h1:hero",
      excerpt: "Pricing",
      metadata: null,
    }).key;
    siteFeature.features.push({
      key: canonicalEntityKey("FEATURE", "Pricing Page"),
      name: "Pricing Page",
      description: null,
      category: "OTHER",
      importance: "SECONDARY",
      confidence: "MEDIUM",
      assertionKind: "FACT",
      sourceIds: [SITE_SOURCE.id],
      evidenceKeys: [siteKey],
    });

    const { service } = buildService({
      repository,
      perSourceDraft: (sourceId) => (sourceId === SITE_SOURCE.id ? siteFeature : featureDraft()),
    });

    const first = await service.analyze(PROJECT_ID, USER_ID);
    const siteFeatureId = first.graph.features.find(
      (item) => item.canonicalKey === canonicalEntityKey("FEATURE", "Pricing Page"),
    )!.id;
    const siteEvidenceId = first.graph.evidence.find(
      (item) => item.sourceId === SITE_SOURCE.id,
    )!.id;
    repository.graph.relationships = [
      {
        id: "rel_site",
        projectId: PROJECT_ID,
        type: "FEATURE_SUPPORTED_BY_EVIDENCE",
        fromType: "FEATURE",
        fromId: siteFeatureId,
        toType: "EVIDENCE",
        toId: siteEvidenceId,
        confidence: "HIGH",
      },
    ] as IntelligenceGraph["relationships"];

    // Second pass analyzes only the repository, so the site feature is not re-derived.
    await service.analyze(PROJECT_ID, USER_ID, { sourceIds: [REPO_SOURCE.id] });

    expect(
      repository.graph.relationships.find(
        (item) => item.fromId === siteFeatureId && item.toId === siteEvidenceId,
      ),
    ).toBeDefined();
  });

  it("replaces a carried relationship when the run re-derives the same entity", async () => {
    const draft = featureDraft();
    const evidenceKey = draft.features[0].evidenceKeys[0];
    draft.relationships.push({
      type: "FEATURE_SUPPORTED_BY_EVIDENCE",
      fromType: "FEATURE",
      fromKey: draft.features[0].key,
      toType: "EVIDENCE",
      toKey: evidenceKey,
      confidence: "HIGH",
    });
    const { service } = buildService({ draft });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.graph.relationships).toHaveLength(1);
    expect(report.graph.relationships[0].type).toBe("FEATURE_SUPPORTED_BY_EVIDENCE");
  });

  it("exposes counts, last run and last snapshot in the summary", async () => {
    const { service } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    const summary = await service.getSummary(PROJECT_ID, USER_ID);

    expect(summary.project.id).toBe(PROJECT_ID);
    expect(summary.counts.features).toBe(1);
    expect(summary.counts.evidence).toBe(1);
    expect(summary.lastRun?.status).toBe("COMPLETED");
    expect(summary.lastSnapshot?.version).toBe(1);
  });

  it("authorizes every read endpoint", async () => {
    const { service } = buildService({});
    const reads = [
      service.getSummary(PROJECT_ID, USER_ID),
      service.getProduct(PROJECT_ID, USER_ID),
      service.listFeatures(PROJECT_ID, USER_ID),
      service.listProblems(PROJECT_ID, USER_ID),
      service.listBenefits(PROJECT_ID, USER_ID),
      service.listClaims(PROJECT_ID, USER_ID),
      service.listWorkflows(PROJECT_ID, USER_ID),
      service.listAudienceSignals(PROJECT_ID, USER_ID),
      service.listBrandSignals(PROJECT_ID, USER_ID),
      service.listAssets(PROJECT_ID, USER_ID),
      service.listEvidence(PROJECT_ID, USER_ID),
      service.listRuns(PROJECT_ID, USER_ID),
    ];
    await expect(Promise.all(reads)).resolves.toBeDefined();
  });

  it("caps the run history limit", async () => {
    const { service, repository } = buildService({});
    await service.analyze(PROJECT_ID, USER_ID);
    await service.analyze(PROJECT_ID, USER_ID);

    await expect(service.listRuns(PROJECT_ID, USER_ID, 9999)).resolves.toHaveLength(2);
    expect(repository.runs).toHaveLength(2);
  });
});
