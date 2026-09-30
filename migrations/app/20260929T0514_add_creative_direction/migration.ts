#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/333a850fb874e181e1780fecdc353ae59748391ecd9310b00659b3f50239f5dc/contract';
import endContract from '../../snapshots/333a850fb874e181e1780fecdc353ae59748391ecd9310b00659b3f50239f5dc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c8d1c07e8f5cfa633164cddeacf0580ffd507fce3ae63e40bdc0a4db0f0acc94/contract';
import startContract from '../../snapshots/c8d1c07e8f5cfa633164cddeacf0580ffd507fce3ae63e40bdc0a4db0f0acc94/contract.json' with { type: 'json' };
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
        table: 'creative_direction',
        columns: [
          col('angle', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('audienceAngle', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('brandVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('creativeRunId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('cta', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('editedByUser', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('emotionalAngle', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('hook', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('intelligenceVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('intentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('musicDirection', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('narrativeSummary', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('proofStrategy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rationale', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('soundDirection', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('strengthScore', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('thesis', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('visualStrategy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('voiceDirection', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'creative_direction_mode_check_3a33d9eb',
            "\"mode\" IN ('GUIDED', 'BALANCED', 'WILD')",
          ),
          checkExpression(
            'creative_direction_status_check_43a18074',
            "\"status\" IN ('DRAFT', 'SELECTED', 'REJECTED', 'ARCHIVED')",
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'creative_direction',
        index: 'creative_direction_intentId_idx_e8967b69',
        columns: ['intentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'creative_direction',
        index: 'creative_direction_intent_created_idx',
        columns: ['intentId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'creative_direction',
        index: 'creative_direction_intent_status_idx',
        columns: ['intentId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'creative_direction',
        index: 'creative_direction_project_idx',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'creative_direction',
        index: 'creative_direction_run_idx',
        columns: ['projectId', 'creativeRunId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'creative_direction',
        foreignKey: {
          name: 'creative_direction_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'creative_direction',
        foreignKey: {
          name: 'creative_direction_intentId_fkey',
          columns: ['intentId'],
          references: { schema: 'public', table: 'content_intent', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
