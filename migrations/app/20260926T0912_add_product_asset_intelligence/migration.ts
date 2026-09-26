#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2cf59c656c6a2b08c637713ebe50571570e1f6708857caf9e4058e25d88a6aba/contract';
import startContract from '../../snapshots/2cf59c656c6a2b08c637713ebe50571570e1f6708857caf9e4058e25d88a6aba/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/aedf1b92fcb081bdf4a12994f49c1287357617f040e5c8c7cb6657392de22dfa/contract';
import endContract from '../../snapshots/aedf1b92fcb081bdf4a12994f49c1287357617f040e5c8c7cb6657392de22dfa/contract.json' with { type: 'json' };
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
        table: 'intelligence_asset',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('canonicalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('durationMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('height', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mediaType', 'text', {
            notNull: true,
            default: lit('OTHER'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('mimeType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('qualitySignals', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('relatedClaimIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('relatedFeatureIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('role', 'text', {
            notNull: true,
            default: lit('SUPPORTING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('sourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('storageKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('width', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_asset_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_asset_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_asset_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_asset_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_asset_mediaType_check_48e31a04',
            "\"mediaType\" IN ('SCREENSHOT', 'PRODUCT_UI', 'HERO_IMAGE', 'ICON', 'ILLUSTRATION', 'DIAGRAM', 'CHART', 'TESTIMONIAL', 'BEFORE_AFTER', 'EXISTING_AD', 'EXISTING_VIDEO', 'BRAND_ASSET', 'OTHER')",
          ),
          checkExpression(
            'intelligence_asset_relatedClaimIds_elem_not_null_6505efac',
            'array_position("relatedClaimIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_asset_relatedFeatureIds_elem_not_null_e8d5025f',
            'array_position("relatedFeatureIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_asset_role_check_e47a320b',
            "\"role\" IN ('PRODUCT_UI', 'FEATURE_PROOF', 'HERO', 'SOCIAL_CREATIVE', 'BRAND_ASSET', 'SUPPORTING')",
          ),
          checkExpression(
            'intelligence_asset_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_audience_signal',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('canonicalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', {
            notNull: true,
            default: lit('CONTEXTUAL'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('segment', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_audience_signal_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_audience_signal_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_audience_signal_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_audience_signal_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_audience_signal_kind_check_78d46c4f',
            "\"kind\" IN ('EXPLICIT_SEGMENT', 'VOCABULARY', 'USE_CASE', 'CONTEXTUAL')",
          ),
          checkExpression(
            'intelligence_audience_signal_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_benefit',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('canonicalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('linkedFeatureIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_benefit_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_benefit_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_benefit_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_benefit_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_benefit_linkedFeatureIds_elem_not_null_d4cee99b',
            'array_position("linkedFeatureIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_benefit_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_brand_signal',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('canonicalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
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
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', {
            notNull: true,
            default: lit('TERMINOLOGY'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_brand_signal_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_brand_signal_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_brand_signal_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_brand_signal_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_brand_signal_kind_check_cfa9a65a',
            "\"kind\" IN ('BRAND_NAME', 'LOGO', 'COLOR', 'FONT', 'VISUAL_STYLE', 'TONE', 'TERMINOLOGY', 'TAGLINE', 'POSITIONING', 'DESIGN_PATTERN')",
          ),
          checkExpression(
            'intelligence_brand_signal_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_claim',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('canonicalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('claimType', 'text', {
            notNull: true,
            default: lit('OTHER'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('conflictsWithClaimId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('verification', 'text', {
            notNull: true,
            default: lit('UNVERIFIED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_claim_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_claim_claimType_check_0c8e528c',
            "\"claimType\" IN ('CAPABILITY', 'INTEGRATION', 'FORMAT', 'LIMITATION', 'PRICING', 'PERFORMANCE', 'OTHER')",
          ),
          checkExpression(
            'intelligence_claim_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_claim_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_claim_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_claim_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_claim_verification_check_fef83f55',
            "\"verification\" IN ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNVERIFIED', 'CONFLICTING', 'CONTRADICTED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_evidence',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidenceKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('excerpt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('locator', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_evidence_kind_check_91a4a511',
            "\"kind\" IN ('SOURCE_FRAGMENT', 'REPOSITORY_FILE', 'URL_SECTION', 'DOCUMENT_SECTION', 'IMAGE_REGION', 'VIDEO_TIMESTAMP', 'AUDIO_TIMESTAMP', 'EXTRACTED_METADATA')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_feature',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('canonicalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('category', 'text', {
            notNull: true,
            default: lit('OTHER'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('importance', 'text', {
            notNull: true,
            default: lit('SECONDARY'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_feature_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_feature_category_check_7d7a228e',
            "\"category\" IN ('AI_GENERATION', 'DASHBOARD', 'AUTHENTICATION', 'INTEGRATION', 'AUTOMATION', 'ANALYTICS', 'COLLABORATION', 'CONTENT_MANAGEMENT', 'EXPORT', 'OTHER')",
          ),
          checkExpression(
            'intelligence_feature_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_feature_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_feature_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_feature_importance_check_85750412',
            "\"importance\" IN ('PRIMARY', 'SECONDARY', 'TERTIARY')",
          ),
          checkExpression(
            'intelligence_feature_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_problem',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('canonicalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_problem_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_problem_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_problem_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_problem_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_problem_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_product',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('category', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
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
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('longDescription', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('purpose', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('shortDescription', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('targetUserSummary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('valueProposition', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_product_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_product_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_product_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_product_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_product_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_relationship',
        columns: [
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('fromId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('fromType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('toId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('toType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_relationship_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_relationship_fromType_check_6ecba03d',
            "\"fromType\" IN ('PRODUCT', 'FEATURE', 'WORKFLOW', 'PROBLEM', 'BENEFIT', 'CLAIM', 'AUDIENCE_SIGNAL', 'BRAND_SIGNAL', 'ASSET', 'EVIDENCE')",
          ),
          checkExpression(
            'intelligence_relationship_toType_check_8c637b06',
            "\"toType\" IN ('PRODUCT', 'FEATURE', 'WORKFLOW', 'PROBLEM', 'BENEFIT', 'CLAIM', 'AUDIENCE_SIGNAL', 'BRAND_SIGNAL', 'ASSET', 'EVIDENCE')",
          ),
          checkExpression(
            'intelligence_relationship_type_check_1ca4650c',
            "\"type\" IN ('FEATURE_SOLVES_PROBLEM', 'FEATURE_PROVIDES_BENEFIT', 'WORKFLOW_USES_FEATURE', 'CLAIM_SUPPORTED_BY_EVIDENCE', 'FEATURE_SUPPORTED_BY_EVIDENCE', 'BENEFIT_SUPPORTED_BY_EVIDENCE', 'PRODUCT_SUPPORTED_BY_EVIDENCE', 'ASSET_REPRESENTS_FEATURE', 'ASSET_SUPPORTS_CLAIM', 'PROBLEM_SUPPORTED_BY_EVIDENCE', 'AUDIENCE_SUPPORTED_BY_EVIDENCE', 'BRAND_SUPPORTED_BY_EVIDENCE')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_run',
        columns: [
          col('completedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('model', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('QUEUED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('trigger', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_run_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_run_status_check_d15ecf83',
            "\"status\" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_snapshot',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('entityCounts', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('summary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_workflow',
        columns: [
          col('assertionKind', 'text', {
            notNull: true,
            default: lit('INFERENCE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('canonicalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('confidence', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('evidenceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('extractedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('extractionMethod', 'text', {
            notNull: true,
            default: lit('DETERMINISTIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('featureIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userLocked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_workflow_assertionKind_check_e87eaa48',
            "\"assertionKind\" IN ('FACT', 'INFERENCE', 'USER_PROVIDED', 'MARKETING_CLAIM')",
          ),
          checkExpression(
            'intelligence_workflow_confidence_check_15ae8318',
            "\"confidence\" IN ('HIGH', 'MEDIUM', 'LOW')",
          ),
          checkExpression(
            'intelligence_workflow_evidenceIds_elem_not_null_4d0cb530',
            'array_position("evidenceIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_workflow_extractionMethod_check_cae1f4ef',
            "\"extractionMethod\" IN ('DETERMINISTIC', 'AI_INTERPRETATION', 'USER_INPUT')",
          ),
          checkExpression(
            'intelligence_workflow_featureIds_elem_not_null_b2754430',
            'array_position("featureIds", NULL) IS NULL',
          ),
          checkExpression(
            'intelligence_workflow_sourceIds_elem_not_null_07253a8e',
            'array_position("sourceIds", NULL) IS NULL',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelligence_workflow_step',
        columns: [
          col('action', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('featureIds', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('order', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('workflowId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'intelligence_workflow_step_featureIds_elem_not_null_b2754430',
            'array_position("featureIds", NULL) IS NULL',
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_asset',
        constraint: 'int_asset_canonical_key',
        columns: ['projectId', 'canonicalKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_audience_signal',
        constraint: 'int_audience_canonical_key',
        columns: ['projectId', 'canonicalKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_benefit',
        constraint: 'int_benefit_canonical_key',
        columns: ['projectId', 'canonicalKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_brand_signal',
        constraint: 'int_brand_canonical_key',
        columns: ['projectId', 'canonicalKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_claim',
        constraint: 'int_claim_canonical_key',
        columns: ['projectId', 'canonicalKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_evidence',
        constraint: 'int_evidence_key',
        columns: ['projectId', 'evidenceKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_feature',
        constraint: 'int_feature_canonical_key',
        columns: ['projectId', 'canonicalKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_problem',
        constraint: 'int_problem_canonical_key',
        columns: ['projectId', 'canonicalKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_product',
        constraint: 'intelligence_product_projectId_key',
        columns: ['projectId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_relationship',
        constraint: 'int_rel_edge_key',
        columns: ['projectId', 'type', 'fromId', 'toId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_snapshot',
        constraint: 'int_snapshot_version_key',
        columns: ['projectId', 'version'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_workflow',
        constraint: 'int_workflow_canonical_key',
        columns: ['projectId', 'canonicalKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelligence_workflow_step',
        constraint: 'int_step_workflow_order_key',
        columns: ['workflowId', 'order'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_asset',
        index: 'int_asset_project_media_idx',
        columns: ['projectId', 'mediaType'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_asset',
        index: 'int_asset_source_idx',
        columns: ['sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_asset',
        index: 'intelligence_asset_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_audience_signal',
        index: 'int_audience_project_kind_idx',
        columns: ['projectId', 'kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_audience_signal',
        index: 'intelligence_audience_signal_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_benefit',
        index: 'intelligence_benefit_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_brand_signal',
        index: 'int_brand_project_kind_idx',
        columns: ['projectId', 'kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_brand_signal',
        index: 'intelligence_brand_signal_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_claim',
        index: 'int_claim_project_verification_idx',
        columns: ['projectId', 'verification'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_claim',
        index: 'int_claim_source_idx',
        columns: ['sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_claim',
        index: 'intelligence_claim_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_evidence',
        index: 'int_evidence_project_kind_idx',
        columns: ['projectId', 'kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_evidence',
        index: 'int_evidence_source_idx',
        columns: ['sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_evidence',
        index: 'intelligence_evidence_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_feature',
        index: 'int_feature_project_category_idx',
        columns: ['projectId', 'category'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_feature',
        index: 'int_feature_project_importance_idx',
        columns: ['projectId', 'importance'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_feature',
        index: 'intelligence_feature_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_problem',
        index: 'intelligence_problem_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_relationship',
        index: 'int_rel_from_idx',
        columns: ['projectId', 'fromType', 'fromId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_relationship',
        index: 'int_rel_to_idx',
        columns: ['projectId', 'toType', 'toId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_relationship',
        index: 'intelligence_relationship_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_run',
        index: 'int_run_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_run',
        index: 'int_run_project_status_idx',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_run',
        index: 'intelligence_run_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_snapshot',
        index: 'int_snapshot_project_created_idx',
        columns: ['projectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_snapshot',
        index: 'intelligence_snapshot_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_snapshot',
        index: 'intelligence_snapshot_runId_idx_a6016437',
        columns: ['runId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_workflow',
        index: 'intelligence_workflow_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelligence_workflow_step',
        index: 'intelligence_workflow_step_workflowId_idx_09218652',
        columns: ['workflowId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_asset',
        foreignKey: {
          name: 'intelligence_asset_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_asset',
        foreignKey: {
          name: 'intelligence_asset_sourceId_fkey',
          columns: ['sourceId'],
          references: { schema: 'public', table: 'source', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_audience_signal',
        foreignKey: {
          name: 'intelligence_audience_signal_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_benefit',
        foreignKey: {
          name: 'intelligence_benefit_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_brand_signal',
        foreignKey: {
          name: 'intelligence_brand_signal_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_claim',
        foreignKey: {
          name: 'intelligence_claim_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_claim',
        foreignKey: {
          name: 'intelligence_claim_sourceId_fkey',
          columns: ['sourceId'],
          references: { schema: 'public', table: 'source', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_evidence',
        foreignKey: {
          name: 'intelligence_evidence_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_evidence',
        foreignKey: {
          name: 'intelligence_evidence_sourceId_fkey',
          columns: ['sourceId'],
          references: { schema: 'public', table: 'source', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_feature',
        foreignKey: {
          name: 'intelligence_feature_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_problem',
        foreignKey: {
          name: 'intelligence_problem_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_product',
        foreignKey: {
          name: 'intelligence_product_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_relationship',
        foreignKey: {
          name: 'intelligence_relationship_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_run',
        foreignKey: {
          name: 'intelligence_run_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_snapshot',
        foreignKey: {
          name: 'intelligence_snapshot_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_snapshot',
        foreignKey: {
          name: 'intelligence_snapshot_runId_fkey',
          columns: ['runId'],
          references: { schema: 'public', table: 'intelligence_run', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_workflow',
        foreignKey: {
          name: 'intelligence_workflow_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'project', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'intelligence_workflow_step',
        foreignKey: {
          name: 'intelligence_workflow_step_workflowId_fkey',
          columns: ['workflowId'],
          references: { schema: 'public', table: 'intelligence_workflow', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
