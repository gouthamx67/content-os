import type {
  AssetMediaType,
  AudienceSignalKind,
  ClaimType,
  FeatureCategory,
  Importance,
} from "../../core/domain/intelligence";
import { isMeaningfulPhrase, splitSentences, truncate } from "./text";

const CAPABILITY_VERB =
  /\b(generat(?:e|es|ed|ing|ion)|creat(?:e|es|ed|ing)|build(?:s|ing)?|automat(?:e|es|ed|ing)|analy[sz](?:e|es|ed|ing)|export(?:s|ed|ing)?|import(?:s|ed|ing)?|convert(?:s|ed|ing)?|transform(?:s|ed|ing)?|track(?:s|ed|ing)?|manag(?:e|es|ed|ing)|publish(?:es|ed|ing)?|schedul(?:e|es|ed|ing)|sync(?:s|ed|ing)?|integrat(?:e|es|ed|ing|ion)|collaborat(?:e|es|ed|ing|ion)|edit(?:s|ed|ing)?|render(?:s|ed|ing)?|optimi[sz](?:e|es|ed|ing)|personaliz(?:e|es|ed|ing)|monetiz(?:e|es|ed|ing)|launch(?:es|ed|ing)?|onboard(?:s|ed|ing)?|transcrib(?:e|es|ed|ing)|detect(?:s|ed|ing)?|personalise[sd]?|scor(?:e|es|ed|ing))\b/i;

const MARKETING_INTENSIFIER =
  /\b(ai[- ]powered|in seconds|without (?:code|effort)|no code|one[- ]click|instantly|effortless|seamless(?:ly)?|unlimited|10x|faster|effortlessly|automatically|in real[- ]time|out of the box|turns? .{0,40} into|from .{0,40} to)\b/i;

const ROLE_TERMS = [
  "marketer",
  "marketers",
  "marketing teams",
  "content teams",
  "content creators",
  "creators",
  "developers",
  "designers",
  "founders",
  "agencies",
  "agencies",
  "small businesses",
  "ecommerce brands",
  "saas teams",
  "product teams",
  "social media managers",
  "writers",
  "editorials",
  "newsrooms",
  "startups",
];

const AUDIENCE_PHRASE = /\b(?:designed|built|made|created|perfect|ideal|tailored)?\s*for\s+([a-z][a-z\s-]{2,48}?)(?=[\s.,;:!?]|$)/gi;

export interface ExtractedClaim {
  text: string;
  claimType: ClaimType;
  marketing: boolean;
}

export function extractClaims(texts: readonly string[], limit = 40): ExtractedClaim[] {
  const seen = new Set<string>();
  const claims: ExtractedClaim[] = [];
  for (const text of texts) {
    for (const sentence of splitSentences(text)) {
      if (claims.length >= limit) return claims;
      if (sentence.length < 15 || sentence.length > 300) continue;
      if (!CAPABILITY_VERB.test(sentence)) continue;
      const normalized = sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      claims.push({
        text: truncate(sentence, 280),
        claimType: classifyClaimType(sentence),
        marketing: MARKETING_INTENSIFIER.test(sentence),
      });
    }
  }
  return claims;
}

function classifyClaimType(sentence: string): ClaimType {
  if (/\b(integrat|api|webhook|zapier|slack|plugin|connect(?:s|ed|ion)?)\b/i.test(sentence)) {
    return "INTEGRATION";
  }
  if (/\b(export|download|csv|pdf|mp4|mp3|json|resolution|1080p|4k|format)\b/i.test(sentence)) {
    return "FORMAT";
  }
  if (/\b(free|trial|plan|price|\$|pricing|per month|subscription|invoice)\b/i.test(sentence)) {
    return "PRICING";
  }
  if (/\b(faster|speed|latency|second|minute|hour|10x|throughput|performance|uptime)\b/i.test(sentence)) {
    return "PERFORMANCE";
  }
  if (/\b(cannot|can't|limited to|only supports|not supported|does not)\b/i.test(sentence)) {
    return "LIMITATION";
  }
  return "CAPABILITY";
}

export interface ExtractedAudience {
  segment: string;
  kind: AudienceSignalKind;
}

export function extractAudienceSignals(
  texts: readonly string[],
  limit = 20,
): ExtractedAudience[] {
  const found = new Map<string, ExtractedAudience>();
  const add = (segment: string, kind: AudienceSignalKind) => {
    const cleaned = truncate(segment, 80).replace(/\s+/g, " ").trim().toLowerCase();
    if (cleaned.length < 3 || cleaned.length > 60) return;
    if (!/^[a-z][a-z\s-]*$/.test(cleaned)) return;
    if (!found.has(cleaned)) found.set(cleaned, { segment: cleaned, kind });
  };

  for (const text of texts) {
    for (const term of ROLE_TERMS) {
      const pattern = new RegExp(`\\b${term}\\b`, "i");
      if (pattern.test(text)) add(term, "EXPLICIT_SEGMENT");
    }
    AUDIENCE_PHRASE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = AUDIENCE_PHRASE.exec(text)) !== null && found.size < limit) {
      const candidate = match[1].trim();
      const words = candidate.split(/\s+/);
      if (words.length > 5) continue;
      if (ROLE_TERMS.some((term) => candidate.toLowerCase().includes(term))) {
        add(candidate, "EXPLICIT_SEGMENT");
      } else if (words.length >= 2) {
        add(candidate, "CONTEXTUAL");
      }
    }
  }
  return [...found.values()].slice(0, limit);
}

const CATEGORY_RULES: [FeatureCategory, RegExp][] = [
  [
    "AI_GENERATION",
    /\b(ai|artificial intelligence|machine learning|llm|model|generat\w*|prompt|copilot|neural)\b/i,
  ],
  ["ANALYTICS", /\b(dashboard|analytic|report\w*|chart|metric|insight|attribution|funnel)\b/i],
  ["AUTHENTICATION", /\b(auth|login|log in|sign in|sign up|permission|role|workspace access|sso|password)\b/i],
  ["INTEGRATION", /\b(integrat\w*|api|webhook|zapier|slack|plugin|connector|third[- ]party)\b/i],
  ["AUTOMATION", /\b(automat\w*|workflow|trigger|schedul\w*|pipeline|sequence|recurring)\b/i],
  ["COLLABORATION", /\b(collaborat\w*|comment\w*|share|review|approval|@mention|handoff|team)\b/i],
  ["CONTENT_MANAGEMENT", /\b(content|cms|post|blog|article|copy|draft|editorial|publishing|calendar)\b/i],
  ["EXPORT", /\b(export|download|import|csv|pdf|spreadsheet|backup)\b/i],
];

export function classifyFeatureCategory(text: string): FeatureCategory {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(text)) return category;
  }
  return "OTHER";
}

export function looksLikeFeatureLabel(text: string, minLength = 3, maxLength = 120): boolean {
  if (!isMeaningfulPhrase(text, minLength, maxLength)) return false;
  const words = text.split(/\s+/);
  if (words.length > 12) return false;
  if (/[.!?]$/.test(text) && words.length > 6) return false;
  return true;
}

export function importanceForFeature(
  text: string,
  context: "heading" | "list" | "copy" | "metadata",
): Importance {
  if (context === "heading") return "PRIMARY";
  if (context === "list") return "SECONDARY";
  if (CAPABILITY_VERB.test(text) || MARKETING_INTENSIFIER.test(text)) return "PRIMARY";
  if (context === "metadata") return "SECONDARY";
  return "TERTIARY";
}

export function classifyAssetMediaType(name: string, alt: string, index: number): AssetMediaType {
  const haystack = `${name} ${alt}`.toLowerCase();
  if (/\b(logo|wordmark|logomark)\b/.test(haystack)) return "BRAND_ASSET";
  if (/\b(screenshot|screen[- ]?shot|ui|interface|dashboard|app)\b/.test(haystack)) {
    return /dashboard|interface|\bui\b/.test(haystack) ? "PRODUCT_UI" : "SCREENSHOT";
  }
  if (/\b(hero|banner|masthead|cover)\b/.test(haystack)) return "HERO_IMAGE";
  if (/\b(icon|glyph)\b/.test(haystack)) return "ICON";
  if (/\b(diagram|flow|architecture|chart|graph)\b/.test(haystack)) return "DIAGRAM";
  if (/\b(illustration|art|graphic|artwork)\b/.test(haystack)) return "ILLUSTRATION";
  if (/\b(testimonial|quote|review)\b/.test(haystack)) return "TESTIMONIAL";
  if (/\b(before|after|comparison)\b/.test(haystack)) return "BEFORE_AFTER";
  if (index === 0) return "HERO_IMAGE";
  return "OTHER";
}

export function assetRoleForMediaType(mediaType: AssetMediaType): "HERO" | "PRODUCT_UI" | "BRAND_ASSET" | "SUPPORTING" {
  if (mediaType === "HERO_IMAGE") return "HERO";
  if (mediaType === "PRODUCT_UI" || mediaType === "SCREENSHOT") return "PRODUCT_UI";
  if (mediaType === "BRAND_ASSET" || mediaType === "ICON") return "BRAND_ASSET";
  return "SUPPORTING";
}
