#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9376e3388ef8cc48503ead96c401950fa5ea2bd7550274ca3a165bcea7fcc08e/contract';
import endContract from '../../snapshots/9376e3388ef8cc48503ead96c401950fa5ea2bd7550274ca3a165bcea7fcc08e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c6daf43392b955612357b182d09b85aa28a184de543914b142b8075d05a0cee0/contract';
import startContract from '../../snapshots/c6daf43392b955612357b182d09b85aa28a184de543914b142b8075d05a0cee0/contract.json' with { type: 'json' };
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
        table: 'content_recommendation',
        columns: [
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contentTypeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('dismissedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('generatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isProgress', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('missingInputs', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('platform', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('priorityScore', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rationale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reasons', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('selectedIntentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('subjectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('subjectLabel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('templateId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'content_recommendation_channel_check_1c241ad4',
            "\"channel\" IN ('VIDEO', 'IMAGE', 'TEXT', 'AUDIO', 'CAMPAIGN')",
          ),
          checkExpression(
            'content_recommendation_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'content_recommendation_missingInputs_elem_not_null_066d9444',
            'array_position("missingInputs", NULL) IS NULL',
          ),
          checkExpression(
            'content_recommendation_reasons_elem_not_null_3036d3dd',
            'array_position("reasons", NULL) IS NULL',
          ),
          checkExpression(
            'content_recommendation_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
          checkExpression(
            'content_recommendation_status_check_c43b5441',
            "\"status\" IN ('ACTIVE', 'DISMISSED', 'SELECTED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'content_recommendation',
        constraint: 'content_recommendation_project_key_key',
        columns: ['projectId', 'key'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'content_recommendation',
        index: 'content_recommendation_project_idx',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'content_recommendation',
        index: 'content_recommendation_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'content_recommendation',
        index: 'content_recommendation_subject_idx',
        columns: ['subjectType', 'subjectId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'content_recommendation',
        foreignKey: {
          name: 'content_recommendation_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
