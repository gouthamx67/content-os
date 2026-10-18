#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/338846283391f49bc3968302c8edac2643e21a5d80ccf4cfebf4f68af5b1306e/contract';
import startContract from '../../snapshots/338846283391f49bc3968302c8edac2643e21a5d80ccf4cfebf4f68af5b1306e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/770fc360e70d4287860c215b26c3eed4bdf2ee40199daa3ea9082cb51cefec7d/contract';
import endContract from '../../snapshots/770fc360e70d4287860c215b26c3eed4bdf2ee40199daa3ea9082cb51cefec7d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'rate_limit_event',
        columns: [
          col('bucketKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'worker_heartbeat',
        columns: [
          col('cancelled', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('failed', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastEvent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastTickAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('processed', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('startedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('succeeded', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('workerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['workerId'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'adaptation_job',
        column: col('leaseExpiresAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'audio_render_job',
        column: col('leaseExpiresAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'image_generation_job',
        column: col('leaseExpiresAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'publication',
        column: col('leaseExpiresAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'render_job',
        column: col('leaseExpiresAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'writing_generation_job',
        column: col('leaseExpiresAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_job',
        index: 'adaptation_job_status_created_idx',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adaptation_job',
        index: 'adaptation_job_status_lease_idx',
        columns: ['status', 'leaseExpiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_render_job',
        index: 'audio_render_job_status_created_idx',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_render_job',
        index: 'audio_render_job_status_lease_idx',
        columns: ['status', 'leaseExpiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'image_generation_job',
        index: 'image_generation_job_status_created_idx',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'image_generation_job',
        index: 'image_generation_job_status_lease_idx',
        columns: ['status', 'leaseExpiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_status_lease_idx',
        columns: ['status', 'leaseExpiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'rate_limit_event',
        index: 'rate_limit_event_bucket_created_idx',
        columns: ['bucketKey', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'rate_limit_event',
        index: 'rate_limit_event_created_idx',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'render_job',
        index: 'render_job_status_created_idx',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'render_job',
        index: 'render_job_status_lease_idx',
        columns: ['status', 'leaseExpiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'worker_heartbeat',
        index: 'worker_heartbeat_kind_idx',
        columns: ['kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'worker_heartbeat',
        index: 'worker_heartbeat_last_tick_idx',
        columns: ['lastTickAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_generation_job',
        index: 'writing_generation_job_status_created_idx',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_generation_job',
        index: 'writing_generation_job_status_lease_idx',
        columns: ['status', 'leaseExpiresAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
