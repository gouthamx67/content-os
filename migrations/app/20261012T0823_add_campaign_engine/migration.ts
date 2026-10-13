#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0c8ef36eaa0302e144bcc32e417313c5e2822c0da0aaab118465a592d74b08fa/contract';
import startContract from '../../snapshots/0c8ef36eaa0302e144bcc32e417313c5e2822c0da0aaab118465a592d74b08fa/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f81a20f6460f2f5144ab7fe6440967cc5db72c3cb661e84eb19e58b0f9455805/contract';
import endContract from '../../snapshots/f81a20f6460f2f5144ab7fe6440967cc5db72c3cb661e84eb19e58b0f9455805/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'campaign',
        columns: [
          col('approvalHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('approvedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('approvedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('assembledAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('audienceSummary', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('brief', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('keyMessage', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('launchKit', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('launchKitHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('objective', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('plan', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revisionNumber', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('strategy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'campaign_status_check_c5865b32',
            "\"status\" IN ('DRAFT', 'PLANNED', 'IN_REVIEW', 'APPROVED', 'ARCHIVED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'campaign_deliverable',
        columns: [
          col('brief', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('campaignId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contentTypeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('links', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('platformId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('position', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scheduledFor', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PLANNED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'campaign_deliverable_channel_check_1c241ad4',
            "\"channel\" IN ('VIDEO', 'IMAGE', 'TEXT', 'AUDIO', 'CAMPAIGN')",
          ),
          checkExpression(
            'campaign_deliverable_status_check_e2b9e409',
            "\"status\" IN ('PLANNED', 'IN_PROGRESS', 'READY', 'BLOCKED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'campaign_revision',
        columns: [
          col('campaignId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revisionNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'campaign_revision_kind_check_838aa307',
            "\"kind\" IN ('CREATE', 'BRIEF_UPDATED', 'STRATEGY_SET', 'PLAN_SET', 'DELIVERABLE_ADDED', 'DELIVERABLE_UPDATED', 'DELIVERABLE_REMOVED', 'SUBMITTED', 'APPROVED', 'RETURNED', 'SCHEDULED', 'ASSEMBLED', 'ARCHIVED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'campaign_revision',
        constraint: 'campaign_revision_campaign_number',
        columns: ['campaignId', 'revisionNumber'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign',
        index: 'campaign_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign',
        index: 'campaign_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign',
        index: 'campaign_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign_deliverable',
        index: 'campaign_deliverable_campaignId_idx_3aacd648',
        columns: ['campaignId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign_deliverable',
        index: 'campaign_deliverable_campaign_position_idx',
        columns: ['campaignId', 'position'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign_deliverable',
        index: 'campaign_deliverable_campaign_scheduled_idx',
        columns: ['campaignId', 'scheduledFor'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign_deliverable',
        index: 'campaign_deliverable_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign_deliverable',
        index: 'campaign_deliverable_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign_revision',
        index: 'campaign_revision_campaignId_idx_3aacd648',
        columns: ['campaignId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'campaign_revision',
        index: 'campaign_revision_campaign_created_idx',
        columns: ['campaignId', 'createdAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'campaign',
        foreignKey: {
          name: 'campaign_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'campaign_deliverable',
        foreignKey: {
          name: 'campaign_deliverable_campaignId_fkey',
          columns: ['campaignId'],
          references: { schema: 'public', table: 'campaign', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'campaign_deliverable',
        foreignKey: {
          name: 'campaign_deliverable_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'campaign_revision',
        foreignKey: {
          name: 'campaign_revision_campaignId_fkey',
          columns: ['campaignId'],
          references: { schema: 'public', table: 'campaign', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
