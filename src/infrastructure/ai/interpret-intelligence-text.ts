import {
  AUDIENCE_SIGNAL_KINDS,
  BRAND_SIGNAL_KINDS,
  CLAIM_TYPES,
  EVIDENCE_KINDS,
  FEATURE_CATEGORIES,
  IMPORTANCE_LEVELS,
  INTELLIGENCE_CONFIDENCE_LEVELS,
  INTELLIGENCE_RELATIONSHIP_TYPES,
  IntelligenceError,
  type IntelligenceEntityType,
} from "../../core/domain/intelligence";
import type { DraftEvidence } from "../../core/domain/intelligence-draft";
import { collectDraftEntityTypes } from "../../core/domain/intelligence-draft";
import {
  parseIntelligenceInterpretation,
  type IntelligenceInterpretationContext,
} from "../../core/domain/intelligence-validation";
import type {
  IntelligenceInterpretationEvidenceRef,
  IntelligenceInterpretationRequest,
  IntelligenceInterpretationResult,
  IntelligenceInterpretationSource,
} from "../../core/ports/intelligence-provider";

export const INTELLIGENCE_SYSTEM_PROMPT = [
  "You extract structured product intelligence from evidence gathered by a deterministic analyzer.",
  "Return only a JSON object. Never invent evidence, source ids, or entity references that were not provided.",
  "Every entity must cite at least one evidence key you either emit or that appears in the provided evidence list.",
  "isMarketingClaim must be true only for promotional or performance assertions that source code alone cannot confirm.",
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
    throw new IntelligenceError(
      "INTELLIGENCE_AI_INVALID_OUTPUT",
      "Intelligence model did not return a JSON object",
    );
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (cause) {
    throw new IntelligenceError(
      "INTELLIGENCE_AI_INVALID_OUTPUT",
      `Intelligence model returned malformed JSON: ${cause instanceof Error ? cause.message : "unparseable"}`,
    );
  }
}

export function buildUserPrompt(request: IntelligenceInterpretationRequest): string {
  return [
    "Task: describe the product behind these sources as structured intelligence.",
    "",
    "Allowed source ids (an id outside this list is invalid):",
    sourceLines(request.sources),
    "",
    "Evidence already gathered by the analyzer (cite these keys instead of restating the evidence):",
    evidenceLines(request.evidence),
    "",
    "Analyzer observations:",
    request.observations,
    "",
    "Allowed enum values (anything else is rejected):",
    `evidence.kind: ${EVIDENCE_KINDS.join("|")}`,
    `confidence: ${INTELLIGENCE_CONFIDENCE_LEVELS.join("|")}`,
    `features[].category: ${FEATURE_CATEGORIES.join("|")}`,
    `features[].importance: ${IMPORTANCE_LEVELS.join("|")}`,
    `claims[].claimType: ${CLAIM_TYPES.join("|")}`,
    `audienceSignals[].kind: ${AUDIENCE_SIGNAL_KINDS.join("|")}`,
    `brandSignals[].kind: ${BRAND_SIGNAL_KINDS.join("|")}`,
    `relationships[].type: ${INTELLIGENCE_RELATIONSHIP_TYPES.join("|")}`,
    "",
    "Response shape:",
    "{",
    '  "evidence": [{"sourceId":"<id>","kind":"<evidence.kind>","locator":"<string>","excerpt":"<string|null>"}],',
    '  "product": {"name":"<string|null>","shortDescription":"<string|null>","longDescription":"<string|null>","category":"<string|null>","purpose":"<string|null>","valueProposition":"<string|null>","targetUserSummary":"<string|null>","confidence":"<confidence>","isMarketingClaim":false,"sourceIds":[],"evidenceKeys":[]},',
    '  "features": [{"name":"<string>","description":"<string|null>","category":"<features[].category>","importance":"<features[].importance>","confidence":"<confidence>","isMarketingClaim":false,"sourceIds":[],"evidenceKeys":[]}],',
    '  "problems": [{"name":"<string>","description":"<string|null>","confidence":"<confidence>","isMarketingClaim":false,"sourceIds":[],"evidenceKeys":[]}],',
    '  "benefits": [{"name":"<string>","description":"<string|null>","linkedFeatureRefs":["<feature name>"],"confidence":"<confidence>","isMarketingClaim":false,"sourceIds":[],"evidenceKeys":[]}],',
    '  "claims": [{"text":"<string>","claimType":"<claims[].claimType>","sourceId":"<id|null>","confidence":"<confidence>","isMarketingClaim":false,"sourceIds":[],"evidenceKeys":[]}],',
    '  "workflows": [{"name":"<string>","description":"<string|null>","steps":[{"action":"<string>","description":"<string|null>","featureRefs":["<feature name>"]}],"confidence":"<confidence>","isMarketingClaim":false,"sourceIds":[],"evidenceKeys":[]}],',
    '  "audienceSignals": [{"segment":"<string>","description":"<string|null>","kind":"<audienceSignals[].kind>","confidence":"<confidence>","isMarketingClaim":false,"sourceIds":[],"evidenceKeys":[]}],',
    '  "brandSignals": [{"kind":"<brandSignals[].kind>","label":"<string>","value":"<string>","confidence":"<confidence>","isMarketingClaim":false,"sourceIds":[],"evidenceKeys":[]}],',
    '  "relationships": [{"type":"<relationships[].type>","fromType":"<entity type>","fromRef":"<name>","toType":"<entity type>","toRef":"<name>","confidence":"<confidence>"}]',
    "}",
    "Note: the *_SUPPORTED_BY_EVIDENCE relationship types require toType EVIDENCE and a toRef equal to one of the evidence keys listed above.",
  ].join("\n");
}

function sourceLines(sources: readonly IntelligenceInterpretationSource[]): string {
  return sources.map((source) => `- id=${source.id} type=${source.type} name=${source.name}`).join("\n") || "- (none)";
}

function evidenceLines(evidence: readonly IntelligenceInterpretationEvidenceRef[]): string {
  return (
    evidence
      .map(
        (item) =>
          `- key=${item.key} sourceId=${item.sourceId} kind=${item.kind} locator=${item.locator}`,
      )
      .join("\n") || "- (none)"
  );
}

/**
 * Single validation path shared by every interpretation provider. No provider
 * may hand a draft to the service without passing through this function.
 */
export function interpretIntelligenceText(
  text: string,
  request: IntelligenceInterpretationRequest,
  identity: { provider: string; model: string },
): IntelligenceInterpretationResult {
  const parsed = extractJsonObject(text);
  const baseEvidence: DraftEvidence[] = request.evidence.map((item) => ({
    key: item.key,
    sourceId: item.sourceId,
    kind: item.kind,
    locator: item.locator,
    excerpt: null,
    metadata: null,
  }));

  const context: IntelligenceInterpretationContext = {
    projectId: request.projectId,
    allowedSourceIds: request.sources.map((source) => source.id),
    baseEntityTypes: new Map<string, IntelligenceEntityType>(),
    baseEvidence,
  };

  const draft = parseIntelligenceInterpretation(parsed, context);
  if (draft.product === null && collectDraftEntityTypes(draft).size === 0) {
    throw new IntelligenceError(
      "INTELLIGENCE_AI_INVALID_OUTPUT",
      "Intelligence model returned no supported entities",
    );
  }

  return { provider: identity.provider, model: identity.model, draft };
}
