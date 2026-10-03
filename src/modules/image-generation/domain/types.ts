/**
 * CP17 domain types.
 *
 * A generated image is the rasterization of a `GraphicDesignGraph` produced by a
 * template from an immutable `GenerationContext` snapshot. Nothing here reads
 * live project state: the snapshot is taken at enqueue time and the design graph
 * is serialised into the recipe, so a later edit to the project cannot change
 * what an already-queued job draws.
 */

export const IMAGE_GENERATION_JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
] as const;
export type ImageGenerationJobStatus =
  (typeof IMAGE_GENERATION_JOB_STATUSES)[number];

export const IMAGE_GENERATION_PROVIDERS = [
  "LOCAL_GRAPHIC",
  "REMOTE_IMAGE",
] as const;
export type ImageGenerationProvider =
  (typeof IMAGE_GENERATION_PROVIDERS)[number];

export const IMAGE_OUTPUT_FORMATS = ["PNG", "JPEG"] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

export const GRAPHIC_TEMPLATE_TYPES = [
  "PRODUCT_HERO",
  "FEATURE_CALLOUT",
  "QUOTE_CARD",
  "SOCIAL_POST",
  "PROMO_CARD",
] as const;
export type GraphicTemplateType = (typeof GRAPHIC_TEMPLATE_TYPES)[number];

export const GRAPHIC_ELEMENT_TYPES = [
  "BACKGROUND",
  "IMAGE",
  "TEXT",
  "RECT",
  "CIRCLE",
] as const;
export type GraphicElementType = (typeof GRAPHIC_ELEMENT_TYPES)[number];

export type GraphicTextAlign = "left" | "center" | "right";

export type GraphicStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number | string;
  align?: GraphicTextAlign;
  letterSpacing?: number;
  lineHeight?: number;
  /** Corner radius for RECT elements. */
  radius?: number;
};

/**
 * One drawable primitive. `assetRef` is a logical reference such as
 * `product:<id>` or `brand:<id>`; the render pipeline resolves it to bytes
 * before the SVG is built, and an unresolved reference is a hard failure.
 */
export type GraphicElement = {
  id: string;
  type: GraphicElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  text?: string;
  assetRef?: string;
  style?: GraphicStyle;
};

export type GraphicBackground =
  | { kind: "COLOR"; color: string }
  | { kind: "TRANSPARENT" };

export type GraphicDesignGraph = {
  contractVersion: 1;
  width: number;
  height: number;
  background: GraphicBackground;
  elements: GraphicElement[];
};

/** The brand half of a generation snapshot, flattened for a template. */
export type GenerationBrandContext = {
  name: string;
  positioning: string;
  tagline: string;
  visualStyle: string;
  colors: Array<{ role: string; name: string; hex: string }>;
  fonts: Array<{ role: string; family: string; weight: string | null }>;
  tone: string[];
  preferredTerms: string[];
  avoidTerms: string[];
  version: number | null;
};

/** The product half of a generation snapshot. */
export type GenerationProductContext = {
  productId: string | null;
  name: string;
  shortDescription: string;
  longDescription: string;
  valueProposition: string;
  targetUserSummary: string;
  features: Array<{
    id: string;
    name: string;
    description: string;
    importance: string;
  }>;
  claims: Array<{ id: string; text: string; verification: string }>;
  confidence: string | null;
};

/**
 * Everything a template is allowed to know. It is closed: a template may only
 * draw content that appears here, so a term, colour or asset outside the
 * snapshot cannot leak into a graphic.
 */
export type GenerationContext = {
  projectId: string;
  product: GenerationProductContext;
  brand: GenerationBrandContext;
  intentId: string | null;
  intentChannel: string | null;
  intentContentType: string | null;
  intentTone: string | null;
  intentAudience: string | null;
  intentRawRequest: string | null;
  directionId: string | null;
  directionThesis: string | null;
  directionVisualStyle: string | null;
  directionVoice: string | null;
  storyboardId: string | null;
  sceneId: string | null;
  sceneText: string | null;
  sceneVisualType: string | null;
  sourceAssetIds: string[];
  brandVersion: number | null;
  intelligenceVersion: number | null;
  userRequest: string;
};

export type ImageGenerationRequest = {
  projectId: string;
  requestedById: string;
  templateType: GraphicTemplateType;
  prompt: string;
  width?: number;
  height?: number;
  outputFormat?: ImageOutputFormat;
  transparent?: boolean;
  provider?: ImageGenerationProvider;
  intentId?: string | null;
  directionId?: string | null;
  storyboardId?: string | null;
  sceneId?: string | null;
};

export type GraphicDocumentRecord = {
  id: string;
  projectId: string;
  createdById: string;
  name: string;
  templateType: GraphicTemplateType;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  transparent: boolean;
  designGraph: string;
  designGraphHash: string;
  contractVersion: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImageGenerationJobRecord = {
  id: string;
  projectId: string;
  requestedById: string;
  graphicDocumentId: string | null;
  provider: ImageGenerationProvider;
  status: ImageGenerationJobStatus;
  outputFormat: ImageOutputFormat;
  width: number;
  height: number;
  transparent: boolean;
  prompt: string;
  generationRecipe: string;
  recipeSha256: string;
  progressPct: number;
  providerJobId: string | null;
  providerModel: string | null;
  providerVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type GeneratedImageAssetRecord = {
  id: string;
  projectId: string;
  generationJobId: string | null;
  graphicDocumentId: string | null;
  storageKey: string;
  mimeType: string;
  outputFormat: ImageOutputFormat;
  width: number;
  height: number;
  byteSize: number;
  checksumSha256: string;
  transparent: boolean;
  metadata: string | null;
  deletedAt: string | null;
  createdAt: string;
};
