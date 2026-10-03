#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/98425fda0ad4d4e5ef6813efa622e8b5dc65d50103d1f5c22f47cbc55825b115/contract';
import startContract from '../../snapshots/98425fda0ad4d4e5ef6813efa622e8b5dc65d50103d1f5c22f47cbc55825b115/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e4a33fc5f7d056e57c703452ca89e9f3694ede2a173c13dbc6ace6fc918cc26f/contract';
import endContract from '../../snapshots/e4a33fc5f7d056e57c703452ca89e9f3694ede2a173c13dbc6ace6fc918cc26f/contract.json' with { type: 'json' };
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
        table: 'render_artifact',
        columns: [
          col('byteSize', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('checksumSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mimeType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('renderJobId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('storageKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'render_job',
        columns: [
          col('compositionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contractVersion', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('durationMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('ffmpegVersion', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('finishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('frameRate', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('height', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outputFormat', 'text', {
            notNull: true,
            default: lit('MP4'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('progressPct', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sceneGraph', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sceneSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('QUEUED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('width', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('render_job_outputFormat_check_a3c3b920', '"outputFormat" IN (\'MP4\')'),
          checkExpression(
            'render_job_status_check_ba978c1e',
            "\"status\" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'render_artifact',
        constraint: 'render_artifact_renderJobId_key',
        columns: ['renderJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'render_artifact',
        index: 'render_artifact_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'render_job',
        index: 'render_job_compositionId_idx_b6aea72b',
        columns: ['compositionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'render_job',
        index: 'render_job_composition_created_idx',
        columns: ['compositionId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'render_job',
        index: 'render_job_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'render_job',
        index: 'render_job_project_status_created_idx',
        columns: ['projectId', 'status', 'createdAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'render_artifact',
        foreignKey: {
          name: 'render_artifact_renderJobId_fkey',
          columns: ['renderJobId'],
          references: { schema: 'public', table: 'render_job', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'render_job',
        foreignKey: {
          name: 'render_job_compositionId_fkey',
          columns: ['compositionId'],
          references: { schema: 'public', table: 'visual_composition', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
