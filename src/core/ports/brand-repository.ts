import type {
  BrandAsset,
  BrandAssetRole,
  BrandColor,
  BrandColorRole,
  BrandConflict,
  BrandConfidence,
  BrandFont,
  BrandFontRole,
  BrandGuideline,
  BrandOrigin,
  BrandPrecedence,
  BrandProfile,
  BrandSourceState,
  BrandStatus,
  BrandTerm,
  BrandTermCategory,
  BrandTermPreference,
  BrandTextField,
  BrandTextOrigins,
  BrandVoiceSignal,
} from "../domain/brand";

export type BrandColorValues = Omit<BrandColor, "id"> & { id?: string };
export type BrandFontValues = Omit<BrandFont, "id"> & { id?: string };
export type BrandAssetValues = Omit<BrandAsset, "id"> & { id?: string };
export type BrandTermValues = Omit<BrandTerm, "id"> & { id?: string };
export type BrandVoiceSignalValues = Omit<BrandVoiceSignal, "id"> & { id?: string };
export type BrandGuidelineValues = Omit<BrandGuideline, "id"> & { id?: string };
export type BrandConflictValues = Omit<BrandConflict, "id"> & { id?: string };

export type BrandProfileValues = {
  name: string | null;
  positioning: string | null;
  tagline: string | null;
  valueProposition: string | null;
  voiceSummary: string | null;
  visualStyle: string | null;
  colors: BrandColorValues[];
  fonts: BrandFontValues[];
  assets: BrandAssetValues[];
  terms: BrandTermValues[];
  voiceSignals: BrandVoiceSignalValues[];
  guidelines: BrandGuidelineValues[];
  conflicts: BrandConflictValues[];
  textOrigins: BrandTextOrigins;
  status: BrandStatus;
  confidence: BrandConfidence;
  version: number;
  locked: boolean;
};

export type BrandSourceStateValues = {
  sourceId: string;
  contentHash: string | null;
  sourceUpdatedAt: string;
  analyzerId: string;
  analyzerRevision: string | null;
  brandVersion: number;
  analyzedAt: string;
};

export type CreateBrandProfileInput = {
  id: string;
  projectId: string;
  values: BrandProfileValues;
  sourceStates: BrandSourceStateValues[];
  createdAt: string;
  updatedAt: string;
};

export type BrandUserColorInput = {
  name: string;
  hex: string;
  role: BrandColorRole;
  notes?: string | null;
};

export type BrandUserFontInput = {
  family: string;
  role: BrandFontRole;
  weight?: string | null;
  style?: string | null;
  sourceUrl?: string | null;
  notes?: string | null;
};

export type BrandUserTermInput = {
  term: string;
  category: BrandTermCategory;
  preference: BrandTermPreference;
  notes?: string | null;
};

export type BrandUserGuidelineInput = {
  title: string;
  detail: string;
};

export type BrandUserVoiceSignalInput = {
  kind: string;
  value: string;
};

export type UpdateBrandInput = Partial<
  Pick<
    BrandProfile,
    "name" | "positioning" | "tagline" | "valueProposition" | "voiceSummary" | "visualStyle"
  >
> & {
  colors?: BrandUserColorInput[];
  fonts?: BrandUserFontInput[];
  terms?: BrandUserTermInput[];
  guidelines?: BrandUserGuidelineInput[];
  voiceSignals?: BrandUserVoiceSignalInput[];
};

export interface BrandRepository {
  save(projectId: string, profile: BrandProfile): Promise<BrandProfile>;
  update(projectId: string, profile: BrandProfile): Promise<BrandProfile>;
  getByProjectId(projectId: string): Promise<BrandProfile | null>;
  setLocked(projectId: string, locked: boolean, updatedAt: string): Promise<BrandProfile | null>;
  listSourceStates(projectId: string): Promise<BrandSourceState[]>;
  saveSourceStates(projectId: string, states: BrandSourceStateValues[]): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}

export type BrandUserOwnedSummary = {
  text: Partial<Record<BrandTextField, string>>;
  colors: BrandColor[];
  fonts: BrandFont[];
  terms: BrandTerm[];
  guidelines: BrandGuideline[];
};

export type BrandMergeCandidate = {
  field: BrandTextField | "color" | "font" | "asset" | "term" | "voiceSignal" | "guideline";
  key: string;
  value: string;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  sourceIds: string[];
  evidenceIds: string[];
  notes?: string | null;
  role?: BrandColorRole | BrandFontRole | BrandAssetRole;
  weight?: string | null;
  style?: string | null;
  sourceUrl?: string | null;
  termCategory?: BrandTermCategory;
  preference?: BrandTermPreference;
  assetId?: string;
  label?: string;
  title?: string;
  detail?: string;
  voiceKind?: string;
  data: Record<string, unknown>;
};
