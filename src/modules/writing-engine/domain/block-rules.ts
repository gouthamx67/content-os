import {
  WRITING_BLOCK_TYPES,
  WRITING_LENGTHS,
  WRITING_TONES,
  type WritingBlockType,
  type WritingLength,
  type WritingTone,
} from "./types";

export function isWritingBlockType(value: unknown): value is WritingBlockType {
  return (
    typeof value === "string" &&
    (WRITING_BLOCK_TYPES as readonly string[]).includes(value)
  );
}

export function isWritingTone(value: unknown): value is WritingTone {
  return (
    typeof value === "string" &&
    (WRITING_TONES as readonly string[]).includes(value)
  );
}

export function isWritingLength(value: unknown): value is WritingLength {
  return (
    typeof value === "string" &&
    (WRITING_LENGTHS as readonly string[]).includes(value)
  );
}

export type BlockRule = {
  blockType: WritingBlockType;
  label: string;
  minWords: number;
  maxWords: Record<WritingLength, number>;
  /** A hard cap in characters that holds for every length. */
  maxChars: number;
  /** How the output is laid out. */
  structure: "LINE" | "PARAGRAPH" | "SCRIPT";
  defaultTone: WritingTone;
  supportsCta: boolean;
};

function rule(
  blockType: WritingBlockType,
  label: string,
  minWords: number,
  maxWords: Record<WritingLength, number>,
  structure: BlockRule["structure"],
  defaultTone: WritingTone,
  supportsCta: boolean,
): BlockRule {
  return {
    blockType,
    label,
    minWords,
    maxWords,
    maxChars: maxWords.LONG * 12,
    structure,
    defaultTone,
    supportsCta,
  };
}

const RULES: Record<WritingBlockType, BlockRule> = {
  HEADLINE: rule("HEADLINE", "Headline", 3, { SHORT: 12, MEDIUM: 16, LONG: 20 }, "LINE", "BRAND", false),
  HOOK: rule("HOOK", "Hook", 3, { SHORT: 14, MEDIUM: 24, LONG: 35 }, "LINE", "BOLD", false),
  SUBHEAD: rule("SUBHEAD", "Subhead", 4, { SHORT: 18, MEDIUM: 30, LONG: 45 }, "LINE", "BRAND", false),
  BODY: rule("BODY", "Body", 12, { SHORT: 70, MEDIUM: 170, LONG: 320 }, "PARAGRAPH", "PROFESSIONAL", true),
  CAPTION: rule("CAPTION", "Caption", 4, { SHORT: 22, MEDIUM: 40, LONG: 70 }, "LINE", "FRIENDLY", true),
  CTA: rule("CTA", "Call to action", 2, { SHORT: 10, MEDIUM: 16, LONG: 25 }, "LINE", "BOLD", true),
  AD_COPY: rule("AD_COPY", "Ad copy", 8, { SHORT: 45, MEDIUM: 95, LONG: 170 }, "PARAGRAPH", "BOLD", true),
  PRODUCT_DESCRIPTION: rule("PRODUCT_DESCRIPTION", "Product description", 12, { SHORT: 70, MEDIUM: 150, LONG: 280 }, "PARAGRAPH", "PROFESSIONAL", false),
  SCRIPT: rule("SCRIPT", "Script", 15, { SHORT: 80, MEDIUM: 200, LONG: 420 }, "SCRIPT", "CONVERSATIONAL", true),
  VOICEOVER: rule("VOICEOVER", "Voiceover", 12, { SHORT: 70, MEDIUM: 160, LONG: 340 }, "SCRIPT", "CONVERSATIONAL", true),
};

export function getBlockRule(blockType: WritingBlockType): BlockRule {
  return RULES[blockType];
}

export const BLOCK_RULES: Readonly<Record<WritingBlockType, BlockRule>> = RULES;

export function blockSupportsCta(blockType: WritingBlockType): boolean {
  return RULES[blockType].supportsCta;
}
