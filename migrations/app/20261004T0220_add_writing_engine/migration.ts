#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/21b5ecc822ef1c8d26b40dd24d974686729497d464d8ee6743c9d2f141f460e9/contract';
import startContract from '../../snapshots/21b5ecc822ef1c8d26b40dd24d974686729497d464d8ee6743c9d2f141f460e9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f2985e2bdf89ae4dcbf06d29c63712ea43888bd8a0d11959c63e6603a77a1283/contract';
import endContract from '../../snapshots/f2985e2bdf89ae4dcbf06d29c63712ea43888bd8a0d11959c63e6603a77a1283/contract.json' with { type: 'json' };
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
        table: 'writing_claim',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('documentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reasoning', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('REVIEW'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('variantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'writing_claim_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
          checkExpression(
            'writing_claim_status_check_70a7aa2b',
            "\"status\" IN ('GROUNDED', 'UNSUPPORTED', 'REVIEW')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'writing_document',
        columns: [
          col('audience', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('blockType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('brandVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contentSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contextSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contextSnapshot', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('directionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('intelligenceVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('intentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('language', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('length', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('objective', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sceneId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('selectedVariantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('storyboardId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
            'writing_document_blockType_check_71908e47',
            "\"blockType\" IN ('HEADLINE', 'HOOK', 'SUBHEAD', 'BODY', 'CAPTION', 'CTA', 'AD_COPY', 'PRODUCT_DESCRIPTION', 'SCRIPT', 'VOICEOVER')",
          ),
          checkExpression(
            'writing_document_length_check_e1e66252',
            "\"length\" IN ('SHORT', 'MEDIUM', 'LONG')",
          ),
          checkExpression(
            'writing_document_tone_check_9045ea36',
            "\"tone\" IN ('BRAND', 'PROFESSIONAL', 'FRIENDLY', 'PLAYFUL', 'BOLD', 'MINIMAL', 'TECHNICAL', 'CONVERSATIONAL')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'writing_generation_job',
        columns: [
          col('audience', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('blockType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contextSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contextSnapshot', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('documentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('finishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('generationRecipe', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('language', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('length', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('objective', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
          col('tone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('variantCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'writing_generation_job_blockType_check_71908e47',
            "\"blockType\" IN ('HEADLINE', 'HOOK', 'SUBHEAD', 'BODY', 'CAPTION', 'CTA', 'AD_COPY', 'PRODUCT_DESCRIPTION', 'SCRIPT', 'VOICEOVER')",
          ),
          checkExpression(
            'writing_generation_job_length_check_e1e66252',
            "\"length\" IN ('SHORT', 'MEDIUM', 'LONG')",
          ),
          checkExpression(
            'writing_generation_job_provider_check_1d241a04',
            "\"provider\" IN ('LOCAL_RULES', 'REMOTE_LLM')",
          ),
          checkExpression(
            'writing_generation_job_status_check_ba978c1e',
            "\"status\" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED')",
          ),
          checkExpression(
            'writing_generation_job_tone_check_9045ea36',
            "\"tone\" IN ('BRAND', 'PROFESSIONAL', 'FRIENDLY', 'PLAYFUL', 'BOLD', 'MINIMAL', 'TECHNICAL', 'CONVERSATIONAL')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'writing_variant',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('documentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instruction', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ordinal', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('selected', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('textSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'writing_variant',
        constraint: 'writing_variant_document_ordinal',
        columns: ['documentId', 'ordinal'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_claim',
        index: 'writing_claim_documentId_idx_825ef746',
        columns: ['documentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_claim',
        index: 'writing_claim_document_status_idx',
        columns: ['documentId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_claim',
        index: 'writing_claim_project_idx',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_claim',
        index: 'writing_claim_variant_idx',
        columns: ['variantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_document',
        index: 'writing_document_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_document',
        index: 'writing_document_project_block_idx',
        columns: ['projectId', 'blockType'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_document',
        index: 'writing_document_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_generation_job',
        index: 'writing_generation_job_documentId_idx_825ef746',
        columns: ['documentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_generation_job',
        index: 'writing_generation_job_document_created_idx',
        columns: ['documentId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_generation_job',
        index: 'writing_generation_job_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_generation_job',
        index: 'writing_generation_job_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_generation_job',
        index: 'writing_generation_job_project_status_created_idx',
        columns: ['projectId', 'status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'writing_variant',
        index: 'writing_variant_document_idx',
        columns: ['documentId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'writing_claim',
        foreignKey: {
          name: 'writing_claim_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'writing_claim',
        foreignKey: {
          name: 'writing_claim_documentId_fkey',
          columns: ['documentId'],
          references: { schema: 'public', table: 'writing_document', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'writing_claim',
        foreignKey: {
          name: 'writing_claim_variantId_fkey',
          columns: ['variantId'],
          references: { schema: 'public', table: 'writing_variant', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'writing_document',
        foreignKey: {
          name: 'writing_document_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'writing_generation_job',
        foreignKey: {
          name: 'writing_generation_job_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'writing_generation_job',
        foreignKey: {
          name: 'writing_generation_job_documentId_fkey',
          columns: ['documentId'],
          references: { schema: 'public', table: 'writing_document', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'writing_variant',
        foreignKey: {
          name: 'writing_variant_documentId_fkey',
          columns: ['documentId'],
          references: { schema: 'public', table: 'writing_document', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
