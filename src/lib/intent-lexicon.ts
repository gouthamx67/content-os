/**
 * Closed vocabularies for intent parsing and for validating what a model
 * returns. They live outside the parser so the deterministic rules and the AI
 * output checks read the same lists: a tone the parser can recognise is a tone
 * the model is allowed to suggest, and a value in neither list is text, not an
 * intent field.
 */

export const PLATFORM_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["product hunt", "product_hunt"],
  ["producthunt", "product_hunt"],
  ["youtube short", "youtube_short"],
  ["youtube shorts", "youtube_short"],
  ["shorts", "youtube_short"],
  ["youtube", "youtube"],
  ["tiktok", "tiktok"],
  ["tik tok", "tiktok"],
  ["instagram", "instagram"],
  ["insta", "instagram"],
  ["linkedin", "linkedin"],
  ["twitter", "x"],
  ["x.com", "x"],
  ["x post", "x"],
  ["x thread", "x"],
  ["website", "website"],
  ["web site", "website"],
  ["web", "website"],
  ["email", "email"],
  ["podcast", "podcast"],
];

/**
 * Tone and style are separate vocabularies on purpose. Words that read as both
 * ("cinematic", "premium") are allowed in each, because collapsing them into one
 * field would erase the distinction a later checkpoint relies on.
 */
export const INTENT_TONES: readonly string[] = [
  "premium",
  "cinematic",
  "technical",
  "minimal",
  "energetic",
  "documentary",
  "founder",
  "ugc",
  "social",
  "viral",
  "dramatic",
  "humorous",
  "conversational",
  "professional",
  "confident",
  "playful",
  "serious",
  "warm",
  "friendly",
  "informative",
  "casual",
  "luxury",
  "elegant",
  "bold",
  "authoritative",
  "calm",
  "sophisticated",
  "nostalgic",
  "inspirational",
  "trustworthy",
  "urgent",
];

export const INTENT_STYLES: readonly string[] = [
  "cinematic",
  "minimal",
  "premium",
  "technical",
  "documentary",
  "energetic",
  "dramatic",
  "ugc",
  "social",
  "viral",
  "animated",
  "motion-graphics",
  "typographic",
  "retro",
  "monochrome",
  "hand-drawn",
  "watercolor",
  "isometric",
  "photoreal",
  "illustrated",
  "abstract",
];

export const INTENT_LANGUAGE_CODES: Readonly<Record<string, string>> = {
  english: "en",
  hindi: "hi",
  spanish: "es",
  french: "fr",
  german: "de",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
};

export const QUANTITY_NOUNS =
  "versions?|variants?|concepts?|ideas?|hooks?|scripts?|captions?|posts?|videos?|images?|graphics?|options?|ads?|thumbnails?|stories|reels?|takes?|cuts?|angles?|formats?|examples?|assets?";

export const INTENT_PURPOSES: readonly string[] = [
  "feature_announcement",
  "social_proof",
  "product_update",
  "recruitment",
  "onboarding",
  "promotion",
  "education",
  "product_demo",
  "explainer",
  "announcement",
  "launch",
];

/** Normalises a model-suggested tone to the vocabulary, or rejects it. */
export function normalizeIntentTone(value: string): string | null {
  return matchVocabulary(value, INTENT_TONES);
}

export function normalizeIntentStyle(value: string): string | null {
  return matchVocabulary(value, INTENT_STYLES);
}

export function isIntentPurpose(value: string): boolean {
  return INTENT_PURPOSES.includes(value);
}

function matchVocabulary(value: string, vocabulary: readonly string[]): string | null {
  const needle = value.trim().toLowerCase().replace(/\s+/g, " ");
  const compact = needle.replace(/[\s-]+/g, "");
  const found = vocabulary.find(
    (entry) => entry === needle || entry.replace(/[\s-]+/g, "") === compact,
  );
  return found ?? null;
}
