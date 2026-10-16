import type {
  LocalizationJobRecord,
  LocalizationSnapshot,
  LocalizationStatus,
  LocalizationStrategy,
} from "../domain/types";
import { localizationHash } from "../serialization/canonical";

export const LOCALIZED_ARTIFACT_SCHEMA_VERSION = 1 as const;

/**
 * A localized artifact: the frozen result of applying one approved localization.
 *
 * It carries no storage keys, no rows from another project and no source bytes —
 * only text a user wrote and hashes of it. Every segment keeps the exact source
 * text it came from, so the result is traceable field by segment.
 */
export type LocalizedArtifact = {
  schemaVersion: typeof LOCALIZED_ARTIFACT_SCHEMA_VERSION;
  localizationJobId: string;
  sourceType: LocalizationJobRecord["sourceType"];
  sourceId: string;
  sourceRevision: string;
  sourceHash: string;
  sourceLocale: string;
  targetLocale: string;
  strategy: LocalizationStrategy;
  localizationRevision: number;
  targetHash: string;
  provider: string;
  providerModel: string | null;
  status: LocalizationStatus;
  segments: readonly {
    id: string;
    kind: string;
    path: string;
    sourceText: string;
    targetText: string | null;
    glossary: Record<string, string>;
  }[];
  findings: readonly import("../domain/types").LocalizationFinding[];
  generatedAt: string;
};

export type MaterializeInput = {
  job: LocalizationJobRecord;
  snapshot: LocalizationSnapshot;
  localizationRevision: number;
  provenance: {
    provider: string;
    providerModel: string | null;
  };
  generatedAt: string;
};

/**
 * Builds the exported artifact.
 *
 * Every value is either text a user wrote or a deterministic hash of it: no
 * storage key, no raw database row and nothing from another project can reach
 * the browser through it.
 */
export class MaterializationService {
  build(input: MaterializeInput): LocalizedArtifact {
    const { job, snapshot } = input;

    const segments = snapshot.segments.map((segment) => ({
      id: segment.id,
      kind: segment.kind,
      path: segment.path,
      sourceText: segment.sourceText,
      targetText: segment.targetText,
      glossary: segment.glossary,
    }));

    const targetHash = localizationHash(
      segments.map((segment) => ({
        id: segment.id,
        targetText: segment.targetText,
      })),
    );

    return {
      schemaVersion: LOCALIZED_ARTIFACT_SCHEMA_VERSION,
      localizationJobId: job.id,
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      sourceRevision: snapshot.sourceRevision,
      sourceHash: snapshot.sourceHash,
      sourceLocale: job.sourceLocale,
      targetLocale: job.targetLocale,
      strategy: job.strategy,
      localizationRevision: input.localizationRevision,
      targetHash,
      provider: input.provenance.provider,
      providerModel: input.provenance.providerModel,
      status: job.status,
      segments,
      findings: snapshot.findings,
      generatedAt: input.generatedAt,
    };
  }
}
