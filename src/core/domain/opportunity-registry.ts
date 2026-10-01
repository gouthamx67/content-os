import { CONTENT_TYPES, getContentType } from "./content-type";
import { isKnownPlatform } from "./platform";
import type { IntentSubjectType } from "./content-intent";

/**
 * A template is a shape of opportunity, not an opportunity. It states which CP09
 * content type it produces, what kind of project entity it is grounded in, and
 * which platforms can carry it. Templates never hardcode project facts: the
 * title, rationale and evidence are all resolved from the context at
 * recommendation time, which is what keeps "no invented features or claims"
 * a property of the engine rather than a review checklist.
 */

export const OPPORTUNITY_TRIGGERS = [
  "FEATURE_AVAILABLE",
  "HIGH_PRIORITY_FEATURE",
  "UNDERPROMOTED_FEATURE",
  "WORKFLOW_AVAILABLE",
  "PROBLEM_UNDERSERVED",
  "BENEFIT_UNDERSERVED",
  "SUPPORTED_CLAIM_AVAILABLE",
  "BRAND_ASSET_READY",
  "PLATFORM_GAP",
  "CONTENT_TYPE_GAP",
  "AUDIENCE_SIGNAL_PRESENT",
  "REFRESH",
] as const;
export type OpportunityTrigger = (typeof OPPORTUNITY_TRIGGERS)[number];

export type OpportunityTemplate = {
  id: string;
  name: string;
  description: string;

  /** CP09 content type this maps to. Must exist in the CP09 registry. */
  contentTypeId: string;

  /** Default channel; always the channel of `contentTypeId`. */
  channel: string;

  /**
   * Which project entity grounds the opportunity. The recommender picks a
   * concrete entity of this type from the context, which is what lets several
   * opportunities come from the same template without collapsing onto one
   * subject.
   */
  preferredSubject: IntentSubjectType | "ASSET" | "ANY";

  /**
   * Platforms that can carry this content type. Kept as a preference: the
   * recommender intersects it with the project's available platforms rather
   * than assuming any platform is publishable.
   */
  preferredPlatforms: string[];

  triggers: OpportunityTrigger[];

  /**
   * Phrases used to phrase the recommendation and, for the CP09 bridge, the
   * vocabulary that lets CP09's deterministic parser read the draft request.
   */
  rationaleTemplate: string;

  /** What the engine must find for this template to be worth suggesting. */
  requiredInputs: string[];
};

export const OPPORTUNITY_TEMPLATES: readonly OpportunityTemplate[] = [
  {
    id: "product_demo",
    name: "Product Demo",
    description: "Walk through the product's core flow end to end.",
    contentTypeId: "video.product_demo",
    channel: "VIDEO",
    preferredSubject: "PRODUCT",
    preferredPlatforms: ["youtube", "linkedin", "website", "x"],
    triggers: ["FEATURE_AVAILABLE", "AUDIENCE_SIGNAL_PRESENT"],
    rationaleTemplate:
      "A product demo shows the real workflow in action rather than describing it.",
    requiredInputs: ["product"],
  },
  {
    id: "feature_demo",
    name: "Feature Demo",
    description: "Demonstrate one specific feature doing its job.",
    contentTypeId: "video.product_demo",
    channel: "VIDEO",
    preferredSubject: "FEATURE",
    preferredPlatforms: ["youtube", "linkedin", "instagram", "tiktok"],
    triggers: ["FEATURE_AVAILABLE", "HIGH_PRIORITY_FEATURE"],
    rationaleTemplate:
      "A focused feature demo proves the capability instead of asserting it.",
    requiredInputs: ["feature"],
  },
  {
    id: "feature_launch",
    name: "Feature Launch Video",
    description: "Announce a newly available feature.",
    contentTypeId: "video.launch",
    channel: "VIDEO",
    preferredSubject: "FEATURE",
    preferredPlatforms: ["youtube", "linkedin", "x"],
    triggers: ["FEATURE_AVAILABLE", "HIGH_PRIORITY_FEATURE"],
    rationaleTemplate:
      "A launch video gives a new feature a moment where announcement and proof meet.",
    requiredInputs: ["feature"],
  },
  {
    id: "explainer",
    name: "Explainer",
    description: "Explain a problem the audience actually has.",
    contentTypeId: "video.explainer",
    channel: "VIDEO",
    preferredSubject: "PROBLEM",
    preferredPlatforms: ["youtube", "linkedin", "website"],
    triggers: ["PROBLEM_UNDERSERVED", "AUDIENCE_SIGNAL_PRESENT"],
    rationaleTemplate:
      "An explainer earns attention by naming the problem before offering the product.",
    requiredInputs: ["problem"],
  },
  {
    id: "before_after",
    name: "Before / After",
    description: "Contrast the old way with the improved one.",
    contentTypeId: "video.social",
    channel: "VIDEO",
    preferredSubject: "BENEFIT",
    preferredPlatforms: ["tiktok", "instagram", "youtube_short"],
    triggers: ["BENEFIT_UNDERSERVED"],
    rationaleTemplate:
      "A before/after makes the improvement legible without needing a claim.",
    requiredInputs: ["benefit"],
  },
  {
    id: "workflow_carousel",
    name: "Workflow Carousel",
    description: "Break a workflow into a swipeable sequence.",
    contentTypeId: "image.carousel",
    channel: "IMAGE",
    preferredSubject: "WORKFLOW",
    preferredPlatforms: ["linkedin", "instagram"],
    triggers: ["WORKFLOW_AVAILABLE"],
    rationaleTemplate:
      "A carousel turns a multi-step workflow into something scannable in one sitting.",
    requiredInputs: ["workflow"],
  },
  {
    id: "feature_graphic",
    name: "Feature Graphic",
    description: "A single visual that communicates one feature.",
    contentTypeId: "image.ad",
    channel: "IMAGE",
    preferredSubject: "FEATURE",
    preferredPlatforms: ["linkedin", "instagram", "website"],
    triggers: ["FEATURE_AVAILABLE", "BRAND_ASSET_READY"],
    rationaleTemplate:
      "A feature graphic carries one idea far enough to be remembered.",
    requiredInputs: ["feature"],
  },
  {
    id: "linkedin_post",
    name: "LinkedIn Post",
    description: "A text-first post for a professional audience.",
    contentTypeId: "text.linkedin",
    channel: "TEXT",
    preferredSubject: "FEATURE",
    preferredPlatforms: ["linkedin"],
    triggers: ["AUDIENCE_SIGNAL_PRESENT", "FEATURE_AVAILABLE"],
    rationaleTemplate:
      "A LinkedIn post reaches the audience where the feature matters professionally.",
    requiredInputs: ["feature"],
  },
  {
    id: "x_post",
    name: "X Post",
    description: "A short post suited to fast conversation.",
    contentTypeId: "text.x",
    channel: "TEXT",
    preferredSubject: "FEATURE",
    preferredPlatforms: ["x"],
    triggers: ["AUDIENCE_SIGNAL_PRESENT", "FEATURE_AVAILABLE"],
    rationaleTemplate:
      "A short post tests whether the idea travels in conversation before more is built.",
    requiredInputs: ["feature"],
  },
  {
    id: "product_hunt",
    name: "Product Hunt",
    description: "A launch listing for the product as a whole.",
    contentTypeId: "text.product_hunt",
    channel: "TEXT",
    preferredSubject: "PRODUCT",
    preferredPlatforms: ["product_hunt"],
    triggers: ["BRAND_ASSET_READY", "AUDIENCE_SIGNAL_PRESENT"],
    rationaleTemplate:
      "A launch listing is worth preparing once the product story is coherent.",
    requiredInputs: ["product", "brand"],
  },
  {
    id: "launch_campaign",
    name: "Launch Campaign",
    description: "A coordinated multi-platform launch kit.",
    contentTypeId: "campaign.launch",
    channel: "CAMPAIGN",
    preferredSubject: "PRODUCT",
    preferredPlatforms: ["linkedin", "x", "youtube", "instagram"],
    triggers: ["BRAND_ASSET_READY", "REFRESH"],
    rationaleTemplate:
      "A campaign reuses one message across channels instead of restating it per post.",
    requiredInputs: ["product", "brand"],
  },
];

export function getOpportunityTemplate(
  id: string,
): OpportunityTemplate | undefined {
  return OPPORTUNITY_TEMPLATES.find((template) => template.id === id);
}

/**
 * A template is only usable if the CP09 content type it claims actually exists
 * and still carries the channel the template advertises. This is checked rather
 * than assumed so a future edit to the CP09 registry cannot silently break the
 * bridge to Content Intent.
 */
export function isTemplateUsable(template: OpportunityTemplate): boolean {
  const definition = getContentType(template.contentTypeId);
  if (!definition) return false;
  if (definition.channel !== template.channel) return false;
  if (!template.preferredPlatforms.every(isKnownPlatform)) return false;

  // Usable means "can still produce a recommendation". A shortlist that names no
  // platform CP09 supports for this content type would be filtered to nothing
  // downstream, so the template is not usable rather than quietly empty.
  return template.preferredPlatforms.some((platform) =>
    definition.supportedPlatforms.includes(platform),
  );
}

export function usableOpportunityTemplates(): OpportunityTemplate[] {
  return OPPORTUNITY_TEMPLATES.filter(isTemplateUsable);
}

/** Content types CP12 can speak about, taken from the CP09 registry. */
export function recommendableContentTypeIds(): string[] {
  const wanted = new Set(OPPORTUNITY_TEMPLATES.map((template) => template.contentTypeId));
  return CONTENT_TYPES.filter((definition) => wanted.has(definition.id)).map(
    (definition) => definition.id,
  );
}
