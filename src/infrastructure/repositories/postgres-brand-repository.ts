import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  BrandAsset,
  BrandColor,
  BrandConflict,
  BrandFont,
  BrandGuideline,
  BrandProfile,
  BrandSourceState,
  BrandTerm,
  BrandTextOrigins,
  BrandVoiceSignal,
} from "../../core/domain/brand";
import { isBrandTextField } from "../../core/domain/brand";
import type {
  BrandRepository,
  BrandSourceStateValues,
} from "../../core/ports/brand-repository";

// The relation fields are dropped: nothing here reads a joined profile or asset,
// and a row that still carries them would not be a plain table row.
type ProfileRow = Omit<
  Models.public_BrandProfile,
  "project" | "colors" | "fonts" | "assets" | "terms" | "voiceSignals" | "guidelines" | "conflicts"
>;
type ColorRow = Omit<Models.public_BrandColor, "project" | "profile">;
type FontRow = Omit<Models.public_BrandFont, "project" | "profile">;
type AssetRow = Omit<Models.public_BrandAsset, "project" | "profile" | "asset">;
type TermRow = Omit<Models.public_BrandTerm, "project" | "profile">;
type VoiceSignalRow = Omit<Models.public_BrandVoiceSignal, "project" | "profile">;
type GuidelineRow = Omit<Models.public_BrandGuideline, "project" | "profile">;
type ConflictRow = Omit<Models.public_BrandConflict, "project" | "profile">;
type SourceStateRow = Omit<Models.public_BrandSourceState, "project" | "source">;

/**
 * `textOrigins` rides in a text array because the contract has no map column, so
 * each entry is one `field=ORIGIN` pair. It is written sorted so two runs that
 * resolve the same origins produce the same row, which keeps a no-op refresh from
 * looking like a change.
 */
function encodeTextOrigins(origins: BrandTextOrigins): string[] {
  return Object.entries(origins)
    .map(([field, origin]): string | null =>
      isBrandTextField(field) && origin ? `${field}=${origin}` : null,
    )
    .filter((entry): entry is string => entry !== null)
    .sort();
}

function decodeTextOrigins(values: readonly string[]): BrandTextOrigins {
  const origins: BrandTextOrigins = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator < 0) continue;
    const field = value.slice(0, separator);
    const origin = value.slice(separator + 1);
    if (!isBrandTextField(field)) continue;
    if (origin !== "USER" && origin !== "INFERRED" && origin !== "EXTRACTED") continue;
    origins[field] = origin;
  }
  return origins;
}

function mapColor(row: ColorRow): BrandColor {
  return {
    id: row.id,
    name: row.name,
    hex: row.hex,
    role: row.role,
    confidence: row.confidence,
    origin: row.origin,
    basis: row.basis,
    sourceIds: [...row.sourceIds],
    evidenceIds: [...row.evidenceIds],
    notes: row.notes,
  };
}

function mapFont(row: FontRow): BrandFont {
  return {
    id: row.id,
    family: row.family,
    role: row.role,
    weight: row.weight,
    style: row.style,
    sourceUrl: row.sourceUrl,
    confidence: row.confidence,
    origin: row.origin,
    basis: row.basis,
    sourceIds: [...row.sourceIds],
    evidenceIds: [...row.evidenceIds],
    notes: row.notes,
  };
}

function mapAsset(row: AssetRow): BrandAsset {
  return {
    id: row.id,
    assetId: row.assetId,
    role: row.role,
    label: row.label,
    confidence: row.confidence,
    origin: row.origin,
    basis: row.basis,
    sourceIds: [...row.sourceIds],
    evidenceIds: [...row.evidenceIds],
    notes: row.notes,
  };
}

function mapTerm(row: TermRow): BrandTerm {
  return {
    id: row.id,
    term: row.term,
    category: row.category,
    preference: row.preference,
    confidence: row.confidence,
    origin: row.origin,
    basis: row.basis,
    sourceIds: [...row.sourceIds],
    evidenceIds: [...row.evidenceIds],
    notes: row.notes,
  };
}

function mapVoiceSignal(row: VoiceSignalRow): BrandVoiceSignal {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    confidence: row.confidence,
    origin: row.origin,
    basis: row.basis,
    sourceIds: [...row.sourceIds],
    evidenceIds: [...row.evidenceIds],
  };
}

function mapGuideline(row: GuidelineRow): BrandGuideline {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    origin: row.origin,
    basis: row.basis,
    sourceIds: [...row.sourceIds],
    evidenceIds: [...row.evidenceIds],
  };
}

function mapConflict(row: ConflictRow): BrandConflict {
  return {
    id: row.id,
    field: row.field,
    retained: row.retained,
    competing: row.competing,
    resolvedBy: row.resolvedBy,
    sourceIds: [...row.sourceIds],
    evidenceIds: [...row.evidenceIds],
  };
}

function mapSourceState(row: SourceStateRow): BrandSourceState {
  return {
    sourceId: row.sourceId,
    contentHash: row.contentHash,
    sourceUpdatedAt: pgTimestampToIso(row.sourceUpdatedAt),
    analyzerId: row.analyzerId,
    analyzerRevision: row.analyzerRevision,
    brandVersion: row.brandVersion,
    analyzedAt: pgTimestampToIso(row.analyzedAt),
  };
}

async function readCollections(orm: PublicOrm, projectId: string) {
  const [colors, fonts, assets, terms, voiceSignals, guidelines, conflicts] = await Promise.all([
    orm.BrandColor.where((row) => row.projectId.eq(projectId))
      .orderBy((row) => row.id.asc())
      .all(),
    orm.BrandFont.where((row) => row.projectId.eq(projectId))
      .orderBy((row) => row.id.asc())
      .all(),
    orm.BrandAsset.where((row) => row.projectId.eq(projectId))
      .orderBy((row) => row.id.asc())
      .all(),
    orm.BrandTerm.where((row) => row.projectId.eq(projectId))
      .orderBy((row) => row.id.asc())
      .all(),
    orm.BrandVoiceSignal.where((row) => row.projectId.eq(projectId))
      .orderBy((row) => row.id.asc())
      .all(),
    orm.BrandGuideline.where((row) => row.projectId.eq(projectId))
      .orderBy((row) => row.id.asc())
      .all(),
    orm.BrandConflict.where((row) => row.projectId.eq(projectId))
      .orderBy((row) => row.id.asc())
      .all(),
  ]);

  return {
    colors: colors.map(mapColor),
    fonts: fonts.map(mapFont),
    assets: assets.map(mapAsset),
    terms: terms.map(mapTerm),
    voiceSignals: voiceSignals.map(mapVoiceSignal),
    guidelines: guidelines.map(mapGuideline),
    conflicts: conflicts.map(mapConflict),
  };
}

/**
 * The profile is rewritten whole on every save: the service has already applied
 * precedence and conflict rules, so persisting anything less than the full
 * collection set would let a dropped value survive as a leftover row. Material
 * ids are derived from canonical keys, so a rewrite keeps ids stable for
 * anything that already references them.
 */
async function writeProfile(orm: PublicOrm, projectId: string, profile: BrandProfile): Promise<void> {
  await orm.BrandProfile.upsert({
    create: {
      id: profile.id,
      projectId,
      name: profile.name,
      positioning: profile.positioning,
      tagline: profile.tagline,
      valueProposition: profile.valueProposition,
      voiceSummary: profile.voiceSummary,
      visualStyle: profile.visualStyle,
      textOrigins: encodeTextOrigins(profile.textOrigins),
      status: profile.status,
      confidence: profile.confidence,
      version: profile.version,
      locked: profile.locked,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
    update: {
      name: profile.name,
      positioning: profile.positioning,
      tagline: profile.tagline,
      valueProposition: profile.valueProposition,
      voiceSummary: profile.voiceSummary,
      visualStyle: profile.visualStyle,
      textOrigins: encodeTextOrigins(profile.textOrigins),
      status: profile.status,
      confidence: profile.confidence,
      version: profile.version,
      locked: profile.locked,
      updatedAt: profile.updatedAt,
    },
    conflictOn: { projectId },
  });

  await orm.BrandColor.where((row) => row.projectId.eq(projectId)).deleteAndCount();
  await orm.BrandFont.where((row) => row.projectId.eq(projectId)).deleteAndCount();
  await orm.BrandAsset.where((row) => row.projectId.eq(projectId)).deleteAndCount();
  await orm.BrandTerm.where((row) => row.projectId.eq(projectId)).deleteAndCount();
  await orm.BrandVoiceSignal.where((row) => row.projectId.eq(projectId)).deleteAndCount();
  await orm.BrandGuideline.where((row) => row.projectId.eq(projectId)).deleteAndCount();
  await orm.BrandConflict.where((row) => row.projectId.eq(projectId)).deleteAndCount();

  if (profile.colors.length > 0) {
    await orm.BrandColor.createAll(
      profile.colors.map((color) => ({
        id: color.id,
        projectId,
        profileId: profile.id,
        name: color.name,
        hex: color.hex,
        role: color.role,
        confidence: color.confidence,
        origin: color.origin,
        basis: color.basis,
        sourceIds: color.sourceIds,
        evidenceIds: color.evidenceIds,
        notes: color.notes,
      })),
    );
  }

  if (profile.fonts.length > 0) {
    await orm.BrandFont.createAll(
      profile.fonts.map((font) => ({
        id: font.id,
        projectId,
        profileId: profile.id,
        family: font.family,
        role: font.role,
        weight: font.weight,
        style: font.style,
        sourceUrl: font.sourceUrl,
        confidence: font.confidence,
        origin: font.origin,
        basis: font.basis,
        sourceIds: font.sourceIds,
        evidenceIds: font.evidenceIds,
        notes: font.notes,
      })),
    );
  }

  if (profile.assets.length > 0) {
    await orm.BrandAsset.createAll(
      profile.assets.map((asset) => ({
        id: asset.id,
        projectId,
        profileId: profile.id,
        assetId: asset.assetId,
        role: asset.role,
        label: asset.label,
        confidence: asset.confidence,
        origin: asset.origin,
        basis: asset.basis,
        sourceIds: asset.sourceIds,
        evidenceIds: asset.evidenceIds,
        notes: asset.notes,
      })),
    );
  }

  if (profile.terms.length > 0) {
    await orm.BrandTerm.createAll(
      profile.terms.map((term) => ({
        id: term.id,
        projectId,
        profileId: profile.id,
        term: term.term,
        category: term.category,
        preference: term.preference,
        confidence: term.confidence,
        origin: term.origin,
        basis: term.basis,
        sourceIds: term.sourceIds,
        evidenceIds: term.evidenceIds,
        notes: term.notes,
      })),
    );
  }

  if (profile.voiceSignals.length > 0) {
    await orm.BrandVoiceSignal.createAll(
      profile.voiceSignals.map((signal) => ({
        id: signal.id,
        projectId,
        profileId: profile.id,
        kind: signal.kind,
        value: signal.value,
        confidence: signal.confidence,
        origin: signal.origin,
        basis: signal.basis,
        sourceIds: signal.sourceIds,
        evidenceIds: signal.evidenceIds,
      })),
    );
  }

  if (profile.guidelines.length > 0) {
    await orm.BrandGuideline.createAll(
      profile.guidelines.map((guideline) => ({
        id: guideline.id,
        projectId,
        profileId: profile.id,
        title: guideline.title,
        detail: guideline.detail,
        origin: guideline.origin,
        basis: guideline.basis,
        sourceIds: guideline.sourceIds,
        evidenceIds: guideline.evidenceIds,
      })),
    );
  }

  if (profile.conflicts.length > 0) {
    await orm.BrandConflict.createAll(
      profile.conflicts.map((conflict) => ({
        id: conflict.id,
        projectId,
        profileId: profile.id,
        field: conflict.field,
        retained: conflict.retained,
        competing: conflict.competing,
        resolvedBy: conflict.resolvedBy,
        sourceIds: conflict.sourceIds,
        evidenceIds: conflict.evidenceIds,
      })),
    );
  }
}

export class PostgresBrandRepository implements BrandRepository {
  constructor(private readonly orm: PublicOrm = db.orm.public) {}

  async save(projectId: string, profile: BrandProfile): Promise<BrandProfile> {
    await db.transaction(async (tx) => {
      await writeProfile(tx.orm.public, projectId, profile);
    });
    return this.getByProjectId(projectId) as Promise<BrandProfile>;
  }

  async update(projectId: string, profile: BrandProfile): Promise<BrandProfile> {
    return this.save(projectId, profile);
  }

  async getByProjectId(projectId: string): Promise<BrandProfile | null> {
    const row = await this.orm.BrandProfile.first({ projectId });
    if (!row) return null;
    return this.hydrate(row);
  }

  async setLocked(
    projectId: string,
    locked: boolean,
    updatedAt: string,
  ): Promise<BrandProfile | null> {
    const row = await this.orm.BrandProfile.where({ projectId }).update({ locked, updatedAt });
    if (!row) return null;
    return this.hydrate(row);
  }

  async listSourceStates(projectId: string): Promise<BrandSourceState[]> {
    const rows = await this.orm.BrandSourceState.where((state) => state.projectId.eq(projectId))
      .orderBy((state) => state.sourceId.asc())
      .all();
    return rows.map(mapSourceState);
  }

  /**
   * One state row per source, keyed on (projectId, sourceId): a re-analysis of the
   * same source must move the recorded hash and version forward rather than
   * accumulate a second row that would make the source look never-analyzed.
   */
  async saveSourceStates(projectId: string, states: BrandSourceStateValues[]): Promise<void> {
    if (states.length === 0) return;

    await db.transaction(async (tx) => {
      for (const state of states) {
        const existing = await tx.orm.public.BrandSourceState.first({
          projectId,
          sourceId: state.sourceId,
        });

        await tx.orm.public.BrandSourceState.upsert({
          create: {
            id: existing?.id ?? `brand_state_${state.sourceId}`,
            projectId,
            sourceId: state.sourceId,
            contentHash: state.contentHash,
            sourceUpdatedAt: state.sourceUpdatedAt,
            analyzerId: state.analyzerId,
            analyzerRevision: state.analyzerRevision,
            brandVersion: state.brandVersion,
            analyzedAt: state.analyzedAt,
          },
          update: {
            contentHash: state.contentHash,
            sourceUpdatedAt: state.sourceUpdatedAt,
            analyzerId: state.analyzerId,
            analyzerRevision: state.analyzerRevision,
            brandVersion: state.brandVersion,
            analyzedAt: state.analyzedAt,
          },
          conflictOn: { projectId, sourceId: state.sourceId },
        });
      }
    });
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.orm.public.BrandProfile.where({ projectId }).deleteAndCount();
      await tx.orm.public.BrandSourceState.where((state) => state.projectId.eq(projectId)).deleteAndCount();
    });
  }

  private async hydrate(row: ProfileRow): Promise<BrandProfile> {
    const collections = await readCollections(this.orm, row.projectId);

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      positioning: row.positioning,
      tagline: row.tagline,
      valueProposition: row.valueProposition,
      voiceSummary: row.voiceSummary,
      visualStyle: row.visualStyle,
      ...collections,
      textOrigins: decodeTextOrigins(row.textOrigins),
      status: row.status,
      confidence: row.confidence,
      version: row.version,
      locked: row.locked,
      createdAt: pgTimestampToIso(row.createdAt),
      updatedAt: pgTimestampToIso(row.updatedAt),
    };
  }
}
