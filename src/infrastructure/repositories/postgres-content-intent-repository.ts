import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type { ContentIntentRepository } from "../../core/ports/content-intent-repository";
import {
  isAspectRatio,
  type AspectRatio,
  type ContentIntent,
  type ContentIntentConstraint,
  type IntentSubject,
} from "../../core/domain/content-intent";

type IntentRow = Omit<Models.public_ContentIntent, "project">;

const CONSTRAINT_SOURCES = new Set(["USER", "PROJECT", "BRAND", "AI", "SYSTEM"]);
const SUBJECT_TYPES = new Set([
  "PRODUCT",
  "FEATURE",
  "WORKFLOW",
  "PROBLEM",
  "BENEFIT",
  "CLAIM",
]);

/**
 * Constraints and subjects are stored as JSON text because the contract has no
 * map column and their shapes are the domain's to define. Both are re-checked on
 * the way out, because the column is text and text can be wrong.
 *
 * A row whose JSON cannot be read still has a usable answer in its own columns,
 * so a damaged provenance list degrades to "no provenance" instead of taking
 * the project page down with it.
 */
function decodeConstraints(raw: string): ContentIntentConstraint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): ContentIntentConstraint[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.key !== "string") return [];
    if (typeof candidate.value !== "string") return [];
    if (
      typeof candidate.source !== "string" ||
      !CONSTRAINT_SOURCES.has(candidate.source)
    ) {
      return [];
    }
    return [
      {
        key: candidate.key as ContentIntentConstraint["key"],
        value: candidate.value,
        source: candidate.source as ContentIntentConstraint["source"],
      },
    ];
  });
}

function decodeSubjects(raw: string): IntentSubject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): IntentSubject[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.type !== "string") {
      return [];
    }
    if (!SUBJECT_TYPES.has(candidate.type)) return [];
    return [{ type: candidate.type as IntentSubject["type"], id: candidate.id }];
  });
}

/**
 * A custom ratio is kept as its dimensions inside the constraint list, so the
 * column set stays small and the provenance of the size survives the round trip.
 */
function decodeCustomAspectRatio(
  constraints: readonly ContentIntentConstraint[],
): { width: number; height: number } | undefined {
  for (const constraint of constraints) {
    if (constraint.key !== "aspectRatio") continue;
    const match = /^(\d{2,5})x(\d{2,5})$/.exec(constraint.value);
    if (!match) continue;
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return undefined;
}

function mapIntent(row: IntentRow): ContentIntent {
  const constraints = decodeConstraints(row.constraints);
  const aspectRatio =
    row.aspectRatio && isAspectRatio(row.aspectRatio)
      ? (row.aspectRatio as AspectRatio)
      : undefined;

  return {
    id: row.id,
    projectId: row.projectId,
    rawRequest: row.rawRequest,
    channel: row.channel,
    // An empty string is the domain's "not decided yet". The column is nullable
    // because SQL reads better with NULL than with ''.
    contentTypeId: row.contentType ?? "",
    purpose: row.purpose ?? undefined,
    platforms: [...row.platforms],
    subjects: decodeSubjects(row.subjects),
    audience: row.audience ?? undefined,
    language: row.language ?? undefined,
    tone: row.tone ?? undefined,
    style: row.style ?? undefined,
    durationSeconds: row.duration ?? undefined,
    quantity: row.quantity,
    aspectRatio,
    customAspectRatio:
      aspectRatio === "CUSTOM" ? decodeCustomAspectRatio(constraints) : undefined,
    cta: row.cta ?? undefined,
    constraints,
    resolutionMode: row.resolution,
    status: row.status,
    confidence: row.confidence,
    unresolvedFields: [...row.unresolved],
    notes: [...row.notes],
    sourceIds: [...row.sourceIds],
    brandVersion: row.brandVersion ?? undefined,
    intelligenceSnapshotVersion: row.intelligenceVersion ?? undefined,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function toRow(intent: ContentIntent) {
  return {
    projectId: intent.projectId,
    rawRequest: intent.rawRequest,
    channel: intent.channel,
    contentType: intent.contentTypeId || null,
    purpose: intent.purpose ?? null,
    platforms: [...intent.platforms],
    audience: intent.audience ?? null,
    language: intent.language ?? null,
    tone: intent.tone ?? null,
    style: intent.style ?? null,
    cta: intent.cta ?? null,
    duration: intent.durationSeconds ?? null,
    quantity: intent.quantity,
    aspectRatio: intent.aspectRatio ?? null,
    constraints: JSON.stringify(intent.constraints),
    subjects: JSON.stringify(intent.subjects),
    resolution: intent.resolutionMode,
    status: intent.status,
    confidence: intent.confidence,
    unresolved: [...intent.unresolvedFields],
    notes: [...intent.notes],
    sourceIds: [...intent.sourceIds],
    brandVersion: intent.brandVersion ?? null,
    intelligenceVersion: intent.intelligenceSnapshotVersion ?? null,
  };
}

export class PostgresContentIntentRepository implements ContentIntentRepository {
  constructor(private readonly orm: PublicOrm = db.orm.public) {}

  async create(intent: ContentIntent): Promise<ContentIntent> {
    const row = await this.orm.ContentIntent.create({
      id: intent.id || undefined,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
      ...toRow(intent),
    });
    return mapIntent(row as IntentRow);
  }

  async getById(id: string): Promise<ContentIntent | null> {
    const row = await this.orm.ContentIntent.first({ id });
    return row ? mapIntent(row as IntentRow) : null;
  }

  async listForProject(projectId: string): Promise<ContentIntent[]> {
    // Newest first: the list is a history of what was asked for, and the most
    // recent request is the one being worked on.
    const rows = await this.orm.ContentIntent.where((intent) =>
      intent.projectId.eq(projectId),
    )
      .orderBy((intent) => intent.createdAt.desc())
      .all();
    return rows.map((row) => mapIntent(row as IntentRow));
  }

  async update(intent: ContentIntent): Promise<ContentIntent> {
    const row = await this.orm.ContentIntent.where({ id: intent.id }).update({
      updatedAt: intent.updatedAt,
      ...toRow(intent),
    });
    return mapIntent(row as IntentRow);
  }
}
