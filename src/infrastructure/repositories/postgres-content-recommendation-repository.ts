import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import { createId } from "../../lib/id";
import type { ContentRecommendationRepository } from "../../core/ports/content-recommendation-repository";
import {
  OPPORTUNITY_CHANNELS,
  OPPORTUNITY_STATUSES,
  type ContentOpportunity,
  type OpportunityChannel,
  type OpportunityStatus,
} from "../../core/domain/content-opportunity";
import {
  INTENT_SUBJECT_TYPES,
  type IntentSubjectType,
} from "../../core/domain/content-intent";

type RecommendationRow = Omit<Models.public_ContentRecommendation, "project">;

// The vocabularies are read from the domain rather than copied here. A second
// list of channels or statuses in the persistence layer would be a second place
// to update when one is added, and the copy that is forgotten is the one that
// starts rejecting rows the domain considers valid.
const CHANNELS = new Set<string>(OPPORTUNITY_CHANNELS);
const STATUSES = new Set<string>(OPPORTUNITY_STATUSES);
const SUBJECT_TYPES = new Set<string>(INTENT_SUBJECT_TYPES);

function validChannel(value: string): value is ContentOpportunity["channel"] {
  return CHANNELS.has(value);
}

function validStatus(value: string): value is OpportunityStatus {
  return STATUSES.has(value);
}

function validSubjectType(value: string): value is IntentSubjectType {
  return SUBJECT_TYPES.has(value);
}

/**
 * The row's arrays arrive as plain arrays and its timestamps as strings; the
 * adapter only re-checks the enums, because those are the columns whose shape
 * the database agrees to hold but whose meaning lives in the domain. Rows with
 * an enum value the domain no longer knows are dropped rather than guessed.
 */
function decodeRow(row: RecommendationRow): ContentOpportunity | null {
  if (!validChannel(row.channel)) return null;
  if (!validStatus(row.status)) return null;
  if (!validSubjectType(row.subjectType)) return null;

  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    templateId: row.templateId,
    contentTypeId: row.contentTypeId,
    channel: row.channel,
    platform: row.platform,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectLabel: row.subjectLabel,
    title: row.title,
    rationale: row.rationale,
    reasons: [...row.reasons],
    missingInputs: [...row.missingInputs],
    priorityScore: Number(row.priorityScore),
    evidence: {
      sourceIds: [...row.sourceIds],
      evidenceIds: [...row.evidenceIds],
      entityIds: [...row.entityIds],
    },
    status: row.status,
    selectedIntentId: row.selectedIntentId,
    dismissedAt: row.dismissedAt === null ? null : pgTimestampToIso(row.dismissedAt),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

export class PostgresContentRecommendationRepository
  implements ContentRecommendationRepository
{
  private readonly orm: PublicOrm;

  constructor(orm: PublicOrm = db.orm.public) {
    this.orm = orm;
  }

  async create(input: {
    projectId: string;
    templateId: string;
    key: string;
    contentTypeId: string;
    channel: OpportunityChannel;
    platform: string;
    subjectType: string;
    subjectId: string | null;
    subjectLabel: string;
    title: string;
    rationale: string;
    reasons: string[];
    missingInputs: string[];
    priorityScore: number;
    sourceIds: string[];
    evidenceIds: string[];
    entityIds: string[];
    generatedAt: string;
  }): Promise<ContentOpportunity> {
    const now = input.generatedAt;
    const row = await this.orm.ContentRecommendation.create({
      id: createId("rec"),
      projectId: input.projectId,
      templateId: input.templateId,
      key: input.key,
      contentTypeId: input.contentTypeId,
      channel: input.channel,
      platform: input.platform,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectLabel: input.subjectLabel,
      title: input.title,
      rationale: input.rationale,
      reasons: input.reasons,
      missingInputs: input.missingInputs,
      priorityScore: input.priorityScore,
      sourceIds: input.sourceIds,
      evidenceIds: input.evidenceIds,
      entityIds: input.entityIds,
      status: "ACTIVE",
      selectedIntentId: null,
      dismissedAt: null,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const decoded = decodeRow(row as unknown as RecommendationRow);
    if (!decoded) {
      throw new Error("Created recommendation row failed to decode");
    }
    return decoded;
  }

  async getById(
    projectId: string,
    id: string,
  ): Promise<ContentOpportunity | null> {
    const row = await this.orm.ContentRecommendation.first({ id });
    if (!row) return null;
    if (row.projectId !== projectId) return null;
    return decodeRow(row as unknown as RecommendationRow);
  }

  async listByProject(
    projectId: string,
    filter?: { status?: OpportunityStatus },
  ): Promise<ContentOpportunity[]> {
    const rows = await this.orm.ContentRecommendation.where((row) =>
      row.projectId.eq(projectId),
    )
      .orderBy((row) => row.createdAt.desc())
      .all();

    return rows
      .filter((row) => {
        if (filter?.status && row.status !== filter.status) return false;
        return true;
      })
      .map((row) => decodeRow(row as unknown as RecommendationRow))
      .filter((row): row is ContentOpportunity => row !== null);
  }

  async updateStatus(
    projectId: string,
    id: string,
    changes: Parameters<ContentRecommendationRepository["updateStatus"]>[2],
  ): Promise<ContentOpportunity | null> {
    const row = await this.orm.ContentRecommendation.first({ id });
    if (!row) return null;
    if (row.projectId !== projectId) return null;

    const updated = await this.orm.ContentRecommendation.where({ id }).update({
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.dismissedAt !== undefined
        ? { dismissedAt: changes.dismissedAt }
        : {}),
      ...(changes.selectedIntentId !== undefined
        ? { selectedIntentId: changes.selectedIntentId }
        : {}),
      updatedAt: changes.updatedAt,
    });

    return decodeRow(updated as unknown as RecommendationRow);
  }

  async replaceGenerated(
    projectId: string,
    opportunity: ContentOpportunity,
  ): Promise<ContentOpportunity> {
    const row = await this.orm.ContentRecommendation.first({
      id: opportunity.id,
    });
    if (!row || row.projectId !== projectId) {
      throw new Error("Cannot replace a recommendation outside its project");
    }

    const updated = await this.orm.ContentRecommendation.where({
      id: opportunity.id,
    }).update({
      templateId: opportunity.templateId,
      contentTypeId: opportunity.contentTypeId,
      channel: opportunity.channel,
      platform: opportunity.platform,
      subjectType: opportunity.subjectType,
      subjectId: opportunity.subjectId,
      subjectLabel: opportunity.subjectLabel,
      title: opportunity.title,
      rationale: opportunity.rationale,
      reasons: opportunity.reasons,
      missingInputs: opportunity.missingInputs,
      priorityScore: opportunity.priorityScore,
      key: opportunity.key,
      sourceIds: opportunity.evidence.sourceIds,
      evidenceIds: opportunity.evidence.evidenceIds,
      entityIds: opportunity.evidence.entityIds,
      generatedAt: opportunity.createdAt,
      updatedAt: opportunity.updatedAt,
    });

    const decoded = decodeRow(updated as unknown as RecommendationRow);
    if (!decoded) {
      throw new Error("Replaced recommendation row failed to decode");
    }
    return decoded;
  }

  async deleteStaleActive(
    projectId: string,
    keepIds: readonly string[],
  ): Promise<number> {
    const rows = await this.orm.ContentRecommendation.where((row) =>
      row.projectId.eq(projectId),
    ).all();

    const toDelete = rows.filter(
      (row) =>
        row.status === "ACTIVE" &&
        !keepIds.includes(row.id) &&
        !row.selectedIntentId,
    );

    for (const row of toDelete) {
      await this.orm.ContentRecommendation.where({ id: row.id }).delete();
    }

    return toDelete.length;
  }
}