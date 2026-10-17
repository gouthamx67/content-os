#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/338846283391f49bc3968302c8edac2643e21a5d80ccf4cfebf4f68af5b1306e/contract';
import endContract from '../../snapshots/338846283391f49bc3968302c8edac2643e21a5d80ccf4cfebf4f68af5b1306e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b279fc3ac210c13e71f42c89be61f3ee6821b9dc10f6d5f3ab5a0ce51c38e31c/contract';
import startContract from '../../snapshots/b279fc3ac210c13e71f42c89be61f3ee6821b9dc10f6d5f3ab5a0ce51c38e31c/contract.json' with { type: 'json' };
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
        table: 'analytics_snapshot',
        columns: [
          col('asOf', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('collectedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('completeness', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('definition', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metricKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provenance', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('providerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('publicationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('unit', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('value', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('windowEnd', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('windowStart', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'optimization_recommendation',
        columns: [
          col('category', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidenceRationale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('dedupeKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('evidence', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('explanation', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('limitations', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('proposedChanges', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resultPublicationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('reviewedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('OPEN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('suggestedAction', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'optimization_recommendation_category_check_303df0ee',
            "\"category\" IN ('PERFORMANCE_OUTLIER', 'TIMING_WINDOW')",
          ),
          checkExpression(
            'optimization_recommendation_confidence_check_fefd3199',
            "\"confidence\" IN ('LOW', 'MEDIUM', 'HIGH')",
          ),
          checkExpression(
            'optimization_recommendation_status_check_9d39a3d0',
            "\"status\" IN ('OPEN', 'ACCEPTED', 'DISMISSED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'publication',
        columns: [
          col('analyticsClaimedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('analyticsCollectedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('analyticsErrorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('analyticsErrorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('analyticsRequestedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('attemptedCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('cancelledAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('connectionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalPostId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('externalPublishedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('externalUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastErrorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastErrorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastErrorRetryable', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
          col('originPublicationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('publishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('recommendationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scheduledFor', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('scheduledTimezone', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceRevision', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceSnapshot', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('validatedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('validation', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'publication_sourceType_check_dbef7823',
            "\"sourceType\" IN ('WRITING_DOCUMENT', 'CAMPAIGN_DELIVERABLE')",
          ),
          checkExpression(
            'publication_status_check_a23779dd',
            "\"status\" IN ('DRAFT', 'READY', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'AMBIGUOUS', 'AUTH_REQUIRED', 'STALE', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'publish_attempt',
        columns: [
          col('attemptNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('finishedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('outcome', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('providerRequestId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('publicationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('retryable', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
          col('startedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'publish_attempt_outcome_check_b73358e1',
            "\"outcome\" IN ('SUCCEEDED', 'FAILED', 'AMBIGUOUS')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'publishing_connection',
        columns: [
          col('capabilities', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('connectedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('credentialCiphertext', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('credentialExpiresAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('disconnectedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalAccountId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastCheckedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('lastErrorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('providerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scopes', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('CONNECTED'),
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
            'publishing_connection_status_check_711b8ed1',
            "\"status\" IN ('CONNECTED', 'AUTH_REQUIRED', 'REVOKED', 'DISCONNECTED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'analytics_snapshot',
        constraint: 'analytics_snapshot_unique_point',
        columns: ['publicationId', 'metricKey', 'collectedAt'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'optimization_recommendation',
        constraint: 'optimization_recommendation_dedupe',
        columns: ['projectId', 'dedupeKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'publication',
        constraint: 'publication_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'publish_attempt',
        constraint: 'publish_attempt_publication_number',
        columns: ['publicationId', 'attemptNumber'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'publishing_connection',
        constraint: 'publishing_connection_unique_account',
        columns: ['projectId', 'providerId', 'externalAccountId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'analytics_snapshot',
        index: 'analytics_snapshot_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'analytics_snapshot',
        index: 'analytics_snapshot_project_collected_idx',
        columns: ['projectId', 'collectedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'analytics_snapshot',
        index: 'analytics_snapshot_project_metric_idx',
        columns: ['projectId', 'metricKey', 'collectedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'analytics_snapshot',
        index: 'analytics_snapshot_publicationId_idx_9a426279',
        columns: ['publicationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'optimization_recommendation',
        index: 'optimization_recommendation_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'optimization_recommendation',
        index: 'optimization_recommendation_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_analytics_requested_idx',
        columns: ['analyticsRequestedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_connectionId_idx_b3eeb6ac',
        columns: ['connectionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_project_source_idx',
        columns: ['projectId', 'sourceType', 'sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_status_created_idx',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publication',
        index: 'publication_status_scheduled_idx',
        columns: ['status', 'scheduledFor'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publish_attempt',
        index: 'publish_attempt_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publish_attempt',
        index: 'publish_attempt_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publish_attempt',
        index: 'publish_attempt_publicationId_idx_9a426279',
        columns: ['publicationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publishing_connection',
        index: 'publishing_connection_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'publishing_connection',
        index: 'publishing_connection_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'analytics_snapshot',
        foreignKey: {
          name: 'analytics_snapshot_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'analytics_snapshot',
        foreignKey: {
          name: 'analytics_snapshot_publicationId_fkey',
          columns: ['publicationId'],
          references: { schema: 'public', table: 'publication', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'optimization_recommendation',
        foreignKey: {
          name: 'optimization_recommendation_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'publication',
        foreignKey: {
          name: 'publication_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'publication',
        foreignKey: {
          name: 'publication_connectionId_fkey',
          columns: ['connectionId'],
          references: { schema: 'public', table: 'publishing_connection', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'publish_attempt',
        foreignKey: {
          name: 'publish_attempt_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'publish_attempt',
        foreignKey: {
          name: 'publish_attempt_publicationId_fkey',
          columns: ['publicationId'],
          references: { schema: 'public', table: 'publication', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'publishing_connection',
        foreignKey: {
          name: 'publishing_connection_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
