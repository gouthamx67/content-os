#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/17230d27cc3d7a50b70c13fe442443af177ae4fb207fc6ebc4ebad35bc992438/contract';
import startContract from '../../snapshots/17230d27cc3d7a50b70c13fe442443af177ae4fb207fc6ebc4ebad35bc992438/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/98425fda0ad4d4e5ef6813efa622e8b5dc65d50103d1f5c22f47cbc55825b115/contract';
import endContract from '../../snapshots/98425fda0ad4d4e5ef6813efa622e8b5dc65d50103d1f5c22f47cbc55825b115/contract.json' with { type: 'json' };
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
        table: 'motion_keyframe',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('easing', 'text', {
            notNull: true,
            default: lit('LINEAR'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('fromValue', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('layerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('property', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('timeMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('toValue', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'motion_keyframe_easing_check_9364cc02',
            "\"easing\" IN ('LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT')",
          ),
          checkExpression(
            'motion_keyframe_property_check_93640a69',
            "\"property\" IN ('X', 'Y', 'SCALE', 'ROTATION', 'OPACITY')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'visual_composition',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('durationMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('frameRate', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('height', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('shotId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
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
          checkExpression(
            'visual_composition_status_check_1d0cbbdd',
            "\"status\" IN ('DRAFT', 'READY', 'ARCHIVED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'visual_effect',
        columns: [
          col('amount', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('enabled', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('layerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'visual_effect_type_check_f98ea148',
            "\"type\" IN ('BLUR', 'BRIGHTNESS', 'CONTRAST', 'SATURATION', 'GRAYSCALE')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'visual_layer',
        columns: [
          col('assetRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('compositionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('cropHeight', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('cropWidth', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('cropX', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('cropY', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('fit', 'text', {
            notNull: true,
            default: lit('CONTAIN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('height', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('opacity', 'float8', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('rotation', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('textContent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('visible', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('width', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('x', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('y', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('zIndex', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'visual_layer_fit_check_70c6746e',
            "\"fit\" IN ('CONTAIN', 'COVER', 'STRETCH')",
          ),
          checkExpression(
            'visual_layer_type_check_832b20e8',
            "\"type\" IN ('MEDIA', 'TEXT', 'SHAPE', 'GROUP')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'motion_keyframe',
        constraint: 'motion_keyframe_layer_property_time_key',
        columns: ['layerId', 'property', 'timeMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'motion_keyframe',
        index: 'motion_keyframe_layerId_idx_d4e47757',
        columns: ['layerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'motion_keyframe',
        index: 'motion_keyframe_layer_time_idx',
        columns: ['layerId', 'timeMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'visual_composition',
        index: 'visual_composition_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'visual_composition',
        index: 'visual_composition_project_idx',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'visual_composition',
        index: 'visual_composition_project_shot_idx',
        columns: ['projectId', 'shotId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'visual_composition',
        index: 'visual_composition_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'visual_effect',
        index: 'visual_effect_layer_idx',
        columns: ['layerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'visual_effect',
        index: 'visual_effect_layer_type_idx',
        columns: ['layerId', 'type'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'visual_layer',
        index: 'visual_layer_composition_idx',
        columns: ['compositionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'visual_layer',
        index: 'visual_layer_composition_z_idx',
        columns: ['compositionId', 'zIndex'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'motion_keyframe',
        foreignKey: {
          name: 'motion_keyframe_layerId_fkey',
          columns: ['layerId'],
          references: { schema: 'public', table: 'visual_layer', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'visual_composition',
        foreignKey: {
          name: 'visual_composition_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'visual_effect',
        foreignKey: {
          name: 'visual_effect_layerId_fkey',
          columns: ['layerId'],
          references: { schema: 'public', table: 'visual_layer', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'visual_layer',
        foreignKey: {
          name: 'visual_layer_compositionId_fkey',
          columns: ['compositionId'],
          references: { schema: 'public', table: 'visual_composition', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
