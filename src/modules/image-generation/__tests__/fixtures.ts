import type { GenerationContextDependencies } from "../context/build-generation-context";
import type {
  GenerationBrandContext,
  GenerationContext,
  GenerationProductContext,
  GraphicDesignGraph,
} from "../domain/types";

export const sampleProduct: GenerationProductContext = {
  productId: "product_1",
  name: "Content OS",
  shortDescription: "Plan and ship content from one place",
  longDescription: "A content operating system for small teams.",
  valueProposition: "Ship a week of content in an afternoon",
  targetUserSummary: "Solo founders and small marketing teams",
  features: [
    {
      id: "feature_1",
      name: "Storyboards",
      description: "Turn a brief into scenes",
      importance: "HIGH",
    },
    {
      id: "feature_2",
      name: "Generated graphics",
      description: "Real PNGs from brand-safe templates",
      importance: "MEDIUM",
    },
  ],
  claims: [
    { id: "claim_1", text: "10x faster planning", verification: "STATED" },
  ],
  confidence: "HIGH",
};

export const sampleBrand: GenerationBrandContext = {
  name: "Content OS",
  positioning: "The content OS for lean teams",
  tagline: "Ship faster",
  visualStyle: "Editorial, high contrast",
  colors: [
    { role: "primary", name: "Ink", hex: "#0B0C0F" },
    { role: "accent", name: "Sky", hex: "#38BDF8" },
  ],
  fonts: [{ role: "heading", family: "Inter", weight: "700" }],
  tone: ["direct", "warm"],
  preferredTerms: ["ship"],
  avoidTerms: ["leverage"],
  version: 3,
};

export const sampleContext: GenerationContext = {
  projectId: "project_1",
  product: sampleProduct,
  brand: sampleBrand,
  intentId: "intent_1",
  intentChannel: "IMAGE",
  intentContentType: "image.social",
  intentTone: "direct",
  intentAudience: "founders",
  intentRawRequest: "Announce our new storyboards",
  directionId: "direction_1",
  directionThesis: "Show the work, not the promise",
  directionVisualStyle: "Bold editorial",
  directionVoice: "Confident",
  storyboardId: "storyboard_1",
  sceneId: "scene_1",
  sceneText: "Opening hook",
  sceneVisualType: "TITLE",
  sourceAssetIds: [],
  brandVersion: 3,
  intelligenceVersion: 2,
  userRequest: "Announce our new storyboards",
};

export function fakeContextDeps(): GenerationContextDependencies {
  return {
    loadProduct: async () => sampleProduct,
    loadBrand: async () => sampleBrand,
    loadIntent: async (_projectId, intentId) =>
      intentId
        ? {
            id: intentId,
            channel: "IMAGE",
            contentType: "image.social",
            tone: "direct",
            audience: "founders",
            rawRequest: "Announce our new storyboards",
          }
        : null,
    loadDirection: async (_projectId, directionId) =>
      directionId
        ? {
            id: directionId,
            thesis: "Show the work, not the promise",
            visualStyle: "Bold editorial",
            voice: "Confident",
          }
        : null,
    loadScene: async (_projectId, storyboardId, sceneId) =>
      storyboardId
        ? {
            storyboardId,
            sceneId: sceneId ?? "scene_1",
            text: "Opening hook",
            visualType: "TITLE",
          }
        : null,
    loadIntelligenceVersion: async () => 2,
    listSourceAssetIds: async () => [],
  };
}

export function sampleGraph(
  overrides: Partial<GraphicDesignGraph> = {},
): GraphicDesignGraph {
  return {
    contractVersion: 1,
    width: 400,
    height: 400,
    background: { kind: "COLOR", color: "#0B0C0F" },
    elements: [
      {
        id: "title",
        type: "TEXT",
        x: 20,
        y: 40,
        width: 360,
        height: 60,
        zIndex: 1,
        text: "Hello <world> & \"you\"",
        style: { fill: "#FFFFFF", fontSize: 32, align: "left" },
      },
    ],
    ...overrides,
  };
}
