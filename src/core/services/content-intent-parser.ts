/**
 * Deterministic parsing. Everything here is a closed rule: a phrase either
 * matches a known signal or the field stays unresolved. The parser never
 * guesses an output, because a confidently wrong content type is more expensive
 * downstream than an honest `contentType` in `unresolvedFields`.
 *
 * Parsing is not resolution. The parser reports what the words contain and how
 * explicitly each field was stated; `ContentIntentResolver` turns that into an
 * intent with provenance, defaults and conflicts.
 */

import {
  getContentType,
  type ContentChannel,
} from "../domain/content-type";
import {
  isAspectRatio,
  NAMED_ASPECT_RATIOS,
  type AspectRatio,
  type ContentIntentConstraint,
  type IntentSubjectType,
} from "../domain/content-intent";
import { isKnownPlatform } from "../domain/platform";
import {
  INTENT_LANGUAGE_CODES,
  INTENT_STYLES,
  INTENT_TONES,
  PLATFORM_ALIASES,
  QUANTITY_NOUNS,
} from "../../lib/intent-lexicon";

export type SubjectMention = {
  type: IntentSubjectType;
  label: string;
};

export type ParsedIntent = {
  contentTypeId?: string;

  /**
   * EXPLICIT when a type was named ("launch video"), INFERRED when it was
   * derived from a platform plus a format noun ("TikTok concepts"). The
   * resolver turns this straight into `resolutionMode`.
   */
  contentTypeOrigin: "EXPLICIT" | "INFERRED" | "NONE";

  channel?: ContentChannel;

  platforms: string[];

  durationSeconds?: number;
  durationCandidates: number[];

  quantity: number;
  quantityCandidates: number[];

  aspectRatio?: AspectRatio;
  aspectRatioCandidates: AspectRatio[];

  customAspectRatio?: { width: number; height: number };

  language?: string;

  tone?: string;

  style?: string;

  audience?: string;

  cta?: string;

  purpose?: string;

  subjectMentions: SubjectMention[];

  constraints: ContentIntentConstraint[];

  unresolvedFields: string[];
};

const RATION_LIKE = new Set(["16:9", "9:16", "1:1", "4:5", "4:3"]);

const ASPECT_RATIO_PHRASES: ReadonlyArray<
  readonly [RegExp, Exclude<AspectRatio, "CUSTOM">]
> = [
  [/\b(?:vertical|portrait|full[- ]?screen)\b/i, "9:16"],
  [/\b(?:square|1:1 ?square)\b/i, "1:1"],
  [/\b(?:landscape|widescreen|horizontal|16:9 ?landscape)\b/i, "16:9"],
];

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
};

const STOP_TOKENS = new Set([
  "and",
  "or",
  "with",
  "using",
  "that",
  "which",
  "who",
  "for",
  "to",
  "in",
  "on",
  "at",
  "but",
  "plus",
  "then",
  "so",
  "because",
  "while",
  "as",
  "of",
  "the",
  "a",
  "an",
]);

/** Nouns that mean "an output", which disqualifies an audience phrase. */
const OUTPUT_NOUNS = new Set([
  "video",
  "videos",
  "post",
  "posts",
  "ad",
  "ads",
  "content",
  "graphic",
  "graphics",
  "image",
  "images",
  "campaign",
  "launch",
  "animation",
  "clip",
  "clips",
  "asset",
  "assets",
  "thing",
  "things",
  "version",
  "versions",
  "copy",
  "asset",
  "this",
  "it",
  "them",
  "me",
  "us",
  "our",
  "my",
  "reel",
  "reels",
  "story",
  "stories",
  "thumbnail",
  "script",
  "scripts",
  "voiceover",
  "brief",
  "one",
  "better",
  "great",
]);

const DURATION_TOKENS = /\b(?:second|seconds|sec|secs|minute|minutes|min|mins)\b/i;

const PURPOSE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:announc\w*)\s+(?:this|the)\s+feature\b|\bfeature\s+announcement\b/i, "feature_announcement"],
  [/\btestimonial|\bcustomer\s+story|\bcase\s+stud(?:y|ies)\b/i, "social_proof"],
  [/\bchangelog\b|\brelease\s+notes?\b|\bproduct\s+update\b/i, "product_update"],
  [/\brecruit|\bhiring\b|\bcareers\b/i, "recruitment"],
  [/\bonboarding\b/i, "onboarding"],
  [/\bpromot|\badvertis|\bmarketing\b/i, "promotion"],
  [/\beducat|\bteach\b|\btutorial\b|\bhow\s+to\b/i, "education"],
  [/\bdemo\b|\bdemonstrat/i, "product_demo"],
  [/\bexplainer\b|\bexplain\b/i, "explainer"],
  [/\bannounc|\bannounce\b/i, "announcement"],
  [/\blaunch(?:ing|es|ed)?\b/i, "launch"],
];

type ContentTypeRule = {
  id: string;
  origin: "EXPLICIT" | "INFERRED";
  test: RegExp;
};

/**
 * Order is significance: a campaign beats a video, a named platform plus format
 * beats a bare format word, and a bare "video" is last because it is the least
 * specific thing a user can say.
 */
const CONTENT_TYPE_RULES: readonly ContentTypeRule[] = [
  {
    id: "campaign.launch",
    origin: "EXPLICIT",
    test:
      /\blaunch\s+(?:campaigns?|kits?|plans?|content\s+plans?)\b|\bmulti[- ]?(?:platform|channel|format)\s+campaign\b|\bgo[- ]to[- ]market\b|\beverything\s+i\s+need\s+to\s+launch\b/i,
  },
  {
    id: "text.product_hunt",
    origin: "EXPLICIT",
    test:
      /\bproduct\s?hunt\b(?![^.]*\b(?:video|reel|short|clip|film|trailer|ad)\b)/i,
  },
  {
    id: "text.linkedin",
    origin: "EXPLICIT",
    test:
      /\blinkedin\s+(?:posts?|copy|updates?|announcements?|text|content)\b|\b(?:post|hook|caption|announcement|copy|update)\s+(?:for|on)\s+linkedin\b/i,
  },
  {
    id: "text.x",
    origin: "EXPLICIT",
    test:
      /\btweet\b|\bx\s+(?:post|thread)\b|\bthread\b|\bthreads\b/i,
  },
  {
    id: "audio.voiceover",
    origin: "EXPLICIT",
    test: /\bvoice[\s-]?over\b|\bnarration\b|\bspoken\s+(?:ad|script|track)\b/i,
  },
  {
    id: "image.thumbnail",
    origin: "EXPLICIT",
    test: /\bthumbnails?\b|\bthumb\b|\bcover\s+(?:image|shot)\b/i,
  },
  {
    id: "image.carousel",
    origin: "EXPLICIT",
    test: /\bcarousel\b|\bmulti[- ]?panel\b|\bswipe\s+post\b/i,
  },
  {
    id: "video.ad",
    origin: "EXPLICIT",
    test:
      /\b(?:video\s+ads?|ad\s+videos?|advertisement\s+videos?|commercials?|spot\s+ads?)\b/i,
  },
  {
    id: "image.ad",
    origin: "EXPLICIT",
    test:
      /\b(?:ad\s+creatives?|static\s+ads?|advertisement\s+(?:image|banner|creative)|display\s+ads?|banner\s+ads?|social\s+ads?|billboard|flyer|poster)\b/i,
  },
  {
    id: "video.explainer",
    origin: "EXPLICIT",
    test: /\bexplainer\b/i,
  },
  {
    id: "video.product_demo",
    origin: "EXPLICIT",
    test:
      /\b(?:demos?|demonstrations?|walkthroughs?|screen\s+recordings?)\b/i,
  },
  {
    id: "video.launch",
    origin: "EXPLICIT",
    test:
      /\b(?:launch\s+videos?|product\s+launch\s+videos?|launch\s+films?|launch\s+teasers?|announcement\s+videos?|teasers?)\b/i,
  },
  {
    id: "video.social",
    origin: "EXPLICIT",
    test: /\b(?:videos?|reels?|shorts?|clips?)\b/i,
  },
];

const VIDEO_FORMAT_NOUNS =
  /\b(?:video|videos|reel|reels|short|shorts|clip|clips|concept|concepts|idea|ideas|take|takes|cut|cuts)\b/i;

const TEXT_FORMAT_NOUNS =
  /\b(?:post|posts|hook|hooks|caption|captions|copy|text|thread|announcement|update|updates|listing)\b/i;

export class ContentIntentParser {
  parse(text: string): ParsedIntent {
    const trimmed = text.trim();

    const platforms = detectPlatforms(trimmed);
    const durationCandidates = detectDurationCandidates(trimmed);
    const quantityCandidates = detectQuantityCandidates(trimmed);
    const { aspectRatios, customAspect } = detectAspectRatios(trimmed);
    const language = detectLanguage(trimmed);
    const tone = detectLexicon(trimmed, INTENT_TONES);
    const style = detectStyle(trimmed, tone);
    const audience = detectAudience(trimmed);
    const cta = detectCta(trimmed);
    const purpose = detectPurpose(trimmed);
    const subjectMentions = detectSubjectMentions(trimmed);
    const { contentTypeId, origin } = detectContentType(trimmed, platforms);

    const unresolvedFields: string[] = [];
    if (!contentTypeId) {
      unresolvedFields.push("contentType");
    }

    const durationSeconds = durationCandidates[0];
    const quantity = quantityCandidates[0] ?? 1;
    const aspectRatio = aspectRatios[0];

    const constraints: ContentIntentConstraint[] = [];
    if (durationSeconds !== undefined) {
      constraints.push({ key: "duration", value: String(durationSeconds), source: "USER" });
      for (const candidate of durationCandidates.slice(1)) {
        if (candidate !== durationSeconds) {
          // The losing reading stays on the record so the validator can report
          // the conflict instead of silently preferring the first one.
          constraints.push({ key: "duration", value: String(candidate), source: "USER" });
        }
      }
    }
    for (const candidate of aspectRatios) {
      // A custom ratio is recorded as its dimensions: "CUSTOM" alone would lose
      // the one thing the user actually said, and could not be read back.
      constraints.push({
        key: "aspectRatio",
        value:
          candidate === "CUSTOM" && customAspect
            ? `${customAspect.width}x${customAspect.height}`
            : candidate,
        source: "USER",
      });
    }
    for (const candidate of quantityCandidates) {
      constraints.push({ key: "quantity", value: String(candidate), source: "USER" });
    }
    if (language) {
      constraints.push({ key: "language", value: language, source: "USER" });
    }
    if (tone) {
      constraints.push({ key: "tone", value: tone, source: "USER" });
    }
    if (style) {
      constraints.push({ key: "style", value: style, source: "USER" });
    }
    for (const platform of platforms) {
      constraints.push({ key: "platform", value: platform, source: "USER" });
    }
    if (audience) {
      constraints.push({ key: "audience", value: audience, source: "USER" });
    }
    if (cta) {
      constraints.push({ key: "cta", value: cta, source: "USER" });
    }

    return {
      contentTypeId,
      contentTypeOrigin: origin,
      channel: contentTypeId
        ? getContentType(contentTypeId)?.channel
        : undefined,
      platforms,
      durationSeconds,
      durationCandidates,
      quantity,
      quantityCandidates,
      aspectRatio,
      aspectRatioCandidates: aspectRatios,
      customAspectRatio: customAspect,
      language,
      tone,
      style,
      audience,
      cta,
      purpose,
      subjectMentions,
      constraints,
      unresolvedFields,
    };
  }
}

function detectPlatforms(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];

  for (const [alias, id] of PLATFORM_ALIASES) {
    if (lower.includes(alias) && !found.includes(id)) {
      found.push(id);
    }
  }

  // A bare "x" is the platform in "post on X", but it is also the multiplication
  // sign in "1080 x 1920", so dimensions are excluded before the token is read.
  if (
    !/\d\s*[x×]\s*\d/.test(lower) &&
    /(^|[^a-z0-9])x([^a-z0-9]|$)/.test(lower) &&
    !found.includes("x")
  ) {
    found.push("x");
  }

  return found;
}

function detectDurationCandidates(text: string): number[] {
  const candidates: number[] = [];

  const clock = /\b(\d{1,2}):([0-5]\d)\b/g;
  for (const match of text.matchAll(clock)) {
    const raw = match[0];
    // "9:16" is an aspect ratio, not nine minutes and sixteen seconds.
    if (RATION_LIKE.has(raw)) continue;
    candidates.push(Number(match[1]) * 60 + Number(match[2]));
  }

  const minutes = /\b(\d+(?:\.\d+)?)[\s-]*(?:minutes?|mins?|m)\b/gi;
  for (const match of text.matchAll(minutes)) {
    const value = Math.round(Number(match[1]) * 60);
    if (Number.isFinite(value) && value > 0) candidates.push(value);
  }

  const seconds = /\b(\d+(?:\.\d+)?)[\s-]*(?:seconds?|secs?|s)\b/gi;
  for (const match of text.matchAll(seconds)) {
    const value = Math.round(Number(match[1]));
    if (value > 0) candidates.push(value);
  }

  if (/\bhalf\s+a\s+minute\b/i.test(text)) candidates.push(30);
  if (/\b(?:a|one)\s+minute\b/i.test(text)) candidates.push(60);

  return dedupe(candidates);
}

/**
 * A count followed straight by a time unit is measuring the item, not counting
 * it: in "30 second video" the 30 is a length. Once something else comes between
 * them the number belongs to the description - in "three 45 second launch
 * videos" the 45 is each video's length and the three still counts the videos -
 * so the span is walked to its opening token rather than rejected wholesale.
 */
function measuresTheItem(span: string): boolean {
  const first = span.trim().split(/\s+/)[0] ?? "";
  return DURATION_TOKENS.test(first);
}

function detectQuantityCandidates(text: string): number[] {
  const candidates: number[] = [];

  // A quantity is often separated from the noun by the subject ("5 TikTok
  // concepts"), but a measurement is not: "30 second video" is a duration, so a
  // span that passes through a time unit is rejected rather than read as a count.
  // The window is wide enough to cross a whole duration, because "three 45
  // second launch videos" is a count of three, and the duration check - not the
  // window - is what keeps "30 second video" a duration. The lookbehind keeps
  // the second half of "16:9" out of the count: a ratio is a measurement, and
  // "9 launch video" is not nine of anything.
  const numeric = new RegExp(
    `(?<![\\w:.:])(\\d+)\\s+((?:[a-z0-9'-]+\\s+){0,6})(?:${QUANTITY_NOUNS})\\b`,
    "gi",
  );
  for (const match of text.matchAll(numeric)) {
    if (measuresTheItem(match[2])) continue;
    const value = Number(match[1]);
    if (value > 0) candidates.push(value);
  }

  const words = new RegExp(
    `\\b(${Object.keys(WORD_NUMBERS).join("|")})\\s+((?:[a-z0-9'-]+\\s+){0,6})(?:${QUANTITY_NOUNS})\\b`,
    "gi",
  );
  for (const match of text.matchAll(words)) {
    if (measuresTheItem(match[2])) continue;
    const value = WORD_NUMBERS[match[1].toLowerCase()];
    if (value) candidates.push(value);
  }

  return dedupe(candidates);
}

function detectAspectRatios(text: string): {
  aspectRatios: AspectRatio[];
  customAspect?: { width: number; height: number };
} {
  const ratios: AspectRatio[] = [];

  for (const ratio of NAMED_ASPECT_RATIOS) {
    if (new RegExp(`\\b${ratio}\\b`).test(text)) {
      ratios.push(ratio);
    }
  }

  for (const [pattern, ratio] of ASPECT_RATIO_PHRASES) {
    if (pattern.test(text) && !ratios.includes(ratio)) {
      ratios.push(ratio);
    }
  }

  const custom = /(\d{3,5})\s*[x×]\s*(\d{3,5})/.exec(text);
  if (custom) {
    ratios.push("CUSTOM");
    return {
      aspectRatios: dedupe(ratios),
      customAspect: { width: Number(custom[1]), height: Number(custom[2]) },
    };
  }

  return { aspectRatios: dedupe(ratios) };
}

function detectLanguage(text: string): string | undefined {
  const pattern =
    /\b(?:in|translate\s+to|write\s+in|make\s+it\s+in|render\s+in)\s+(english|hindi|spanish|french|german|japanese|korean|chinese)\b/i;
  const match = pattern.exec(text);
  if (!match) return undefined;

  const code = match[1].toLowerCase();
  const found = INTENT_LANGUAGE_CODES[code];
  return found ?? code;
}

function detectLexicon(
  text: string,
  lexicon: readonly string[],
): string | undefined {
  const lower = text.toLowerCase();
  // Text order, not word length: in "technical minimal" the first word is the
  // tone and the second is the style, which is how the user wrote it.
  const matches = [...lexicon]
    .map((term) => {
      const match = new RegExp(
        `(?:^|[^a-z0-9])(${escapeRegExp(term)})(?:[^a-z0-9]|$)`,
      ).exec(lower);
      return match?.index === undefined ? null : { term, index: match.index };
    })
    .filter((entry): entry is { term: string; index: number } => entry !== null)
    .sort((a, b) => a.index - b.index);

  return matches[0]?.term;
}

/**
 * Tone and style are separate fields that happen to share a vocabulary, so the
 * word that became the tone is not reused as the style while another style word
 * is available: "technical minimal" is a tone plus a style, not one word twice.
 * A lone descriptor ("cinematic") is recorded in both, because it describes
 * both and neither is invented.
 */
function detectStyle(
  text: string,
  tone: string | undefined,
): string | undefined {
  const style = detectLexicon(text, INTENT_STYLES);
  if (style !== tone) return style;
  return (tone && detectSecondLexicon(text, INTENT_STYLES, tone)) ?? style;
}

function detectSecondLexicon(
  text: string,
  lexicon: readonly string[],
  exclude: string,
): string | undefined {
  const lower = text.toLowerCase();
  for (const term of lexicon) {
    if (term === exclude) continue;
    if (
      new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}(?:[^a-z0-9]|$)`).test(lower)
    ) {
      return term;
    }
  }
  return undefined;
}

function detectAudience(text: string): string | undefined {
  const patterns = [
    /\b(?:for|targeting|target|aimed\s+at|aiming\s+at|geared\s+(?:toward|towards)|directed\s+at|addressing)\s+([^.,;!?\n]{2,60})/i,
    /\baudience\s*(?:is|of|:)?\s*([^.,;!?\n]{2,60})/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const cleaned = cleanAudience(match[1]);
    if (cleaned) return cleaned;
  }

  return undefined;
}

/**
 * "the analytics feature" is a mention of analytics, so the article that
 * introduces a name is dropped before the label is looked up.
 */
function cleanAudience(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(/["'“”]/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);

  const kept: string[] = [];
  for (const token of tokens) {
    if (STOP_TOKENS.has(token) || OUTPUT_NOUNS.has(token)) break;
    if (DURATION_TOKENS.test(token)) break;
    if (/^\d+$/.test(token)) break;
    if (isKnownPlatform(token) || isKnownPlatform(token.replace(/-/g, "_"))) {
      return null;
    }
    kept.push(token);
  }

  const candidate = kept.join(" ").trim();
  if (!candidate) return null;
  if (RATION_LIKE.has(candidate)) return null;
  if (isAspectRatio(candidate)) return null;
  // A single stopword-ish token is not an audience.
  if (candidate.split(" ").length === 1 && OUTPUT_NOUNS.has(candidate)) {
    return null;
  }
  return candidate;
}

function detectCta(text: string): string | undefined {
  const patterns = [
    /\bcta\b\s*[:=]?\s*["“']?([^"”'\n]{2,80}?)["”']?(?=\s*[.,;!?\n]|$)/i,
    /\b(?:with|and|using)\s+(?:an?\s+)?["“']([^"”']{2,80}?)["”']?\s+cta\b/i,
    /\b(?:with|and|using)\s+(?:an?\s+)?([^,.;!?\n]{2,60}?)\s+cta\b/i,
    /\b(?:end|ends|ending|finish|finishes|finishing|close|closes|closing)\s+(?:it\s+|the\s+\w+\s+)?(?:with|on|saying|calls|calling|says)\s+["“']?([^"”'.,;\n]{2,60}?)["”']?(?=\s*[.,;!?\n]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = cleanCta(match[1]);
    if (value) return value;
  }

  return undefined;
}

function cleanCta(raw: string): string | null {
  const value = raw
    .replace(/^["“']+|["”']+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "")
    .trim();

  if (!value || value.length > 80) return null;
  // "CTA" alone, or a fragment of the phrase that introduced it, is not a CTA.
  if (/^cta$/i.test(value)) return null;
  return value;
}

function detectPurpose(text: string): string | undefined {
  for (const [pattern, purpose] of PURPOSE_RULES) {
    if (pattern.test(text)) return purpose;
  }
  return undefined;
}

/**
 * Mentions are read from fragments, and the fragment is anchored to the last
 * occurrence of the noun marker in the request, then the up-to-two tokens
 * immediately before it. Anchoring to the *last* marker matters: in "a demo
 * about the Launch Workflow workflow", the entity name ends in the noun it is
 * announced by, so a leftmost parse grabs "the Launch" and reads it as the word
 * "launch" — which then gets discarded as an output noun. The last marker is
 * the one the label actually sits before, whichever noun it matches.
 *
 * The label then has leading stop tokens trimmed ("about the analytics" reads
 * as "analytics") but never down to zero tokens, so a single-word label is
 * never lost.
 */
const SUBJECT_NOUN_RULES: ReadonlyArray<
  readonly [RegExp, IntentSubjectType]
> = [
  [/(?:features?)/i, "FEATURE"],
  [/(?:workflows?|flows?|pipelines?)/i, "WORKFLOW"],
  [/problems?|challenges?|pain\s+points?/i, "PROBLEM"],
  [/(?:benefits?|advantages?)/i, "BENEFIT"],
  [/(?:claims?)/i, "CLAIM"],
];

/** The product is the only subject addressed by type, not by a noun marker. */
const PRODUCT_MENTION_RULE: Readonly<
  readonly [RegExp, IntentSubjectType]
> = [/\b(?:the\s+)?(product|app|platform|tool|saas|service)\b/i, "PRODUCT"];

const LEADING_MENTION_STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "about",
  "for",
  "on",
  "at",
  "in",
  "to",
  "with",
  "using",
  "that",
  "which",
  "who",
  "and",
  "or",
  "but",
  "as",
]);

function trimLeadingMentionTokens(value: string): string {
  const tokens = value.split(/\s+/).filter((token) => token.length > 0);
  let start = 0;
  while (start < tokens.length - 1 && LEADING_MENTION_STOP.has(tokens[start])) {
    start += 1;
  }
  return tokens.slice(start).join(" ");
}

function labelFromCapture(captured: string): string {
  const tokens = captured.split(/\s+/).filter((token) => token.length > 0);
  const nearestToNoun = tokens.slice(-2).join(" ");
  return trimLeadingMentionTokens(nearestToNoun);
}

function detectSubjectMentions(text: string): SubjectMention[] {
  const mentions: SubjectMention[] = [];

  for (const [nounPattern, type] of SUBJECT_NOUN_RULES) {
    const marker = new RegExp(`\\b(?:${nounPattern.source})\\b`, "gi");
    const matches = [...text.matchAll(marker)];
    if (matches.length === 0) continue;

    const last = matches[matches.length - 1];
    if (last.index === undefined) continue;

    const before = text.slice(0, last.index).trim().toLowerCase();
    const label = labelFromCapture(before);
    if (!label) continue;
    if (OUTPUT_NOUNS.has(label) || STOP_TOKENS.has(label)) continue;

    mentions.push({ type, label });
  }

  const productMatch = PRODUCT_MENTION_RULE[0].exec(text);
  if (productMatch) {
    const label = labelFromCapture(productMatch[1].trim().toLowerCase());
    if (label && !mentions.some((item) => item.type === "PRODUCT")) {
      mentions.push({ type: "PRODUCT", label });
    }
  }

  return mentions;
}

function detectContentType(
  text: string,
  platforms: readonly string[],
): { contentTypeId?: string; origin: "EXPLICIT" | "INFERRED" | "NONE" } {
  for (const rule of CONTENT_TYPE_RULES) {
    if (rule.test.test(text)) {
      return { contentTypeId: rule.id, origin: rule.origin };
    }
  }

  // A named platform plus a format noun narrows the type without naming it.
  // This is an inference and is recorded as one.
  for (const platform of platforms) {
    if (SHORT_FORM_VIDEO_PLATFORMS.includes(platform) && VIDEO_FORMAT_NOUNS.test(text)) {
      return { contentTypeId: "video.social", origin: "INFERRED" };
    }
  }

  if (TEXT_FORMAT_NOUNS.test(text)) {
    if (/\b(?:for|on)\s+linkedin\b/i.test(text) || /\blinkedin\b/i.test(text)) {
      return { contentTypeId: "text.linkedin", origin: "INFERRED" };
    }
    if (/\b(?:for|on)\s+(?:x|twitter)\b/i.test(text) || /\btweet\b/i.test(text)) {
      return { contentTypeId: "text.x", origin: "INFERRED" };
    }
  }

  return { origin: "NONE" };
}

const SHORT_FORM_VIDEO_PLATFORMS = ["tiktok", "instagram", "youtube_short"];

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
