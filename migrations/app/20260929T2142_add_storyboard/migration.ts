#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/333a850fb874e181e1780fecdc353ae59748391ecd9310b00659b3f50239f5dc/contract';
import startContract from '../../snapshots/333a850fb874e181e1780fecdc353ae59748391ecd9310b00659b3f50239f5dc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c6daf43392b955612357b182d09b85aa28a184de543914b142b8075d05a0cee0/contract';
import endContract from '../../snapshots/c6daf43392b955612357b182d09b85aa28a184de543914b142b8075d05a0cee0/contract.json' with { type: 'json' };
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
        table: 'storyboard',
        columns: [
          col('actualDurationMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('aspectRatio', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('brandVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('creativeRunId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('directionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('intelligenceVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('intentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('platforms', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('targetDurationMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('version', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'storyboard_platforms_elem_not_null_53a1bdb5',
            'array_position("platforms", NULL) IS NULL',
          ),
          checkExpression(
            'storyboard_status_check_e8dc73a3',
            "\"status\" IN ('DRAFT', 'READY', 'SELECTED', 'LOCKED', 'ARCHIVED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'storyboard_scene',
        columns: [
          col('claimIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('durationMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('endMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('featureIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('musicDirection', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('purpose', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sfxCues', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('shots', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('storyboardId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('textOverlays', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('transitionIn', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('transitionOut', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('voiceoverPlan', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('workflowIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'storyboard_scene_claimIds_elem_not_null_40174445',
            'array_position("claimIds", NULL) IS NULL',
          ),
          checkExpression(
            'storyboard_scene_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'storyboard_scene_featureIds_elem_not_null_b2754430',
            'array_position("featureIds", NULL) IS NULL',
          ),
          checkExpression('storyboard_scene_positive_duration_8886a046', '"endMs" > "startMs"'),
          checkExpression(
            'storyboard_scene_type_check_08f7327c',
            "\"type\" IN ('HOOK', 'PROBLEM', 'REVEAL', 'PRODUCT_DEMO', 'WORKFLOW', 'FEATURE', 'TRANSFORMATION', 'PROOF', 'SOCIAL_PROOF', 'CTA', 'TRANSITION', 'CUSTOM')",
          ),
          checkExpression(
            'storyboard_scene_workflowIds_elem_not_null_86e06725',
            'array_position("workflowIds", NULL) IS NULL',
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'storyboard_scene',
        constraint: 'storyboard_scene_order',
        columns: ['storyboardId', 'order'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'storyboard',
        index: 'storyboard_direction_idx',
        columns: ['directionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'storyboard',
        index: 'storyboard_intent_idx',
        columns: ['intentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'storyboard',
        index: 'storyboard_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'storyboard',
        index: 'storyboard_project_idx',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'storyboard',
        index: 'storyboard_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'storyboard_scene',
        index: 'storyboard_scene_storyboard_idx',
        columns: ['storyboardId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'storyboard',
        foreignKey: {
          name: 'storyboard_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'storyboard',
        foreignKey: {
          name: 'storyboard_intentId_fkey',
          columns: ['intentId'],
          references: { schema: 'public', table: 'content_intent', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'storyboard',
        foreignKey: {
          name: 'storyboard_directionId_fkey',
          columns: ['directionId'],
          references: { schema: 'public', table: 'creative_direction', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'storyboard_scene',
        foreignKey: {
          name: 'storyboard_scene_storyboardId_fkey',
          columns: ['storyboardId'],
          references: { schema: 'public', table: 'storyboard', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
