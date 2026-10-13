import { db } from "../../prisma/db";
import type { PublicOrm, Transaction } from "../../prisma/db";
import { pgTimestampToIso } from "../../lib/time";
import type {
  AppendRevisionInput,
  AppendRevisionResult,
  CreateEditorDocumentInput,
  CreateEditorRevisionInput,
  EditorRepository,
  EditorRevisionListFilter,
  ListEditorDocumentsFilter,
} from "../../core/ports/editor-repository";
import type {
  EditorDocumentRecord,
  EditorDocumentStatus,
  EditorNodeRecord,
  EditorNodeType,
  EditorOperationType,
  EditorRevisionRecord,
} from "../../modules/editor-engine/domain/types";

type DocumentRow = {
  id: string;
  projectId: string;
  name: string;
  status: string;
  documentVersion: number;
  currentRevisionId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

type NodeRow = {
  id: string;
  documentId: string;
  parentId: string | null;
  type: string;
  name: string;
  zIndex: number;
  sortIndex: number;
  createdAt: string;
  updatedAt: string;
};

type RevisionRow = {
  id: string;
  documentId: string;
  revisionNumber: number;
  operationType: string;
  operationPayload: string;
  snapshot: string;
  snapshotSha256: string;
  createdById: string;
  sourceType: string;
  sourceId: string | null;
  provenanceSourceIds: string[];
  restoredFromRevisionId: string | null;
  createdAt: string;
};

function decodeDocument(row: DocumentRow): EditorDocumentRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status as EditorDocumentStatus,
    documentVersion: row.documentVersion,
    currentRevisionId: row.currentRevisionId,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
    // A document row alone cannot answer these; the service fills them in from a
    // count and the head revision so the two cannot drift from the log.
    revisionCount: 0,
    lastOperation: null,
  };
}

function decodeNode(row: NodeRow): EditorNodeRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    parentId: row.parentId,
    type: row.type as EditorNodeType,
    name: row.name,
    zIndex: row.zIndex,
    sortIndex: row.sortIndex,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeRevision(row: RevisionRow): EditorRevisionRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    revisionNumber: row.revisionNumber,
    operationType: row.operationType as EditorOperationType,
    operationPayload: row.operationPayload,
    snapshot: row.snapshot,
    snapshotSha256: row.snapshotSha256,
    createdById: row.createdById,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    provenanceSourceIds: row.provenanceSourceIds ?? [],
    restoredFromRevisionId: row.restoredFromRevisionId,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function revisionValues(input: CreateEditorRevisionInput) {
  return {
    id: input.revisionId,
    documentId: input.documentId,
    revisionNumber: input.revisionNumber,
    operationType: input.operationType,
    operationPayload: input.operationPayload,
    snapshot: input.snapshot,
    snapshotSha256: input.snapshotSha256,
    createdById: input.createdById,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    provenanceSourceIds: [...input.provenanceSourceIds],
    restoredFromRevisionId: input.restoredFromRevisionId,
    createdAt: input.createdAt,
  };
}

function revisionFromInput(
  input: CreateEditorRevisionInput,
): EditorRevisionRecord {
  return {
    id: input.revisionId,
    documentId: input.documentId,
    revisionNumber: input.revisionNumber,
    operationType: input.operationType,
    operationPayload: input.operationPayload,
    snapshot: input.snapshot,
    snapshotSha256: input.snapshotSha256,
    createdById: input.createdById,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    provenanceSourceIds: [...input.provenanceSourceIds],
    restoredFromRevisionId: input.restoredFromRevisionId,
    createdAt: input.createdAt,
  };
}

function nodeValues(node: EditorNodeRecord) {
  return {
    id: node.id,
    documentId: node.documentId,
    parentId: node.parentId,
    type: node.type,
    name: node.name,
    zIndex: node.zIndex,
    // `sortIndex` mirrors `zIndex` rather than tracking a second ordering: the
    // reducer renumbers siblings densely, so the two can never disagree and the
    // index on (documentId, parentId, sortIndex) reads children in paint order.
    sortIndex: node.zIndex,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

/**
 * Postgres persistence for editor documents.
 *
 * The method that matters is `appendRevision`. It writes the new revision and
 * then moves the document's head with a conditional update naming the head the
 * caller expected, so two clients editing from the same revision cannot both
 * win: the loser's update matches no row and its whole transaction rolls back,
 * taking the revision it had already inserted with it.
 */
/**
 * Rewrites the node index so it matches the snapshot just written.
 *
 * The index is a projection of the snapshot, never a second truth: the snapshot
 * lives in the revision's payload, so a reader that follows the head gets both or
 * neither.
 *
 * It is upserted rather than deleted and re-inserted. Prisma 8 defers a
 * transaction's `delete` until the transaction closes, so a delete immediately
 * followed by an insert of the same primary key inside one transaction collides
 * on the key it was just told to remove. Upserting keeps a surviving node's row —
 * and its `createdAt` — intact, and the only rows ever deleted are ones the new
 * snapshot no longer mentions.
 */
async function projectNodes(
  tx: Transaction,
  documentId: string,
  nodes: readonly EditorNodeRecord[],
): Promise<void> {
  const incoming = new Map(nodes.map((node) => [node.id, node]));

  const existing = (await tx.orm.public.EditorNode.where({ documentId }).all()) as unknown as NodeRow[];

  for (const node of nodes) {
    const row = nodeValues(node);

    await tx.orm.public.EditorNode.upsert({
      create: row,
      // `createdAt` is absent from the update on purpose: it records when the
      // node first entered the document, and a projection refresh must not make
      // every node look as new as the revision that touched it.
      update: {
        parentId: row.parentId,
        type: row.type,
        name: row.name,
        zIndex: row.zIndex,
        sortIndex: row.sortIndex,
        updatedAt: row.updatedAt,
      },
    });
  }

  for (const row of existing) {
    if (!incoming.has(row.id)) {
      await tx.orm.public.EditorNode.where({ id: row.id }).delete();
    }
  }
}

/**
 * True when the failure is the unique index on `(documentId, revisionNumber)`.
 *
 * Matched on the SQLSTATE for a unique violation plus the constraint's table so a
 * unique violation anywhere else in the write — a reused node id, a reused
 * revision id — is still reported as the bug it is.
 */
function isRevisionOrdinalRace(error: unknown): boolean {
  // The driver reports the database's own error fields on `cause`, with its own
  // wrapper fields on the outer error, so the pair is read from both levels.
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
      candidate.constraint.startsWith("editor_revision")
    );
  });
}

export class PostgresEditorRepository implements EditorRepository {
  constructor(private readonly orm: PublicOrm = db.orm.public) {}

  async createDocument(
    input: CreateEditorDocumentInput,
    revision: CreateEditorRevisionInput,
  ): Promise<EditorDocumentRecord> {
    let created = false;

    await db.transaction(async (tx) => {
      // The document names its head revision and the revision names its
      // document, so neither row can be inserted first on its own. The document
      // is created with a null head, the revision is written, and the head is
      // then set. All three statements share one transaction, so a reader sees
      // either no document at all or a document whose head already exists — the
      // intermediate state is never observable, which is why it is safe to build
      // it here.
      await tx.orm.public.EditorDocument.create({
        id: input.documentId,
        projectId: input.projectId,
        name: input.name,
        status: input.status,
        documentVersion: input.documentVersion,
        currentRevisionId: null,
        createdById: input.createdById,
        createdAt: input.now,
        updatedAt: input.now,
      });

      await tx.orm.public.EditorRevision.create(revisionValues(revision));

      await tx.orm.public.EditorDocument.where({ id: input.documentId }).update({
        currentRevisionId: revision.revisionId,
      });

      await projectNodes(tx, input.documentId, input.nodes);

      created = true;
    });

    if (!created) {
      throw new Error("Editor document was not created");
    }

    const document = await this.getDocument(input.projectId, input.documentId);

    if (!document) {
      throw new Error("Editor document vanished during creation");
    }

    return {
      ...document,
      revisionCount: 1,
      lastOperation: revision.operationType,
    };
  }

  /** Reads a document by id alone, for reporting a race whose project is known. */
  private async readDocumentById(
    documentId: string,
  ): Promise<EditorDocumentRecord | null> {
    const row = (await this.orm.EditorDocument.where({ id: documentId })
      .first()) as unknown as DocumentRow | null;

    return row ? decodeDocument(row) : null;
  }

  async getDocument(
    projectId: string,
    documentId: string,
  ): Promise<EditorDocumentRecord | null> {
    const row = (await this.orm.EditorDocument.where({ projectId, id: documentId })
      .first()) as unknown as DocumentRow | null;

    return row ? decodeDocument(row) : null;
  }

  async listDocuments(
    filter: ListEditorDocumentsFilter,
  ): Promise<EditorDocumentRecord[]> {
    const scoped = this.orm.EditorDocument.where({ projectId: filter.projectId });
    const collection = filter.status
      ? scoped.where({ status: filter.status })
      : scoped;

    const rows = (await collection
      .orderBy((row) => row.createdAt.desc())
      .all()) as unknown as DocumentRow[];

    return rows.map(decodeDocument);
  }

  async setStatus(
    projectId: string,
    documentId: string,
    status: EditorDocumentStatus,
    updatedAt: string,
  ): Promise<EditorDocumentRecord | null> {
    const row = (await this.orm.EditorDocument.where({ projectId, id: documentId })
      .update({ status, updatedAt })) as unknown as DocumentRow | null;

    return row ? decodeDocument(row) : null;
  }

  async listNodes(documentId: string): Promise<EditorNodeRecord[]> {
    const rows = (await this.orm.EditorNode.where({ documentId })
      .orderBy([(row) => row.sortIndex.asc(), (row) => row.id.asc()])
      .all()) as unknown as NodeRow[];

    return rows.map(decodeNode);
  }

  async appendRevision(input: AppendRevisionInput): Promise<AppendRevisionResult> {
    const { revision } = input;
    let outcome: AppendRevisionResult = {
      applied: false,
      revision: null,
      document: null,
      actualHeadRevisionId: null,
    };

    try {
      await this.runAppendTransaction(input, (result) => {
        outcome = result;
      });
    } catch (error) {
      // Two writers can both read the same head and both try to claim the next
      // revision number; the unique index on `(documentId, revisionNumber)`
      // catches the second one. That is a lost race, not a broken database, so it
      // is reported as the conflict it is — and the loser's transaction has
      // already rolled back, which is why the head is re-read here rather than
      // inside it.
      if (!isRevisionOrdinalRace(error)) {
        throw error;
      }

      const document = await this.readDocumentById(revision.documentId);

      outcome = {
        applied: false,
        revision: null,
        document,
        actualHeadRevisionId: document?.currentRevisionId ?? null,
      };
    }

    return outcome;
  }

  private async runAppendTransaction(
    input: AppendRevisionInput,
    report: (result: AppendRevisionResult) => void,
  ): Promise<void> {
    const { revision, expectedRevisionId } = input;

    await db.transaction(async (tx) => {
      // The head is read inside the transaction so the conflict decision is
      // made against the state this transaction is serialising against.
      const current = (await tx.orm.public.EditorDocument.where({
        id: revision.documentId,
      }).first()) as unknown as DocumentRow | null;

      if (!current) {
        report({
          applied: false,
          revision: null,
          document: null,
          actualHeadRevisionId: null,
        });
        return;
      }

      const actual = current.currentRevisionId ?? null;

      if (actual !== expectedRevisionId) {
        // Report the real head rather than throwing: the caller needs it to tell
        // the user which revision they are now out of date with.
        report({
          applied: false,
          revision: null,
          document: decodeDocument(current),
          actualHeadRevisionId: actual,
        });
        return;
      }

      if (expectedRevisionId === null) {
        // Every document is created pointing at its first revision, so a caller
        // that believes the head is empty is not looking at an editable
        // document. Refusing is the honest answer; a null-comparing predicate
        // would be `= NULL`, which is never true, and would fail confusingly.
        report({
          applied: false,
          revision: null,
          document: decodeDocument(current),
          actualHeadRevisionId: actual,
        });
        return;
      }

      await tx.orm.public.EditorRevision.create(revisionValues(revision));

      const moved = tx.sql.public.editor_document
        .update({
          currentRevisionId: revision.revisionId,
          documentVersion: current.documentVersion + 1,
          updatedAt: revision.createdAt,
        })
        .where((f, fns) => fns.eq(f.id, revision.documentId))
        .where((f, fns) => fns.eq(f.currentRevisionId, expectedRevisionId))
        .returning("id")
        .build();

      const movedRows = await tx.query(moved);

      if (movedRows.length !== 1) {
        report({
          applied: false,
          revision: null,
          document: decodeDocument(current),
          actualHeadRevisionId: actual,
        });
        return;
      }

      // The node rows move in the same transaction as the revision they belong
      // to, so a reader following the head always sees both or neither.
      await projectNodes(tx, revision.documentId, input.nodes);

      const head = (await tx.orm.public.EditorDocument.where({
        id: revision.documentId,
      }).first()) as unknown as DocumentRow;

      report({
        applied: true,
        revision: revisionFromInput(revision),
        document: decodeDocument(head),
        actualHeadRevisionId: revision.revisionId,
      });
    });
  }

  async getRevision(
    documentId: string,
    revisionId: string,
  ): Promise<EditorRevisionRecord | null> {
    const row = (await this.orm.EditorRevision.where({ documentId, id: revisionId })
      .first()) as unknown as RevisionRow | null;

    return row ? decodeRevision(row) : null;
  }

  async getRevisionByNumber(
    documentId: string,
    revisionNumber: number,
  ): Promise<EditorRevisionRecord | null> {
    const row = (await this.orm.EditorRevision.where({
      documentId,
      revisionNumber,
    }).first()) as unknown as RevisionRow | null;

    return row ? decodeRevision(row) : null;
  }

  async listRevisions(
    filter: EditorRevisionListFilter,
  ): Promise<EditorRevisionRecord[]> {
    const rows = (await this.orm.EditorRevision.where({
      documentId: filter.documentId,
    })
      .orderBy((row) => row.revisionNumber.desc())
      .limit(filter.limit)
      .offset(filter.offset)
      .all()) as unknown as RevisionRow[];

    return rows.map(decodeRevision);
  }

  async countRevisions(documentId: string): Promise<number> {
    const totals = await this.orm.EditorRevision.where({ documentId }).aggregate(
      (aggregate) => ({ total: aggregate.count() }),
    );

    return totals.total;
  }
}

export const postgresEditorRepository = new PostgresEditorRepository();
