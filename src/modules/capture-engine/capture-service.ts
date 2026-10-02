import type { Readable } from "node:stream";
import { createId } from "../../lib/id";
import {
  captureStorage,
  type CaptureStorage,
} from "./storage/capture-storage";
import {
  ALLOWED_MIME_TYPES,
  MAX_CAPTURE_BYTES,
  MAX_DURATION_MS,
  normalizeMimeType,
  sanitizeCaptureMetadata,
  validateCaptureInput,
} from "./capture-validation";
import {
  buildCapturePlan,
  type CapturePlanItem,
  type CapturePlanShot,
} from "./capture-plan";
import { buildCaptureManifest, type CaptureManifest } from "./capture-manifest";
import { assertTransition } from "./session-state";
import {
  isCaptureMode,
  type CaptureMode,
  type CaptureSessionRecord,
  type CaptureTakeRecord,
} from "./capture-types";
import { type CaptureRepository } from "../../core/ports/capture-repository";

export class CaptureError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CaptureError";
    this.status = status;
  }
}

export type CaptureServiceDeps = {
  repository: CaptureRepository;
  /**
   * Project membership, delegated to the CP04 guard rather than reimplemented.
   * The capture engine has no opinion about who may open a project.
   */
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  /**
   * Byte storage. Injected so an integration test can point it at a temporary
   * root instead of writing into the repository's real capture directory.
   */
  storage?: CaptureStorage;
};

export class CaptureService {
  private readonly repository: CaptureRepository;
  private readonly authorizeProject: CaptureServiceDeps["authorizeProject"];
  private readonly storage: CaptureStorage;

  constructor(deps: CaptureServiceDeps) {
    this.repository = deps.repository;
    this.authorizeProject = deps.authorizeProject;
    this.storage = deps.storage ?? captureStorage;
  }

  /**
   * Session creation is authorized on the project, not on a session: there is
   * no session yet, and a storyboard id in the body is checked against the same
   * project rather than trusted because it was supplied.
   */
  async createSession(input: {
    projectId: string;
    userId: string;
    storyboardId?: string | null;
  }): Promise<CaptureSessionRecord> {
    await this.authorizeProject(input.projectId, input.userId);

    if (input.storyboardId) {
      const ownsStoryboard = await this.storyboardBelongsToProject(
        input.projectId,
        input.storyboardId,
      );

      if (!ownsStoryboard) {
        throw new CaptureError(
          400,
          "Storyboard does not belong to this project",
        );
      }
    }

    const now = new Date().toISOString();

    return this.repository.createSession({
      id: createId("caps"),
      projectId: input.projectId,
      createdById: input.userId,
      storyboardId: input.storyboardId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async storyboardBelongsToProject(
    projectId: string,
    storyboardId: string,
  ): Promise<boolean> {
    const { db } = await import("../../prisma/db");
    const row = await db.orm.public.Storyboard.first({ id: storyboardId });
    return row?.projectId === projectId;
  }

  async listSessions(input: {
    projectId: string;
    userId: string;
  }): Promise<CaptureSessionRecord[]> {
    await this.authorizeProject(input.projectId, input.userId);
    return this.repository.listSessionsByProject(input.projectId);
  }

  async getSession(input: {
    projectId: string;
    sessionId: string;
    userId: string;
  }): Promise<CaptureSessionRecord> {
    await this.authorizeProject(input.projectId, input.userId);

    const session = await this.repository.getSession(
      input.projectId,
      input.sessionId,
    );

    if (!session) {
      // A session in another project is reported as missing rather than
      // forbidden: telling a member of project B that project A has a session
      // id would confirm the id exists.
      throw new CaptureError(404, "Capture session not found");
    }

    return session;
  }

  async startSession(input: {
    projectId: string;
    sessionId: string;
    userId: string;
  }): Promise<CaptureSessionRecord> {
    await this.authorizeProject(input.projectId, input.userId);

    const session = await this.getSession(input);

    if (session.status !== "DRAFT") {
      throw new CaptureError(
        400,
        "Capture session cannot be started from " + session.status,
      );
    }

    assertTransition(session.status, "ACTIVE");

    const now = new Date().toISOString();

    return this.repository.updateSession(input.projectId, session.id, {
      status: "ACTIVE",
      startedAt: session.startedAt ?? now,
      updatedAt: now,
    });
  }

  async beginReview(input: {
    projectId: string;
    sessionId: string;
    userId: string;
  }): Promise<CaptureSessionRecord> {
    await this.authorizeProject(input.projectId, input.userId);
    const session = await this.getSession(input);

    assertTransition(session.status, "REVIEW");

    return this.repository.updateSession(input.projectId, session.id, {
      status: "REVIEW",
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Writes the bytes, then the row.
   *
   * The storage write happens first because it is the step that can fail on its
   * own terms (disk full, bad path). If the row write then fails, the orphaned
   * object is deleted before the error propagates — a file nothing points at is
   * invisible to the cleanup job, so leaving it behind would be a leak that
   * nothing would ever collect.
   */
  async addTake(input: {
    projectId: string;
    sessionId: string;
    userId: string;
    shotId?: string | null;
    mode: CaptureMode;
    filename?: string | null;
    mimeType: string;
    bytes: Buffer;
    metadata?: unknown;
  }): Promise<CaptureTakeRecord> {
    await this.authorizeProject(input.projectId, input.userId);

    if (!isCaptureMode(input.mode)) {
      throw new CaptureError(400, "Invalid capture mode");
    }

    const session = await this.getSession(input);

    if (session.status !== "ACTIVE") {
      throw new CaptureError(
        400,
        "Capture session is not active; takes can only be added to an active session",
      );
    }

    if (input.shotId) {
      const plan = await this.capturePlan(input.projectId, session);

      if (
        plan.length > 0 &&
        !plan.some((item) => item.shotId === input.shotId)
      ) {
        // A shot id outside this session's storyboard would produce a take that
        // no plan item references and no review screen would ever show.
        throw new CaptureError(400, "Shot does not belong to this session");
      }
    }

    const mimeType = normalizeMimeType(input.mimeType);
    const metadata = sanitizeCaptureMetadata(input.metadata);

    try {
      validateCaptureInput({
        mimeType,
        byteSize: input.bytes.byteLength,
        metadata,
      });
    } catch (error) {
      throw new CaptureError(
        400,
        error instanceof Error ? error.message : "Invalid capture",
      );
    }

    const stored = await this.storage.put(
      input.projectId,
      input.filename ?? `capture.${extensionFor(mimeType)}`,
      input.bytes,
    );

    const now = new Date().toISOString();

    try {
      return await this.repository.createTake({
        id: createId("capt"),
        sessionId: session.id,
        projectId: input.projectId,
        shotId: input.shotId ?? null,
        mode: input.mode,
        status: "READY",
        storageKey: stored.storageKey,
        originalName: input.filename ?? null,
        mimeType,
        byteSize: stored.byteSize,
        checksumSha256: stored.checksumSha256,
        width: metadata?.width ?? null,
        height: metadata?.height ?? null,
        durationMs: metadata?.durationMs ?? null,
        frameRate: metadata?.frameRate ?? null,
        metadata: (metadata ?? null) as Record<string, unknown> | null,
        createdAt: now,
        acceptedAt: null,
        rejectedAt: null,
        deletedAt: null,
      });
    } catch (error) {
      await this.storage.delete(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Retake creates a new take. The accepted take keeps its own bytes, checksum
   * and timestamps: overwriting it would mean the manifest described a file that
   * no longer exists, and a shot's history would silently lose the take the user
   * chose.
   */
  async retake(input: {
    projectId: string;
    sessionId: string;
    userId: string;
    previousTakeId?: string | null;
    mode: CaptureMode;
    filename?: string | null;
    mimeType: string;
    bytes: Buffer;
    metadata?: unknown;
    shotId?: string | null;
  }): Promise<CaptureTakeRecord> {
    let shotId = input.shotId ?? null;

    if (!shotId && input.previousTakeId) {
      const previous = await this.getTake({
        projectId: input.projectId,
        sessionId: input.sessionId,
        takeId: input.previousTakeId,
        userId: input.userId,
      });

      shotId = previous.shotId;
    }

    return this.addTake({ ...input, shotId });
  }

  async getTake(input: {
    projectId: string;
    sessionId: string;
    takeId: string;
    userId: string;
  }): Promise<CaptureTakeRecord> {
    await this.authorizeProject(input.projectId, input.userId);

    const take = await this.repository.getTakeForSession(
      input.projectId,
      input.sessionId,
      input.takeId,
    );

    if (!take) {
      throw new CaptureError(404, "Capture take not found");
    }

    return take;
  }

  async listTakes(input: {
    projectId: string;
    sessionId: string;
    userId: string;
  }): Promise<CaptureTakeRecord[]> {
    await this.authorizeProject(input.projectId, input.userId);
    await this.getSession(input);
    return this.repository.listTakesBySession(
      input.projectId,
      input.sessionId,
    );
  }

  async acceptTake(input: {
    projectId: string;
    sessionId: string;
    takeId: string;
    userId: string;
  }): Promise<CaptureTakeRecord> {
    await this.authorizeProject(input.projectId, input.userId);
    const take = await this.getTake(input);

    if (take.status === "DELETED") {
      throw new CaptureError(400, "Capture take has been deleted");
    }

    const now = new Date().toISOString();

    return this.repository.updateTake(input.projectId, take.id, {
      status: "ACCEPTED",
      acceptedAt: now,
      // Clearing the rejection keeps one take in exactly one review state: a
      // take that was rejected and then accepted must not still carry
      // rejectedAt, or a reader would see both timestamps and trust neither.
      rejectedAt: null,
    });
  }

  async rejectTake(input: {
    projectId: string;
    sessionId: string;
    takeId: string;
    userId: string;
  }): Promise<CaptureTakeRecord> {
    await this.authorizeProject(input.projectId, input.userId);
    const take = await this.getTake(input);

    if (take.status === "DELETED") {
      throw new CaptureError(400, "Capture take has been deleted");
    }

    const now = new Date().toISOString();

    return this.repository.updateTake(input.projectId, take.id, {
      status: "REJECTED",
      rejectedAt: now,
      acceptedAt: null,
    });
  }

  /**
   * Deleting removes the bytes and marks the row DELETED rather than dropping
   * it: the record that a take existed, for which shot, and when it was captured
   * is the audit trail. Hard-deleting the row would also lose the only record
   * that the shot was ever attempted.
   */
  async deleteTake(input: {
    projectId: string;
    sessionId: string;
    takeId: string;
    userId: string;
  }): Promise<CaptureTakeRecord> {
    await this.authorizeProject(input.projectId, input.userId);
    const take = await this.getTake(input);

    // Bytes first, then the row. A crash between the two leaves a row whose
    // object is gone, which `exists` reports as absent and cleanup can collect;
    // the reverse order would leave a live row pointing at a deleted read.
    await this.storage.delete(take.storageKey);

    return this.repository.updateTake(input.projectId, take.id, {
      status: "DELETED",
      deletedAt: new Date().toISOString(),
    });
  }

  async completeSession(input: {
    projectId: string;
    sessionId: string;
    userId: string;
  }): Promise<CaptureSessionRecord> {
    await this.authorizeProject(input.projectId, input.userId);
    const session = await this.getSession(input);

    assertTransition(session.status, "COMPLETED");

    const accepted = await this.repository.countAcceptedTakes(
      input.projectId,
      session.id,
    );

    if (accepted === 0) {
      throw new CaptureError(
        400,
        "At least one accepted take is required before completing",
      );
    }

    const now = new Date().toISOString();

    return this.repository.updateSession(input.projectId, session.id, {
      status: "COMPLETED",
      completedAt: now,
      updatedAt: now,
    });
  }

  async cancelSession(input: {
    projectId: string;
    sessionId: string;
    userId: string;
  }): Promise<CaptureSessionRecord> {
    await this.authorizeProject(input.projectId, input.userId);
    const session = await this.getSession(input);

    assertTransition(session.status, "CANCELLED");

    return this.repository.updateSession(input.projectId, session.id, {
      status: "CANCELLED",
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * The brief shown before capture, read from CP11 rather than restated here.
   * Without a storyboard there is no plan, and the UI must say that rather than
   * render an empty requirement list that looks like a bug.
   */
  async capturePlan(
    projectId: string,
    session: CaptureSessionRecord,
  ): Promise<CapturePlanItem[]> {
    if (!session.storyboardId) {
      return [];
    }

    const { db } = await import("../../prisma/db");
    // Ordered in the query rather than sorted afterwards so the plan is read in
    // timeline order: the next shot to capture is the next one on screen.
    const ordered = await db.orm.public.StoryboardScene.where({
      storyboardId: session.storyboardId,
    })
      .orderBy((scene) => scene.order.asc())
      .all();

    const shots: CapturePlanShot[] = ordered.map((scene) => ({
      id: scene.id,
      title: scene.name,
      captureRequirements: readCaptureRequirements(scene),
    }));

    return buildCapturePlan(shots);
  }

  async manifest(input: {
    projectId: string;
    sessionId: string;
    userId: string;
  }): Promise<CaptureManifest> {
    await this.authorizeProject(input.projectId, input.userId);
    await this.getSession(input);

    const takes = await this.repository.listTakesBySession(
      input.projectId,
      input.sessionId,
    );

    return buildCaptureManifest({
      sessionId: input.sessionId,
      projectId: input.projectId,
      takes,
    });
  }

  /**
   * Resolves a take's bytes for streaming.
   *
   * The storage key comes from the row, never from the request, and the
   * membership check happens before the take is looked up so an unauthorized
   * caller cannot use response timing to probe which take ids exist.
   */
  async resolveStream(input: {
    projectId: string;
    takeId: string;
    userId: string;
  }): Promise<{ take: CaptureTakeRecord; stream: Readable }> {
    await this.authorizeProject(input.projectId, input.userId);

    const take = await this.repository.getTake(input.projectId, input.takeId);

    if (!take || take.status === "DELETED") {
      throw new CaptureError(404, "Capture take not found");
    }

    const exists = await this.storage.exists(take.storageKey);

    if (!exists) {
      // The row is intact but the object is gone. Reporting 404 rather than a
      // 500 keeps a lost file indistinguishable from one that was never there,
      // and avoids implying the capture pipeline is broken.
      throw new CaptureError(404, "Capture bytes are no longer available");
    }

    return { take, stream: this.storage.read(take.storageKey) };
  }
}

function readCaptureRequirements(
  scene: { notes: string; voiceoverPlan: string | null; purpose: string },
): CapturePlanShot["captureRequirements"] {
  // CP11 stores a scene's capture brief in its notes. Parsed opportunistically:
  // a scene with free-form notes simply yields no explicit modes, and the UI
  // offers every mode rather than refusing to capture it.
  const modes: string[] = [];
  const match = scene.notes.match(/capture:([A-Z,]+)/i);

  if (match?.[1]) {
    modes.push(...match[1].split(",").map((m) => m.trim().toUpperCase()));
  }

  const instructions = scene.notes
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^capture:/i.test(line));

  return {
    modes,
    instructions,
    required: modes.length > 0,
  };
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/webm":
      return "weba";
    default:
      return "bin";
  }
}

export { ALLOWED_MIME_TYPES, MAX_CAPTURE_BYTES, MAX_DURATION_MS };
