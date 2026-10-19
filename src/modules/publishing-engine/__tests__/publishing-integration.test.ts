import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PublishingSecretBox } from "../secrets";
import { PublishingError } from "../errors";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";
const PUBLISHING_KEY = Buffer.alloc(32, 3).toString("base64");

process.env["DATABASE_URL"] = TEST_DATABASE_URL;
process.env["PUBLISHING_SECRET_KEY"] = PUBLISHING_KEY;
process.env["PUBLISHING_MASTODON_BASE_URL"] = "http://127.0.0.1:59123";
process.env["PUBLISHING_MASTODON_CLIENT_ID"] = "test-client";
process.env["PUBLISHING_MASTODON_CLIENT_SECRET"] = "test-secret";

type Context = Awaited<ReturnType<typeof loadContext>>;

async function loadContext() {
  const [dbModule, services] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
  ]);
  return { orm: dbModule.db.orm.public, services };
}

type Created = {
  owner: Awaited<ReturnType<Context["services"]["authService"]["register"]>>;
  projectId: string;
};

async function createOwner(
  context: Context,
  name: string,
): Promise<Created> {
  const owner = await context.services.authService.register({
    email: `cp23-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`,
    password: "test-password-1",
  });
  const project = await context.services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name },
    owner.user.id,
  );
  return { owner, projectId: project.id };
}

async function createWritingDocument(
  context: Context,
  created: Created,
  content = "We ship on Friday.",
): Promise<string> {
  const documentId = `wdoc-${Math.random().toString(36).slice(2, 10)}`;
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  await context.orm.WritingDocument.create({
    id: documentId,
    projectId: created.projectId,
    createdById: created.owner.user.id,
    title: "Launch headline",
    blockType: "BODY",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: null,
    language: "en",
    content,
    contentSha256: sha(content),
    contextSnapshot: "{}",
    contextSha256: sha("{}"),
    version: 1,
  });
  return documentId;
}

async function createConnectedConnection(
  context: Context,
  created: Created,
): Promise<string> {
  const box = new PublishingSecretBox(Buffer.from(PUBLISHING_KEY, "base64"));
  const now = new Date().toISOString();
  const connection = await context.services.publishingRepository.createConnection({
    id: `conn-${Math.random().toString(36).slice(2, 10)}`,
    projectId: created.projectId,
    createdById: created.owner.user.id,
    providerId: "mastodon",
    externalAccountId: `acct-${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Integration account",
    scopes: ["read", "write"],
    capabilities: ["TEXT_POST", "IDEMPOTENT_PUBLISH"],
    status: "CONNECTED",
    credentialCiphertext: box.seal("integration-token"),
    credentialExpiresAt: null,
    connectedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return connection.id;
}

let context: Context;
const createdProjects: Created[] = [];

beforeAll(async () => {
  context = await loadContext();
});

afterAll(async () => {
  for (const created of createdProjects.reverse()) {
    await context.orm.Project.where({ id: created.projectId })
      .delete()
      .catch(() => undefined);
    await context.orm.WorkspaceMember.where((row) =>
      row.userId.eq(created.owner.user.id),
    )
      .delete()
      .catch(() => undefined);
    await context.orm.Session.where((row) =>
      row.userId.eq(created.owner.user.id),
    )
      .delete()
      .catch(() => undefined);
    if (created.owner.workspace) {
      await context.orm.Workspace.where({ id: created.owner.workspace.id })
        .delete()
        .catch(() => undefined);
    }
    await context.orm.User.where({ id: created.owner.user.id })
      .delete()
      .catch(() => undefined);
  }
});

describe("publishing engine against the real database", () => {
  it("runs the full draft → validate → queue → claim → ambiguous → reconcile → cancel flow", async () => {
    const created = await createOwner(context, "CP23 full flow");
    createdProjects.push(created);
    const documentId = await createWritingDocument(context, created);
    const connectionId = await createConnectedConnection(context, created);

    const publication = await context.services.publishingService.createPublication(
      created.owner.user.id,
      created.projectId,
      { connectionId, sourceType: "WRITING_DOCUMENT", sourceId: documentId },
    );
    expect(publication.status).toBe("DRAFT");
    expect(publication.sourceRevision).toBe("v1");

    const validated = await context.services.publishingService.validatePublication(
      created.owner.user.id,
      created.projectId,
      publication.id,
    );
    expect(validated.status).toBe("READY");
    expect(validated.sourceHash).toBe(publication.sourceHash);

    const queued = await context.services.publishingService.queuePublication(
      created.owner.user.id,
      created.projectId,
      publication.id,
    );
    expect(queued.status).toBe("QUEUED");

    const nowIso = new Date().toISOString();
    const [first, second] = await Promise.all([
      context.services.publishingRepository.claimNextDue(nowIso),
      context.services.publishingRepository.claimNextDue(nowIso),
    ]);
    const winners = [first, second].filter((row) => row?.id === publication.id);
    expect(winners).toHaveLength(1);

    const claimed =
      first?.id === publication.id ? first : second?.id === publication.id ? second : null;
    expect(claimed?.status).toBe("PUBLISHING");

    const dispatched = await context.services.publishingService.dispatchClaimed(
      claimed!,
    );
    expect(dispatched?.status).toBe("AMBIGUOUS");
    expect(dispatched?.attemptedCount).toBe(1);

    const detail = await context.services.publishingService.getPublicationDetail(
      created.owner.user.id,
      created.projectId,
      publication.id,
    );
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.outcome).toBe("AMBIGUOUS");
    expect(detail.attempts[0]?.errorCode).toBe("PUBLISHING_PROVIDER_AMBIGUOUS");

    const reconciled = await context.services.publishingService.reconcilePublication(
      created.owner.user.id,
      created.projectId,
      publication.id,
    );
    expect(reconciled.status).toBe("QUEUED");

    const cancelled = await context.services.publishingService.cancelPublication(
      created.owner.user.id,
      created.projectId,
      publication.id,
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
  }, 30_000);

  it("isolates projects: another project's publication and connection resolve to nothing", async () => {
    const first = await createOwner(context, "CP23 owner A");
    createdProjects.push(first);
    const second = await createOwner(context, "CP23 owner B");
    createdProjects.push(second);

    const documentId = await createWritingDocument(context, first);
    const connectionId = await createConnectedConnection(context, first);
    const publication = await context.services.publishingService.createPublication(
      first.owner.user.id,
      first.projectId,
      { connectionId, sourceType: "WRITING_DOCUMENT", sourceId: documentId },
    );

    const foreignPublication =
      await context.services.publishingRepository.getPublication(
        second.projectId,
        publication.id,
      );
    expect(foreignPublication).toBeNull();

    const foreignConnection =
      await context.services.publishingRepository.getConnection(
        second.projectId,
        connectionId,
      );
    expect(foreignConnection).toBeNull();

    await expect(
      context.services.publishingService.validatePublication(
        second.owner.user.id,
        second.projectId,
        publication.id,
      ),
    ).rejects.toMatchObject({ code: "PUBLICATION_NOT_FOUND" });
  });

  it("keeps history snapshots append-only and skips duplicates at the same instant", async () => {
    const created = await createOwner(context, "CP23 analytics");
    createdProjects.push(created);
    const documentId = await createWritingDocument(context, created);
    const connectionId = await createConnectedConnection(context, created);
    const publication = await context.services.publishingService.createPublication(
      created.owner.user.id,
      created.projectId,
      { connectionId, sourceType: "WRITING_DOCUMENT", sourceId: documentId },
    );

    const firstAt = "2026-10-17T12:00:00.000Z";
    const base = {
      projectId: created.projectId,
      publicationId: publication.id,
      providerId: "mastodon",
      unit: "count",
      definition: "Integration reading",
      windowStart: "2026-10-17T11:00:00.000Z",
      windowEnd: firstAt,
      asOf: firstAt,
      collectedAt: firstAt,
      provenance: "PROVIDER_API",
      completeness: "COMPLETE",
    };

    const stored = await context.services.publishingRepository.createSnapshots([
      { ...base, id: "snap-1", metricKey: "favourites", value: 3 },
      { ...base, id: "snap-2", metricKey: "reblogs", value: 1 },
    ]);
    expect(stored).toBe(2);

    const duplicates = await context.services.publishingRepository.createSnapshots([
      { ...base, id: "snap-3", metricKey: "favourites", value: 3 },
    ]);
    expect(duplicates).toBe(0);

    const laterAt = "2026-10-17T13:00:00.000Z";
    const storedLater = await context.services.publishingRepository.createSnapshots([
      {
        ...base,
        id: "snap-4",
        metricKey: "favourites",
        value: 7,
        collectedAt: laterAt,
        asOf: laterAt,
        windowEnd: laterAt,
      },
    ]);
    expect(storedLater).toBe(1);

    const history = await context.services.publishingRepository.listSnapshots(
      created.projectId,
      publication.id,
    );
    expect(history.map((snapshot) => snapshot.metricKey)).toEqual([
      "favourites",
      "reblogs",
      "favourites",
    ]);

    const latest = await context.services.publishingRepository.latestSnapshotPoints(
      created.projectId,
      [publication.id],
    );
    const favourites = latest.find((snapshot) => snapshot.metricKey === "favourites");
    expect(favourites?.value).toBe(7);
    expect(latest).toHaveLength(2);

    const foreign = await context.services.publishingRepository.latestSnapshotPoints(
      created.projectId,
      ["publication-does-not-exist"],
    );
    expect(foreign).toEqual([]);

    // The capped read keeps the newest readings and still returns them oldest-first.
    const capped = await context.services.publishingRepository.listSnapshots(
      created.projectId,
      publication.id,
      2,
    );
    expect(capped.map((snapshot) => snapshot.metricKey)).toEqual([
      "reblogs",
      "favourites",
    ]);
  });

  it("refuses unresolvable sources with a structured error", async () => {
    const created = await createOwner(context, "CP23 source guard");
    createdProjects.push(created);
    const connectionId = await createConnectedConnection(context, created);

    await expect(
      context.services.publishingService.createPublication(
        created.owner.user.id,
        created.projectId,
        {
          connectionId,
          sourceType: "WRITING_DOCUMENT",
          sourceId: "wdoc-missing",
        },
      ),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
  });

  it("reports insufficient optimization evidence instead of inventing a recommendation", async () => {
    const created = await createOwner(context, "CP23 optimization guard");
    createdProjects.push(created);

    await expect(
      context.services.optimizationService.generate(
        created.owner.user.id,
        created.projectId,
      ),
    ).rejects.toBeInstanceOf(PublishingError);

    await expect(
      context.services.optimizationService.generate(
        created.owner.user.id,
        created.projectId,
      ),
    ).rejects.toMatchObject({
      code: "OPTIMIZATION_INSUFFICIENT_EVIDENCE",
      extras: { sampleSize: 0, minimumSampleSize: 3 },
    });
  });
});
