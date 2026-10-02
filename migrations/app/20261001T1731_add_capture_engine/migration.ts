#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/17230d27cc3d7a50b70c13fe442443af177ae4fb207fc6ebc4ebad35bc992438/contract';
import endContract from '../../snapshots/17230d27cc3d7a50b70c13fe442443af177ae4fb207fc6ebc4ebad35bc992438/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f5537d84fb0917df614370dde52172e76a7de4e5a46372d43da01593b3d0b0da/contract';
import startContract from '../../snapshots/f5537d84fb0917df614370dde52172e76a7de4e5a46372d43da01593b3d0b0da/contract.json' with { type: 'json' };
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
        table: 'capture_session',
        columns: [
          col('completedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('storyboardId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'capture_session_status_check_5c483c16',
            "\"status\" IN ('DRAFT', 'ACTIVE', 'REVIEW', 'COMPLETED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'capture_take',
        columns: [
          col('acceptedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('byteSize', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('checksumSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('deletedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('durationMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('frameRate', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('height', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('mimeType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('originalName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rejectedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('shotId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('READY'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('storageKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('width', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'capture_take_mode_check_529dc74a',
            "\"mode\" IN ('CAMERA', 'MICROPHONE', 'SCREEN', 'FILE')",
          ),
          checkExpression(
            'capture_take_status_check_4b2e0566',
            "\"status\" IN ('READY', 'ACCEPTED', 'REJECTED', 'DELETED')",
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'capture_session',
        index: 'capture_session_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'capture_session',
        index: 'capture_session_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'capture_session',
        index: 'capture_session_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'capture_take',
        index: 'capture_take_project_session_created_idx',
        columns: ['projectId', 'sessionId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'capture_take',
        index: 'capture_take_project_shot_idx',
        columns: ['projectId', 'shotId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'capture_take',
        index: 'capture_take_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'capture_take',
        index: 'capture_take_session_status_idx',
        columns: ['sessionId', 'status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'capture_session',
        foreignKey: {
          name: 'capture_session_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'capture_take',
        foreignKey: {
          name: 'capture_take_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'capture_session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
