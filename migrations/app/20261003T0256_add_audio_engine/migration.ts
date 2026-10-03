#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9bb58cae2e25d49890ce74030507a07e2fef44b028f7cfe7830165e74d4b3bd1/contract';
import endContract from '../../snapshots/9bb58cae2e25d49890ce74030507a07e2fef44b028f7cfe7830165e74d4b3bd1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e4a33fc5f7d056e57c703452ca89e9f3694ede2a173c13dbc6ace6fc918cc26f/contract';
import startContract from '../../snapshots/e4a33fc5f7d056e57c703452ca89e9f3694ede2a173c13dbc6ace6fc918cc26f/contract.json' with { type: 'json' };
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
        table: 'audio_artifact',
        columns: [
          col('audioRenderJobId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
          col('storageKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'audio_automation_point',
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
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('property', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('timeMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('trackId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('value', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'audio_automation_point_easing_check_9364cc02',
            "\"easing\" IN ('LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT')",
          ),
          checkExpression(
            'audio_automation_point_property_check_644a0ba3',
            '"property" IN (\'VOLUME_DB\')',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'audio_composition',
        columns: [
          col('channels', 'int4', {
            notNull: true,
            default: lit(2),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('compositionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('durationMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sampleRate', 'int4', {
            notNull: true,
            default: lit(48000),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
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
            'audio_composition_status_check_1d0cbbdd',
            "\"status\" IN ('DRAFT', 'READY', 'ARCHIVED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'audio_render_job',
        columns: [
          col('audioCompositionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('audioGraph', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('audioSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('channels', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
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
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outputFormat', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('progressPct', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sampleRate', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
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
          col('videoRenderJobId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'audio_render_job_outputFormat_check_60ea69e0',
            "\"outputFormat\" IN ('WAV', 'MP4')",
          ),
          checkExpression(
            'audio_render_job_status_check_ba978c1e',
            "\"status\" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'audio_track',
        columns: [
          col('audioCompositionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('duckVoiceoverDb', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('durationMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('fadeInMs', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('fadeOutMs', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('gainDb', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mute', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pan', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('solo', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('sourceOffsetMs', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('sourceRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startMs', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'audio_track_kind_check_796d0837',
            "\"kind\" IN ('VOICEOVER', 'MUSIC', 'SFX', 'AMBIENCE')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'muxed_video_artifact',
        columns: [
          col('audioRenderJobId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
          col('storageKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('videoRenderJobId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'audio_artifact',
        constraint: 'audio_artifact_audioRenderJobId_key',
        columns: ['audioRenderJobId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'audio_automation_point',
        constraint: 'audio_automation_track_property_time_key',
        columns: ['trackId', 'property', 'timeMs'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'audio_composition',
        constraint: 'audio_composition_compositionId_key',
        columns: ['compositionId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'muxed_video_artifact',
        constraint: 'muxed_video_artifact_audioRenderJobId_key',
        columns: ['audioRenderJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_artifact',
        index: 'audio_artifact_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_automation_point',
        index: 'audio_automation_point_trackId_idx_8b560769',
        columns: ['trackId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_automation_point',
        index: 'audio_automation_track_property_time_idx',
        columns: ['trackId', 'property', 'timeMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_composition',
        index: 'audio_composition_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_composition',
        index: 'audio_composition_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_render_job',
        index: 'audio_render_job_audioCompositionId_idx_6598b581',
        columns: ['audioCompositionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_render_job',
        index: 'audio_render_job_composition_created_idx',
        columns: ['audioCompositionId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_render_job',
        index: 'audio_render_job_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_render_job',
        index: 'audio_render_job_project_status_created_idx',
        columns: ['projectId', 'status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_track',
        index: 'audio_track_audioCompositionId_idx_6598b581',
        columns: ['audioCompositionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_track',
        index: 'audio_track_composition_kind_idx',
        columns: ['audioCompositionId', 'kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audio_track',
        index: 'audio_track_composition_start_idx',
        columns: ['audioCompositionId', 'startMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'muxed_video_artifact',
        index: 'muxed_video_artifact_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'muxed_video_artifact',
        index: 'muxed_video_artifact_project_video_idx',
        columns: ['projectId', 'videoRenderJobId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'audio_artifact',
        foreignKey: {
          name: 'audio_artifact_audioRenderJobId_fkey',
          columns: ['audioRenderJobId'],
          references: { schema: 'public', table: 'audio_render_job', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'audio_automation_point',
        foreignKey: {
          name: 'audio_automation_point_trackId_fkey',
          columns: ['trackId'],
          references: { schema: 'public', table: 'audio_track', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'audio_composition',
        foreignKey: {
          name: 'audio_composition_compositionId_fkey',
          columns: ['compositionId'],
          references: { schema: 'public', table: 'visual_composition', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'audio_render_job',
        foreignKey: {
          name: 'audio_render_job_audioCompositionId_fkey',
          columns: ['audioCompositionId'],
          references: { schema: 'public', table: 'audio_composition', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'audio_track',
        foreignKey: {
          name: 'audio_track_audioCompositionId_fkey',
          columns: ['audioCompositionId'],
          references: { schema: 'public', table: 'audio_composition', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'muxed_video_artifact',
        foreignKey: {
          name: 'muxed_video_artifact_audioRenderJobId_fkey',
          columns: ['audioRenderJobId'],
          references: { schema: 'public', table: 'audio_render_job', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
