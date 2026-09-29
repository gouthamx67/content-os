#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/51ad3137a964ebb61d81d7b9217aa744e853d9430ec996ee1d688631767f3b36/contract';
import startContract from '../../snapshots/51ad3137a964ebb61d81d7b9217aa744e853d9430ec996ee1d688631767f3b36/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c8d1c07e8f5cfa633164cddeacf0580ffd507fce3ae63e40bdc0a4db0f0acc94/contract';
import endContract from '../../snapshots/c8d1c07e8f5cfa633164cddeacf0580ffd507fce3ae63e40bdc0a4db0f0acc94/contract.json' with { type: 'json' };
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
        table: 'content_intent',
        columns: [
          col('aspectRatio', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('audience', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('brandVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('constraints', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contentType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('cta', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('duration', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('intelligenceVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('language', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text[]', { notNull: true, codecRef: { codecId: 'pg/text@1', many: true } }),
          col('platforms', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('purpose', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('quantity', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('rawRequest', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolution', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('style', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('subjects', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tone', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('unresolved', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'content_intent_channel_check_1c241ad4',
            "\"channel\" IN ('VIDEO', 'IMAGE', 'TEXT', 'AUDIO', 'CAMPAIGN')",
          ),
          checkExpression(
            'content_intent_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'content_intent_notes_elem_not_null_f914e30f',
            'array_position("notes", NULL) IS NULL',
          ),
          checkExpression(
            'content_intent_platforms_elem_not_null_53a1bdb5',
            'array_position("platforms", NULL) IS NULL',
          ),
          checkExpression(
            'content_intent_resolution_check_eb7780a0',
            "\"resolution\" IN ('EXPLICIT', 'INFERRED', 'PARTIAL', 'NEEDS_CLARIFICATION')",
          ),
          checkExpression(
            'content_intent_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
          checkExpression(
            'content_intent_status_check_f3b4e003',
            "\"status\" IN ('DRAFT', 'RESOLVED', 'NEEDS_CLARIFICATION', 'BLOCKED')",
          ),
          checkExpression(
            'content_intent_unresolved_elem_not_null_b05bd153',
            'array_position("unresolved", NULL) IS NULL',
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'content_intent',
        index: 'content_intent_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'content_intent',
        index: 'content_intent_project_idx',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'content_intent',
        index: 'content_intent_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'content_intent',
        foreignKey: {
          name: 'content_intent_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
