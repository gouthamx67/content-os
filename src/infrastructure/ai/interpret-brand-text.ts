import { BrandError } from "../../core/domain/brand";
import type { BrandInterpretationRequest } from "../../core/ports/brand-interpretation-provider";

export const BRAND_SYSTEM_PROMPT = [
  "You describe a brand from evidence a deterministic analyzer already gathered.",
  "Return only a JSON object. Never invent evidence keys, source ids, or facts that were not provided.",
  "You may describe identity, positioning, voice and terminology. You may not state colors, fonts, logos or assets: those come from deterministic extraction only.",
  "Every field you return must cite at least one evidence key from the provided list; a field with no supporting key is rejected.",
  "A field the observations already state deterministically is not yours to restate.",
].join(" ");

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Models sometimes wrap JSON in prose; retry with the outermost braces.
  }

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new BrandError(
      "BRAND_AI_INVALID_OUTPUT",
      "Brand model did not return a JSON object",
    );
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (cause) {
    throw new BrandError(
      "BRAND_AI_INVALID_OUTPUT",
      `Brand model returned malformed JSON: ${
        cause instanceof Error ? cause.message : "unparseable"
      }`,
    );
  }
}

export function buildBrandPrompt(request: BrandInterpretationRequest): string {
  return [
    "Task: describe the brand behind these sources. Do not restate what the analyzer already determined.",
    "",
    "Allowed source ids (an id outside this list is invalid):",
    sourceLines(request.sources),
    "",
    "Evidence keys you may cite:",
    evidenceLines(request.evidence),
    "",
    "Fields the analyzer already determined deterministically (do not restate them):",
    request.deterministicFields.length > 0
      ? request.deterministicFields.join(", ")
      : "- (none)",
    "",
    "Analyzer observations:",
    request.observations,
    "",
    "Allowed enum values:",
    "confidence: HIGH|MEDIUM|LOW",
    "terms[].category: FEATURE|PROBLEM|VALUE_PROP|CALL_TO_ACTION|AUDIENCE|COMPETITOR|INDUSTRY_TERM",
    "preference: PREFERRED|AVOID|NEUTRAL",
    "",
    "Response shape:",
    "{",
    '  "positioning": "<string|null>", "positioningConfidence": "HIGH|MEDIUM|LOW", "positioningEvidenceKeys": [],',
    '  "tagline": "<string|null>", "taglineConfidence": "HIGH|MEDIUM|LOW", "taglineEvidenceKeys": [],',
    '  "valueProposition": "<string|null>", "valuePropositionConfidence": "HIGH|MEDIUM|LOW", "valuePropositionEvidenceKeys": [],',
    '  "voiceSummary": "<string|null>", "voiceSummaryConfidence": "HIGH|MEDIUM|LOW", "voiceSummaryEvidenceKeys": [],',
    '  "visualStyle": "<string|null>", "visualStyleConfidence": "HIGH|MEDIUM|LOW", "visualStyleEvidenceKeys": [],',
    '  "voiceSignals": [{"kind":"<string>","value":"<string>","confidence":"<confidence>","evidenceKeys":[]}],',
    '  "preferredTerms": [{"term":"<string>","category":"<terms[].category>","confidence":"<confidence>","evidenceKeys":[]}],',
    '  "avoidTerms": [{"term":"<string>","category":"<terms[].category>","confidence":"<confidence>","evidenceKeys":[]}]',
    "}",
  ].join("\n");
}

function sourceLines(sources: BrandInterpretationRequest["sources"]): string {
  return (
    sources.map((source) => `- id=${source.id} type=${source.type} name=${source.name}`).join("\n") ||
    "- (none)"
  );
}

function evidenceLines(
  evidence: BrandInterpretationRequest["evidence"],
): string {
  return (
    evidence
      .map((item) => `- key=${item.key} sourceId=${item.sourceId} kind=${item.kind} locator=${item.locator}`)
      .join("\n") || "- (none)"
  );
}
