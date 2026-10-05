#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/760ab4923672cf1bcac674e1046a06a8fd7d9d9c5661f1050f74a11d6874df43/contract';
import endContract from '../../snapshots/760ab4923672cf1bcac674e1046a06a8fd7d9d9c5661f1050f74a11d6874df43/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f2985e2bdf89ae4dcbf06d29c63712ea43888bd8a0d11959c63e6603a77a1283/contract';
import startContract from '../../snapshots/f2985e2bdf89ae4dcbf06d29c63712ea43888bd8a0d11959c63e6603a77a1283/contract.json' with { type: 'json' };
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
        table: 'adaptation_batch',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('finishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('progressPct', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceSnapshot', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('QUEUED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('targetCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'adaptation_batch_sourceType_check_63f55b86',
            "\"sourceType\" IN ('WRITING_VARIANT', 'GENERATED_IMAGE', 'VISUAL_COMPOSITION')",
          ),
          checkExpression(
            'adaptation_batch_status_check_dc5a4cf0',
            "\"status\" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'adaptation_job',
        columns: [
          col('batchId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('finishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('formatId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outputByteSize', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('outputChecksumSha256', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('outputHeight', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('outputMimeType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('outputStorageKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('outputText', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('outputWidth', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('platformId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('progressPct', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipe', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipeSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('renderJobId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('requestedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'adaptation_job_kind_check_c3fab27c',
            "\"kind\" IN ('COPY', 'IMAGE', 'VIDEO')",
          ),
          checkExpression(
            'adaptation_job_status_check_a62b1769',
            "\"status\" IN ('QUEUED', 'RUNNING', 'WAITING_RENDER', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'adaptation_job',
        constraint: 'adaptation_job_batch_format_platform',
        columns: ['batchId', 'formatId', 'platformId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_batch',
        index: 'adaptation_batch_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_batch',
        index: 'adaptation_batch_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_batch',
        index: 'adaptation_batch_project_status_created_idx',
        columns: ['projectId', 'status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_job',
        index: 'adaptation_job_batchId_idx_84d4b0b9',
        columns: ['batchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_job',
        index: 'adaptation_job_batch_created_idx',
        columns: ['batchId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_job',
        index: 'adaptation_job_batch_status_idx',
        columns: ['batchId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_job',
        index: 'adaptation_job_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_job',
        index: 'adaptation_job_project_status_created_idx',
        columns: ['projectId', 'status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_job',
        index: 'adaptation_job_render_idx',
        columns: ['renderJobId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'adaptation_batch',
        foreignKey: {
          name: 'adaptation_batch_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'adaptation_job',
        foreignKey: {
          name: 'adaptation_job_batchId_fkey',
          columns: ['batchId'],
          references: { schema: 'public', table: 'adaptation_batch', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'adaptation_job',
        foreignKey: {
          name: 'adaptation_job_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
