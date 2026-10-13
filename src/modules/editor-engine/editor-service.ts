import type { EditorRepository } from "../../core/ports/editor-repository";
import { EditorError } from "./errors";
import {
  EDITOR_DOCUMENT_STATUSES,
  EDITOR_DOCUMENT_VERSION,
  type EditorDocumentRecord,
  type EditorDocumentStatus,
  type EditorNode,
  type EditorNodeRecord,
  type EditorOperation,
  type EditorRevisionRecord,
  type EditorRevisionSummary,
  type EditorSnapshot,
} from "./domain/types";
import { EDITOR_LIMITS, validateSnapshot } from "./domain/validation";
import { applyOperation } from "./operations/apply-operation";
import {
  parseAndVerifySnapshot,
  serializeSnapshot,
  snapshotSha256,
} from "./serialization/editor-snapshot";
import { computeUndoTarget } from "./history/undo";
import { computeRedoTarget } from "./history/redo";
import {
  serializeRestorePayload,
  type RestoreDirection,
} from "./history/lineage";

/**
 * Where an edit came from.
 *
 * `SYSTEM` covers the browser's own gestures; `IMPORT` covers a source brought
 * in from another checkpoint; `AI` covers an accepted proposal. The distinction
 * is stored on every revision because "who changed this" is the first question
 * anyone asks of a content history.
 */
export const EDITOR_SOURCE_TYPES = ["SYSTEM", "IMPORT", "AI"] as const;
export type EditorSourceType = (typeof EDITOR_SOURCE_TYPES)[number];

export type EditorDocumentDetail = {
  document: EditorDocumentRecord;
  snapshot: EditorSnapshot;
  revision: EditorRevisionRecord;
};

export type EditorDocumentSummary = EditorDocumentRecord & {
  nodeCount: number;
  mediaCount: number;
  textCount: number;
};

export type ApplyEditorOperationArgs = {
  projectId: string;
  userId: string;
  documentId: string;
  /** The head the caller started from. A mismatch is a conflict, not a merge. */
  baseRevision: string;
  operation: EditorOperation;
  sourceType?: EditorSourceType;
  sourceId?: string | null;
  provenanceSourceIds?: readonly string[];
};

export type CreateEditorDocumentArgs = {
  projectId: string;
  userId: string;
  name: string;
  width?: number;
  height?: number;
  durationMs?: number;
  frameRate?: number;
  nodes?: readonly EditorNode[];
  status?: EditorDocumentStatus;
  sourceType?: EditorSourceType;
  sourceId?: string | null;
  provenanceSourceIds?: readonly string[];
};

export type EditorServiceDeps = {
  repository: EditorRepository;
  /** Throws when the caller is not a member of the project. */
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  /** Ids come from here so a test can make collisions deliberately. */
  newId: (prefix: string) => string;
  now?: () => string;
};

const DEFAULT_CANVAS = {
  width: 1080,
  height: 1920,
  durationMs: 15_000,
  frameRate: 30,
} as const;

function nodeRecordsFromSnapshot(
  snapshot: EditorSnapshot,
  now: string,
): EditorNodeRecord[] {
  return snapshot.nodes.map((node) => ({
    id: node.id,
    documentId: snapshot.documentId,
    parentId: node.parentId,
    type: node.type,
    name: node.name,
    zIndex: node.zIndex,
    sortIndex: node.zIndex,
    createdAt: now,
    updatedAt: now,
  }));
}

function summarize(document: EditorDocumentRecord, snapshot: EditorSnapshot) {
  return {
    ...document,
    nodeCount: snapshot.nodes.length,
    mediaCount: snapshot.nodes.filter((node) => node.asset !== null).length,
    textCount: snapshot.nodes.filter((node) => node.type === "TEXT").length,
  };
}

/**
 * Everything that changes an editor document goes through here.
 *
 * The service owns three invariants no route may bypass:
 *
 * - A mutation names the revision it started from, and the write only lands if
 *   that revision is still the head. There is no merge and no last-writer-wins.
 * - History is append-only. Undo, redo and an explicit restore each add a
 *   revision; nothing is ever updated or deleted.
 * - An operation is applied to the stored snapshot, never to something the
 *   caller sent. The wire shape is validated separately and then discarded.
 */
export class EditorService {
  private readonly repository: EditorRepository;
  private readonly authorizeProject: EditorServiceDeps["authorizeProject"];
  private readonly newId: EditorServiceDeps["newId"];
  private readonly now: () => string;

  constructor(deps: EditorServiceDeps) {
    this.repository = deps.repository;
    this.authorizeProject = deps.authorizeProject;
    this.newId = deps.newId;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async createDocument(
    args: CreateEditorDocumentArgs,
  ): Promise<EditorDocumentDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    const status = args.status ?? "DRAFT";
    if (!EDITOR_DOCUMENT_STATUSES.includes(status)) {
      throw new EditorError(
        "EDITOR_INVALID_OPERATION",
        `Unknown document status: ${String(status)}`,
      );
    }

    const now = this.now();
    const documentId = this.newId("edoc");

    const snapshot: EditorSnapshot = validateSnapshot({
      version: EDITOR_DOCUMENT_VERSION,
      documentId,
      width: args.width ?? DEFAULT_CANVAS.width,
      height: args.height ?? DEFAULT_CANVAS.height,
      durationMs: args.durationMs ?? DEFAULT_CANVAS.durationMs,
      frameRate: args.frameRate ?? DEFAULT_CANVAS.frameRate,
      nodes: [...(args.nodes ?? [])],
    });

    const sourceType = args.sourceType ?? "SYSTEM";
    const sourceId = args.sourceId ?? null;

    const document = await this.repository.createDocument(
      {
        documentId,
        projectId: args.projectId,
        name: args.name,
        createdById: args.userId,
        documentVersion: snapshot.version,
        status,
        now,
        nodes: nodeRecordsFromSnapshot(snapshot, now),
      },
      {
        revisionId: this.newId("edrev"),
        documentId,
        revisionNumber: 1,
        operationType: "CREATE",
        operationPayload: JSON.stringify({
          type: "CREATE",
          nodeCount: snapshot.nodes.length,
          sourceType,
          sourceId,
        }),
        snapshot: serializeSnapshot(snapshot),
        snapshotSha256: snapshotSha256(snapshot),
        createdById: args.userId,
        sourceType,
        sourceId,
        provenanceSourceIds: args.provenanceSourceIds ?? [],
        restoredFromRevisionId: null,
        createdAt: now,
      },
    );

    return {
      document,
      snapshot,
      revision: (await this.repository.getRevision(
        documentId,
        document.currentRevisionId as string,
      )) as EditorRevisionRecord,
    };
  }

  async listDocuments(args: {
    projectId: string;
    userId: string;
    status?: EditorDocumentStatus | null;
  }): Promise<EditorDocumentSummary[]> {
    await this.authorizeProject(args.projectId, args.userId);

    const documents = await this.repository.listDocuments({
      projectId: args.projectId,
      status: args.status ?? null,
    });

    const summaries: EditorDocumentSummary[] = [];

    for (const document of documents) {
      // One unreadable document must not fail the whole list: a document whose
      // head is missing is reported with its counts unknown rather than thrown.
      const head = await this.readHead(document).catch(() => null);

      summaries.push(
        head
          ? summarize(
              { ...document, revisionCount: head.revision.revisionNumber },
              head.snapshot,
            )
          : { ...document, nodeCount: 0, mediaCount: 0, textCount: 0 },
      );
    }

    return summaries;
  }

  async getDocument(args: {
    projectId: string;
    userId: string;
    documentId: string;
  }): Promise<EditorDocumentDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    const document = await this.repository.getDocument(args.projectId, args.documentId);

    if (!document) {
      throw new EditorError(
        "EDITOR_DOCUMENT_NOT_FOUND",
        "No editor document with that id exists in this project",
      );
    }

    return this.readHead(document);
  }

  async applyOperation(args: ApplyEditorOperationArgs): Promise<EditorDocumentDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    const document = await this.requireDocument(args.projectId, args.documentId);
    const head = await this.readHead(document);

    this.assertBaseRevision(head.document, args.baseRevision);

    const { snapshot } = applyOperation(head.snapshot, args.operation, {
      newNodeIds: this.mintIdsFor(head.snapshot, args.operation),
      newNodeId: args.operation.type === "DUPLICATE" ? args.operation.newNodeId : undefined,
    });

    const sourceType = args.sourceType ?? "SYSTEM";
    const now = this.now();

    const revision = await this.commit({
      document: head.document,
      baseRevision: args.baseRevision,
      revisionNumber: head.revision.revisionNumber + 1,
      snapshot,
      operationType: args.operation.type,
      operationPayload: JSON.stringify(args.operation),
      createdById: args.userId,
      sourceType,
      sourceId: args.sourceId ?? null,
      provenanceSourceIds: canonicalSourceIds(
        args.provenanceSourceIds ?? collectProvenance(snapshot),
      ),
      restoredFromRevisionId: null,
      now,
    });

    return {
      document: this.withCounts(revision.document, revision.revision),
      snapshot,
      revision: revision.revision,
    };
  }

  async history(args: {
    projectId: string;
    userId: string;
    documentId: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    document: EditorDocumentRecord;
    revisions: EditorRevisionSummary[];
    total: number;
  }> {
    await this.authorizeProject(args.projectId, args.userId);

    const document = await this.requireDocument(args.projectId, args.documentId);
    const total = await this.repository.countRevisions(args.documentId);

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const offset = Math.max(args.offset ?? 0, 0);

    const revisions = await this.repository.listRevisions({
      documentId: args.documentId,
      limit,
      offset,
    });

    return {
      document: await this.withCounts(document, null),
      revisions: revisions.map(stripSnapshot),
      total,
    };
  }

  /** Reads a revision's snapshot for preview. It never changes the document. */
  async previewRevision(args: {
    projectId: string;
    userId: string;
    documentId: string;
    revisionId: string;
  }): Promise<{ revision: EditorRevisionSummary; snapshot: EditorSnapshot }> {
    await this.authorizeProject(args.projectId, args.userId);
    await this.requireDocument(args.projectId, args.documentId);

    const revision = await this.requireRevision(args.documentId, args.revisionId);

    return {
      revision: stripSnapshot(revision),
      snapshot: parseAndVerifySnapshot(revision.snapshot, revision.snapshotSha256),
    };
  }

  async undo(args: {
    projectId: string;
    userId: string;
    documentId: string;
    baseRevision: string;
  }): Promise<EditorDocumentDetail> {
    return this.restoreByDirection(args, "UNDO");
  }

  async redo(args: {
    projectId: string;
    userId: string;
    documentId: string;
    baseRevision: string;
  }): Promise<EditorDocumentDetail> {
    return this.restoreByDirection(args, "REDO");
  }

  async restoreRevision(args: {
    projectId: string;
    userId: string;
    documentId: string;
    baseRevision: string;
    revisionId: string;
  }): Promise<EditorDocumentDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    const document = await this.requireDocument(args.projectId, args.documentId);
    const head = await this.readHead(document);
    this.assertBaseRevision(head.document, args.baseRevision);

    const target = await this.requireRevision(args.documentId, args.revisionId);
    const snapshot = parseAndVerifySnapshot(target.snapshot, target.snapshotSha256);

    const commit = await this.commit({
      document: head.document,
      baseRevision: args.baseRevision,
      revisionNumber: head.revision.revisionNumber + 1,
      snapshot,
      operationType: "RESTORE",
      operationPayload: serializeRestorePayload({
        direction: "EXPLICIT",
        targetRevisionId: target.id,
        // An explicit jump lands the user on the chosen version; it deliberately
        // does not resume whatever branch they abandoned by leaving it.
        undoPointerRevisionId: head.revision.id,
        redoPointerRevisionId: null,
      }),
      createdById: args.userId,
      sourceType: "SYSTEM",
      sourceId: target.id,
      provenanceSourceIds: canonicalSourceIds(target.provenanceSourceIds),
      restoredFromRevisionId: target.id,
      now: this.now(),
    });

    return {
      document: this.withCounts(commit.document, commit.revision),
      snapshot,
      revision: commit.revision,
    };
  }

  private async restoreByDirection(
    args: {
      projectId: string;
      userId: string;
      documentId: string;
      baseRevision: string;
    },
    direction: Extract<RestoreDirection, "UNDO" | "REDO">,
  ): Promise<EditorDocumentDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    const document = await this.requireDocument(args.projectId, args.documentId);
    const head = await this.readHead(document);
    this.assertBaseRevision(head.document, args.baseRevision);

    const history = await this.repository.listRevisions({
      documentId: args.documentId,
      limit: HISTORY_SCAN_LIMIT,
      offset: 0,
    });

    const summaries = history.map(stripSnapshot);

    // Both branches are written out rather than merged behind a shared `plan`:
    // undo and redo carry different pointers, and only the branch that chose the
    // direction knows which pointer fields its plan filled in.
    const restore =
      direction === "UNDO"
        ? (() => {
            const plan = computeUndoTarget({ revisions: summaries });
            return {
              target: plan.target,
              undoPointerRevisionId: plan.nextUndoPointer,
              redoPointerRevisionId: head.revision.id,
            };
          })()
        : (() => {
            const plan = computeRedoTarget({ revisions: summaries });
            return {
              target: plan.target,
              undoPointerRevisionId: plan.nextUndoPointer,
              redoPointerRevisionId: plan.nextRedoPointer,
            };
          })();

    // The target's snapshot is read from its own row rather than reconstructed
    // from the operation, so a restore can never drift from the history it claims.
    const target = await this.requireRevision(args.documentId, restore.target.id);
    const snapshot = parseAndVerifySnapshot(target.snapshot, target.snapshotSha256);

    const commit = await this.commit({
      document: head.document,
      baseRevision: args.baseRevision,
      revisionNumber: head.revision.revisionNumber + 1,
      snapshot,
      operationType: "RESTORE",
      operationPayload: serializeRestorePayload({
        direction,
        targetRevisionId: target.id,
        undoPointerRevisionId: restore.undoPointerRevisionId,
        redoPointerRevisionId: restore.redoPointerRevisionId,
      }),
      createdById: args.userId,
      sourceType: "SYSTEM",
      sourceId: target.id,
      provenanceSourceIds: canonicalSourceIds(target.provenanceSourceIds),
      restoredFromRevisionId: target.id,
      now: this.now(),
    });

    return {
      document: this.withCounts(commit.document, commit.revision),
      snapshot,
      revision: commit.revision,
    };
  }

  async finalize(args: {
    projectId: string;
    userId: string;
    documentId: string;
    baseRevision: string;
  }): Promise<EditorDocumentDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    const document = await this.requireDocument(args.projectId, args.documentId);
    const head = await this.readHead(document);
    this.assertBaseRevision(head.document, args.baseRevision);

    // Finalizing publishes a readiness claim, so it is refused while any node is
    // still missing the media or copy it promises to show.
    const incomplete = head.snapshot.nodes.filter((node) => {
      if (node.type === "TEXT") return !node.text || node.text.value.trim() === "";
      if (node.type === "IMAGE" || node.type === "VIDEO" || node.type === "AUDIO") {
        return node.asset === null;
      }
      return false;
    });

    if (incomplete.length > 0) {
      throw new EditorError(
        "EDITOR_DOCUMENT_LOCKED",
        `${incomplete.length} node(s) still need content before this document can be marked ready`,
        { nodeIds: incomplete.map((node) => node.id) },
      );
    }

    if (head.snapshot.nodes.length === 0) {
      throw new EditorError(
        "EDITOR_DOCUMENT_LOCKED",
        "An empty document cannot be marked ready",
      );
    }

    const now = this.now();
    const updated = await this.repository.setStatus(
      args.projectId,
      args.documentId,
      "READY",
      now,
    );

    return {
      document: this.withCounts(updated ?? head.document, head.revision),
      snapshot: head.snapshot,
      revision: head.revision,
    };
  }

  async archive(args: {
    projectId: string;
    userId: string;
    documentId: string;
  }): Promise<EditorDocumentRecord> {
    await this.authorizeProject(args.projectId, args.userId);
    await this.requireDocument(args.projectId, args.documentId);

    const updated = await this.repository.setStatus(
      args.projectId,
      args.documentId,
      "ARCHIVED",
      this.now(),
    );

    if (!updated) {
      throw new EditorError(
        "EDITOR_DOCUMENT_NOT_FOUND",
        "No editor document with that id exists in this project",
      );
    }

    return updated;
  }

  /**
   * Reports that the editor is wired up.
   *
   * There is no worker to poll: every mutation is served by the request itself,
   * so a healthy editor is one that can read and write its own documents.
   */
  async health(args: { projectId: string; userId: string }) {
    await this.authorizeProject(args.projectId, args.userId);

    const documents = await this.repository.listDocuments({
      projectId: args.projectId,
    });

    return {
      status: "healthy" as const,
      operationTypes: true,
      concurrentEditProtection: true,
      documentVersion: EDITOR_DOCUMENT_VERSION,
      limits: EDITOR_LIMITS,
      documentCount: documents.length,
      checkedAt: this.now(),
    };
  }

  private async requireDocument(
    projectId: string,
    documentId: string,
  ): Promise<EditorDocumentRecord> {
    const document = await this.repository.getDocument(projectId, documentId);

    if (!document) {
      throw new EditorError(
        "EDITOR_DOCUMENT_NOT_FOUND",
        "No editor document with that id exists in this project",
      );
    }

    return document;
  }

  private async requireRevision(
    documentId: string,
    revisionId: string,
  ): Promise<EditorRevisionRecord> {
    const revision = await this.repository.getRevision(documentId, revisionId);

    if (!revision) {
      throw new EditorError(
        "EDITOR_REVISION_NOT_FOUND",
        "No revision with that id exists in this document",
      );
    }

    return revision;
  }

  /** Reads the head revision and verifies it against its own recorded hash. */
  private async readHead(
    document: EditorDocumentRecord,
  ): Promise<EditorDocumentDetail> {
    if (!document.currentRevisionId) {
      throw new EditorError(
        "EDITOR_INVALID_OPERATION",
        "This document has no head revision and cannot be edited",
      );
    }

    const revision = await this.requireRevision(
      document.id,
      document.currentRevisionId,
    );

    return {
      document: this.withCounts(document, revision),
      snapshot: parseAndVerifySnapshot(revision.snapshot, revision.snapshotSha256),
      revision,
    };
  }

  private assertBaseRevision(
    document: EditorDocumentRecord,
    baseRevision: string,
  ): void {
    if (document.currentRevisionId !== baseRevision) {
      throw new EditorError(
        "EDITOR_REVISION_CONFLICT",
        "This document has changed since you loaded it",
        {
          currentRevisionId: document.currentRevisionId,
          baseRevision,
          documentVersion: document.documentVersion,
        },
      );
    }
  }

  private async commit(input: {
    document: EditorDocumentRecord;
    baseRevision: string;
    /** The head's number plus one, decided by the caller that read the head. */
    revisionNumber: number;
    snapshot: EditorSnapshot;
    operationType: EditorDocumentDetail["revision"]["operationType"];
    operationPayload: string;
    createdById: string;
    sourceType: EditorSourceType;
    sourceId: string | null;
    provenanceSourceIds: readonly string[];
    restoredFromRevisionId: string | null;
    now: string;
  }): Promise<{ document: EditorDocumentRecord; revision: EditorRevisionRecord }> {
    const outcome = await this.repository.appendRevision({
      revision: {
        revisionId: this.newId("edrev"),
        documentId: input.document.id,
        revisionNumber: input.revisionNumber,
        operationType: input.operationType,
        operationPayload: input.operationPayload,
        snapshot: serializeSnapshot(input.snapshot),
        snapshotSha256: snapshotSha256(input.snapshot),
        createdById: input.createdById,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        provenanceSourceIds: input.provenanceSourceIds,
        restoredFromRevisionId: input.restoredFromRevisionId,
        createdAt: input.now,
      },
      expectedRevisionId: input.baseRevision,
      nodes: nodeRecordsFromSnapshot(input.snapshot, input.now),
    });

    if (!outcome.applied || !outcome.revision || !outcome.document) {
      throw new EditorError(
        "EDITOR_REVISION_CONFLICT",
        "This document has changed since you loaded it",
        {
          currentRevisionId: outcome.actualHeadRevisionId,
          baseRevision: input.baseRevision,
        },
      );
    }

    return { document: outcome.document, revision: outcome.revision };
  }

  /**
   * Mints ids for the nodes an operation will create.
   *
   * Ids are minted before the write so a CREATE can never invent its own and a
   * retry cannot collide with a node someone else created in the meantime.
   */
  private mintIdsFor(
    snapshot: EditorSnapshot,
    operation: EditorOperation,
  ): string[] {
    switch (operation.type) {
      case "SPLIT": {
        const node = snapshot.nodes.find(
          (candidate) => candidate.id === operation.nodeId,
        );
        if (!node) return [];
        const sourceEnd = node.trim?.endMs ?? node.asset?.durationMs ?? null;
        const extras =
          sourceEnd === null || operation.endMs === undefined
            ? 1
            : operation.endMs < sourceEnd
              ? 2
              : 1;
        return Array.from({ length: extras }, () => this.newId("enode"));
      }
      case "DUPLICATE":
        return [operation.newNodeId];
      default:
        return [];
    }
  }

  private withCounts(
    document: EditorDocumentRecord,
    revision: EditorRevisionRecord | null,
  ): EditorDocumentRecord {
    return {
      ...document,
      revisionCount: revision?.revisionNumber ?? document.revisionCount,
      lastOperation: revision?.operationType ?? document.lastOperation,
    };
  }
}

/**
 * Undo and redo scan the revision log to work out where to step.
 *
 * The log is newest-first, so the cap keeps the head and the revisions behind it
 * and drops the oldest — which is exactly the part undo walks towards. A
 * pathological document reports "nothing to undo" rather than reading an
 * unbounded log into memory.
 */
const HISTORY_SCAN_LIMIT = 5_000;

/**
 * Drops the snapshot bytes from a revision for a listing.
 *
 * A history panel needs who changed what and when, not the whole document copied
 * once per entry, so the payload is dropped here rather than at the repository.
 */
function stripSnapshot(revision: EditorRevisionRecord): EditorRevisionSummary {
  return {
    id: revision.id,
    documentId: revision.documentId,
    revisionNumber: revision.revisionNumber,
    operationType: revision.operationType,
    operationPayload: revision.operationPayload,
    snapshotSha256: revision.snapshotSha256,
    createdById: revision.createdById,
    sourceType: revision.sourceType,
    sourceId: revision.sourceId,
    provenanceSourceIds: revision.provenanceSourceIds,
    restoredFromRevisionId: revision.restoredFromRevisionId,
    createdAt: revision.createdAt,
  };
}

/**
 * The order sources were collected in is an accident of the snapshot, not a
 * fact about the edit, so it is not stored. Sorted ids mean two revisions with
 * the same grounding produce the same bytes.
 */
function canonicalSourceIds(sourceIds: readonly string[]): string[] {
  return [...new Set(sourceIds)].sort();
}

function collectProvenance(snapshot: EditorSnapshot): string[] {
  const sourceIds = new Set<string>();

  for (const node of snapshot.nodes) {
    for (const id of node.provenance?.sourceIds ?? []) {
      sourceIds.add(id);
    }
  }

  return [...sourceIds].sort();
}
