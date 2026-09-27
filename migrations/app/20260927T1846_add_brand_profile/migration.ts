#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/17c508283b77d73d869b73dd8127bb0b3f0731e0e08acfff84fdeccb2bdefa4e/contract';
import startContract from '../../snapshots/17c508283b77d73d869b73dd8127bb0b3f0731e0e08acfff84fdeccb2bdefa4e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7154ae40f2635aa7ace0fa457b8cda3a5f23c55c7113ebcc66c5e7d4cc59fd0f/contract';
import endContract from '../../snapshots/7154ae40f2635aa7ace0fa457b8cda3a5f23c55c7113ebcc66c5e7d4cc59fd0f/contract.json' with { type: 'json' };
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
        table: 'brand_asset',
        columns: [
          col('assetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('basis', 'text', {
            notNull: true,
            default: lit('RECOGNIZED_ASSET'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('LOW'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('origin', 'text', {
            notNull: true,
            default: lit('EXTRACTED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('profileId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'brand_asset_basis_check_0cb76274',
            "\"basis\" IN ('INFERENCE', 'GENERAL_EXTRACTION', 'RECOGNIZED_ASSET', 'DESIGN_TOKEN', 'EXPLICIT_GUIDELINE', 'USER')",
          ),
          checkExpression(
            'brand_asset_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'brand_asset_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'brand_asset_origin_check_4f78d06c',
            "\"origin\" IN ('EXTRACTED', 'INFERRED', 'USER')",
          ),
          checkExpression(
            'brand_asset_role_check_c9adb556',
            "\"role\" IN ('LOGO', 'PRIMARY_LOGO', 'MARK', 'WORDMARK', 'ICON', 'FAVICON', 'PATTERN', 'TEXTURE', 'ILLUSTRATION', 'PHOTOGRAPHY_STYLE')",
          ),
          checkExpression(
            'brand_asset_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'brand_color',
        columns: [
          col('basis', 'text', {
            notNull: true,
            default: lit('GENERAL_EXTRACTION'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('LOW'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('hex', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('origin', 'text', {
            notNull: true,
            default: lit('EXTRACTED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('profileId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'brand_color_basis_check_0cb76274',
            "\"basis\" IN ('INFERENCE', 'GENERAL_EXTRACTION', 'RECOGNIZED_ASSET', 'DESIGN_TOKEN', 'EXPLICIT_GUIDELINE', 'USER')",
          ),
          checkExpression(
            'brand_color_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'brand_color_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'brand_color_origin_check_4f78d06c',
            "\"origin\" IN ('EXTRACTED', 'INFERRED', 'USER')",
          ),
          checkExpression(
            'brand_color_role_check_5c11cb2c',
            "\"role\" IN ('PRIMARY', 'SECONDARY', 'ACCENT', 'BACKGROUND', 'SURFACE', 'TEXT', 'MUTED', 'BORDER', 'SUCCESS', 'WARNING', 'DANGER', 'NEUTRAL')",
          ),
          checkExpression(
            'brand_color_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'brand_conflict',
        columns: [
          col('competing', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('field', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('profileId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolvedBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('retained', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'brand_conflict_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'brand_conflict_resolvedBy_check_b61f5589',
            "\"resolvedBy\" IN ('INFERENCE', 'GENERAL_EXTRACTION', 'RECOGNIZED_ASSET', 'DESIGN_TOKEN', 'EXPLICIT_GUIDELINE', 'USER')",
          ),
          checkExpression(
            'brand_conflict_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'brand_font',
        columns: [
          col('basis', 'text', {
            notNull: true,
            default: lit('GENERAL_EXTRACTION'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('LOW'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('family', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('origin', 'text', {
            notNull: true,
            default: lit('EXTRACTED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('profileId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('sourceUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('style', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('weight', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'brand_font_basis_check_0cb76274',
            "\"basis\" IN ('INFERENCE', 'GENERAL_EXTRACTION', 'RECOGNIZED_ASSET', 'DESIGN_TOKEN', 'EXPLICIT_GUIDELINE', 'USER')",
          ),
          checkExpression(
            'brand_font_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'brand_font_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'brand_font_origin_check_4f78d06c',
            "\"origin\" IN ('EXTRACTED', 'INFERRED', 'USER')",
          ),
          checkExpression(
            'brand_font_role_check_cfaea187',
            "\"role\" IN ('HEADING', 'BODY', 'DISPLAY', 'MONOSPACE', 'UI', 'CAPTION')",
          ),
          checkExpression(
            'brand_font_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'brand_guideline',
        columns: [
          col('basis', 'text', {
            notNull: true,
            default: lit('EXPLICIT_GUIDELINE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('detail', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('origin', 'text', {
            notNull: true,
            default: lit('EXTRACTED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('profileId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'brand_guideline_basis_check_0cb76274',
            "\"basis\" IN ('INFERENCE', 'GENERAL_EXTRACTION', 'RECOGNIZED_ASSET', 'DESIGN_TOKEN', 'EXPLICIT_GUIDELINE', 'USER')",
          ),
          checkExpression(
            'brand_guideline_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'brand_guideline_origin_check_4f78d06c',
            "\"origin\" IN ('EXTRACTED', 'INFERRED', 'USER')",
          ),
          checkExpression(
            'brand_guideline_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'brand_profile',
        columns: [
          col('confidence', 'text', {
            notNull: true,
            default: lit('LOW'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('locked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('positioning', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tagline', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('textOrigins', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('valueProposition', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('version', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('visualStyle', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('voiceSummary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'brand_profile_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'brand_profile_status_check_09a729f8',
            "\"status\" IN ('DRAFT', 'READY', 'STALE')",
          ),
          checkExpression(
            'brand_profile_textOrigins_elem_not_null_70e5d210',
            'array_position("textOrigins", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'brand_source_state',
        columns: [
          col('analyzedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('analyzerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('brandVersion', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('contentHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceUpdatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'brand_term',
        columns: [
          col('basis', 'text', {
            notNull: true,
            default: lit('GENERAL_EXTRACTION'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('category', 'text', {
            notNull: true,
            default: lit('INDUSTRY_TERM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('LOW'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('origin', 'text', {
            notNull: true,
            default: lit('EXTRACTED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('preference', 'text', {
            notNull: true,
            default: lit('NEUTRAL'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('profileId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('term', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'brand_term_basis_check_0cb76274',
            "\"basis\" IN ('INFERENCE', 'GENERAL_EXTRACTION', 'RECOGNIZED_ASSET', 'DESIGN_TOKEN', 'EXPLICIT_GUIDELINE', 'USER')",
          ),
          checkExpression(
            'brand_term_category_check_18ff91ea',
            "\"category\" IN ('FEATURE', 'PROBLEM', 'VALUE_PROP', 'CALL_TO_ACTION', 'AUDIENCE', 'COMPETITOR', 'INDUSTRY_TERM')",
          ),
          checkExpression(
            'brand_term_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'brand_term_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'brand_term_origin_check_4f78d06c',
            "\"origin\" IN ('EXTRACTED', 'INFERRED', 'USER')",
          ),
          checkExpression(
            'brand_term_preference_check_d1c098fe',
            "\"preference\" IN ('PREFERRED', 'AVOID', 'NEUTRAL')",
          ),
          checkExpression(
            'brand_term_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'brand_voice_signal',
        columns: [
          col('basis', 'text', {
            notNull: true,
            default: lit('RECOGNIZED_ASSET'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('LOW'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('origin', 'text', {
            notNull: true,
            default: lit('EXTRACTED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('profileId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'brand_voice_signal_basis_check_0cb76274',
            "\"basis\" IN ('INFERENCE', 'GENERAL_EXTRACTION', 'RECOGNIZED_ASSET', 'DESIGN_TOKEN', 'EXPLICIT_GUIDELINE', 'USER')",
          ),
          checkExpression(
            'brand_voice_signal_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'brand_voice_signal_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'brand_voice_signal_origin_check_4f78d06c',
            "\"origin\" IN ('EXTRACTED', 'INFERRED', 'USER')",
          ),
          checkExpression(
            'brand_voice_signal_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'brand_profile',
        constraint: 'brand_profile_project_key',
        columns: ['projectId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'brand_source_state',
        constraint: 'brand_source_state_source_key',
        columns: ['projectId', 'sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_asset',
        index: 'brand_asset_profile_idx',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_asset',
        index: 'brand_asset_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_asset',
        index: 'brand_asset_project_role_idx',
        columns: ['projectId', 'role'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_color',
        index: 'brand_color_profile_idx',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_color',
        index: 'brand_color_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_color',
        index: 'brand_color_project_role_idx',
        columns: ['projectId', 'role'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_conflict',
        index: 'brand_conflict_profile_idx',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_conflict',
        index: 'brand_conflict_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_conflict',
        index: 'brand_conflict_project_field_idx',
        columns: ['projectId', 'field'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_font',
        index: 'brand_font_profile_idx',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_font',
        index: 'brand_font_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_font',
        index: 'brand_font_project_role_idx',
        columns: ['projectId', 'role'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_guideline',
        index: 'brand_guideline_profile_idx',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_guideline',
        index: 'brand_guideline_project_idx',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_source_state',
        index: 'brand_source_state_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_source_state',
        index: 'brand_source_state_source_idx',
        columns: ['sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_term',
        index: 'brand_term_profile_idx',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_term',
        index: 'brand_term_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_term',
        index: 'brand_term_project_preference_idx',
        columns: ['projectId', 'preference'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_voice_signal',
        index: 'brand_voice_profile_idx',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_voice_signal',
        index: 'brand_voice_project_kind_idx',
        columns: ['projectId', 'kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'brand_voice_signal',
        index: 'brand_voice_signal_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_asset',
        foreignKey: {
          name: 'brand_asset_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_color',
        foreignKey: {
          name: 'brand_color_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_conflict',
        foreignKey: {
          name: 'brand_conflict_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_font',
        foreignKey: {
          name: 'brand_font_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_guideline',
        foreignKey: {
          name: 'brand_guideline_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_profile',
        foreignKey: {
          name: 'brand_profile_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_source_state',
        foreignKey: {
          name: 'brand_source_state_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_source_state',
        foreignKey: {
          name: 'brand_source_state_sourceId_fkey',
          columns: ['sourceId'],
          references: { schema: 'public', table: 'source', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_term',
        foreignKey: {
          name: 'brand_term_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_voice_signal',
        foreignKey: {
          name: 'brand_voice_signal_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
