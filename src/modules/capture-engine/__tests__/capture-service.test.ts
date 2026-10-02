import { Readable } from "node:stream";
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CaptureService, CaptureError } from "../capture-service";
import {
  type CaptureRepository,
  type CreateCaptureTakeInput,
  type UpdateCaptureTakeInput,
} from "../../../core/ports/capture-repository";
import type {
  CaptureSessionRecord,
  CaptureTakeRecord,
} from "../capture-types";
import type { CaptureStorage, StoredCapture } from "../storage/capture-storage";

class MemoryCaptureRepository implements CaptureRepository {
  sessions: CaptureSessionRecord[] = [];
  takes: CaptureTakeRecord[] = [];

  async createSession(input: {
    id: string;
    projectId: string;
    createdById: string;
    storyboardId: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<CaptureSessionRecord> {
    const session: CaptureSessionRecord = {
      ...input,
      status: "DRAFT",
      startedAt: null,
      completedAt: null,
    };
    this.sessions.push(session);
    return session;
  }

  async getSession(projectId: string, sessionId: string) {
    return (
      this.sessions.find(
        (session) =>
          session.projectId === projectId && session.id === sessionId,
      ) ?? null
    );
  }

  async updateSession(
    projectId: string,
    sessionId: string,
    changes: Partial<CaptureSessionRecord>,
  ) {
    const session = await this.getSession(projectId, sessionId);
    if (!session) throw new Error("session missing");
    Object.assign(session, changes);
    return session;
  }

  async listSessionsByProject(projectId: string) {
    return this.sessions.filter((session) => session.projectId === projectId);
  }

  async createTake(input: CreateCaptureTakeInput): Promise<CaptureTakeRecord> {
    const take: CaptureTakeRecord = {
      acceptedAt: null,
      rejectedAt: null,
      deletedAt: null,
      ...input,
    } as CaptureTakeRecord;
    this.takes.push(take);
    return take;
  }

  async getTake(projectId: string, takeId: string) {
    return (
      this.takes.find(
        (take) => take.projectId === projectId && take.id === takeId,
      ) ?? null
    );
  }

  async getTakeForSession(projectId: string, sessionId: string, takeId: string) {
    return (
      this.takes.find(
        (take) =>
          take.projectId === projectId &&
          take.sessionId === sessionId &&
          take.id === takeId,
      ) ?? null
    );
  }

  async updateTake(
    projectId: string,
    takeId: string,
    changes: UpdateCaptureTakeInput,
  ) {
    const take = await this.getTake(projectId, takeId);
    if (!take) throw new Error("take missing");
    Object.assign(take, changes);
    return take;
  }

  async listTakesBySession(projectId: string, sessionId: string) {
    return this.takes.filter(
      (take) => take.projectId === projectId && take.sessionId === sessionId,
    );
  }

  async listTakesByProject(projectId: string) {
    return this.takes.filter((take) => take.projectId === projectId);
  }

  async countAcceptedTakes(projectId: string, sessionId: string) {
    return this.takes.filter(
      (take) =>
        take.projectId === projectId &&
        take.sessionId === sessionId &&
        take.status === "ACCEPTED",
    ).length;
  }

  async deleteTake(projectId: string, takeId: string) {
    this.takes = this.takes.filter(
      (take) => !(take.projectId === projectId && take.id === takeId),
    );
  }
}

class MemoryCaptureStorage implements CaptureStorage {
  objects = new Map<string, Buffer>();
  private counter = 0;

  async put(
    projectId: string,
    _filename: string,
    bytes: Buffer,
  ): Promise<StoredCapture> {
    this.counter += 1;
    const storageKey = `${projectId}/take-${this.counter}`;
    this.objects.set(storageKey, Buffer.from(bytes));
    return {
      storageKey,
      byteSize: bytes.byteLength,
      checksumSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  }

  read(storageKey: string) {
    const bytes = this.objects.get(storageKey);
    if (!bytes) throw new Error("missing object");
    return Readable.from(bytes);
  }

  async delete(storageKey: string) {
    this.objects.delete(storageKey);
  }

  async exists(storageKey: string) {
    return this.objects.has(storageKey);
  }
}

const FIXTURE = Buffer.from("content-os-cp13-real-capture-fixture", "utf8");

function makeService(overrides?: { authorizeProject?: () => Promise<void> }) {
  const repository = new MemoryCaptureRepository();
  const storage = new MemoryCaptureStorage();
  const authorizeProject = overrides?.authorizeProject ?? (async () => undefined);
  const service = new CaptureService({ repository, storage, authorizeProject });
  return { service, repository, storage };
}

async function activeSession(service: CaptureService, projectId = "project-1") {
  const session = await service.createSession({ projectId, userId: "user-1" });
  await service.startSession({
    projectId,
    sessionId: session.id,
    userId: "user-1",
  });
  return session;
}

describe("CaptureService.addTake", () => {
  it("persists bytes and a row, and reports the checksum of what it stored", async () => {
    const { service, storage } = makeService();
    const session = await activeSession(service);

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      filename: "take.webm",
      mimeType: "video/webm;codecs=vp9",
      bytes: FIXTURE,
      metadata: { durationMs: 4200, width: 1280, height: 720 },
    });

    expect(take.mimeType).toBe("video/webm");
    expect(take.byteSize).toBe(FIXTURE.byteLength);
    expect(take.checksumSha256).toBe(
      crypto.createHash("sha256").update(FIXTURE).digest("hex"),
    );
    expect(storage.objects.get(take.storageKey)).toEqual(FIXTURE);
  });

  it("refuses a take in a DRAFT session", async () => {
    const { service } = makeService();
    const session = await service.createSession({
      projectId: "project-1",
      userId: "user-1",
    });

    await expect(
      service.addTake({
        projectId: "project-1",
        sessionId: session.id,
        userId: "user-1",
        mode: "CAMERA",
        mimeType: "video/webm",
        bytes: FIXTURE,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an unsupported MIME type before writing bytes", async () => {
    const { service, storage } = makeService();
    const session = await activeSession(service);

    await expect(
      service.addTake({
        projectId: "project-1",
        sessionId: session.id,
        userId: "user-1",
        mode: "FILE",
        mimeType: "image/svg+xml",
        bytes: FIXTURE,
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(storage.objects.size).toBe(0);
  });

  it("deletes the stored object when the row write fails", async () => {
    const { service, repository, storage } = makeService();
    const session = await activeSession(service);

    vi.spyOn(repository, "createTake").mockRejectedValueOnce(
      new Error("insert failed"),
    );

    await expect(
      service.addTake({
        projectId: "project-1",
        sessionId: session.id,
        userId: "user-1",
        mode: "CAMERA",
        mimeType: "video/webm",
        bytes: FIXTURE,
      }),
    ).rejects.toThrow("insert failed");

    expect(storage.objects.size).toBe(0);
  });
});

describe("CaptureService review lifecycle", () => {
  it("accepts one take and clears a prior rejection", async () => {
    const { service } = makeService();
    const session = await activeSession(service);

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    await service.rejectTake({
      projectId: "project-1",
      sessionId: session.id,
      takeId: take.id,
      userId: "user-1",
    });

    const accepted = await service.acceptTake({
      projectId: "project-1",
      sessionId: session.id,
      takeId: take.id,
      userId: "user-1",
    });

    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedAt).not.toBeNull();
    expect(accepted.rejectedAt).toBeNull();
  });

  it("retake creates a new take and leaves the accepted one intact", async () => {
    const { service, repository } = makeService();
    const session = await activeSession(service);

    const original = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    await service.acceptTake({
      projectId: "project-1",
      sessionId: session.id,
      takeId: original.id,
      userId: "user-1",
    });

    const retake = await service.retake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      previousTakeId: original.id,
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: Buffer.from("a different recording", "utf8"),
    });

    expect(retake.id).not.toBe(original.id);
    expect(retake.shotId).toBe(original.shotId);

    const originalAfter = await repository.getTake("project-1", original.id);
    expect(originalAfter?.status).toBe("ACCEPTED");
    expect(originalAfter?.checksumSha256).toBe(original.checksumSha256);
  });

  it("delete removes the bytes but keeps a DELETED row", async () => {
    const { service, repository, storage } = makeService();
    const session = await activeSession(service);

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    const deleted = await service.deleteTake({
      projectId: "project-1",
      sessionId: session.id,
      takeId: take.id,
      userId: "user-1",
    });

    expect(deleted.status).toBe("DELETED");
    expect(await storage.exists(take.storageKey)).toBe(false);
    expect(await repository.getTake("project-1", take.id)).not.toBeNull();
  });

  it("cannot complete without an accepted take", async () => {
    const { service } = makeService();
    const session = await activeSession(service);

    await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    await expect(
      service.completeSession({
        projectId: "project-1",
        sessionId: session.id,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("completes a session once a take is accepted", async () => {
    const { service } = makeService();
    const session = await activeSession(service);

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    await service.acceptTake({
      projectId: "project-1",
      sessionId: session.id,
      takeId: take.id,
      userId: "user-1",
    });

    const completed = await service.completeSession({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
    });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();
  });

  it("refuses to cancel a completed session", async () => {
    const { service } = makeService();
    const session = await activeSession(service);

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    await service.acceptTake({
      projectId: "project-1",
      sessionId: session.id,
      takeId: take.id,
      userId: "user-1",
    });

    await service.completeSession({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
    });

    await expect(
      service.cancelSession({
        projectId: "project-1",
        sessionId: session.id,
        userId: "user-1",
      }),
    ).rejects.toThrow();
  });
});

describe("CaptureService scoping", () => {
  it("reports a session in another project as not found", async () => {
    const { service } = makeService();
    const session = await service.createSession({
      projectId: "project-1",
      userId: "user-1",
    });

    await expect(
      service.getSession({
        projectId: "project-2",
        sessionId: session.id,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reports a take from another session as not found", async () => {
    const { service } = makeService();
    const session = await activeSession(service);
    const other = await service.createSession({
      projectId: "project-1",
      userId: "user-1",
    });

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    await expect(
      service.getTake({
        projectId: "project-1",
        sessionId: other.id,
        takeId: take.id,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("propagates the authorization failure before doing any work", async () => {
    const authorize = vi.fn(async () => {
      throw new CaptureError(403, "Forbidden");
    });
    const repository = new MemoryCaptureRepository();
    const storage = new MemoryCaptureStorage();
    const service = new CaptureService({
      repository,
      storage,
      authorizeProject: authorize,
    });

    await expect(
      service.listSessions({ projectId: "project-1", userId: "stranger" }),
    ).rejects.toMatchObject({ status: 403 });

    expect(authorize).toHaveBeenCalledWith("project-1", "stranger");
  });
});

describe("CaptureService.resolveStream", () => {
  it("returns bytes for a persisted take", async () => {
    const { service } = makeService();
    const session = await activeSession(service);

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    const { stream } = await service.resolveStream({
      projectId: "project-1",
      takeId: take.id,
      userId: "user-1",
    });

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks)).toEqual(FIXTURE);
  });

  it("404s when the row is intact but the object is gone", async () => {
    const { service, storage } = makeService();
    const session = await activeSession(service);

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    storage.objects.delete(take.storageKey);

    await expect(
      service.resolveStream({
        projectId: "project-1",
        takeId: take.id,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("404s for a DELETED take", async () => {
    const { service } = makeService();
    const session = await activeSession(service);

    const take = await service.addTake({
      projectId: "project-1",
      sessionId: session.id,
      userId: "user-1",
      mode: "CAMERA",
      mimeType: "video/webm",
      bytes: FIXTURE,
    });

    await service.deleteTake({
      projectId: "project-1",
      sessionId: session.id,
      takeId: take.id,
      userId: "user-1",
    });

    await expect(
      service.resolveStream({
        projectId: "project-1",
        takeId: take.id,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
