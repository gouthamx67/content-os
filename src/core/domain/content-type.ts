/**
 * The content type registry is the single answer to "what kind of asset is
 * this". Every later checkpoint - providers, templates, the creative director -
 * resolves a stable id through this table instead of matching on prose, so an
 * id added here is a contract with those checkpoints.
 *
 * Ids are append-only. Renaming one silently re-points content that already
 * references it.
 */

export const CONTENT_CHANNELS = [
  "VIDEO",
  "IMAGE",
  "TEXT",
  "AUDIO",
  "CAMPAIGN",
] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

export type ContentTypeDefinition = {
  id: string;

  channel: ContentChannel;

  name: string;

  description: string;

  supportedPlatforms: string[];

  supportsDuration: boolean;

  supportsAspectRatio: boolean;

  supportsQuantity: boolean;

  supportsTone: boolean;

  supportsStyle: boolean;

  supportsLanguage: boolean;
};

export const CONTENT_TYPES: readonly ContentTypeDefinition[] = [
  {
    id: "video.product_demo",
    channel: "VIDEO",
    name: "Product Demo",
    description: "Demonstrates the product and its workflow.",
    supportedPlatforms: [
      "website",
      "youtube",
      "linkedin",
      "x",
      "instagram",
      "tiktok",
    ],
    supportsDuration: true,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "video.launch",
    channel: "VIDEO",
    name: "Product Launch Video",
    description: "Introduces and launches a product.",
    supportedPlatforms: [
      "website",
      "product_hunt",
      "youtube",
      "linkedin",
      "x",
      "instagram",
      "tiktok",
    ],
    supportsDuration: true,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "video.ad",
    channel: "VIDEO",
    name: "Advertisement",
    description: "Promotional advertising creative.",
    supportedPlatforms: [
      "youtube",
      "instagram",
      "tiktok",
      "linkedin",
      "x",
    ],
    supportsDuration: true,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "video.explainer",
    channel: "VIDEO",
    name: "Explainer",
    description: "Explains a product, workflow, or concept.",
    supportedPlatforms: [
      "website",
      "youtube",
      "linkedin",
    ],
    supportsDuration: true,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "video.social",
    channel: "VIDEO",
    name: "Social Video",
    description: "Short-form social content.",
    supportedPlatforms: [
      "tiktok",
      "instagram",
      "youtube",
      "x",
      "linkedin",
    ],
    supportsDuration: true,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "image.thumbnail",
    channel: "IMAGE",
    name: "Thumbnail",
    description: "Thumbnail or preview image.",
    supportedPlatforms: [
      "youtube",
      "website",
      "product_hunt",
    ],
    supportsDuration: false,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "image.ad",
    channel: "IMAGE",
    name: "Ad Creative",
    description: "Static advertising creative.",
    supportedPlatforms: [
      "instagram",
      "linkedin",
      "x",
      "website",
    ],
    supportsDuration: false,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "image.carousel",
    channel: "IMAGE",
    name: "Carousel",
    description: "Multi-panel social carousel.",
    supportedPlatforms: [
      "linkedin",
      "instagram",
    ],
    supportsDuration: false,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "text.linkedin",
    channel: "TEXT",
    name: "LinkedIn Post",
    description: "LinkedIn post.",
    supportedPlatforms: ["linkedin"],
    supportsDuration: false,
    supportsAspectRatio: false,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: false,
    supportsLanguage: true,
  },

  {
    id: "text.x",
    channel: "TEXT",
    name: "X Post",
    description: "X post or thread.",
    supportedPlatforms: ["x"],
    supportsDuration: false,
    supportsAspectRatio: false,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: false,
    supportsLanguage: true,
  },

  {
    id: "text.product_hunt",
    channel: "TEXT",
    name: "Product Hunt Listing",
    description: "Product Hunt launch copy.",
    supportedPlatforms: ["product_hunt"],
    supportsDuration: false,
    supportsAspectRatio: false,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: false,
    supportsLanguage: true,
  },

  {
    id: "audio.voiceover",
    channel: "AUDIO",
    name: "Voiceover",
    description: "Narration or voiceover.",
    supportedPlatforms: [
      "video",
      "podcast",
      "social",
    ],
    supportsDuration: true,
    supportsAspectRatio: false,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },

  {
    id: "campaign.launch",
    channel: "CAMPAIGN",
    name: "Launch Campaign",
    description: "Multi-format product launch campaign.",
    supportedPlatforms: [
      "product_hunt",
      "x",
      "linkedin",
      "instagram",
      "tiktok",
      "youtube",
      "email",
      "website",
    ],
    supportsDuration: false,
    supportsAspectRatio: true,
    supportsQuantity: true,
    supportsTone: true,
    supportsStyle: true,
    supportsLanguage: true,
  },
];

export function getContentType(
  id: string,
): ContentTypeDefinition | null {
  return (
    CONTENT_TYPES.find((contentType) => contentType.id === id) ??
    null
  );
}

export function contentTypesForChannel(
  channel: ContentChannel,
): ContentTypeDefinition[] {
  return CONTENT_TYPES.filter(
    (contentType) => contentType.channel === channel,
  );
}

/**
 * Text types name the one platform they can exist on (`text.linkedin` is a
 * LinkedIn post by definition), so the platform is a fact about the type
 * rather than something to ask the user for.
 */
export function onlySupportedPlatform(
  contentType: ContentTypeDefinition,
): string | null {
  return contentType.supportedPlatforms.length === 1
    ? contentType.supportedPlatforms[0]
    : null;
}
