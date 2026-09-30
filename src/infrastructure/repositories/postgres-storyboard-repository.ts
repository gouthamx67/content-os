/**
 * Persistence for storyboards.
 *
 * A storyboard and its scenes are always written together. Two tables that
 * describe one plan cannot be allowed to disagree: a storyboard row saying
 * `actualDurationMs` of 30s next to scenes that cover 27.5s is the kind of
 * damage that reads as a rendering bug three checkpoints later. So create,
 * update and every selection change go through one transaction, and a reader
 * either sees the whole plan or none of it.
 *
 * Everything inside a scene is JSON text, the way the intent keeps its
 * constraints and the direction its nested strategy. It is decoded defensively on
 * the way out: a column is text and text can be wrong, so a damaged scene
 * degrades to one with an empty shot list rather than taking the project page
 * down with it.
 */

import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  ListStoryboardsOptions,
  StoryboardRepository,
} from "../../core/ports/storyboard-repository";
import {
  isStoryboardCaptureMode,
  isStoryboardSceneType,
  isStoryboardStatus,
  isStoryboardTextEmphasis,
  isStoryboardTextPosition,
  isStoryboardTextRole,
  isStoryboardTransitionType,
  isStoryboardVisualType,
  type Storyboard,
  type StoryboardCaptureRequirement,
  type StoryboardMusicDirection,
  type StoryboardScene,
  type StoryboardSfxCue,
  type StoryboardShot,
  type StoryboardStatus,
  type StoryboardTextOverlay,
  type StoryboardTransitionPlan,
  type StoryboardVoiceoverPlan,
  type UpdateStoryboardInput,
} from "../../core/domain/storyboard";

type StoryboardRow = Omit<
  Models.public_Storyboard,
  "project" | "intent" | "direction" | "scenes"
>;
type SceneRow = Omit<Models.public_StoryboardScene, "storyboard">;

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** A JSON column that is supposed to hold a list, as a list of unknowns. */
function jsonArray(raw: string | null): unknown[] {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function decodeCapture(value: unknown): StoryboardCaptureRequirement {
  if (!isRecord(value)) {
    return {
      mode: "NONE",
      target: "",
      workflowId: null,
      featureId: null,
      browserSessionId: null,
      browserTraceId: null,
    };
  }
  const mode = isStoryboardCaptureMode(value.mode) ? value.mode : "NONE";
  return {
    mode,
    target: str(value.target),
    workflowId: strOrNull(value.workflowId),
    featureId: strOrNull(value.featureId),
    browserSessionId: strOrNull(value.browserSessionId),
    browserTraceId: strOrNull(value.browserTraceId),
  };
}

function decodeShot(value: unknown): StoryboardShot | null {
  if (!isRecord(value)) return null;
  const description = str(value.description);
  // A shot with nothing to shoot is not a shot; keeping it would produce a scene
  // the validator would reject on the way back out.
  if (description.length === 0) return null;
  return {
    id: str(value.id),
    description,
    visualType: isStoryboardVisualType(value.visualType)
      ? value.visualType
      : "CUSTOM",
    productInteraction: str(value.productInteraction),
    framing: str(value.framing),
    cameraMotion: str(value.cameraMotion),
    assetIds: stringList(value.assetIds),
    evidenceIds: stringList(value.evidenceIds),
    captureRequirement: decodeCapture(value.captureRequirement),
    notes: str(value.notes),
  };
}

function decodeOverlay(value: unknown): StoryboardTextOverlay | null {
  if (!isRecord(value)) return null;
  const text = str(value.text);
  if (text.length === 0) return null;
  const startOffsetMs = num(value.startOffsetMs);
  const endOffsetMs = num(value.endOffsetMs, startOffsetMs);
  return {
    id: str(value.id),
    role: isStoryboardTextRole(value.role) ? value.role : "CAPTION",
    text,
    position: isStoryboardTextPosition(value.position) ? value.position : "CENTER",
    emphasis: isStoryboardTextEmphasis(value.emphasis) ? value.emphasis : "NORMAL",
    startOffsetMs,
    // An overlay that ends before it starts would make the timeline arithmetic
    // meaningless, so the end is pulled to at least the start.
    endOffsetMs: Math.max(startOffsetMs, endOffsetMs),
  };
}

function decodeSfxCue(value: unknown): StoryboardSfxCue | null {
  if (!isRecord(value)) return null;
  const name = str(value.name);
  if (name.length === 0) return null;
  return { name, atOffsetMs: num(value.atOffsetMs), why: str(value.why) };
}

function decodeTransition(value: unknown): StoryboardTransitionPlan | null {
  if (!isRecord(value)) return null;
  if (!isStoryboardTransitionType(value.type)) return null;
  return { type: value.type, rationale: str(value.rationale) };
}

function decodeVoiceover(raw: string | null): StoryboardVoiceoverPlan | null {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return null;
  const text = str(parsed.text);
  return text.length > 0 ? { text } : null;
}

function decodeMusic(raw: string | null): StoryboardMusicDirection | null {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return null;
  const style = str(parsed.style);
  if (style.length === 0) return null;
  const tempo = parsed.tempoBpm;
  return {
    style,
    tempoBpm: typeof tempo === "number" && Number.isFinite(tempo) ? tempo : null,
  };
}

function mapScene(row: SceneRow): StoryboardScene {
  return {
    id: row.id,
    order: row.order,
    type: isStoryboardSceneType(row.type) ? row.type : "CUSTOM",
    name: row.name,
    purpose: row.purpose,
    startMs: row.startMs,
    endMs: row.endMs,
    durationMs: row.durationMs,
    shots: jsonArray(row.shots)
      .map(decodeShot)
      .filter((shot): shot is StoryboardShot => shot !== null),
    textOverlays: jsonArray(row.textOverlays)
      .map(decodeOverlay)
      .filter((overlay): overlay is StoryboardTextOverlay => overlay !== null),
    voiceoverPlan: decodeVoiceover(row.voiceoverPlan),
    musicDirection: decodeMusic(row.musicDirection),
    sfxCues: jsonArray(row.sfxCues)
      .map(decodeSfxCue)
      .filter((cue): cue is StoryboardSfxCue => cue !== null),
    transitionIn: decodeTransition(parseJson(row.transitionIn)),
    transitionOut: decodeTransition(parseJson(row.transitionOut)),
    featureIds: [...row.featureIds],
    workflowIds: [...row.workflowIds],
    claimIds: [...row.claimIds],
    evidenceIds: [...row.evidenceIds],
    notes: row.notes,
  };
}

function mapStoryboard(
  row: StoryboardRow,
  sceneRows: readonly SceneRow[],
): Storyboard {
  return {
    id: row.id,
    projectId: row.projectId,
    intentId: row.intentId,
    directionId: row.directionId,
    creativeRunId: row.creativeRunId,
    name: row.name,
    status: isStoryboardStatus(row.status) ? row.status : "DRAFT",
    targetDurationMs: row.targetDurationMs,
    actualDurationMs: row.actualDurationMs,
    aspectRatio: row.aspectRatio ?? null,
    platforms: [...row.platforms],
    brandVersion: row.brandVersion ?? null,
    intelligenceVersion: row.intelligenceVersion ?? null,
    version: row.version,
    // Sorted by order rather than trusted to arrive in sequence: the reader's
    // timeline is the order column, and a query that returned rows out of order
    // would otherwise produce a plan whose scenes disagree with its spans.
    scenes: [...sceneRows]
      .sort((left, right) => left.order - right.order)
      .map(mapScene),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function sceneRow(storyboardId: string, scene: StoryboardScene, now: string) {
  return {
    id: scene.id,
    storyboardId,
    order: scene.order,
    type: scene.type,
    name: scene.name,
    purpose: scene.purpose,
    startMs: scene.startMs,
    endMs: scene.endMs,
    durationMs: scene.durationMs,
    shots: JSON.stringify(scene.shots),
    textOverlays: JSON.stringify(scene.textOverlays),
    voiceoverPlan: scene.voiceoverPlan ? JSON.stringify(scene.voiceoverPlan) : null,
    musicDirection: scene.musicDirection ? JSON.stringify(scene.musicDirection) : null,
    sfxCues: JSON.stringify(scene.sfxCues),
    transitionIn: scene.transitionIn ? JSON.stringify(scene.transitionIn) : null,
    transitionOut: scene.transitionOut ? JSON.stringify(scene.transitionOut) : null,
    featureIds: [...scene.featureIds],
    workflowIds: [...scene.workflowIds],
    claimIds: [...scene.claimIds],
    evidenceIds: [...scene.evidenceIds],
    notes: scene.notes,
    createdAt: now,
    updatedAt: now,
  };
}

function boardRow(board: Storyboard) {
  return {
    projectId: board.projectId,
    intentId: board.intentId,
    directionId: board.directionId,
    creativeRunId: board.creativeRunId,
    name: board.name,
    status: board.status,
    targetDurationMs: board.targetDurationMs,
    actualDurationMs: board.actualDurationMs,
    aspectRatio: board.aspectRatio,
    platforms: [...board.platforms],
    brandVersion: board.brandVersion,
    intelligenceVersion: board.intelligenceVersion,
    version: board.version,
  };
}

/**
 * Ids are generated (`sb_…`), so a comma cannot appear inside one and the joined
 * list splits back cleanly.
 *
 * Demote-then-promote in one statement, with the intent's rows locked, so two
 * concurrent selections cannot interleave and leave nothing or two selected.
 */
function statusPlan(
  id: string,
  status: StoryboardStatus,
  demoteTo: StoryboardStatus,
  updatedAt: string,
) {
  return db.raw.sql`
    WITH target AS (
      SELECT id, "intentId" FROM "public"."storyboard" WHERE id = ${id}
      FOR UPDATE
    ),
    demoted AS (
      UPDATE "public"."storyboard" AS d
      SET status = ${demoteTo}::text, "updatedAt" = ${updatedAt}::timestamptz
      WHERE d."intentId" = (SELECT "intentId" FROM target)
        AND d.status = 'SELECTED'
        AND d.id <> (SELECT id FROM target)
      RETURNING d.id
    )
    UPDATE "public"."storyboard" AS s
    SET status = ${status}::text, "updatedAt" = ${updatedAt}::timestamptz
    WHERE s.id = (SELECT id FROM target)
    RETURNING (
      SELECT string_agg(demoted.id, ',')
      FROM demoted
    ) AS "demotedIds"
  `
    .returnsRow({ demotedIds: { codecId: "pg/text@1", nullable: true } })
    .build();
}

export class PostgresStoryboardRepository implements StoryboardRepository {
  constructor(private readonly orm: PublicOrm = db.orm.public) {}

  async create(board: Storyboard): Promise<Storyboard> {
    await db.transaction(async (tx) => {
      await tx.orm.public.Storyboard.create({
        id: board.id,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
        ...boardRow(board),
      });
      if (board.scenes.length > 0) {
        await tx.orm.public.StoryboardScene.createAll(
          board.scenes.map((scene) => sceneRow(board.id, scene, board.updatedAt)),
        );
      }
    });
    const created = await this.getById(board.id);
    if (!created) throw new Error(`Storyboard ${board.id} vanished after create`);
    return created;
  }

  async getById(id: string): Promise<Storyboard | null> {
    const row = await this.orm.Storyboard.first({ id });
    if (!row) return null;
    const sceneRows = await this.scenesOf(id);
    return mapStoryboard(row as StoryboardRow, sceneRows);
  }

  async listByProject(
    projectId: string,
    options: ListStoryboardsOptions = {},
  ): Promise<Storyboard[]> {
    const rows = await this.orm.Storyboard.where((board) =>
      board.projectId.eq(projectId),
    )
      .orderBy((board) => board.createdAt.desc())
      .all();

    const filtered = rows.filter((row) => {
      if (options.intentId && row.intentId !== options.intentId) return false;
      if (options.directionId && row.directionId !== options.directionId) return false;
      if (options.status && row.status !== options.status) return false;
      return true;
    });

    const limited =
      options.limit && options.limit > 0 ? filtered.slice(0, options.limit) : filtered;

    const boards: Storyboard[] = [];
    for (const row of limited) {
      boards.push(mapStoryboard(row as StoryboardRow, await this.scenesOf(row.id)));
    }
    return boards;
  }

  async listByIntent(intentId: string): Promise<Storyboard[]> {
    const rows = await this.orm.Storyboard.where((board) =>
      board.intentId.eq(intentId),
    )
      .orderBy((board) => board.createdAt.desc())
      .all();

    const boards: Storyboard[] = [];
    for (const row of rows) {
      boards.push(mapStoryboard(row as StoryboardRow, await this.scenesOf(row.id)));
    }
    return boards;
  }

  async update(
    id: string,
    patch: UpdateStoryboardInput,
  ): Promise<Storyboard | null> {
    const current = await this.getById(id);
    if (!current) return null;

    const updatedAt = patch.updatedAt ?? current.updatedAt;
    const scenes = patch.scenes ?? current.scenes;

    await db.transaction(async (tx) => {
      if (patch.scenes) {
        // Delete-then-insert rather than a diff: the unique constraint on
        // (storyboardId, order) means a renumbering cannot be applied one row at
        // a time, and a diff would have to be correct about that.
        await tx.orm.public.StoryboardScene.where((scene) =>
          scene.storyboardId.eq(id),
        ).deleteAndCount();
        if (scenes.length > 0) {
          await tx.orm.public.StoryboardScene.createAll(
            scenes.map((scene) => sceneRow(id, scene, updatedAt)),
          );
        }
      }

      await tx.orm.public.Storyboard.where({ id }).update({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.targetDurationMs === undefined
          ? {}
          : { targetDurationMs: patch.targetDurationMs }),
        ...(patch.actualDurationMs === undefined
          ? {}
          : { actualDurationMs: patch.actualDurationMs }),
        ...(patch.version === undefined ? {} : { version: patch.version }),
        updatedAt,
      });
    });

    return this.getById(id);
  }

  async lock(
    id: string,
    updatedAt: string,
  ): Promise<{ storyboard: Storyboard; archived: Storyboard[] } | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const rows = await db.transaction((tx) =>
      tx.query(statusPlan(id, "LOCKED", "ARCHIVED", updatedAt)),
    );
    const displaced = this.parseDisplaced(rows[0]?.demotedIds);

    const locked = await this.getById(id);
    if (!locked) return null;
    if (displaced.length === 0) return { storyboard: locked, archived: [] };

    const archived = await this.byIds(displaced);
    return { storyboard: locked, archived };
  }

  async selectForIntent(
    id: string,
    updatedAt: string,
  ): Promise<{ storyboard: Storyboard; demoted: Storyboard[] } | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const rows = await db.transaction((tx) =>
      tx.query(statusPlan(id, "SELECTED", "DRAFT", updatedAt)),
    );
    const displaced = this.parseDisplaced(rows[0]?.demotedIds);

    const selected = await this.getById(id);
    if (!selected) return null;
    if (displaced.length === 0) return { storyboard: selected, demoted: [] };

    const demoted = await this.byIds(displaced);
    return { storyboard: selected, demoted };
  }

  async getLockedForIntent(intentId: string): Promise<Storyboard | null> {
    const row = await this.orm.Storyboard.where((board) => board.intentId.eq(intentId))
      .where((board) => board.status.eq("LOCKED"))
      .orderBy((board) => board.updatedAt.desc())
      .first();
    if (!row) return null;
    return mapStoryboard(row as StoryboardRow, await this.scenesOf(row.id));
  }

  private parseDisplaced(raw: unknown): string[] {
    // The column is text or null; a null means nothing else was selected.
    return String(raw ?? "")
      .split(",")
      .filter(Boolean);
  }

  /** Displaced boards in the order the transaction returned them, not query order. */
  private async byIds(ids: readonly string[]): Promise<Storyboard[]> {
    if (ids.length === 0) return [];
    const rows = (await this.orm.Storyboard.where((board) => board.id.in([...ids])).all()) as StoryboardRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));

    const boards: Storyboard[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      // A displaced id that no longer resolves is skipped rather than returned as
      // a half-built plan: the transaction told us about it, but the row is gone.
      if (row) boards.push(mapStoryboard(row, await this.scenesOf(id)));
    }
    return boards;
  }

  private async scenesOf(storyboardId: string): Promise<SceneRow[]> {
    const rows = await this.orm.StoryboardScene.where((scene) =>
      scene.storyboardId.eq(storyboardId),
    )
      .orderBy((scene) => scene.order.asc())
      .all();
    return rows as SceneRow[];
  }
}
