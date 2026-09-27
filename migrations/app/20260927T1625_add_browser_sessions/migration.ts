#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/17c508283b77d73d869b73dd8127bb0b3f0731e0e08acfff84fdeccb2bdefa4e/contract';
import endContract from '../../snapshots/17c508283b77d73d869b73dd8127bb0b3f0731e0e08acfff84fdeccb2bdefa4e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/aedf1b92fcb081bdf4a12994f49c1287357617f040e5c8c7cb6657392de22dfa/contract';
import startContract from '../../snapshots/aedf1b92fcb081bdf4a12994f49c1287357617f040e5c8c7cb6657392de22dfa/contract.json' with { type: 'json' };
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
      this.dropCheckConstraint({
        schema: 'public',
        table: 'intelligence_evidence',
        constraint: 'intelligence_evidence_kind_check_91a4a511',
      }),
      this.createTable({
        schema: 'public',
        table: 'browser_observation',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stateHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stepOrder', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'browser_session',
        columns: [
          col('actionCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currentUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('endedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('goal', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('initialUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pageCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('planner', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('plannerModel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('QUEUED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('successCriteria', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('targetClass', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetSourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'browser_session_status_check_be53ae1d',
            "\"status\" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')",
          ),
          checkExpression(
            'browser_session_targetClass_check_1846c42f',
            "\"targetClass\" IN ('PUBLIC', 'CONTROLLED_LOCAL')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'browser_step',
        columns: [
          col('actionType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('completedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('durationMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('inputSummary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('result', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('stateHashAfter', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('stateHashBefore', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('targetSummary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'browser_step_status_check_b616a972',
            "\"status\" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'browser_step',
        constraint: 'browser_step_order',
        columns: ['sessionId', 'order'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'intelligence_evidence',
        constraint: 'intelligence_evidence_kind_check_113d84e9',
        expression:
          "\"kind\" IN ('SOURCE_FRAGMENT', 'REPOSITORY_FILE', 'URL_SECTION', 'DOCUMENT_SECTION', 'IMAGE_REGION', 'VIDEO_TIMESTAMP', 'AUDIO_TIMESTAMP', 'EXTRACTED_METADATA', 'BROWSER_INTERACTION')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'browser_observation',
        index: 'browser_observation_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'browser_observation',
        index: 'browser_observation_session_step_idx',
        columns: ['sessionId', 'stepOrder'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'browser_session',
        index: 'browser_session_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'browser_session',
        index: 'browser_session_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'browser_session',
        index: 'browser_session_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'browser_session',
        index: 'browser_session_targetSourceId_idx_385adefa',
        columns: ['targetSourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'browser_step',
        index: 'browser_step_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'browser_observation',
        foreignKey: {
          name: 'browser_observation_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'browser_session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'browser_session',
        foreignKey: {
          name: 'browser_session_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'browser_session',
        foreignKey: {
          name: 'browser_session_targetSourceId_fkey',
          columns: ['targetSourceId'],
          references: { schema: 'public', table: 'source', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'browser_step',
        foreignKey: {
          name: 'browser_step_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'browser_session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
