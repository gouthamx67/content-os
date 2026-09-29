/**
 * Validation for model-authored intent fields. The deterministic parser trusts
 * nothing, and neither does this: a value that the parser could not have
 * produced from the text is only accepted when it resolves to a real registry
 * entry or a real measurement.
 *
 * Two boundaries are enforced here. Unsupported values are rejected outright,
 * because a hallucinated content type would send CP10 down a path that does not
 * exist. Creative-direction keys are rejected too, because "what did the user
 * ask for" and "what should we make" are different questions.
 */

import {
  ContentIntentError,
  INTENT_LANGUAGES,
  isAspectRatio,
  type AspectRatio,
} from "./content-intent";
import { getContentType } from "./content-type";
import { isKnownPlatform } from "./platform";
import {
  INTENT_PURPOSES,
  normalizeIntentStyle,
  normalizeIntentTone,
} from "../../lib/intent-lexicon";

const MAX_DURATION_SECONDS = 3600;
const MAX_QUANTITY = 100;
const MAX_PLATFORMS = 6;
const MAX_VALUE = 60;

const ALLOWED_KEYS = new Set([
  "contentTypeId",
  "purpose",
  "platforms",
  "durationSeconds",
  "aspectRatio",
  "language",
  "tone",
  "style",
  "quantity",
  "notes",
]);

/** Keys that answer a creative question rather than a request question. */
const CREATIVE_KEYS = new Set([
  "hook",
  "hooks",
  "story",
  "storyline",
  "structure",
  "angle",
  "angles",
  "scene",
  "scenes",
  "shot",
  "shots",
  "script",
  "treatment",
  "visual",
  "visuals",
  "music",
  "voiceover",
  "copy",
  "caption",
  "headline",
  "recommendation",
  "recommendations",
  "best",
  "idea",
  "ideas",
  "audience",
  "persona",
  "personas",
  "cta",
]);

export interface ParsedContentIntentInterpretation {
  contentTypeId?: string;
  purpose?: string;
  platforms: string[];
  durationSeconds?: number;
  aspectRatio?: AspectRatio;
  language?: string;
  tone?: string;
  style?: string;
  quantity?: number;
  notes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): ContentIntentError {
  return new ContentIntentError("INTENT_AI_INVALID_OUTPUT", message);
}

function stringField(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw invalid(`Intent model returned a non-string ${label}`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_VALUE) {
    throw invalid(`Intent model returned a ${label} longer than ${MAX_VALUE} characters`);
  }
  return trimmed;
}

function integerField(
  value: unknown,
  label: string,
  max: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw invalid(`Intent model returned an out-of-range ${label}`);
  }
  return value;
}

export function parseContentIntentInterpretation(
  parsed: unknown,
): ParsedContentIntentInterpretation {
  if (!isRecord(parsed)) {
    throw invalid("Intent model did not return a JSON object");
  }

  for (const key of Object.keys(parsed)) {
    if (CREATIVE_KEYS.has(key.toLowerCase())) {
      throw invalid(
        `Intent model returned "${key}": deciding what to make is not this checkpoint's job`,
      );
    }
    if (!ALLOWED_KEYS.has(key)) {
      throw invalid(`Intent model returned an unexpected field "${key}"`);
    }
  }

  const notes: string[] = [];
  if (Array.isArray(parsed.notes)) {
    for (const entry of parsed.notes.slice(0, 5)) {
      const note = stringField(entry, "note");
      if (note) notes.push(note);
    }
  } else if (parsed.notes !== undefined) {
    throw invalid("Intent model returned a non-array notes field");
  }

  const contentTypeId = stringField(parsed.contentTypeId, "contentTypeId");
  if (contentTypeId !== undefined && !getContentType(contentTypeId)) {
    throw invalid(`Intent model returned an unsupported content type "${contentTypeId}"`);
  }

  const purpose = stringField(parsed.purpose, "purpose");
  if (purpose !== undefined && !INTENT_PURPOSES.includes(purpose)) {
    throw invalid(`Intent model returned an unknown purpose "${purpose}"`);
  }

  const platforms: string[] = [];
  if (parsed.platforms !== undefined) {
    if (!Array.isArray(parsed.platforms)) {
      throw invalid("Intent model returned a non-array platforms field");
    }
    if (parsed.platforms.length > MAX_PLATFORMS) {
      throw invalid(`Intent model returned more than ${MAX_PLATFORMS} platforms`);
    }
    for (const entry of parsed.platforms) {
      if (typeof entry !== "string") {
        throw invalid("Intent model returned a non-string platform");
      }
      const platform = entry.trim().toLowerCase();
      if (!platform) continue;
      if (!isKnownPlatform(platform)) {
        throw invalid(`Intent model returned an unknown platform "${platform}"`);
      }
      if (!platforms.includes(platform)) platforms.push(platform);
    }
  }

  const durationSeconds = integerField(
    parsed.durationSeconds,
    "durationSeconds",
    MAX_DURATION_SECONDS,
  );

  const quantity = integerField(parsed.quantity, "quantity", MAX_QUANTITY);

  const aspectRatio = stringField(parsed.aspectRatio, "aspectRatio") as
    | AspectRatio
    | undefined;
  if (aspectRatio !== undefined && !isAspectRatio(aspectRatio)) {
    throw invalid(`Intent model returned an unsupported aspect ratio "${aspectRatio}"`);
  }
  if (aspectRatio === "CUSTOM") {
    // A custom ratio needs dimensions, which the interpretation shape does not
    // carry, so the model cannot claim one.
    throw invalid("Intent model may not return a CUSTOM aspect ratio");
  }

  const language = stringField(parsed.language, "language");
  if (
    language !== undefined &&
    !INTENT_LANGUAGES.some((entry) => entry.code === language.toLowerCase())
  ) {
    throw invalid(`Intent model returned an unsupported language "${language}"`);
  }

  const rawTone = stringField(parsed.tone, "tone");
  const normalizedTone = rawTone ? normalizeIntentTone(rawTone) : null;
  if (rawTone && !normalizedTone) {
    throw invalid(`Intent model returned an unsupported tone "${rawTone}"`);
  }
  const tone = normalizedTone ?? undefined;

  const rawStyle = stringField(parsed.style, "style");
  const normalizedStyle = rawStyle ? normalizeIntentStyle(rawStyle) : null;
  if (rawStyle && !normalizedStyle) {
    throw invalid(`Intent model returned an unsupported style "${rawStyle}"`);
  }
  const style = normalizedStyle ?? undefined;

  return {
    contentTypeId,
    purpose,
    platforms,
    durationSeconds,
    aspectRatio,
    language: language?.toLowerCase(),
    tone,
    style,
    quantity,
    notes,
  };
}
