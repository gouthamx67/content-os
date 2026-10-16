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

export type CreateProjectLocaleInput = {
  id: string;
  projectId: string;
  locale: string;
  label: string;
  direction: TextDirection;
  isSource: boolean;
  isTarget: boolean;
  createdById: string;
  now: string;
};

export type UpdateProjectLocaleInput = {
  localeId: string;
  label?: string;
  direction?: TextDirection;
  isSource?: boolean;
  isTarget?: boolean;
  updatedAt: string;
};

export type UpsertGlossaryTermInput = {
  id: string;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  term: string;
  translation: string;
  doNotTranslate: boolean;
  createdById: string;
  now: string;
};

export type UpsertTranslationMemoryInput = {
  id: string;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  sourceHash: string;
  sourceText: string;
  targetText: string;
  createdById: string;
  now: string;
};

export type LocalizationRevisionDraft = {
  revisionId: string;
  kind: LocalizationRevisionKind;
  snapshot: LocalizationSnapshot;
  createdById: string;
  createdAt: string;
};

/**
 * Lifecycle columns a mutation may set alongside its own change.
 *
 * A patch field that is `undefined` is left untouched; `null` clears it. The
 * approval columns are written in the same transaction that appends the approval
 * snapshot, so a reader can never observe `APPROVED` without the revision it
 * approved.
 */
export type LocalizationJobPatch = {
  status?: LocalizationStatus;
  provider?: string | null;
  approvalRevisionNumber?: number | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  appliedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  sourceRevision?: string;
  sourceHash?: string;
};

export type AppendLocalizationRevisionInput = {
  projectId: string;
  jobId: string;
  expectedRevisionNumber: number;
  revision: LocalizationRevisionDraft;
  jobPatch: LocalizationJobPatch;
  now: string;
};

export type LocalizationMutationResult = {
  applied: boolean;
  job: LocalizationJobRecord | null;
};

export type LocalizationRevisionListFilter = {
  jobId: string;
  limit: number;
  offset: number;
};

export type CreateLocalizationJobInput = {
  id: string;
  projectId: string;
  sourceType: LocalizationJobRecord["sourceType"];
  sourceId: string;
  sourceRevision: string;
  sourceHash: string;
  sourceLocale: string;
  targetLocale: string;
  strategy: LocalizationJobRecord["strategy"];
  status: LocalizationStatus;
  provider: string | null;
  createdById: string;
  now: string;
  firstRevision: LocalizationRevisionDraft;
};

/**
 * Persistence for localization.
 *
 * Reads are scoped by project and id together. The job head is claimed by
 * `appendRevision`, which names the revision number it expects: a writer that
 * read an older head is refused rather than merged. Locales, glossary and
 * translation memory are project-scoped and keyed uniquely so a re-add updates
 * in place.
 */
export type LocalizationRepository = {
  createProjectLocale(
    input: CreateProjectLocaleInput,
  ): Promise<ProjectLocaleRecord>;

  listProjectLocales(projectId: string): Promise<ProjectLocaleRecord[]>;

  getProjectLocale(
    projectId: string,
    localeId: string,
  ): Promise<ProjectLocaleRecord | null>;

  findProjectLocaleByCode(
    projectId: string,
    locale: string,
  ): Promise<ProjectLocaleRecord | null>;

  updateProjectLocale(
    projectId: string,
    input: UpdateProjectLocaleInput,
  ): Promise<ProjectLocaleRecord | null>;

  deleteProjectLocale(projectId: string, localeId: string): Promise<boolean>;

  upsertGlossaryTerm(
    input: UpsertGlossaryTermInput,
  ): Promise<LocaleGlossaryRecord>;

  listGlossary(
    projectId: string,
    sourceLocale: string,
    targetLocale: string,
  ): Promise<LocaleGlossaryRecord[]>;

  deleteGlossaryTerm(projectId: string, termId: string): Promise<boolean>;

  upsertTranslationMemory(
    input: UpsertTranslationMemoryInput,
  ): Promise<TranslationMemoryRecord>;

  lookupTranslationMemory(
    projectId: string,
    sourceLocale: string,
    targetLocale: string,
    sourceHash: string,
  ): Promise<TranslationMemoryRecord | null>;

  createJob(input: CreateLocalizationJobInput): Promise<LocalizationJobRecord>;

  getJob(
    projectId: string,
    jobId: string,
  ): Promise<LocalizationJobRecord | null>;

  listJobs(projectId: string): Promise<LocalizationJobRecord[]>;

  listRevisions(
    filter: LocalizationRevisionListFilter,
  ): Promise<LocalizationRevisionRecord[]>;

  countRevisions(jobId: string): Promise<number>;

  getRevisionByNumber(
    jobId: string,
    revisionNumber: number,
  ): Promise<LocalizationRevisionRecord | null>;

  appendRevision(
    input: AppendLocalizationRevisionInput,
  ): Promise<LocalizationMutationResult>;
};
