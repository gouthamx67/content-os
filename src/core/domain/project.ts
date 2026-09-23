export type ProjectStatus =
  | "created"
  | "analyzing"
  | "ready"
  | "generating"
  | "completed"
  | "failed";

export type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;

  sources: Source[];
  assets: Asset[];

  product?: ProductIntelligence;
  brand?: BrandProfile;
  audience?: AudienceProfile;
};

export type SourceType =
  | "website"
  | "repository"
  | "file"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "design"
  | "text";

export type Source = {
  id: string;
  type: SourceType;
  name: string;
  uri?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type AssetType =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "logo"
  | "screenshot"
  | "font"
  | "icon"
  | "other";

export type Asset = {
  id: string;
  type: AssetType;
  name: string;
  uri?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ProductIntelligence = {
  summary: string;

  features: ProductFeature[];
  workflows: ProductWorkflow[];
  benefits: string[];
  claims: ProductClaim[];
  wowMoments: WowMoment[];
  evidence: Evidence[];
};

export type ProductFeature = {
  id: string;
  name: string;
  description: string;
};

export type ProductWorkflow = {
  id: string;
  name: string;
  steps: string[];
  outcome?: string;
};

export type ProductClaim = {
  id: string;
  claim: string;
  confidence: "verified" | "supported" | "unverified";
  evidenceIds: string[];
};

export type WowMoment = {
  id: string;
  title: string;
  description: string;
  sourceIds: string[];
  signals: {
    visualImpact: number;
    transformation: number;
    novelty: number;
    clarity: number;
  };
};

export type Evidence = {
  id: string;
  sourceId: string;
  statement: string;
  location?: string;
};

export type BrandProfile = {
  name?: string;
  voice?: string;
  colors?: string[];
  fonts?: string[];
  logoAssetId?: string;
  guidelines?: string;
};

export type AudienceProfile = {
  primaryAudience?: string;
  personas: AudiencePersona[];
  problems: string[];
  needs: string[];
};

export type AudiencePersona = {
  id: string;
  name: string;
  description: string;
};