import type {
  EditorDocumentRecord,
  EditorDocumentStatus,
  EditorNodeRecord,
  EditorOperationType,
  EditorRevisionRecord,
} from "../../modules/editor-engine/domain/types";

export type CreateEditorDocumentInput = {
  documentId: string;
  projectId: string;
  name: string;
  createdById: string;
  documentVersion: number;
  status: EditorDocumentStatus;
  now: string;
  /** The node rows that project the opening snapshot. */
  nodes: readonly EditorNodeRecord[];
};

export type CreateEditorRevisionInput = {
  revisionId: string;
  documentId: string;
  revisionNumber: number;
  operationType: EditorOperationType;
  operationPayload: string;
  snapshot: string;
  snapshotSha256: string;
  createdById: string;
  sourceType: string;
  sourceId: string | null;
  provenanceSourceIds: readonly string[];
  restoredFromRevisionId: string | null;
  createdAt: string;
};

export type AppendRevisionInput = {
  revision: CreateEditorRevisionInput;
  /**
   * The head the caller believes it is editing. `null` means "the document has
   * no revision yet", which only a creation can satisfy.
   */
  expectedRevisionId: string | null;
  /**
   * The node rows that project the new snapshot. Written inside the same
   * transaction as the revision so the two can never be observed apart.
   */
  nodes: readonly EditorNodeRecord[];
};

export type AppendRevisionResult = {
  /** False when another writer moved the head first; nothing was written. */
  applied: boolean;
  revision: EditorRevisionRecord | null;
  document: EditorDocumentRecord | null;
  /** The head as it actually is, returned so the caller can report the conflict. */
  actualHeadRevisionId: string | null;
};

export type EditorRevisionListFilter = {
  documentId: string;
  limit: number;
  offset: number;
};

export type ListEditorDocumentsFilter = {
  projectId: string;
  status?: EditorDocumentStatus | null;
};

export type EditorRepository = {
  createDocument(
    input: CreateEditorDocumentInput,
    revision: CreateEditorRevisionInput,
  ): Promise<EditorDocumentRecord>;

  getDocument(
    projectId: string,
    documentId: string,
  ): Promise<EditorDocumentRecord | null>;

  listDocuments(
    filter: ListEditorDocumentsFilter,
  ): Promise<EditorDocumentRecord[]>;

  setStatus(
    projectId: string,
    documentId: string,
    status: EditorDocumentStatus,
    updatedAt: string,
  ): Promise<EditorDocumentRecord | null>;

  listNodes(documentId: string): Promise<EditorNodeRecord[]>;

  /**
   * Appends a revision and moves the head, but only if the head is still the one
   * the caller started from.
   */
  appendRevision(input: AppendRevisionInput): Promise<AppendRevisionResult>;

  getRevision(
    documentId: string,
    revisionId: string,
  ): Promise<EditorRevisionRecord | null>;

  getRevisionByNumber(
    documentId: string,
    revisionNumber: number,
  ): Promise<EditorRevisionRecord | null>;

  listRevisions(
    filter: EditorRevisionListFilter,
  ): Promise<EditorRevisionRecord[]>;

  countRevisions(documentId: string): Promise<number>;
};
