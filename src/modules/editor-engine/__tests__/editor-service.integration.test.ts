import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupEditorProject,
  createEditorProject,
  imageNode,
  loadEditorTestContext,
  textNode,
  type Orm,
  type Services,
} from "./helpers";
import { parseAndVerifySnapshot } from "../serialization/editor-snapshot";
import { EditorError } from "../errors";

let orm: Orm;
let services: Services;
let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;

beforeAll(async () => {
  const loaded = await loadEditorTestContext();
  orm = loaded.orm;
  services = loaded.services;

  const created = await createEditorProject(services);
  owner = created.owner;
  projectId = created.projectId;
});

afterAll(async () => {
  await cleanupEditorProject(orm, owner, projectId);
});

function editor() {
  return services.editorService;
}

async function createStarter() {
  return editor().createDocument({
    projectId,
    userId: owner.user.id,
    name: "Launch cut",
    nodes: [imageNode(), textNode({ zIndex: 2 })],
  });
}

describe("editor document lifecycle", () => {
  it("opens a document on revision one with its nodes indexed", async () => {
    const detail = await createStarter();

    expect(detail.document.currentRevisionId).toBe(detail.revision.id);
    expect(detail.revision.revisionNumber).toBe(1);
    expect(detail.revision.operationType).toBe("CREATE");
    expect(detail.snapshot.nodes).toHaveLength(2);

    const nodes = await services.editorRepository.listNodes(detail.document.id);
    expect(nodes.map((node) => node.id).sort()).toEqual(
      detail.snapshot.nodes.map((node) => node.id).sort(),
    );
  });

  it("reads back a stored snapshot that matches its recorded hash", async () => {
    const detail = await createStarter();
    const row = await services.editorRepository.getRevision(
      detail.document.id,
      detail.revision.id,
    );

    const snapshot = parseAndVerifySnapshot(row!.snapshot, row!.snapshotSha256);
    expect(snapshot.nodes.map((node) => node.id).sort()).toEqual(
      detail.snapshot.nodes.map((node) => node.id).sort(),
    );
  });

  it("mirrors zIndex into the node index so ordered reads agree with the snapshot", async () => {
    const detail = await createStarter();
    const nodes = await services.editorRepository.listNodes(detail.document.id);

    for (const node of nodes) {
      const canonical = detail.snapshot.nodes.find(
        (candidate) => candidate.id === node.id,
      );
      expect(node.sortIndex).toBe(canonical!.zIndex);
    }
  });

  it("summarises documents for a listing without handing back a snapshot", async () => {
    const starter = await createStarter();

    const listed = await editor().listDocuments({
      projectId,
      userId: owner.user.id,
    });

    const entry = listed.find((item) => item.id === starter.document.id);

    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ nodeCount: 2, mediaCount: 1, textCount: 1 });
    expect(entry).not.toHaveProperty("snapshot");
  });

  it("reports a document that belongs to another project as missing", async () => {
    const detail = await createStarter();
    const other = await createEditorProject(services, "cp20-other");

    try {
      await expect(
        editor().getDocument({
          projectId: other.projectId,
          userId: other.owner.user.id,
          documentId: detail.document.id,
        }),
      ).rejects.toThrow(/no editor document/i);
    } finally {
      await cleanupEditorProject(orm, other.owner, other.projectId);
    }
  });

  it("refuses a write from a user who is not in the project", async () => {
    const detail = await createStarter();
    const other = await createEditorProject(services, "cp20-outsider");

    try {
      await expect(
        editor().applyOperation({
          projectId: other.projectId,
          userId: other.owner.user.id,
          documentId: detail.document.id,
          baseRevision: detail.revision.id,
          operation: { type: "SET_TEXT", nodeId: "x", value: "no" },
        }),
      ).rejects.toThrow();
    } finally {
      await cleanupEditorProject(orm, other.owner, other.projectId);
    }
  });
});

describe("applying operations", () => {
  it("moves the head forward and records what changed", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    const applied = await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "Approved" },
    });

    expect(applied.revision.revisionNumber).toBe(2);
    expect(applied.revision.operationType).toBe("SET_TEXT");
    expect(applied.document.currentRevisionId).toBe(applied.revision.id);
    expect(applied.snapshot.nodes.find((node) => node.id === headline.id)?.text).toEqual({
      value: "Approved",
    });
  });

  it("refuses a write built on a revision that is no longer the head", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "First" },
    });

    await expect(
      editor().applyOperation({
        projectId,
        userId: owner.user.id,
        documentId: starter.document.id,
        baseRevision: starter.revision.id,
        operation: { type: "SET_TEXT", nodeId: headline.id, value: "Second" },
      }),
    ).rejects.toThrow(/changed since you loaded it/i);
  });

  it("lets exactly one of two concurrent edits from the same base win", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    const attempt = (value: string) =>
      editor().applyOperation({
        projectId,
        userId: owner.user.id,
        documentId: starter.document.id,
        baseRevision: starter.revision.id,
        operation: { type: "SET_TEXT", nodeId: headline.id, value },
      });

    const settled = await Promise.allSettled([attempt("Writer A"), attempt("Writer B")]);

    const winners = settled.filter((result) => result.status === "fulfilled");
    const losers = settled.filter((result) => result.status === "rejected");

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(String((losers[0] as PromiseRejectedResult).reason)).toMatch(
      /changed since you loaded it/i,
    );

    // The loser must not have written anything: the head is the winner's, and the
    // document holds no revision from the losing attempt. Two writers raced for
    // revision number two, so this also proves the loser's row was rolled back
    // rather than left behind as history that never happened.
    const detail = await editor().getDocument({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    expect(detail.revision.revisionNumber).toBe(2);

    const history = await editor().history({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    expect(history.total).toBe(2);
    expect(history.revisions.map((revision) => revision.revisionNumber)).toEqual([2, 1]);
    expect(detail.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value).toBe(
      winners[0].status === "fulfilled"
        ? winners[0].value.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value
        : null,
    );
  });

  it("keeps one winner and one clean log when many writers race the same head", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        editor().applyOperation({
          projectId,
          userId: owner.user.id,
          documentId: starter.document.id,
          baseRevision: starter.revision.id,
          operation: { type: "SET_TEXT", nodeId: headline.id, value: `writer-${index}` },
        }),
      ),
    );

    const winners = settled.filter((result) => result.status === "fulfilled");
    const losers = settled.filter((result) => result.status === "rejected");

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(7);
    // Every loser is told it is out of date, not handed a database error.
    for (const loser of losers) {
      expect(String((loser as PromiseRejectedResult).reason)).toMatch(
        /changed since you loaded it/i,
      );
    }

    const history = await editor().history({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    // Two revisions, numbered without a gap, and every number claimed once.
    expect(history.revisions.map((revision) => revision.revisionNumber)).toEqual([2, 1]);
    expect(history.total).toBe(2);

    const detail = await editor().getDocument({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    const winner = winners[0] as PromiseFulfilledResult<
      Awaited<ReturnType<ReturnType<typeof editor>["getDocument"]>>
    >;

    expect(detail.revision.id).toBe(winner.value.revision.id);
    expect(detail.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value).toBe(
      winner.value.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value,
    );
  });

  it("records who made a change and which project sources it rests on", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    const applied = await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "Grounded" },
      sourceType: "AI",
      sourceId: "proposal-1",
      provenanceSourceIds: ["src-2", "src-1"],
    });

    expect(applied.revision.sourceType).toBe("AI");
    expect(applied.revision.sourceId).toBe("proposal-1");
    // Sorted, so the same set of sources always produces the same bytes.
    expect([...applied.revision.provenanceSourceIds]).toEqual(["src-1", "src-2"]);
  });

  it("rejects a RESTORE sent as a client operation", async () => {
    const starter = await createStarter();

    await expect(
      editor().applyOperation({
        projectId,
        userId: owner.user.id,
        documentId: starter.document.id,
        baseRevision: starter.revision.id,
        operation: { type: "RESTORE", targetRevisionId: starter.revision.id },
      }),
    ).rejects.toThrow(/restore/i);
  });
});

describe("history", () => {
  it("grows the log and never rewrites an earlier revision", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;
    const first = starter.revision.id;

    await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: first,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "One" },
    });

    const second = await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: (
        await editor().getDocument({
          projectId,
          userId: owner.user.id,
          documentId: starter.document.id,
        })
      ).revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "Two" },
    });

    const history = await editor().history({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    expect(history.total).toBe(3);
    expect(history.revisions.map((revision) => revision.revisionNumber)).toEqual([
      3, 2, 1,
    ]);
    // Newest first, and no snapshot bytes in a listing.
    expect(history.revisions[0]?.id).toBe(second.revision.id);
    expect(history.revisions.every((revision) => !("snapshot" in revision))).toBe(true);

    // The first revision still holds exactly what it held when it was written.
    const original = await editor().previewRevision({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      revisionId: first,
    });

    expect(
      original.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value,
    ).toBe("Draft headline");
  });

  it("previews an old revision without changing the document", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "Temporary" },
    });

    const before = await editor().getDocument({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    await editor().previewRevision({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      revisionId: starter.revision.id,
    });

    const after = await editor().getDocument({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    expect(after.revision.id).toBe(before.revision.id);
  });
});

describe("undo, redo and restore", () => {
  it("undoes and redoes a text edit by returning to the same bytes", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    const edited = await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "Changed" },
    });

    const undone = await editor().undo({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: edited.revision.id,
    });

    expect(undone.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value).toBe(
      "Draft headline",
    );
    expect(undone.revision.operationType).toBe("RESTORE");
    expect(undone.revision.restoredFromRevisionId).toBe(starter.revision.id);
    // Undo adds a revision rather than rewinding the log.
    expect(undone.revision.revisionNumber).toBe(3);

    const redone = await editor().redo({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: undone.revision.id,
    });

    expect(redone.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value).toBe(
      "Changed",
    );
    expect(redone.revision.revisionNumber).toBe(4);
  });

  it("keeps walking the branch on repeated undos", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;
    const headlineId = headline.id;

    let head = starter.revision.id;

    for (const value of ["One", "Two", "Three"]) {
      const applied = await editor().applyOperation({
        projectId,
        userId: owner.user.id,
        documentId: starter.document.id,
        baseRevision: head,
        operation: { type: "SET_TEXT", nodeId: headlineId, value },
      });
      head = applied.revision.id;
    }

    const values: string[] = [];

    for (let step = 0; step < 3; step += 1) {
      const undone = await editor().undo({
        projectId,
        userId: owner.user.id,
        documentId: starter.document.id,
        baseRevision: head,
      });
      values.push(
        undone.snapshot.nodes.find((node) => node.id === headlineId)?.text?.value ??
          "",
      );
      head = undone.revision.id;
    }

    expect(values).toEqual(["Two", "One", "Draft headline"]);
  });

  it("refuses to undo when there is nothing left to undo", async () => {
    const starter = await createStarter();

    await expect(
      editor().undo({
        projectId,
        userId: owner.user.id,
        documentId: starter.document.id,
        baseRevision: starter.revision.id,
      }),
    ).rejects.toThrow(/earliest|undo/i);
  });

  it("refuses to redo a branch the user abandoned by editing instead", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    const edited = await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "Changed" },
    });

    const undone = await editor().undo({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: edited.revision.id,
    });

    // A new edit after an undo abandons the redo chain rather than reviving it.
    const branched = await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: undone.revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "Something else" },
    });

    expect(branched.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value).toBe(
      "Something else",
    );

    await expect(
      editor().redo({
        projectId,
        userId: owner.user.id,
        documentId: starter.document.id,
        baseRevision: branched.revision.id,
      }),
    ).rejects.toThrow(/undone|redo/i);
  });

  it("restores an arbitrary revision by appending one more", async () => {
    const starter = await createStarter();
    const headline = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    const edited = await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
      operation: { type: "SET_TEXT", nodeId: headline.id, value: "Changed" },
    });

    const restored = await editor().restoreRevision({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: edited.revision.id,
      revisionId: starter.revision.id,
    });

    expect(restored.snapshot.nodes.find((node) => node.id === headline.id)?.text?.value).toBe(
      "Draft headline",
    );
    expect(restored.revision.restoredFromRevisionId).toBe(starter.revision.id);
    expect(restored.revision.revisionNumber).toBe(3);

    const history = await editor().history({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    // Three revisions, and the edited one is still readable.
    expect(history.total).toBe(3);
    expect(history.revisions.map((revision) => revision.revisionNumber)).toEqual([3, 2, 1]);
  });

  it("refuses a restore of a revision from a different document", async () => {
    const first = await createStarter();
    const second = await createStarter();

    await expect(
      editor().restoreRevision({
        projectId,
        userId: owner.user.id,
        documentId: second.document.id,
        baseRevision: second.revision.id,
        revisionId: first.revision.id,
      }),
    ).rejects.toThrow(EditorError);
  });
});

describe("readiness", () => {
  it("refuses to mark a document ready while a text node is empty", async () => {
    const starter = await createStarter();
    const empty = starter.snapshot.nodes.find((node) => node.type === "TEXT")!;

    await editor().applyOperation({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
      operation: { type: "SET_TEXT", nodeId: empty.id, value: "   " },
    });

    const current = await editor().getDocument({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    await expect(
      editor().finalize({
        projectId,
        userId: owner.user.id,
        documentId: starter.document.id,
        baseRevision: current.revision.id,
      }),
    ).rejects.toThrow(/still need content/i);
  });

  it("marks a complete document ready", async () => {
    const starter = await createStarter();

    const finalized = await editor().finalize({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
      baseRevision: starter.revision.id,
    });

    expect(finalized.document.status).toBe("READY");
  });

  it("archives a document without touching its history", async () => {
    const starter = await createStarter();

    const archived = await editor().archive({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    expect(archived.status).toBe("ARCHIVED");

    const history = await editor().history({
      projectId,
      userId: owner.user.id,
      documentId: starter.document.id,
    });

    expect(history.total).toBe(1);
  });
});

describe("health", () => {
  it("reports the limits the editor enforces", async () => {
    const health = await editor().health({ projectId, userId: owner.user.id });

    expect(health.status).toBe("healthy");
    expect(health.concurrentEditProtection).toBe(true);
    expect(health.limits.maxNodesPerDocument).toBe(500);
  });
});
