#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/21b5ecc822ef1c8d26b40dd24d974686729497d464d8ee6743c9d2f141f460e9/contract';
import endContract from '../../snapshots/21b5ecc822ef1c8d26b40dd24d974686729497d464d8ee6743c9d2f141f460e9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9bb58cae2e25d49890ce74030507a07e2fef44b028f7cfe7830165e74d4b3bd1/contract';
import startContract from '../../snapshots/9bb58cae2e25d49890ce74030507a07e2fef44b028f7cfe7830165e74d4b3bd1/contract.json' with { type: 'json' };
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
        table: 'generated_image_asset',
        columns: [
          col('byteSize', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('checksumSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('deletedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('generationJobId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('graphicDocumentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('height', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('mimeType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outputFormat', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('storageKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('transparent', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('width', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'generated_image_asset_outputFormat_check_85875664',
            "\"outputFormat\" IN ('PNG', 'JPEG')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'graphic_document',
        columns: [
          col('contractVersion', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('deletedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('designGraph', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('designGraphHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('height', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outputFormat', 'text', {
            notNull: true,
            default: lit('PNG'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('templateType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('transparent', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
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
            'graphic_document_outputFormat_check_85875664',
            "\"outputFormat\" IN ('PNG', 'JPEG')",
          ),
          checkExpression(
            'graphic_document_templateType_check_769a6e6c',
            "\"templateType\" IN ('PRODUCT_HERO', 'FEATURE_CALLOUT', 'QUOTE_CARD', 'SOCIAL_POST', 'PROMO_CARD')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'image_generation_job',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('finishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('generationRecipe', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('graphicDocumentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('height', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outputFormat', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('progressPct', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('prompt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('providerJobId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('providerModel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('providerVersion', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('recipeSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('QUEUED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('transparent', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
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
            'image_generation_job_outputFormat_check_85875664',
            "\"outputFormat\" IN ('PNG', 'JPEG')",
          ),
          checkExpression(
            'image_generation_job_provider_check_dfff8216',
            "\"provider\" IN ('LOCAL_GRAPHIC', 'REMOTE_IMAGE')",
          ),
          checkExpression(
            'image_generation_job_status_check_ba978c1e',
            "\"status\" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED')",
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generated_image_asset',
        index: 'generated_image_asset_generationJobId_idx_486d342e',
        columns: ['generationJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generated_image_asset',
        index: 'generated_image_asset_graphicDocumentId_idx_b2981756',
        columns: ['graphicDocumentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generated_image_asset',
        index: 'generated_image_asset_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generated_image_asset',
        index: 'generated_image_asset_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generated_image_asset',
        index: 'generated_image_asset_project_document_idx',
        columns: ['projectId', 'graphicDocumentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generated_image_asset',
        index: 'generated_image_asset_project_job_idx',
        columns: ['projectId', 'generationJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'graphic_document',
        index: 'graphic_document_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'graphic_document',
        index: 'graphic_document_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'graphic_document',
        index: 'graphic_document_project_template_idx',
        columns: ['projectId', 'templateType'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'image_generation_job',
        index: 'image_generation_job_document_created_idx',
        columns: ['graphicDocumentId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'image_generation_job',
        index: 'image_generation_job_graphicDocumentId_idx_b2981756',
        columns: ['graphicDocumentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'image_generation_job',
        index: 'image_generation_job_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'image_generation_job',
        index: 'image_generation_job_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'image_generation_job',
        index: 'image_generation_job_project_status_created_idx',
        columns: ['projectId', 'status', 'createdAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'generated_image_asset',
        foreignKey: {
          name: 'generated_image_asset_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'generated_image_asset',
        foreignKey: {
          name: 'generated_image_asset_generationJobId_fkey',
          columns: ['generationJobId'],
          references: { schema: 'public', table: 'image_generation_job', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'generated_image_asset',
        foreignKey: {
          name: 'generated_image_asset_graphicDocumentId_fkey',
          columns: ['graphicDocumentId'],
          references: { schema: 'public', table: 'graphic_document', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'graphic_document',
        foreignKey: {
          name: 'graphic_document_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'image_generation_job',
        foreignKey: {
          name: 'image_generation_job_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'image_generation_job',
        foreignKey: {
          name: 'image_generation_job_graphicDocumentId_fkey',
          columns: ['graphicDocumentId'],
          references: { schema: 'public', table: 'graphic_document', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
