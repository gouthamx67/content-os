import {
  BrandError,
  brandPrecedenceForOrigin,
  brandTextValue,
  computeBrandConfidence,
  computeBrandStatus,
  emptyBrandProfile,
  isBrandTextField,
  toBrandExecutionProfile,
  type BrandConflict,
  type BrandOrigin,
  type BrandProfile,
  type BrandSourceState,
  type BrandTextField,
  type BrandTextOrigins,
} from "../domain/brand";
import { createId } from "../../lib/id";
import {
  brandEvidenceId,
  normalizeFontFamily,
  normalizeHexColor,
  normalizeTerm,
} from "../../lib/brand-normalization";
import type {
  BrandAnalyzerInput,
  BrandAnalyzerRegistry,
  BrandAnalyzerResult,
} from "../ports/brand-analyzer";
import type { BrandRepository, UpdateBrandInput } from "../ports/brand-repository";
import type {
  EvidenceValues,
  IntelligenceRepository,
} from "../ports/intelligence-repository";
import type {
  BrandInterpretationProvider,
  BrandInterpretationResult,
} from "../ports/brand-interpretation-provider";
import type { SourceRepository } from "../ports/source-repository";
import type { AssetRepository } from "../ports/asset-repository";
import type { StorageProvider } from "../ports/storage-provider";
import type { Source } from "../domain/source";
import type { Asset } from "../domain/asset";
import type { BrandSignal } from "../domain/intelligence";
import { canonicalEvidenceKey } from "../domain/intelligence-canonical";
import type { ProjectService } from "./project-service";
import {
  mergeBrandEntries,
  toBrandAsset,
  toBrandColor,
  toBrandConflict,
  toBrandFont,
  toBrandGuideline,
  toBrandTerm,
  toBrandVoiceSignal,
  type BrandConflictSeed,
  type BrandMergeEntry,
  type BrandMaterialKind,
} from "./brand-merge";
import { buildUserBrandValues, type UserBrandPatch } from "./brand-user-values";

const MAX_SOURCE_BYTES = 8_000_000;
const MAX_EVIDENCE_PER_RUN = 120;
const MAX_EXCERPT = 2_000;
const MAX_CONFLICTS = 40;

const TEXT_FIELDS: BrandTextField[] = [
  "name",
  "positioning",
  "tagline",
  "valueProposition",
  "voiceSummary",
  "visualStyle",
];

export type BrandAnalysisTrigger = "INITIAL" | "MANUAL" | "REFRESH" | "SOURCE_CHANGED";

export interface BrandAnalysisOptions {
  trigger?: BrandAnalysisTrigger;
  sourceIds?: string[];
  force?: boolean;
  signal?: AbortSignal;
}

export interface BrandAnalysisReport {
  profile: BrandProfile;
  execution: ReturnType<typeof toBrandExecutionProfile>;
  aiApplied: boolean;
  aiErrorCode: string | null;
  analyzedSourceIds: string[];
  skipped: "NONE" | "LOCKED" | "UP_TO_DATE";
  notes: string[];
}

export interface BrandProfileView {
  profile: BrandProfile | null;
  sourceStates: BrandSourceState[];
  execution: ReturnType<typeof toBrandExecutionProfile> | null;
}

export interface BrandIntelligenceServiceDependencies {
  projectService: Pick<ProjectService, "getAuthorized">;
  sourceRepository: Pick<SourceRepository, "listByProject">;
  assetRepository: Pick<AssetRepository, "listByProject">;
  storageProvider: Pick<StorageProvider, "get">;
  analyzers: BrandAnalyzerRegistry;
  repository: Pick<
    BrandRepository,
    "save" | "update" | "getByProjectId" | "setLocked" | "listSourceStates" | "saveSourceStates"
  >;
  intelligence: Pick<
    IntelligenceRepository,
    "recordEvidence" | "listEvidence" | "listBrandSignals"
  >;
  interpretationProvider?: BrandInterpretationProvider | null;
  now?: () => Date;
  createId?: (prefix: string) => string;
}

interface AnalysisRun {
  source: Source | null;
  analyzerId: string;
  result: BrandAnalyzerResult;
}

export class BrandIntelligenceService {
  private readonly projectService: BrandIntelligenceServiceDependencies["projectService"];
  private readonly sourceRepository: BrandIntelligenceServiceDependencies["sourceRepository"];
  private readonly assetRepository: BrandIntelligenceServiceDependencies["assetRepository"];
  private readonly storageProvider: BrandIntelligenceServiceDependencies["storageProvider"];
  private readonly analyzers: BrandAnalyzerRegistry;
  private readonly repository: BrandIntelligenceServiceDependencies["repository"];
  private readonly intelligence: BrandIntelligenceServiceDependencies["intelligence"];
  private readonly interpretationProvider: BrandInterpretationProvider | null;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(deps: BrandIntelligenceServiceDependencies) {
    this.projectService = deps.projectService;
    this.sourceRepository = deps.sourceRepository;
    this.assetRepository = deps.assetRepository;
    this.storageProvider = deps.storageProvider;
    this.analyzers = deps.analyzers;
    this.repository = deps.repository;
    this.intelligence = deps.intelligence;
    this.interpretationProvider = deps.interpretationProvider ?? null;
    this.now = deps.now ?? (() => new Date());
    this.createId = deps.createId ?? createId;
  }

  async getProfile(projectId: string, userId: string): Promise<BrandProfileView> {
    await this.projectService.getAuthorized(projectId, userId);
    const [stored, sourceStates, sources] = await Promise.all([
      this.repository.getByProjectId(projectId),
      this.repository.listSourceStates(projectId),
      this.sourceRepository.listByProject(projectId),
    ]);
    if (!stored) return { profile: null, sourceStates, execution: null };
    const profile = withComputedStatus(
      stored,
      sourceStates,
      sources.filter((source) => source.status === "READY"),
    );
    return { profile, sourceStates, execution: toBrandExecutionProfile(profile) };
  }

  async analyze(
    projectId: string,
    userId: string,
    options: BrandAnalysisOptions = {},
  ): Promise<BrandAnalysisReport> {
    await this.projectService.getAuthorized(projectId, userId);
    const [sources, assets, stored, sourceStates, brandSignals, evidence] = await Promise.all([
      this.sourceRepository.listByProject(projectId),
      this.assetRepository.listByProject(projectId),
      this.repository.getByProjectId(projectId),
      this.repository.listSourceStates(projectId),
      this.intelligence.listBrandSignals(projectId).catch(() => [] as BrandSignal[]),
      this.intelligence.listEvidence(projectId).catch(() => []),
    ]);

    const ready = sources.filter((source) => source.status === "READY");
    if (ready.length === 0) {
      throw new BrandError(
        "BRAND_NO_SOURCES",
        "No readable sources are available to analyze for brand",
      );
    }

    const selected = selectSources(ready, sourceStates, options);
    if (selected.length === 0 && stored) {
      const profile = withComputedStatus(stored, sourceStates, ready);
      return {
        profile,
        execution: toBrandExecutionProfile(profile),
        aiApplied: false,
        aiErrorCode: null,
        analyzedSourceIds: [],
        skipped: "UP_TO_DATE",
        notes: ["No new or changed sources since the last brand analysis"],
      };
    }

    const evidenceByKey = new Map(
      evidence.map((item) => [
        canonicalEvidenceKey(item.sourceId, item.kind, item.locator),
        item.id,
      ]),
    );

    const notes: string[] = [];
    const runs: AnalysisRun[] = [];

    for (const source of selected) {
      const run = await this.runSource(projectId, source, assets, notes, options.signal);
      if (run) runs.push(run);
    }

    const assetRun = await this.runAssets(projectId, assets);
    if (assetRun) runs.push(assetRun);

    const evidenceValues = collectEvidence(runs, evidenceByKey, sources);
    await this.recordEvidence(projectId, evidenceValues);

    const analyzerEntries = runs.flatMap((run) => entriesFromResult(run.result, evidenceByKey));
    const signalEntries = entriesFromBrandSignals(brandSignals, evidenceByKey);
    const storedEntries = entriesFromStored(stored);

    let aiApplied = false;
    let aiErrorCode: string | null = null;
    let aiEntries: BrandMergeEntry[] = [];
    if (this.interpretationProvider && analyzerEntries.length > 0) {
      const outcome = await this.interpret(projectId, ready, runs, analyzerEntries);
      if (outcome.error) {
        aiErrorCode = outcome.error.code;
        notes.push(outcome.error.message);
      } else {
        aiApplied = true;
        notes.push(...outcome.result.notes);
        aiEntries = entriesFromInterpretation(outcome.result, evidenceByKey);
      }
    } else {
      notes.push("AI interpretation disabled; deterministic brand analysis only");
    }

    const analyzerBySource = new Map(
      runs.flatMap((run) => (run.source ? [[run.source.id, run.analyzerId] as const] : [])),
    );
    const nextStates: BrandSourceState[] = selected
      .filter((source) => analyzerBySource.has(source.id))
      .map((source) => ({
        sourceId: source.id,
        contentHash: source.contentHash,
        sourceUpdatedAt: source.updatedAt,
        analyzerId: analyzerBySource.get(source.id) ?? "unknown",
        brandVersion: (stored?.version ?? 0) + 1,
        analyzedAt: this.now().toISOString(),
      }));
    const mergedStates = [...sourceStates.filter((state) => !selected.some((source) => source.id === state.sourceId)), ...nextStates];

    if (stored?.locked) {
      if (nextStates.length > 0) await this.repository.saveSourceStates(projectId, nextStates);
      notes.push(
        "Brand profile is locked: new evidence was recorded but no canonical value changed",
      );
      const profile = withComputedStatus(stored, mergedStates, ready);
      return {
        profile,
        execution: toBrandExecutionProfile(profile),
        aiApplied,
        aiErrorCode,
        analyzedSourceIds: nextStates.map((state) => state.sourceId),
        skipped: "LOCKED",
        notes,
      };
    }

    const composed = this.compose({
      projectId,
      stored,
      entries: [...storedEntries, ...analyzerEntries, ...signalEntries, ...aiEntries],
    });

    const timestamp = this.now().toISOString();
    const next: BrandProfile = {
      ...composed,
      version: (stored?.version ?? 0) + 1,
      createdAt: stored?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    const saved = stored
      ? await this.repository.update(projectId, next)
      : await this.repository.save(projectId, next);
    if (nextStates.length > 0) await this.repository.saveSourceStates(projectId, nextStates);

    const profile = withComputedStatus(saved, mergedStates, ready);
    return {
      profile,
      execution: toBrandExecutionProfile(profile),
      aiApplied,
      aiErrorCode,
      analyzedSourceIds: nextStates.map((state) => state.sourceId),
      skipped: "NONE",
      notes,
    };
  }

  /**
   * A refresh is incremental by contract: it re-reads only new or changed
   * sources and reports UP_TO_DATE when nothing moved, so a scheduled refresh
   * does not rewrite an unchanged profile.
   */
  async refresh(projectId: string, userId: string): Promise<BrandAnalysisReport> {
    return this.analyze(projectId, userId, { trigger: "REFRESH" });
  }

  async update(
    projectId: string,
    userId: string,
    input: UpdateBrandInput,
  ): Promise<BrandProfile> {
    await this.projectService.getAuthorized(projectId, userId);
    const stored = await this.repository.getByProjectId(projectId);
    if (!stored) {
      throw new BrandError("BRAND_NOT_FOUND", "This project has no brand profile yet");
    }

    const patch: UserBrandPatch = {
      colors: input.colors,
      fonts: input.fonts,
      terms: input.terms,
      guidelines: input.guidelines,
      voiceSignals: input.voiceSignals,
    };
    const userValues = buildUserBrandValues(patch);

    const patchedTextFields = new Set<BrandTextField>(
      TEXT_FIELDS.filter((field) => field in input),
    );
    const textPatch: Partial<Record<BrandTextField, string | null>> = {};
    for (const field of patchedTextFields) {
      const raw = input[field];
      textPatch[field] =
        raw === null || raw === undefined || String(raw).trim() === ""
          ? null
          : normalizeTerm(String(raw)) || null;
    }

    // A patch owns the sections it carries. A user who edits the palette is
    // replacing it, not adding to it, otherwise an extracted color could never
    // be removed: it would come back on the next refresh. Text fields differ
    // only when cleared, which falls back to the detected value instead of
    // erasing the evidence behind it.
    const replacedKinds = new Set<BrandMaterialKind>();
    if (input.colors !== undefined) replacedKinds.add("color");
    if (input.fonts !== undefined) replacedKinds.add("font");
    if (input.terms !== undefined) replacedKinds.add("term");
    if (input.guidelines !== undefined) replacedKinds.add("guideline");
    if (input.voiceSignals !== undefined) replacedKinds.add("voiceSignal");

    const kept = entriesFromStored(stored).filter((entry) => {
      if (replacedKinds.has(entry.kind)) return false;
      if (entry.kind !== "text") return true;
      if (!isBrandTextField(entry.key) || !patchedTextFields.has(entry.key)) return true;
      return textPatch[entry.key] === null && entry.origin !== "USER";
    });
    const userEntries = entriesFromUserValues(userValues);

    // Replacing a collection drops the values it used to hold. A slot that a
    // user just filled therefore holds a disagreement that merge cannot see,
    // because the displaced entry is no longer in the input, so the swap is
    // recorded explicitly instead of the evidence disappearing.
    const displaced = displacedSlotSeeds(
      entriesFromStored(stored),
      userEntries,
      replacedKinds,
    );

    const composed = this.compose({
      projectId,
      stored,
      entries: [...kept, ...userEntries],
      extraConflictSeeds: displaced,
    });

    const textOrigins: BrandTextOrigins = { ...composed.textOrigins };
    for (const field of patchedTextFields) {
      const normalized = textPatch[field];
      if (normalized !== null) {
        textOrigins[field] = "USER";
        continue;
      }
      const detected = kept.some(
        (entry) => entry.kind === "text" && entry.key === field,
      );
      if (detected) {
        // The detected value survives, so clearing an untouched field leaves the
        // canonical value alone instead of blanking it.
        delete textPatch[field];
        continue;
      }
      delete textOrigins[field];
    }

    const next: BrandProfile = {
      ...composed,
      ...textPatch,
      textOrigins,
      version: stored.version,
      locked: stored.locked,
      createdAt: stored.createdAt,
      updatedAt: this.now().toISOString(),
    };
    return this.repository.update(projectId, next);
  }

  async setLock(
    projectId: string,
    userId: string,
    locked: boolean,
  ): Promise<BrandProfile> {
    await this.projectService.getAuthorized(projectId, userId);
    const saved = await this.repository.setLocked(projectId, locked, this.now().toISOString());
    if (!saved) {
      throw new BrandError("BRAND_NOT_FOUND", "This project has no brand profile yet");
    }
    return saved;
  }

  private async runSource(
    projectId: string,
    source: Source,
    assets: readonly Asset[],
    notes: string[],
    signal: AbortSignal | undefined,
  ): Promise<AnalysisRun | null> {
    const bytes = await this.readSourceBytes(source);
    const base: BrandAnalyzerInput = {
      projectId,
      source,
      bytes,
      text: this.decodeText(bytes, source),
      html: this.decodeHtml(bytes, source),
      existingAssetIds: assets.map((asset) => asset.id),
      existingAssets: [...assets],
      signal,
    };
    const analyzer = this.analyzers.find(base);
    if (!analyzer) {
      notes.push(`No brand analyzer supports source type ${source.type}`);
      return null;
    }
    try {
      return { source, analyzerId: analyzer.id, result: await analyzer.analyze(base) };
    } catch (cause) {
      notes.push(
        `Brand analyzer ${analyzer.id} failed for source ${source.id}: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`,
      );
      return null;
    }
  }

  private async runAssets(
    projectId: string,
    assets: readonly Asset[],
  ): Promise<AnalysisRun | null> {
    if (assets.length === 0) return null;
    const base: BrandAnalyzerInput = {
      projectId,
      source: null,
      bytes: null,
      text: null,
      html: null,
      existingAssetIds: assets.map((asset) => asset.id),
      existingAssets: [...assets],
    };
    const analyzer = this.analyzers.find(base);
    if (!analyzer) return null;
    return { source: null, analyzerId: analyzer.id, result: await analyzer.analyze(base) };
  }

  private async readSourceBytes(source: Source): Promise<Uint8Array | null> {
    if (!source.storageKey) return null;
    try {
      const bytes = await this.storageProvider.get(source.storageKey);
      return bytes.length > MAX_SOURCE_BYTES ? bytes.subarray(0, MAX_SOURCE_BYTES) : bytes;
    } catch {
      return null;
    }
  }

  private decodeText(bytes: Uint8Array | null, source: Source): string | null {
    if (!bytes) return null;
    if (source.type === "PDF" || source.mimeType === "application/pdf") return null;
    return new TextDecoder().decode(bytes);
  }

  private decodeHtml(bytes: Uint8Array | null, source: Source): string | null {
    if (!bytes) return null;
    if (source.type !== "WEBSITE" && source.type !== "WEB_APP") return null;
    return new TextDecoder().decode(bytes);
  }

  private async recordEvidence(projectId: string, values: EvidenceValues[]): Promise<void> {
    if (values.length === 0) return;
    await this.intelligence
      .recordEvidence(projectId, values)
      .catch(() => undefined);
  }

  private async interpret(
    projectId: string,
    sources: readonly Source[],
    runs: readonly AnalysisRun[],
    analyzerEntries: readonly BrandMergeEntry[],
  ): Promise<
    { result: BrandInterpretationResult; error?: never } | { error: BrandError; result?: never }
  > {
    const evidenceRefs = new Map<
      string,
      { key: string; sourceId: string; kind: string; locator: string }
    >();
    for (const run of runs) {
      for (const draft of run.result.evidence) {
        evidenceRefs.set(draft.key, {
          key: draft.key,
          sourceId: draft.sourceId,
          kind: draft.kind,
          locator: draft.locator,
        });
      }
    }

    const deterministicFields = analyzerEntries
      .filter((entry) => entry.kind === "text")
      .map((entry) => entry.key as BrandTextField);

    try {
      const result = await this.interpretationProvider!.interpret({
        projectId,
        sources: sources.map((source) => ({
          id: source.id,
          type: source.type,
          name: source.name,
        })),
        evidence: [...evidenceRefs.values()],
        observations: buildObservations(runs),
        deterministicFields: [...new Set(deterministicFields)],
      });
      return { result };
    } catch (cause) {
      if (cause instanceof BrandError) return { error: cause };
      return {
        error: new BrandError(
          "BRAND_AI_UNAVAILABLE",
          cause instanceof Error ? cause.message : "Brand model call failed",
        ),
      };
    }
  }

  private compose(input: {
    projectId: string;
    stored: BrandProfile | null;
    entries: BrandMergeEntry[];
    extraConflictSeeds?: BrandConflictSeed[];
  }): BrandProfile {
    const { projectId, stored, entries, extraConflictSeeds = [] } = input;
    const base =
      stored ??
      emptyBrandProfile(projectId, this.createId("brp"), this.now().toISOString());

    const textEntries = entries.filter((entry) => entry.kind === "text");
    const materialEntries = entries.filter((entry) => entry.kind !== "text");

    const mergedText = mergeBrandEntries(textEntries);
    const mergedMaterial = mergeBrandEntries(materialEntries);

    const textValues: Partial<BrandProfile> = {};
    const textOrigins: BrandTextOrigins = {};
    for (const winner of mergedText.winners) {
      const field = winner.key as BrandTextField;
      textValues[field] = winner.value;
      textOrigins[field] = winner.origin;
    }

    const conflicts: BrandConflict[] = [
      ...mergedText.conflicts,
      ...mergedMaterial.conflicts,
      ...extraConflictSeeds,
    ]
      .slice(0, MAX_CONFLICTS)
      .map((seed, index) => toBrandConflict(seed, index, projectId));

    const scope = projectId;
    const material = <T,>(kind: BrandMaterialKind, convert: (entry: BrandMergeEntry, scope: string) => T) =>
      mergedMaterial.winners
        .filter((entry) => entry.kind === kind)
        .map((entry) => convert(entry, scope));

    const draft: BrandProfile = {
      ...base,
      ...textValues,
      textOrigins,
      colors: material("color", toBrandColor),
      fonts: material("font", toBrandFont),
      assets: material("asset", toBrandAsset),
      terms: material("term", toBrandTerm),
      voiceSignals: material("voiceSignal", toBrandVoiceSignal),
      guidelines: material("guideline", toBrandGuideline),
      conflicts,
    };

    return {
      ...draft,
      confidence: computeBrandConfidence(draft),
      status: computeBrandStatus(draft, { stale: false }),
    };
  }
}

/**
 * The slot a value occupies: a color owns its role, a font owns its role, and a
 * term, guideline or voice signal owns its own identity. Two values in the same
 * slot disagree no matter what else differs about them.
 */
function materialSlot(entry: BrandMergeEntry): string | null {
  const role = typeof entry.data.role === "string" ? entry.data.role.toUpperCase() : null;
  switch (entry.kind) {
    case "color":
    case "font":
      return role ? `${entry.kind}:${role.toLowerCase()}` : null;
    case "term":
      return `term:${entry.value.toLowerCase()}`;
    case "voiceSignal":
      return `voiceSignal:${String(entry.data.kind ?? entry.value).toLowerCase()}`;
    case "guideline":
      return `guideline:${entry.value.toLowerCase()}`;
    default:
      return null;
  }
}

function materialValue(entry: BrandMergeEntry): string {
  if (entry.kind === "color") {
    const hex = normalizeHexColor(String(entry.data.hex ?? ""));
    return hex ? `${entry.data.role ?? "PRIMARY"} ${hex}` : entry.value;
  }
  if (entry.kind === "font") {
    const family = normalizeFontFamily(String(entry.data.family ?? entry.value));
    return family ? `${entry.data.role ?? "BODY"} ${family}` : entry.value;
  }
  return entry.value;
}

function displacedSlotSeeds(
  storedEntries: readonly BrandMergeEntry[],
  userEntries: readonly BrandMergeEntry[],
  replacedKinds: ReadonlySet<BrandMaterialKind>,
): BrandConflictSeed[] {
  const userSlots = new Map<string, BrandMergeEntry>();
  for (const entry of userEntries) {
    if (!replacedKinds.has(entry.kind)) continue;
    const slot = materialSlot(entry);
    if (slot) userSlots.set(`${slot}`, entry);
  }
  if (userSlots.size === 0) return [];

  const seeds: BrandConflictSeed[] = [];
  const seen = new Set<string>();
  for (const entry of storedEntries) {
    if (!replacedKinds.has(entry.kind)) continue;
    const slot = materialSlot(entry);
    if (!slot || seen.has(slot)) continue;
    const winner = userSlots.get(slot);
    if (!winner) continue;
    seen.add(slot);
    seeds.push({
      field: slot,
      retained: materialValue(winner),
      competing: materialValue(entry),
      resolvedBy: "USER",
      sourceIds: [...entry.sourceIds],
      evidenceIds: [...entry.evidenceIds],
    });
  }
  return seeds;
}

function selectSources(
  sources: readonly Source[],
  states: readonly BrandSourceState[],
  options: BrandAnalysisOptions,
): Source[] {
  if (options.sourceIds && options.sourceIds.length > 0) {
    const wanted = new Set(options.sourceIds);
    return sources.filter((source) => wanted.has(source.id));
  }
  if (options.force) return [...sources];
  const known = new Map(states.map((state) => [state.sourceId, state]));
  return sources.filter((source) => {
    const state = known.get(source.id);
    if (!state) return true;
    return state.contentHash !== source.contentHash || state.sourceUpdatedAt !== source.updatedAt;
  });
}

function withComputedStatus(
  profile: BrandProfile,
  states: readonly BrandSourceState[],
  sources: readonly Source[],
): BrandProfile {
  const known = new Map(states.map((state) => [state.sourceId, state]));
  const stale = sources.some((source) => {
    const state = known.get(source.id);
    if (!state) return true;
    return source.contentHash !== state.contentHash || source.updatedAt !== state.sourceUpdatedAt;
  });
  return { ...profile, status: computeBrandStatus(profile, { stale }) };
}

function collectEvidence(
  runs: readonly AnalysisRun[],
  evidenceByKey: Map<string, string>,
  sources: readonly Source[],
): EvidenceValues[] {
  const knownSourceIds = new Set(sources.map((source) => source.id));
  const values: EvidenceValues[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    for (const draft of run.result.evidence) {
      if (values.length >= MAX_EVIDENCE_PER_RUN) break;
      if (seen.has(draft.key)) continue;
      if (!knownSourceIds.has(draft.sourceId)) continue;
      seen.add(draft.key);
      const canonical = canonicalEvidenceKey(draft.sourceId, draft.kind, draft.locator);
      const id = evidenceByKey.get(canonical) ?? brandEvidenceId(draft.key);
      evidenceByKey.set(canonical, id);
      // Brand analyzers reference their evidence by the key they minted
      // ("brand_evidence:*") while CP06/CP07 reference it canonically
      // ("evidence:*"). Both forms must resolve to the same row id, otherwise
      // analyzer-derived values silently lose their provenance.
      evidenceByKey.set(draft.key, id);
      values.push({
        id,
        key: draft.key,
        sourceId: draft.sourceId,
        kind: draft.kind,
        locator: draft.locator,
        excerpt: draft.excerpt ? draft.excerpt.slice(0, MAX_EXCERPT) : null,
        metadata: draft.metadata ? JSON.stringify(draft.metadata) : null,
      });
    }
  }
  return values;
}

function evidenceIds(
  keys: readonly string[],
  evidenceByKey: Map<string, string>,
): string[] {
  return keys.map((key) => evidenceByKey.get(key)).filter((id): id is string => Boolean(id));
}

function entriesFromResult(
  result: BrandAnalyzerResult,
  evidenceByKey: Map<string, string>,
): BrandMergeEntry[] {
  const entries: BrandMergeEntry[] = [];

  for (const candidate of result.text) {
    entries.push({
      kind: "text",
      key: candidate.field,
      value: candidate.value,
      origin: candidate.origin,
      basis: candidate.basis,
      confidence: candidate.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(candidate.evidenceKeys, evidenceByKey),
      data: {},
    });
  }

  for (const color of result.colors) {
    const hex = normalizeHexColor(color.hex);
    if (!hex) continue;
    entries.push({
      kind: "color",
      key: `${color.role}|${hex}`,
      value: color.name,
      origin: color.origin,
      basis: color.basis,
      confidence: color.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(color.evidenceKeys, evidenceByKey),
      data: { role: color.role, hex, notes: color.notes ?? null },
    });
  }

  for (const font of result.fonts) {
    const family = normalizeFontFamily(font.family);
    if (!family) continue;
    entries.push({
      kind: "font",
      key: `${font.role}|${family.toLowerCase()}`,
      value: family,
      origin: font.origin,
      basis: font.basis,
      confidence: font.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(font.evidenceKeys, evidenceByKey),
      data: {
        role: font.role,
        weight: font.weight ?? null,
        style: font.style ?? null,
        sourceUrl: font.sourceUrl ?? null,
        notes: font.notes ?? null,
      },
    });
  }

  for (const asset of result.assets) {
    if (!asset.assetId) continue;
    entries.push({
      kind: "asset",
      key: `${asset.assetId}|${asset.role}`,
      value: asset.label,
      origin: asset.origin,
      basis: asset.basis,
      confidence: asset.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(asset.evidenceKeys, evidenceByKey),
      data: { role: asset.role, assetId: asset.assetId, notes: asset.notes ?? null },
    });
  }

  for (const term of result.terms) {
    const value = normalizeTerm(term.term);
    if (!value) continue;
    entries.push({
      kind: "term",
      key: value.toLowerCase(),
      value,
      origin: term.origin,
      basis: term.basis,
      confidence: term.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(term.evidenceKeys, evidenceByKey),
      data: {
        category: term.category,
        preference: term.preference,
        notes: term.notes ?? null,
      },
    });
  }

  for (const signal of result.voiceSignals) {
    entries.push({
      kind: "voiceSignal",
      key: `${signal.kind}|${signal.value.toLowerCase()}`,
      value: signal.value,
      origin: signal.origin,
      basis: signal.basis,
      confidence: signal.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(signal.evidenceKeys, evidenceByKey),
      data: { kind: signal.kind },
    });
  }

  for (const guideline of result.guidelines) {
    entries.push({
      kind: "guideline",
      key: `guideline|${guideline.title.toLowerCase()}`,
      value: guideline.title,
      origin: guideline.origin,
      basis: guideline.basis,
      confidence: "MEDIUM",
      sourceIds: [],
      evidenceIds: evidenceIds(guideline.evidenceKeys, evidenceByKey),
      data: { detail: guideline.detail },
    });
  }

  return entries;
}

function entriesFromUserValues(
  values: ReturnType<typeof buildUserBrandValues>,
): BrandMergeEntry[] {
  const entries: BrandMergeEntry[] = [];
  for (const color of values.colors) {
    const hex = normalizeHexColor(color.hex);
    if (!hex) continue;
    entries.push({
      kind: "color",
      key: `${color.role}|${hex}`,
      value: color.name,
      origin: "USER",
      basis: "USER",
      confidence: "HIGH",
      sourceIds: [],
      evidenceIds: [],
      data: { role: color.role, hex, notes: color.notes ?? null },
    });
  }
  for (const font of values.fonts) {
    const family = normalizeFontFamily(font.family);
    if (!family) continue;
    entries.push({
      kind: "font",
      key: `${font.role}|${family.toLowerCase()}`,
      value: family,
      origin: "USER",
      basis: "USER",
      confidence: "HIGH",
      sourceIds: [],
      evidenceIds: [],
      data: {
        role: font.role,
        weight: font.weight ?? null,
        style: font.style ?? null,
        sourceUrl: font.sourceUrl ?? null,
        notes: font.notes ?? null,
      },
    });
  }
  for (const term of values.terms) {
    entries.push({
      kind: "term",
      key: term.term.toLowerCase(),
      value: term.term,
      origin: "USER",
      basis: "USER",
      confidence: "HIGH",
      sourceIds: [],
      evidenceIds: [],
      data: { category: term.category, preference: term.preference, notes: term.notes ?? null },
    });
  }
  for (const guideline of values.guidelines) {
    entries.push({
      kind: "guideline",
      key: `guideline|${guideline.title.toLowerCase()}`,
      value: guideline.title,
      origin: "USER",
      basis: "USER",
      confidence: "HIGH",
      sourceIds: [],
      evidenceIds: [],
      data: { detail: guideline.detail },
    });
  }
  for (const signal of values.voiceSignals) {
    entries.push({
      kind: "voiceSignal",
      key: `${signal.kind}|${signal.value.toLowerCase()}`,
      value: signal.value,
      origin: "USER",
      basis: "USER",
      confidence: "HIGH",
      sourceIds: [],
      evidenceIds: [],
      data: { kind: signal.kind },
    });
  }
  return entries;
}

function entriesFromStored(stored: BrandProfile | null): BrandMergeEntry[] {
  if (!stored) return [];
  const entries: BrandMergeEntry[] = [];
  const originFor = (field: BrandTextField): BrandOrigin => stored.textOrigins[field] ?? "EXTRACTED";

  for (const field of TEXT_FIELDS) {
    const value = brandTextValue(stored, field);
    if (!value) continue;
    entries.push({
      kind: "text",
      key: field,
      value,
      origin: originFor(field),
      basis: brandPrecedenceForOrigin(originFor(field)),
      confidence: stored.confidence,
      sourceIds: [],
      evidenceIds: [],
      data: {},
    });
  }

  for (const color of stored.colors) {
    entries.push({
      kind: "color",
      key: `${color.role}|${color.hex}`,
      value: color.name,
      origin: color.origin,
      basis: color.basis,
      confidence: color.confidence,
      sourceIds: color.sourceIds,
      evidenceIds: color.evidenceIds,
      data: { role: color.role, hex: color.hex, notes: color.notes },
    });
  }

  for (const font of stored.fonts) {
    entries.push({
      kind: "font",
      key: `${font.role}|${font.family.toLowerCase()}`,
      value: font.family,
      origin: font.origin,
      basis: font.basis,
      confidence: font.confidence,
      sourceIds: font.sourceIds,
      evidenceIds: font.evidenceIds,
      data: {
        role: font.role,
        weight: font.weight,
        style: font.style,
        sourceUrl: font.sourceUrl,
        notes: font.notes,
      },
    });
  }

  for (const asset of stored.assets) {
    entries.push({
      kind: "asset",
      key: `${asset.assetId}|${asset.role}`,
      value: asset.label,
      origin: asset.origin,
      basis: asset.basis,
      confidence: asset.confidence,
      sourceIds: asset.sourceIds,
      evidenceIds: asset.evidenceIds,
      data: { role: asset.role, assetId: asset.assetId, notes: asset.notes },
    });
  }

  for (const term of stored.terms) {
    entries.push({
      kind: "term",
      key: term.term.toLowerCase(),
      value: term.term,
      origin: term.origin,
      basis: term.basis,
      confidence: term.confidence,
      sourceIds: term.sourceIds,
      evidenceIds: term.evidenceIds,
      data: { category: term.category, preference: term.preference, notes: term.notes },
    });
  }

  for (const signal of stored.voiceSignals) {
    entries.push({
      kind: "voiceSignal",
      key: `${signal.kind}|${signal.value.toLowerCase()}`,
      value: signal.value,
      origin: signal.origin,
      basis: signal.basis,
      confidence: signal.confidence,
      sourceIds: signal.sourceIds,
      evidenceIds: signal.evidenceIds,
      data: { kind: signal.kind },
    });
  }

  for (const guideline of stored.guidelines) {
    entries.push({
      kind: "guideline",
      key: `guideline|${guideline.title.toLowerCase()}`,
      value: guideline.title,
      origin: guideline.origin,
      basis: guideline.basis,
      confidence: "MEDIUM",
      sourceIds: guideline.sourceIds,
      evidenceIds: guideline.evidenceIds,
      data: { detail: guideline.detail },
    });
  }

  return entries;
}

/**
 * CP06 brand signals are read as a lower ranked basis. They were extracted by a
 * different pipeline, so they can enrich the canonical brand but never outrank
 * a value the brand analyzers read from the sources themselves.
 */
function entriesFromBrandSignals(
  signals: readonly BrandSignal[],
  evidenceByKey: Map<string, string>,
): BrandMergeEntry[] {
  const entries: BrandMergeEntry[] = [];
  for (const signal of signals) {
    const value = signal.value.trim();
    if (!value) continue;
    const kind = signal.kind.toLowerCase();
    const provenance = signal.provenance;
    const ids = provenance?.evidenceIds?.length ? provenance.evidenceIds : [];
    const sourceIds = provenance?.sourceIds ?? [];
    void evidenceByKey;

    if (kind === "color" || kind === "palette") {
      const hex = normalizeHexColor(value);
      if (!hex) continue;
      entries.push({
        kind: "color",
        key: `PRIMARY|${hex}`,
        value: `Brand color ${hex}`,
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        confidence: signal.confidence,
        sourceIds,
        evidenceIds: ids,
        data: { role: "PRIMARY", hex, notes: "Carried over from product intelligence" },
      });
      continue;
    }

    if (kind === "font_family" || kind === "font" || kind === "typography") {
      const family = normalizeFontFamily(value);
      if (!family) continue;
      entries.push({
        kind: "font",
        key: `BODY|${family.toLowerCase()}`,
        value: family,
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        confidence: signal.confidence,
        sourceIds,
        evidenceIds: ids,
        data: {
          role: "BODY",
          weight: null,
          style: null,
          sourceUrl: null,
          notes: signal.label,
        },
      });
      continue;
    }

    if (kind === "tone" || kind === "voice" || kind === "messaging") {
      entries.push({
        kind: "voiceSignal",
        key: `TONE|${value.toLowerCase()}`,
        value,
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        confidence: signal.confidence,
        sourceIds,
        evidenceIds: ids,
        data: { kind: "TONE" },
      });
      continue;
    }

    if (kind === "positioning" || kind === "tagline") {
      entries.push({
        kind: "text",
        key: kind,
        value,
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        confidence: signal.confidence,
        sourceIds,
        evidenceIds: ids,
        data: {},
      });
      continue;
    }

    if (kind === "target_audience" || kind === "audience") {
      entries.push({
        kind: "term",
        key: value.toLowerCase(),
        value,
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        confidence: signal.confidence,
        sourceIds,
        evidenceIds: ids,
        data: { category: "AUDIENCE", preference: "NEUTRAL", notes: signal.label },
      });
    }
  }
  return entries;
}

function entriesFromInterpretation(
  result: BrandInterpretationResult,
  evidenceByKey: Map<string, string>,
): BrandMergeEntry[] {
  const entries: BrandMergeEntry[] = [];
  for (const item of result.text) {
    entries.push({
      kind: "text",
      key: item.field,
      value: item.value,
      origin: "INFERRED",
      basis: "INFERENCE",
      confidence: item.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(item.evidenceKeys, evidenceByKey),
      data: {},
    });
  }
  for (const signal of result.voiceSignals) {
    entries.push({
      kind: "voiceSignal",
      key: `${signal.kind}|${signal.value.toLowerCase()}`,
      value: signal.value,
      origin: "INFERRED",
      basis: "INFERENCE",
      confidence: signal.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(signal.evidenceKeys, evidenceByKey),
      data: { kind: signal.kind },
    });
  }
  for (const term of result.terms) {
    const value = normalizeTerm(term.term);
    if (!value) continue;
    entries.push({
      kind: "term",
      key: value.toLowerCase(),
      value,
      origin: "INFERRED",
      basis: "INFERENCE",
      confidence: term.confidence,
      sourceIds: [],
      evidenceIds: evidenceIds(term.evidenceKeys, evidenceByKey),
      data: { category: term.category, preference: term.preference, notes: null },
    });
  }
  return entries;
}

function buildObservations(runs: readonly AnalysisRun[]): string {
  const lines: string[] = [];
  for (const run of runs) {
    const label = run.source ? `${run.source.type} ${run.source.name}` : "project assets";
    lines.push(`${label}:`);
    for (const candidate of run.result.text) {
      lines.push(`- ${candidate.field}: ${candidate.value}`);
    }
    for (const color of run.result.colors) {
      lines.push(`- color ${color.role}: ${color.hex} (${color.name})`);
    }
    for (const font of run.result.fonts) {
      lines.push(`- font ${font.role}: ${font.family}`);
    }
    for (const term of run.result.terms) {
      lines.push(`- term ${term.preference.toLowerCase()}: ${term.term}`);
    }
    for (const guideline of run.result.guidelines) {
      lines.push(`- guideline ${guideline.title}: ${guideline.detail}`);
    }
    for (const signal of run.result.voiceSignals) {
      lines.push(`- voice ${signal.kind}: ${signal.value}`);
    }
    for (const note of run.result.notes) {
      lines.push(`- note: ${note}`);
    }
  }
  return lines.join("\n").slice(0, 8_000);
}
