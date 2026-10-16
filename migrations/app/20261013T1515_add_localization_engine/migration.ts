#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b279fc3ac210c13e71f42c89be61f3ee6821b9dc10f6d5f3ab5a0ce51c38e31c/contract';
import endContract from '../../snapshots/b279fc3ac210c13e71f42c89be61f3ee6821b9dc10f6d5f3ab5a0ce51c38e31c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f81a20f6460f2f5144ab7fe6440967cc5db72c3cb661e84eb19e58b0f9455805/contract';
import startContract from '../../snapshots/f81a20f6460f2f5144ab7fe6440967cc5db72c3cb661e84eb19e58b0f9455805/contract.json' with { type: 'json' };
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
        table: 'locale_glossary',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('doNotTranslate', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceLocale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetLocale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('term', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('translation', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'localization_job',
        columns: [
          col('appliedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('approvalRevisionNumber', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('approvedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('approvedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('headRevisionNumber', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceLocale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceRevision', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('strategy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetLocale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'localization_job_sourceType_check_62ad7fd5',
            "\"sourceType\" IN ('WRITING_DOCUMENT', 'EDITOR_DOCUMENT', 'ADAPTATION_JOB', 'CAMPAIGN')",
          ),
          checkExpression(
            'localization_job_status_check_ad1ab034',
            "\"status\" IN ('DRAFT', 'READY_TO_LOCALIZE', 'PROCESSING', 'NEEDS_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'APPLIED', 'STALE', 'FAILED')",
          ),
          checkExpression(
            'localization_job_strategy_check_17a80209',
            "\"strategy\" IN ('TRANSLATE', 'TRANSCREATE')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'localization_revision',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('jobId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revisionNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('snapshot', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('snapshotHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'localization_revision_kind_check_ba1c464d',
            "\"kind\" IN ('CREATE', 'SEGMENT_EDITED', 'PROCESSED', 'VALIDATED', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'APPLIED', 'MARKED_STALE', 'FAILED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'project_locale',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('direction', 'text', {
            notNull: true,
            default: lit('LTR'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isSource', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('isTarget', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('locale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'project_locale_direction_check_95cbf4cb',
            "\"direction\" IN ('LTR', 'RTL')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'translation_memory',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceLocale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceText', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetLocale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetText', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'locale_glossary',
        constraint: 'locale_glossary_unique',
        columns: ['projectId', 'sourceLocale', 'targetLocale', 'term'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'localization_revision',
        constraint: 'localization_revision_job_number',
        columns: ['jobId', 'revisionNumber'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'project_locale',
        constraint: 'project_locale_project_locale',
        columns: ['projectId', 'locale'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'translation_memory',
        constraint: 'translation_memory_unique',
        columns: ['projectId', 'sourceLocale', 'targetLocale', 'sourceHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'locale_glossary',
        index: 'locale_glossary_pair_idx',
        columns: ['projectId', 'sourceLocale', 'targetLocale'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'localization_job',
        index: 'localization_job_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'localization_job',
        index: 'localization_job_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'localization_job',
        index: 'localization_job_project_source_idx',
        columns: ['projectId', 'sourceType', 'sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'localization_job',
        index: 'localization_job_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'localization_revision',
        index: 'localization_revision_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'localization_revision',
        index: 'localization_revision_job_created_idx',
        columns: ['jobId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'project_locale',
        index: 'project_locale_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'localization_job',
        foreignKey: {
          name: 'localization_job_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'localization_revision',
        foreignKey: {
          name: 'localization_revision_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'localization_job', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'project_locale',
        foreignKey: {
          name: 'project_locale_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
