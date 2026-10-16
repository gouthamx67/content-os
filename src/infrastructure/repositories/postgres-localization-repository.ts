import { db } from "../../prisma/db";
import type { PublicOrm, Transaction } from "../../prisma/db";
import { pgTimestampToIso } from "../../lib/time";
import type {
  AppendLocalizationRevisionInput,
  CreateLocalizationJobInput,
  CreateProjectLocaleInput,
  LocalizationJobPatch,
  LocalizationMutationResult,
  LocalizationRepository,
  LocalizationRevisionDraft,
  LocalizationRevisionListFilter,
  UpdateProjectLocaleInput,
  UpsertGlossaryTermInput,
  UpsertTranslationMemoryInput,
} from "../../core/ports/localization-repository";
import type {
  LocaleGlossaryRecord,
  LocalizationJobRecord,
  LocalizationRevisionKind,
  LocalizationRevisionRecord,
  LocalizationSnapshot,
  LocalizationStatus,
  ProjectLocaleRecord,
  TextDirection,
  TranslationMemoryRecord,
} from "../../modules/localization-engine/domain/types";
import { localizationHash, parseStoredJson } from "../../modules/localization-engine/serialization/canonical";

type ProjectLocaleRow = {
  id: string;
  projectId: string;
  locale: string;
  label: string;
  direction: string;
  isSource: boolean;
  isTarget: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

type GlossaryRow = {
  id: string;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  term: string;
  translation: string;
  doNotTranslate: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

type TranslationMemoryRow = {
  id: string;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  sourceHash: string;
  sourceText: string;
  targetText: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: string;
  projectId: string;
  sourceType: string;
  sourceId: string;
  sourceRevision: string;
  sourceHash: string;
  sourceLocale: string;
  targetLocale: string;
  strategy: string;
  status: string;
  provider: string | null;
  headRevisionNumber: number;
  approvalRevisionNumber: number | null;
  approvedById: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

type RevisionRow = {
  id: string;
  jobId: string;
  revisionNumber: number;
  kind: string;
  snapshot: string;
  snapshotHash: string;
  createdById: string;
  createdAt: string;
};

function decodeLocale(row: ProjectLocaleRow): ProjectLocaleRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    locale: row.locale,
    label: row.label,
    direction: row.direction as TextDirection,
    isSource: row.isSource,
    isTarget: row.isTarget,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeGlossary(row: GlossaryRow): LocaleGlossaryRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceLocale: row.sourceLocale,
    targetLocale: row.targetLocale,
    term: row.term,
    translation: row.translation,
    doNotTranslate: row.doNotTranslate,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeTranslationMemory(
  row: TranslationMemoryRow,
): TranslationMemoryRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceLocale: row.sourceLocale,
    targetLocale: row.targetLocale,
    sourceHash: row.sourceHash,
    sourceText: row.sourceText,
    targetText: row.targetText,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeJob(row: JobRow): LocalizationJobRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceType: row.sourceType as LocalizationJobRecord["sourceType"],
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision,
    sourceHash: row.sourceHash,
    sourceLocale: row.sourceLocale,
    targetLocale: row.targetLocale,
    strategy: row.strategy as LocalizationJobRecord["strategy"],
    status: row.status as LocalizationStatus,
    provider: row.provider,
    headRevisionNumber: row.headRevisionNumber,
    approvalRevisionNumber: row.approvalRevisionNumber,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt ? pgTimestampToIso(row.approvedAt) : null,
    appliedAt: row.appliedAt ? pgTimestampToIso(row.appliedAt) : null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeRevision(row: RevisionRow): LocalizationRevisionRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    revisionNumber: row.revisionNumber,
    kind: row.kind as LocalizationRevisionKind,
    snapshot: parseStoredJson<LocalizationSnapshot>(row.snapshot, "revision snapshot"),
    snapshotHash: row.snapshotHash,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function revisionValues(
  jobId: string,
  revision: LocalizationRevisionDraft,
  revisionNumber: number,
) {
  return {
    id: revision.revisionId,
    jobId,
    revisionNumber,
    kind: revision.kind,
    snapshot: JSON.stringify(revision.snapshot),
    snapshotHash: localizationHash(revision.snapshot),
    createdById: revision.createdById,
    createdAt: revision.createdAt,
  };
}

function patchColumns(patch: LocalizationJobPatch): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (patch.status !== undefined) columns["status"] = patch.status;
  if (patch.provider !== undefined) columns["provider"] = patch.provider;
  if (patch.approvalRevisionNumber !== undefined) {
    columns["approvalRevisionNumber"] = patch.approvalRevisionNumber;
  }
  if (patch.approvedById !== undefined) columns["approvedById"] = patch.approvedById;
  if (patch.approvedAt !== undefined) columns["approvedAt"] = patch.approvedAt;
  if (patch.appliedAt !== undefined) columns["appliedAt"] = patch.appliedAt;
  if (patch.errorCode !== undefined) columns["errorCode"] = patch.errorCode;
  if (patch.errorMessage !== undefined) columns["errorMessage"] = patch.errorMessage;
  if (patch.sourceRevision !== undefined) columns["sourceRevision"] = patch.sourceRevision;
  if (patch.sourceHash !== undefined) columns["sourceHash"] = patch.sourceHash;
  return columns;
}

function isRevisionOrdinalRace(error: unknown): boolean {
  const levels: unknown[] = [error];
  if (typeof error === "object" && error !== null) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) levels.push(cause);
  }

  return levels.some((level) => {
    if (typeof level !== "object" || level === null) return false;
    const candidate = level as { code?: unknown; constraint?: unknown };
    return (
      candidate.code === "23505" &&
      typeof candidate.constraint === "string" &&
      candidate.constraint.startsWith("localization_revision")
    );
  });
}

export class PostgresLocalizationRepository implements LocalizationRepository {
  constructor(private readonly orm: PublicOrm = db.orm.public) {}

  async createProjectLocale(
    input: CreateProjectLocaleInput,
  ): Promise<ProjectLocaleRecord> {
    await this.orm.ProjectLocale.create({
      id: input.id,
      projectId: input.projectId,
      locale: input.locale,
      label: input.label,
      direction: input.direction,
      isSource: input.isSource,
      isTarget: input.isTarget,
      createdById: input.createdById,
      createdAt: input.now,
      updatedAt: input.now,
    });

    const row = (await this.orm.ProjectLocale.where({
      projectId: input.projectId,
      id: input.id,
    }).first()) as ProjectLocaleRow | null;
    if (!row) throw new Error("Locale vanished during creation");
    return decodeLocale(row);
  }

  async listProjectLocales(projectId: string): Promise<ProjectLocaleRecord[]> {
    const rows = (await this.orm.ProjectLocale.where({ projectId })
      .orderBy((row) => row.locale.asc())
      .all()) as unknown as ProjectLocaleRow[];
    return rows.map(decodeLocale);
  }

  async getProjectLocale(
    projectId: string,
    localeId: string,
  ): Promise<ProjectLocaleRecord | null> {
    const row = (await this.orm.ProjectLocale.where({
      projectId,
      id: localeId,
    }).first()) as ProjectLocaleRow | null;
    return row ? decodeLocale(row) : null;
  }

  async findProjectLocaleByCode(
    projectId: string,
    locale: string,
  ): Promise<ProjectLocaleRecord | null> {
    const row = (await this.orm.ProjectLocale.where({
      projectId,
      locale,
    }).first()) as ProjectLocaleRow | null;
    return row ? decodeLocale(row) : null;
  }

  async updateProjectLocale(
    projectId: string,
    input: UpdateProjectLocaleInput,
  ): Promise<ProjectLocaleRecord | null> {
    const patch: Record<string, unknown> = { updatedAt: input.updatedAt };
    if (input.label !== undefined) patch["label"] = input.label;
    if (input.direction !== undefined) patch["direction"] = input.direction;
    if (input.isSource !== undefined) patch["isSource"] = input.isSource;
    if (input.isTarget !== undefined) patch["isTarget"] = input.isTarget;

    const row = (await this.orm.ProjectLocale.where({
      projectId,
      id: input.localeId,
    }).update(patch)) as ProjectLocaleRow | null;
    return row ? decodeLocale(row) : null;
  }

  async deleteProjectLocale(projectId: string, localeId: string): Promise<boolean> {
    const existing = await this.orm.ProjectLocale.where({
      projectId,
      id: localeId,
    }).first();
    if (!existing) return false;
    await this.orm.ProjectLocale.where({ projectId, id: localeId }).delete();
    return true;
  }

  async upsertGlossaryTerm(
    input: UpsertGlossaryTermInput,
  ): Promise<LocaleGlossaryRecord> {
    await db.transaction(async (tx) => {
      const existing = (await tx.orm.public.LocaleGlossary.where({
        projectId: input.projectId,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        term: input.term,
      }).first()) as GlossaryRow | null;

      if (existing) {
        await tx.orm.public.LocaleGlossary.where({ id: existing.id }).update({
          translation: input.translation,
          doNotTranslate: input.doNotTranslate,
          updatedAt: input.now,
        });
        return;
      }

      await tx.orm.public.LocaleGlossary.create({
        id: input.id,
        projectId: input.projectId,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        term: input.term,
        translation: input.translation,
        doNotTranslate: input.doNotTranslate,
        createdById: input.createdById,
        createdAt: input.now,
        updatedAt: input.now,
      });
    });

    const row = (await this.orm.LocaleGlossary.where({
      projectId: input.projectId,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      term: input.term,
    }).first()) as GlossaryRow | null;
    if (!row) throw new Error("Glossary term vanished during upsert");
    return decodeGlossary(row);
  }

  async listGlossary(
    projectId: string,
    sourceLocale: string,
    targetLocale: string,
  ): Promise<LocaleGlossaryRecord[]> {
    const rows = (await this.orm.LocaleGlossary.where({
      projectId,
      sourceLocale,
      targetLocale,
    })
      .orderBy((row) => row.term.asc())
      .all()) as unknown as GlossaryRow[];
    return rows.map(decodeGlossary);
  }

  async deleteGlossaryTerm(projectId: string, termId: string): Promise<boolean> {
    const existing = await this.orm.LocaleGlossary.where({
      projectId,
      id: termId,
    }).first();
    if (!existing) return false;
    await this.orm.LocaleGlossary.where({ projectId, id: termId }).delete();
    return true;
  }

  async upsertTranslationMemory(
    input: UpsertTranslationMemoryInput,
  ): Promise<TranslationMemoryRecord> {
    await db.transaction(async (tx) => {
      const existing = (await tx.orm.public.TranslationMemory.where({
        projectId: input.projectId,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        sourceHash: input.sourceHash,
      }).first()) as TranslationMemoryRow | null;

      if (existing) {
        await tx.orm.public.TranslationMemory.where({ id: existing.id }).update({
          sourceText: input.sourceText,
          targetText: input.targetText,
          updatedAt: input.now,
        });
        return;
      }

      await tx.orm.public.TranslationMemory.create({
        id: input.id,
        projectId: input.projectId,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        sourceHash: input.sourceHash,
        sourceText: input.sourceText,
        targetText: input.targetText,
        createdById: input.createdById,
        createdAt: input.now,
        updatedAt: input.now,
      });
    });

    const row = (await this.orm.TranslationMemory.where({
      projectId: input.projectId,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      sourceHash: input.sourceHash,
    }).first()) as TranslationMemoryRow | null;
    if (!row) throw new Error("Translation memory row vanished during upsert");
    return decodeTranslationMemory(row);
  }

  async lookupTranslationMemory(
    projectId: string,
    sourceLocale: string,
    targetLocale: string,
    sourceHash: string,
  ): Promise<TranslationMemoryRecord | null> {
    const row = (await this.orm.TranslationMemory.where({
      projectId,
      sourceLocale,
      targetLocale,
      sourceHash,
    }).first()) as TranslationMemoryRow | null;
    return row ? decodeTranslationMemory(row) : null;
  }

  async createJob(input: CreateLocalizationJobInput): Promise<LocalizationJobRecord> {
    await db.transaction(async (tx) => {
      await tx.orm.public.LocalizationJob.create({
        id: input.id,
        projectId: input.projectId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceRevision: input.sourceRevision,
        sourceHash: input.sourceHash,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        strategy: input.strategy,
        status: input.status,
        provider: input.provider,
        headRevisionNumber: 1,
        approvalRevisionNumber: null,
        approvedById: null,
        approvedAt: null,
        appliedAt: null,
        errorCode: null,
        errorMessage: null,
        createdById: input.createdById,
        createdAt: input.now,
        updatedAt: input.now,
      });

      await tx.orm.public.LocalizationRevision.create(
        revisionValues(input.id, input.firstRevision, 1),
      );
    });

    const job = await this.getJob(input.projectId, input.id);
    if (!job) throw new Error("Localization job vanished during creation");
    return job;
  }

  async getJob(
    projectId: string,
    jobId: string,
  ): Promise<LocalizationJobRecord | null> {
    const row = (await this.orm.LocalizationJob.where({
      projectId,
      id: jobId,
    }).first()) as JobRow | null;
    return row ? decodeJob(row) : null;
  }

  async listJobs(projectId: string): Promise<LocalizationJobRecord[]> {
    const rows = (await this.orm.LocalizationJob.where({ projectId })
      .orderBy((row) => row.createdAt.desc())
      .all()) as unknown as JobRow[];
    return rows.map(decodeJob);
  }

  async listRevisions(
    filter: LocalizationRevisionListFilter,
  ): Promise<LocalizationRevisionRecord[]> {
    const rows = (await this.orm.LocalizationRevision.where({
      jobId: filter.jobId,
    })
      .orderBy((row) => row.revisionNumber.desc())
      .limit(filter.limit)
      .offset(filter.offset)
      .all()) as unknown as RevisionRow[];
    return rows.map(decodeRevision);
  }

  async countRevisions(jobId: string): Promise<number> {
    const totals = await this.orm.LocalizationRevision.where({ jobId }).aggregate(
      (aggregate) => ({ total: aggregate.count() }),
    );
    return totals.total;
  }

  async getRevisionByNumber(
    jobId: string,
    revisionNumber: number,
  ): Promise<LocalizationRevisionRecord | null> {
    const row = (await this.orm.LocalizationRevision.where({
      jobId,
      revisionNumber,
    }).first()) as RevisionRow | null;
    return row ? decodeRevision(row) : null;
  }

  async appendRevision(
    input: AppendLocalizationRevisionInput,
  ): Promise<LocalizationMutationResult> {
    let claimed = false;

    try {
      await db.transaction(async (tx) => {
        const claimedRow = (await tx.orm.public.LocalizationJob.where({
          projectId: input.projectId,
          id: input.jobId,
          headRevisionNumber: input.expectedRevisionNumber,
        }).update({
          headRevisionNumber: input.expectedRevisionNumber + 1,
          updatedAt: input.now,
        })) as JobRow | null;

        if (!claimedRow) return;

        const columns = {
          ...patchColumns(input.jobPatch),
          headRevisionNumber: input.expectedRevisionNumber + 1,
          updatedAt: input.now,
        };

        await tx.orm.public.LocalizationJob.where({
          projectId: input.projectId,
          id: input.jobId,
        }).update(columns);

        await tx.orm.public.LocalizationRevision.create(
          revisionValues(
            input.jobId,
            input.revision,
            input.expectedRevisionNumber + 1,
          ),
        );

        claimed = true;
      });
    } catch (error) {
      if (!isRevisionOrdinalRace(error)) throw error;
      const job = await this.getJob(input.projectId, input.jobId);
      return { applied: false, job };
    }

    const job = await this.getJob(input.projectId, input.jobId);
    return { applied: claimed, job };
  }
}

export function createPostgresLocalizationRepository(
  orm: PublicOrm = db.orm.public,
): PostgresLocalizationRepository {
  return new PostgresLocalizationRepository(orm);
}

export type { Transaction };
