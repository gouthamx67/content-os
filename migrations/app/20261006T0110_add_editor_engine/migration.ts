#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0c8ef36eaa0302e144bcc32e417313c5e2822c0da0aaab118465a592d74b08fa/contract';
import endContract from '../../snapshots/0c8ef36eaa0302e144bcc32e417313c5e2822c0da0aaab118465a592d74b08fa/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/760ab4923672cf1bcac674e1046a06a8fd7d9d9c5661f1050f74a11d6874df43/contract';
import startContract from '../../snapshots/760ab4923672cf1bcac674e1046a06a8fd7d9d9c5661f1050f74a11d6874df43/contract.json' with { type: 'json' };
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
        table: 'editor_document',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('currentRevisionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('documentVersion', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
            'editor_document_status_check_1d0cbbdd',
            "\"status\" IN ('DRAFT', 'READY', 'ARCHIVED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'editor_node',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('documentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('parentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sortIndex', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
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
            'editor_node_type_check_9ab11ff3',
            "\"type\" IN ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'SHAPE', 'GROUP')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'editor_revision',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('documentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('operationPayload', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('operationType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provenanceSourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('restoredFromRevisionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('revisionNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('snapshot', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('snapshotSha256', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'editor_revision_operationType_check_ecf179b5',
            "\"operationType\" IN ('CREATE', 'SET_TEXT', 'REPLACE_ASSET', 'MOVE', 'RESIZE', 'ROTATE', 'SET_OPACITY', 'SET_STYLE', 'TRIM', 'SET_GAIN', 'SET_MUTE', 'SET_VISIBILITY', 'REORDER', 'DUPLICATE', 'DELETE', 'SPLIT', 'RESTORE')",
          ),
          checkExpression(
            'editor_revision_provenanceSourceIds_elem_not_null_4aac0ed6',
            'array_position("provenanceSourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'editor_revision',
        constraint: 'editor_revision_document_number',
        columns: ['documentId', 'revisionNumber'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_document',
        index: 'editor_document_current_revision_idx',
        columns: ['currentRevisionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_document',
        index: 'editor_document_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_document',
        index: 'editor_document_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_node',
        index: 'editor_node_documentId_idx_825ef746',
        columns: ['documentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_node',
        index: 'editor_node_document_parent_sort_idx',
        columns: ['documentId', 'parentId', 'sortIndex'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_node',
        index: 'editor_node_parentId_idx_6a68f597',
        columns: ['parentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_revision',
        index: 'editor_revision_documentId_idx_825ef746',
        columns: ['documentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_revision',
        index: 'editor_revision_document_created_idx',
        columns: ['documentId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_revision',
        index: 'editor_revision_document_source_idx',
        columns: ['documentId', 'sourceType', 'sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'editor_revision',
        index: 'editor_revision_restored_from_idx',
        columns: ['restoredFromRevisionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'editor_document',
        foreignKey: {
          name: 'editor_document_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'editor_document',
        foreignKey: {
          name: 'editor_document_currentRevisionId_fkey',
          columns: ['currentRevisionId'],
          references: { schema: 'public', table: 'editor_revision', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'editor_node',
        foreignKey: {
          name: 'editor_node_documentId_fkey',
          columns: ['documentId'],
          references: { schema: 'public', table: 'editor_document', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'editor_node',
        foreignKey: {
          name: 'editor_node_parentId_fkey',
          columns: ['parentId'],
          references: { schema: 'public', table: 'editor_node', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'editor_revision',
        foreignKey: {
          name: 'editor_revision_documentId_fkey',
          columns: ['documentId'],
          references: { schema: 'public', table: 'editor_document', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'editor_revision',
        foreignKey: {
          name: 'editor_revision_restoredFromRevisionId_fkey',
          columns: ['restoredFromRevisionId'],
          references: { schema: 'public', table: 'editor_revision', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
