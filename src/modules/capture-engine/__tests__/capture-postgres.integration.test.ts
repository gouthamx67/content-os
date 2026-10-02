import crypto from "node:crypto";
import { stat, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";
import type { CaptureTakeRecord } from "../capture-types";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

const FIXTURE = Buffer.from("content-os-cp13-real-capture-fixture", "utf8");
const CAPTURE_ROOT = path.join(process.cwd(), ".content-os", "captures");

type Services = typeof import("../../../infrastructure/services");

let services: Services;
let orm: PublicOrm;

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [{ db }, loadedServices] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
  ]);

  services = loadedServices;
  orm = db.orm.public;

  owner = await services.authService.register({
    email: `cp13-${Date.now()}@test.local`,
    password: "test-password-1",
  });

  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP13 capture" },
    owner.user.id,
  );

  projectId = project.id;
});

afterAll(async () => {
  if (projectId) {
    // Capture rows hang off the project, but delete them explicitly so a failure
    // here names the table that was left behind rather than blaming the cascade.
    await orm.CaptureTake.where((take) => take.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.CaptureSession.where((session) =>
      session.projectId.eq(projectId),
    )
      .delete()
      .catch(() => undefined);

    await rm(path.join(CAPTURE_ROOT, projectId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);

    await orm.Project.where({ id: projectId })
      .delete()
      .catch(() => undefined);
  }

  if (owner) {
    await orm.WorkspaceMember.where((member) =>
      member.userId.eq(owner.user.id),
    )
      .delete()
      .catch(() => undefined);
    await orm.Session.where((session) => session.userId.eq(owner.user.id))
      .delete()
      .catch(() => undefined);
    await orm.Workspace.where({ id: owner.workspace!.id })
      .delete()
      .catch(() => undefined);
    await orm.User.where({ id: owner.user.id })
      .delete()
      .catch(() => undefined);
  }
});

async function newActiveSession() {
  const session = await services.captureService.createSession({
    projectId,
    userId: owner.user.id,
  });

  return services.captureService.startSession({
    projectId,
    sessionId: session.id,
    userId: owner.user.id,
  });
}

async function addFixtureTake(
  sessionId: string,
  overrides: Partial<{
    mode: "CAMERA" | "MICROPHONE" | "SCREEN" | "FILE";
    mimeType: string;
    filename: string;
    bytes: Buffer;
    metadata: unknown;
    shotId: string | null;
  }> = {},
): Promise<CaptureTakeRecord> {
  return services.captureService.addTake({
    projectId,
    sessionId,
    userId: owner.user.id,
    mode: overrides.mode ?? "CAMERA",
    mimeType: overrides.mimeType ?? "video/webm;codecs=vp9",
    filename: overrides.filename ?? "take.webm",
    bytes: overrides.bytes ?? FIXTURE,
    metadata: overrides.metadata ?? { durationMs: 4200, width: 1280, height: 720 },
    shotId: overrides.shotId ?? null,
  });
}

describe("capture Postgres persistence", () => {
  it("writes the take row and the bytes, and the row points at the stored file", async () => {
    const session = await newActiveSession();
    const take = await addFixtureTake(session.id);

    const row = await orm.CaptureTake.first({ id: take.id });

    expect(row).not.toBeNull();
    expect(row?.projectId).toBe(projectId);
    expect(row?.sessionId).toBe(session.id);
    expect(row?.checksumSha256).toBe(sha256(FIXTURE));
    expect(row?.byteSize).toBe(FIXTURE.byteLength);
    // The codec suffix the browser reported was normalized before the row write.
    expect(row?.mimeType).toBe("video/webm");
    expect(row?.status).toBe("READY");

    const absolutePath = path.join(CAPTURE_ROOT, row!.storageKey);
    const info = await stat(absolutePath);
    expect(info.isFile()).toBe(true);
    expect(info.size).toBe(FIXTURE.byteLength);
  });

  it("streams back the exact bytes that were stored", async () => {
    const session = await newActiveSession();
    const take = await addFixtureTake(session.id, {
      bytes: Buffer.from("byte-exact-read-back", "utf8"),
    });

    const { stream } = await services.captureService.resolveStream({
      projectId,
      takeId: take.id,
      userId: owner.user.id,
    });

    const bytes = await readAll(stream);
    expect(bytes).toEqual(Buffer.from("byte-exact-read-back", "utf8"));
    expect(sha256(bytes)).toBe(take.checksumSha256);
  });

  it("survives a fresh read of session, takes and manifest from the database", async () => {
    const session = await newActiveSession();
    const take = await addFixtureTake(session.id);

    const rereadSession = await services.captureService.getSession({
      projectId,
      sessionId: session.id,
      userId: owner.user.id,
    });

    const takes = await services.captureService.listTakes({
      projectId,
      sessionId: session.id,
      userId: owner.user.id,
    });

    const manifest = await services.captureService.manifest({
      projectId,
      sessionId: session.id,
      userId: owner.user.id,
    });

    expect(rereadSession.id).toBe(session.id);
    expect(rereadSession.status).toBe("ACTIVE");
    expect(takes.map((entry) => entry.id)).toContain(take.id);
    expect(manifest.takes).toHaveLength(1);
    expect(manifest.takes[0]?.checksumSha256).toBe(take.checksumSha256);
  });
});

describe("capture Postgres review lifecycle", () => {
  it("accepts, retakes into a second row, and keeps the accepted take", async () => {
    const session = await newActiveSession();
    const original = await addFixtureTake(session.id);

    await services.captureService.acceptTake({
      projectId,
      sessionId: session.id,
      takeId: original.id,
      userId: owner.user.id,
    });

    const retake = await services.captureService.retake({
      projectId,
      sessionId: session.id,
      userId: owner.user.id,
      previousTakeId: original.id,
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: Buffer.from("the replacement recording", "utf8"),
    });

    expect(retake.id).not.toBe(original.id);

    const rows = await orm.CaptureTake.where(
      (take) => take.sessionId.eq(session.id),
    ).all();

    expect(rows).toHaveLength(2);

    const originalRow = await orm.CaptureTake.first({ id: original.id });
    expect(originalRow?.status).toBe("ACCEPTED");
    expect(originalRow?.checksumSha256).toBe(sha256(FIXTURE));
  });

  it("deletes the bytes and keeps a DELETED row", async () => {
    const session = await newActiveSession();
    const take = await addFixtureTake(session.id);

    const rowBefore = await orm.CaptureTake.first({ id: take.id });
    const absolutePath = path.join(CAPTURE_ROOT, rowBefore!.storageKey);

    await services.captureService.deleteTake({
      projectId,
      sessionId: session.id,
      takeId: take.id,
      userId: owner.user.id,
    });

    const rowAfter = await orm.CaptureTake.first({ id: take.id });
    expect(rowAfter).not.toBeNull();
    expect(rowAfter?.status).toBe("DELETED");
    expect(rowAfter?.deletedAt).not.toBeNull();

    await expect(stat(absolutePath)).rejects.toThrow();
  });

  it("completes a session only after a take is accepted, and persists the status", async () => {
    const session = await newActiveSession();
    const take = await addFixtureTake(session.id);

    await expect(
      services.captureService.completeSession({
        projectId,
        sessionId: session.id,
        userId: owner.user.id,
      }),
    ).rejects.toMatchObject({ status: 400 });

    await services.captureService.acceptTake({
      projectId,
      sessionId: session.id,
      takeId: take.id,
      userId: owner.user.id,
    });

    await services.captureService.completeSession({
      projectId,
      sessionId: session.id,
      userId: owner.user.id,
    });

    const row = await orm.CaptureSession.first({ id: session.id });
    expect(row?.status).toBe("COMPLETED");
    expect(row?.completedAt).not.toBeNull();
  });

  it("cascades capture rows when the project is deleted", async () => {
    const tempUser = await services.authService.register({
      email: `cp13-cascade-${Date.now()}@test.local`,
      password: "test-password-1",
    });

    const tempProject = await services.projectService.createForWorkspace(
      tempUser.workspace!.id,
      { name: "cascade" },
      tempUser.user.id,
    );

    const session = await services.captureService.createSession({
      projectId: tempProject.id,
      userId: tempUser.user.id,
    });

    await services.captureService.startSession({
      projectId: tempProject.id,
      sessionId: session.id,
      userId: tempUser.user.id,
    });

    await services.captureService.addTake({
      projectId: tempProject.id,
      sessionId: session.id,
      userId: tempUser.user.id,
      mode: "FILE",
      mimeType: "image/png",
      filename: "still.png",
      bytes: FIXTURE,
      metadata: { width: 64, height: 64 },
    });

    await orm.Project.where({ id: tempProject.id }).delete();

    const sessions = await orm.CaptureSession.where((row) =>
      row.projectId.eq(tempProject.id),
    ).all();
    const takes = await orm.CaptureTake.where((row) =>
      row.projectId.eq(tempProject.id),
    ).all();

    expect(sessions).toHaveLength(0);
    expect(takes).toHaveLength(0);

    await rm(path.join(CAPTURE_ROOT, tempProject.id), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await orm.WorkspaceMember.where((member) =>
      member.userId.eq(tempUser.user.id),
    )
      .delete()
      .catch(() => undefined);
    await orm.Session.where((row) => row.userId.eq(tempUser.user.id))
      .delete()
      .catch(() => undefined);
    await orm.Workspace.where({ id: tempUser.workspace!.id })
      .delete()
      .catch(() => undefined);
    await orm.User.where({ id: tempUser.user.id })
      .delete()
      .catch(() => undefined);
  });
});
