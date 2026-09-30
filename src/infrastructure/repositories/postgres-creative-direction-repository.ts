/**
 * Persistence for creative directions.
 *
 * The nested creative structures are JSON text, the same way the intent keeps
 * its constraints, because the contract has no map column and the shapes behind
 * them are the domain's to define. They are re-checked on the way out: a column
 * is text, and text can be wrong, so a damaged row degrades to a direction with
 * no proof attached rather than taking the project page down.
 *
 * The selection is enforced here rather than in the service. One statement that
 * demotes the previous selection and promotes the new one is the only way to
 * make "exactly one selected direction per intent" true under two simultaneous
 * requests.
 */

import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  CreativeDirectionRepository,
  ListCreativeDirectionsOptions,
} from "../../core/ports/creative-direction-repository";
import {
  isCreativeAngle,
  isCreativeDirectionStatus,
  isCreativeMode,
  type CreativeDirection,
  type CreativeDirectionStatus,
  type CreativeHook,
  type CreativeProofStrategy,
  type CreativeVisualStrategy,
} from "../../core/domain/creative-direction";

type DirectionRow = Omit<Models.public_CreativeDirection, "project" | "intent">;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function decodeHook(raw: string): CreativeHook {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) {
    return { statement: "", mechanism: "", emotionalTrigger: "" };
  }
  return {
    statement: typeof parsed.statement === "string" ? parsed.statement : "",
    mechanism: typeof parsed.mechanism === "string" ? parsed.mechanism : "",
    emotionalTrigger:
      typeof parsed.emotionalTrigger === "string" ? parsed.emotionalTrigger : "",
  };
}

function decodeVisual(raw: string): CreativeVisualStrategy {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) {
    return { approach: "", rationale: "", productMoments: [], assetIds: [] };
  }
  return {
    approach: typeof parsed.approach === "string" ? parsed.approach : "",
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    productMoments: stringList(parsed.productMoments),
    assetIds: stringList(parsed.assetIds),
  };
}

function decodeProof(raw: string): CreativeProofStrategy {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) {
    return { claimIds: [], evidenceIds: [], proofPoints: [] };
  }
  return {
    claimIds: stringList(parsed.claimIds),
    evidenceIds: stringList(parsed.evidenceIds),
    proofPoints: stringList(parsed.proofPoints),
  };
}

function mapDirection(row: DirectionRow): CreativeDirection {
  return {
    id: row.id,
    projectId: row.projectId,
    intentId: row.intentId,
    creativeRunId: row.creativeRunId,
    mode: isCreativeMode(row.mode) ? row.mode : "BALANCED",
    status: isCreativeDirectionStatus(row.status) ? row.status : "DRAFT",
    angle: isCreativeAngle(row.angle) ? row.angle : "CUSTOM",
    name: row.name,
    thesis: row.thesis,
    hook: decodeHook(row.hook),
    audienceAngle: row.audienceAngle,
    emotionalAngle: row.emotionalAngle,
    narrativeSummary: row.narrativeSummary,
    visualStrategy: decodeVisual(row.visualStrategy),
    proofStrategy: decodeProof(row.proofStrategy),
    voiceDirection: row.voiceDirection,
    musicDirection: row.musicDirection,
    soundDirection: row.soundDirection,
    cta: row.cta ?? null,
    rationale: row.rationale,
    strengthScore: row.strengthScore,
    editedByUser: row.editedByUser,
    brandVersion: row.brandVersion ?? null,
    intelligenceVersion: row.intelligenceVersion ?? null,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function toRow(direction: CreativeDirection) {
  return {
    projectId: direction.projectId,
    intentId: direction.intentId,
    creativeRunId: direction.creativeRunId,
    mode: direction.mode,
    status: direction.status,
    angle: direction.angle,
    name: direction.name,
    thesis: direction.thesis,
    hook: JSON.stringify(direction.hook),
    audienceAngle: direction.audienceAngle,
    emotionalAngle: direction.emotionalAngle,
    narrativeSummary: direction.narrativeSummary,
    visualStrategy: JSON.stringify(direction.visualStrategy),
    proofStrategy: JSON.stringify(direction.proofStrategy),
    voiceDirection: direction.voiceDirection,
    musicDirection: direction.musicDirection,
    soundDirection: direction.soundDirection,
    cta: direction.cta,
    rationale: direction.rationale,
    strengthScore: direction.strengthScore,
    editedByUser: direction.editedByUser,
    brandVersion: direction.brandVersion,
    intelligenceVersion: direction.intelligenceVersion,
  };
}

/**
 * Demote every other selected direction for this intent, then select this one.
 * The row lock serialises the pair, so two concurrent selects cannot interleave
 * between the demotion and the promotion and leave nothing or two rows selected.
 */
/**
 * Ids are generated (`cdir_…`), so a comma cannot appear inside one and the
 * joined list splits back cleanly.
 */
function selectPlan(id: string, updatedAt: string) {
  return db.raw.sql`
    WITH target AS (
      SELECT id, "intentId" FROM "public"."creative_direction" WHERE id = ${id}
      FOR UPDATE
    ),
    demoted AS (
      UPDATE "public"."creative_direction" AS d
      SET status = 'DRAFT', "updatedAt" = ${updatedAt}::timestamptz
      WHERE d."intentId" = (SELECT "intentId" FROM target)
        AND d.status = 'SELECTED'
        AND d.id <> (SELECT id FROM target)
      RETURNING d.id
    )
    UPDATE "public"."creative_direction" AS s
    SET status = 'SELECTED', "updatedAt" = ${updatedAt}::timestamptz
    WHERE s.id = (SELECT id FROM target)
    RETURNING (
      SELECT string_agg(demoted.id, ',')
      FROM demoted
    ) AS "demotedIds"
  `
    .returnsRow({ demotedIds: { codecId: "pg/text@1", nullable: true } })
    .build();
}

export class PostgresCreativeDirectionRepository
  implements CreativeDirectionRepository
{
  constructor(private readonly orm: PublicOrm = db.orm.public) {}

  async create(direction: CreativeDirection): Promise<CreativeDirection> {
    const row = await this.orm.CreativeDirection.create({
      id: direction.id,
      createdAt: direction.createdAt,
      updatedAt: direction.updatedAt,
      ...toRow(direction),
    });
    return mapDirection(row as DirectionRow);
  }

  async getById(id: string): Promise<CreativeDirection | null> {
    const row = await this.orm.CreativeDirection.first({ id });
    return row ? mapDirection(row as DirectionRow) : null;
  }

  async listByProject(
    projectId: string,
    options: ListCreativeDirectionsOptions = {},
  ): Promise<CreativeDirection[]> {
    const rows = await this.orm.CreativeDirection.where((direction) =>
      direction.projectId.eq(projectId),
    )
      .orderBy((direction) => direction.createdAt.desc())
      .all();

    const filtered = rows.filter((row) => {
      if (options.intentId && row.intentId !== options.intentId) return false;
      if (options.status && row.status !== options.status) return false;
      return true;
    });

    const limited =
      options.limit && options.limit > 0
        ? filtered.slice(0, options.limit)
        : filtered;

    return limited.map((row) => mapDirection(row as DirectionRow));
  }

  async listByIntent(intentId: string): Promise<CreativeDirection[]> {
    const rows = await this.orm.CreativeDirection.where((direction) =>
      direction.intentId.eq(intentId),
    )
      .orderBy((direction) => direction.createdAt.desc())
      .all();
    return rows.map((row) => mapDirection(row as DirectionRow));
  }

  async listByRun(creativeRunId: string): Promise<CreativeDirection[]> {
    const rows = await this.orm.CreativeDirection.where((direction) =>
      direction.creativeRunId.eq(creativeRunId),
    )
      .orderBy((direction) => direction.createdAt.asc())
      .all();
    return rows.map((row) => mapDirection(row as DirectionRow));
  }

  async update(
    id: string,
    patch: Partial<CreativeDirection>,
  ): Promise<CreativeDirection | null> {
    const current = await this.getById(id);
    if (!current) return null;

    const row = await this.orm.CreativeDirection.where({ id }).update({
      ...toRow({ ...current, ...patch, id }),
      updatedAt: patch.updatedAt ?? current.updatedAt,
    });
    return mapDirection(row as DirectionRow);
  }

  async setStatus(
    id: string,
    status: CreativeDirectionStatus,
    updatedAt: string,
  ): Promise<CreativeDirection | null> {
    const row = await this.orm.CreativeDirection.where({ id }).update({
      status,
      updatedAt,
    });
    return row ? mapDirection(row as DirectionRow) : null;
  }

  async selectForIntent(
    id: string,
    updatedAt: string,
  ): Promise<{ selected: CreativeDirection; demoted: CreativeDirection[] } | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const rows = await db.transaction((tx) => tx.query(selectPlan(id, updatedAt)));
    // The column is text or null; a null means nothing else was selected.
    const demotedIds = String(rows[0]?.demotedIds ?? "")
      .split(",")
      .filter(Boolean);

    const selected = await this.getById(id);
    if (!selected) return null;
    if (demotedIds.length === 0) return { selected, demoted: [] };

    const demoted = await this.orm.CreativeDirection.where((direction) =>
      direction.id.in(demotedIds),
    ).all();

    const order = new Map<string, number>(
      demotedIds.map((demotedId, index) => [demotedId, index]),
    );
    return {
      selected,
      demoted: demoted
        .map((row) => mapDirection(row as DirectionRow))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    };
  }

  async listUserEditedForIntent(
    intentId: string,
  ): Promise<CreativeDirection[]> {
    const rows = await this.orm.CreativeDirection.where((direction) =>
      direction.intentId.eq(intentId),
    )
      .orderBy((direction) => direction.createdAt.desc())
      .all();
    return rows
      .filter((row) => row.editedByUser)
      .map((row) => mapDirection(row as DirectionRow));
  }
}
