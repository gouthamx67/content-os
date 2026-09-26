import {
  IntelligenceError,
  type AssertionKind,
  type AudienceSignalKind,
  type BrandSignalKind,
  type ClaimType,
  type EvidenceKind,
  type FeatureCategory,
  type Importance,
  type IntelligenceConfidence,
  type IntelligenceEntityType,
  type IntelligenceRelationshipType,
} from "./intelligence";
import { INTELLIGENCE_CONFIDENCE_LEVELS } from "./intelligence";
import { canonicalEntityKey, canonicalEvidenceKey } from "./intelligence-canonical";
import {
  MAX_DRAFT_ITEMS,
  collectDraftEntityTypes,
  emptyIntelligenceDraft,
  type DraftEvidence,
  type IntelligenceDraft,
} from "./intelligence-draft";

const MAX_TEXT = 2_000;
const MAX_SHORT_TEXT = 300;
const MAX_NAME = 200;
const MAX_LOCATOR = 500;
const MAX_EVIDENCE_ITEMS = 100;

export const RELATIONSHIP_ENDPOINTS: Record<
  IntelligenceRelationshipType,
  { from: IntelligenceEntityType; to: IntelligenceEntityType }
> = {
  FEATURE_SOLVES_PROBLEM: { from: "FEATURE", to: "PROBLEM" },
  FEATURE_PROVIDES_BENEFIT: { from: "FEATURE", to: "BENEFIT" },
  WORKFLOW_USES_FEATURE: { from: "WORKFLOW", to: "FEATURE" },
  CLAIM_SUPPORTED_BY_EVIDENCE: { from: "CLAIM", to: "EVIDENCE" },
  FEATURE_SUPPORTED_BY_EVIDENCE: { from: "FEATURE", to: "EVIDENCE" },
  BENEFIT_SUPPORTED_BY_EVIDENCE: { from: "BENEFIT", to: "EVIDENCE" },
  PRODUCT_SUPPORTED_BY_EVIDENCE: { from: "PRODUCT", to: "EVIDENCE" },
  PROBLEM_SUPPORTED_BY_EVIDENCE: { from: "PROBLEM", to: "EVIDENCE" },
  AUDIENCE_SUPPORTED_BY_EVIDENCE: { from: "AUDIENCE_SIGNAL", to: "EVIDENCE" },
  BRAND_SUPPORTED_BY_EVIDENCE: { from: "BRAND_SIGNAL", to: "EVIDENCE" },
  ASSET_REPRESENTS_FEATURE: { from: "ASSET", to: "FEATURE" },
  ASSET_SUPPORTS_CLAIM: { from: "ASSET", to: "CLAIM" },
};

export interface IntelligenceInterpretationContext {
  projectId: string;
  allowedSourceIds: readonly string[];
  baseEntityTypes: ReadonlyMap<string, IntelligenceEntityType>;
  baseEvidence: readonly DraftEvidence[];
}

function reject(path: string, detail: string): never {
  throw new IntelligenceError(
    "INTELLIGENCE_AI_INVALID_OUTPUT",
    `Intelligence model output rejected at ${path}: ${detail}`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) reject(path, "expected an object");
  return value;
}

function expectArray(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) reject(path, "expected an array");
  if (value.length > max) reject(path, `expected at most ${max} items`);
  return value;
}

function expectKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) reject(`${path}.${key}`, "unknown field");
  }
}

function expectString(
  value: unknown,
  path: string,
  options: { max?: number; min?: number; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") reject(path, "expected a string");
  const max = options.max ?? MAX_TEXT;
  if (value.length > max) reject(path, `expected at most ${max} characters`);
  if (!options.allowEmpty && value.trim().length === 0) reject(path, "expected a non-empty string");
  if (options.min !== undefined && value.trim().length < options.min) {
    reject(path, `expected at least ${options.min} characters`);
  }
  return value;
}

function expectOptionalString(
  value: unknown,
  path: string,
  max = MAX_TEXT,
): string | null {
  if (value === undefined || value === null) return null;
  return expectString(value, path, { max, allowEmpty: true });
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    reject(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function expectOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  fallback: T,
): T {
  if (value === undefined || value === null) return fallback;
  return expectEnum(value, allowed, path);
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") reject(path, "expected a boolean");
  return value;
}

function expectStringArray(
  value: unknown,
  path: string,
  max: number,
): string[] {
  if (value === undefined || value === null) return [];
  const items = expectArray(value, path, max);
  return items.map((item, index) => expectString(item, `${path}[${index}]`, { max: MAX_NAME }));
}

const FEATURE_CATEGORIES: readonly FeatureCategory[] = [
  "AI_GENERATION",
  "DASHBOARD",
  "AUTHENTICATION",
  "INTEGRATION",
  "AUTOMATION",
  "ANALYTICS",
  "COLLABORATION",
  "CONTENT_MANAGEMENT",
  "EXPORT",
  "OTHER",
];

const IMPORTANCES: readonly Importance[] = ["PRIMARY", "SECONDARY", "TERTIARY"];
const CLAIM_TYPES: readonly ClaimType[] = [
  "CAPABILITY",
  "INTEGRATION",
  "FORMAT",
  "LIMITATION",
  "PRICING",
  "PERFORMANCE",
  "OTHER",
];
const AUDIENCE_KINDS: readonly AudienceSignalKind[] = [
  "EXPLICIT_SEGMENT",
  "VOCABULARY",
  "USE_CASE",
  "CONTEXTUAL",
];
const BRAND_KINDS: readonly BrandSignalKind[] = [
  "BRAND_NAME",
  "LOGO",
  "COLOR",
  "FONT",
  "VISUAL_STYLE",
  "TONE",
  "TERMINOLOGY",
  "TAGLINE",
  "POSITIONING",
  "DESIGN_PATTERN",
];
const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "SOURCE_FRAGMENT",
  "REPOSITORY_FILE",
  "URL_SECTION",
  "DOCUMENT_SECTION",
  "IMAGE_REGION",
  "VIDEO_TIMESTAMP",
  "AUDIO_TIMESTAMP",
  "EXTRACTED_METADATA",
];
const RELATIONSHIP_TYPES = Object.keys(RELATIONSHIP_ENDPOINTS) as IntelligenceRelationshipType[];

function assertionKindFor(isMarketingClaim: boolean): AssertionKind {
  return isMarketingClaim ? "MARKETING_CLAIM" : "INFERENCE";
}

function assertSourceAllowed(sourceId: unknown, path: string, context: IntelligenceInterpretationContext): string {
  const value = expectString(sourceId, path, { max: 200 });
  if (!context.allowedSourceIds.includes(value)) {
    throw new IntelligenceError(
      "INTELLIGENCE_SCOPE_VIOLATION",
      `Intelligence model referenced source ${value} which is not part of project ${context.projectId} (rejected at ${path})`,
    );
  }
  return value;
}

function baseFor(
  value: Record<string, unknown>,
  path: string,
  context: IntelligenceInterpretationContext,
): {
  key: string;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  sourceIds: string[];
  evidenceKeys: string[];
} {
  const kind = assertionKindFor(expectBoolean(value["isMarketingClaim"] ?? false, `${path}.isMarketingClaim`));
  return {
    key: "",
    confidence: expectOptionalEnum(
      value["confidence"],
      INTELLIGENCE_CONFIDENCE_LEVELS,
      `${path}.confidence`,
      "MEDIUM",
    ),
    assertionKind: kind,
    sourceIds: expectStringArray(value["sourceIds"], `${path}.sourceIds`, MAX_EVIDENCE_ITEMS).map(
      (sourceId, index) => assertSourceAllowed(sourceId, `${path}.sourceIds[${index}]`, context),
    ),
    evidenceKeys: expectStringArray(value["evidenceKeys"], `${path}.evidenceKeys`, MAX_EVIDENCE_ITEMS),
  };
}

function parseEvidence(raw: unknown, context: IntelligenceInterpretationContext): DraftEvidence[] {
  if (raw === undefined || raw === null) return [];
  const items = expectArray(raw, "evidence", MAX_EVIDENCE_ITEMS);
  return items.map((item, index) => {
    const path = `evidence[${index}]`;
    const value = expectObject(item, path);
    expectKnownKeys(value, ["sourceId", "kind", "locator", "excerpt"], path);
    return {
      key: "",
      sourceId: assertSourceAllowed(value["sourceId"], `${path}.sourceId`, context),
      kind: expectEnum(value["kind"], EVIDENCE_KINDS, `${path}.kind`),
      locator: expectString(value["locator"], `${path}.locator`, { max: MAX_LOCATOR }),
      excerpt: expectOptionalString(value["excerpt"], `${path}.excerpt`, MAX_TEXT),
      metadata: null,
    };
  });
}

export function parseIntelligenceInterpretation(
  raw: unknown,
  context: IntelligenceInterpretationContext,
): IntelligenceDraft {
  const draft = emptyIntelligenceDraft();
  const value = expectObject(raw, "$");
  expectKnownKeys(
    value,
    [
      "product",
      "features",
      "problems",
      "benefits",
      "claims",
      "workflows",
      "audienceSignals",
      "brandSignals",
      "evidence",
      "relationships",
    ],
    "$",
  );

  const aiEvidence = parseEvidence(value["evidence"], context);
  for (const item of aiEvidence) {
    const key = canonicalEvidenceKey(item.sourceId, item.kind, item.locator);
    draft.evidence.push({ ...item, key });
  }
  const knownEvidence = new Set<string>([
    ...context.baseEvidence.map((item) => item.key),
    ...draft.evidence.map((item) => item.key),
  ]);

  if (value["product"] !== undefined && value["product"] !== null) {
    const path = "product";
    const product = expectObject(value["product"], path);
    expectKnownKeys(
      product,
      [
        "name",
        "shortDescription",
        "longDescription",
        "category",
        "purpose",
        "valueProposition",
        "targetUserSummary",
        "confidence",
        "isMarketingClaim",
        "sourceIds",
        "evidenceKeys",
      ],
      path,
    );
    const base = baseFor(product, path, context);
    draft.product = {
      ...base,
      name: expectOptionalString(product["name"], `${path}.name`, MAX_NAME),
      shortDescription: expectOptionalString(product["shortDescription"], `${path}.shortDescription`, MAX_SHORT_TEXT),
      longDescription: expectOptionalString(product["longDescription"], `${path}.longDescription`, MAX_TEXT),
      category: expectOptionalString(product["category"], `${path}.category`, MAX_NAME),
      purpose: expectOptionalString(product["purpose"], `${path}.purpose`, MAX_TEXT),
      valueProposition: expectOptionalString(product["valueProposition"], `${path}.valueProposition`, MAX_TEXT),
      targetUserSummary: expectOptionalString(product["targetUserSummary"], `${path}.targetUserSummary`, MAX_TEXT),
    };
  }

  draft.features = expectArray(value["features"] ?? [], "features", MAX_DRAFT_ITEMS).map((item, index) => {
    const path = `features[${index}]`;
    const entry = expectObject(item, path);
    expectKnownKeys(
      entry,
      ["name", "description", "category", "importance", "confidence", "isMarketingClaim", "sourceIds", "evidenceKeys"],
      path,
    );
    const name = expectString(entry["name"], `${path}.name`, { max: MAX_NAME });
    return {
      ...baseFor(entry, path, context),
      key: canonicalEntityKey("FEATURE", name),
      name,
      description: expectOptionalString(entry["description"], `${path}.description`, MAX_TEXT),
      category: expectOptionalEnum(entry["category"], FEATURE_CATEGORIES, `${path}.category`, "OTHER"),
      importance: expectOptionalEnum(entry["importance"], IMPORTANCES, `${path}.importance`, "SECONDARY"),
    };
  });

  draft.problems = expectArray(value["problems"] ?? [], "problems", MAX_DRAFT_ITEMS).map((item, index) => {
    const path = `problems[${index}]`;
    const entry = expectObject(item, path);
    expectKnownKeys(entry, ["name", "description", "confidence", "isMarketingClaim", "sourceIds", "evidenceKeys"], path);
    const name = expectString(entry["name"], `${path}.name`, { max: MAX_NAME });
    return {
      ...baseFor(entry, path, context),
      key: canonicalEntityKey("PROBLEM", name),
      name,
      description: expectOptionalString(entry["description"], `${path}.description`, MAX_TEXT),
    };
  });

  draft.benefits = expectArray(value["benefits"] ?? [], "benefits", MAX_DRAFT_ITEMS).map((item, index) => {
    const path = `benefits[${index}]`;
    const entry = expectObject(item, path);
    expectKnownKeys(
      entry,
      ["name", "description", "linkedFeatureRefs", "confidence", "isMarketingClaim", "sourceIds", "evidenceKeys"],
      path,
    );
    const name = expectString(entry["name"], `${path}.name`, { max: MAX_NAME });
    return {
      ...baseFor(entry, path, context),
      key: canonicalEntityKey("BENEFIT", name),
      name,
      description: expectOptionalString(entry["description"], `${path}.description`, MAX_TEXT),
      linkedFeatureKeys: expectStringArray(entry["linkedFeatureRefs"], `${path}.linkedFeatureRefs`, MAX_DRAFT_ITEMS),
    };
  });

  draft.claims = expectArray(value["claims"] ?? [], "claims", MAX_DRAFT_ITEMS).map((item, index) => {
    const path = `claims[${index}]`;
    const entry = expectObject(item, path);
    expectKnownKeys(
      entry,
      ["text", "claimType", "sourceId", "confidence", "isMarketingClaim", "sourceIds", "evidenceKeys"],
      path,
    );
    const text = expectString(entry["text"], `${path}.text`, { max: MAX_TEXT, min: 3 });
    const sourceId =
      entry["sourceId"] === undefined || entry["sourceId"] === null
        ? null
        : assertSourceAllowed(entry["sourceId"], `${path}.sourceId`, context);
    return {
      ...baseFor(entry, path, context),
      key: canonicalEntityKey("CLAIM", text),
      text,
      claimType: expectOptionalEnum(entry["claimType"], CLAIM_TYPES, `${path}.claimType`, "OTHER"),
      sourceId,
    };
  });

  draft.workflows = expectArray(value["workflows"] ?? [], "workflows", MAX_DRAFT_ITEMS).map((item, index) => {
    const path = `workflows[${index}]`;
    const entry = expectObject(item, path);
    expectKnownKeys(
      entry,
      ["name", "description", "steps", "confidence", "isMarketingClaim", "sourceIds", "evidenceKeys"],
      path,
    );
    const name = expectString(entry["name"], `${path}.name`, { max: MAX_NAME });
    const steps = expectArray(entry["steps"] ?? [], `${path}.steps`, 50).map((step, stepIndex) => {
      const stepPath = `${path}.steps[${stepIndex}]`;
      const stepValue = expectObject(step, stepPath);
      expectKnownKeys(stepValue, ["action", "description", "featureRefs"], stepPath);
      return {
        order: stepIndex,
        action: expectString(stepValue["action"], `${stepPath}.action`, { max: MAX_SHORT_TEXT }),
        description: expectOptionalString(stepValue["description"], `${stepPath}.description`, MAX_SHORT_TEXT),
        featureKeys: expectStringArray(stepValue["featureRefs"], `${stepPath}.featureRefs`, MAX_DRAFT_ITEMS),
      };
    });
    return {
      ...baseFor(entry, path, context),
      key: canonicalEntityKey("WORKFLOW", name),
      name,
      description: expectOptionalString(entry["description"], `${path}.description`, MAX_TEXT),
      steps,
      featureKeys: steps.flatMap((step) => step.featureKeys),
    };
  });

  draft.audienceSignals = expectArray(
    value["audienceSignals"] ?? [],
    "audienceSignals",
    MAX_DRAFT_ITEMS,
  ).map((item, index) => {
    const path = `audienceSignals[${index}]`;
    const entry = expectObject(item, path);
    expectKnownKeys(
      entry,
      ["segment", "description", "kind", "confidence", "isMarketingClaim", "sourceIds", "evidenceKeys"],
      path,
    );
    const segment = expectString(entry["segment"], `${path}.segment`, { max: MAX_NAME });
    return {
      ...baseFor(entry, path, context),
      key: canonicalEntityKey("AUDIENCE_SIGNAL", segment),
      segment,
      description: expectOptionalString(entry["description"], `${path}.description`, MAX_TEXT),
      kind: expectOptionalEnum(entry["kind"], AUDIENCE_KINDS, `${path}.kind`, "CONTEXTUAL"),
    };
  });

  draft.brandSignals = expectArray(
    value["brandSignals"] ?? [],
    "brandSignals",
    MAX_DRAFT_ITEMS,
  ).map((item, index) => {
    const path = `brandSignals[${index}]`;
    const entry = expectObject(item, path);
    expectKnownKeys(
      entry,
      ["kind", "label", "value", "confidence", "isMarketingClaim", "sourceIds", "evidenceKeys"],
      path,
    );
    return {
      ...baseFor(entry, path, context),
      key: canonicalEntityKey(
        "BRAND_SIGNAL",
        `${expectEnum(entry["kind"], BRAND_KINDS, `${path}.kind`)}-${expectString(entry["label"], `${path}.label`, { max: MAX_NAME })}`,
      ),
      kind: expectEnum(entry["kind"], BRAND_KINDS, `${path}.kind`),
      label: expectString(entry["label"], `${path}.label`, { max: MAX_NAME }),
      value: expectString(entry["value"], `${path}.value`, { max: MAX_TEXT }),
    };
  });

  const resolvable = new Map<string, IntelligenceEntityType>(context.baseEntityTypes);
  for (const [key, type] of collectDraftEntityTypes(draft)) resolvable.set(key, type);
  for (const item of context.baseEvidence) resolvable.set(item.key, "EVIDENCE");
  for (const item of draft.evidence) resolvable.set(item.key, "EVIDENCE");

  function resolveRef(ref: string, declaredType: IntelligenceEntityType, path: string): string {
    if (resolvable.get(ref) === declaredType) return ref;
    let derived: string;
    try {
      derived = canonicalEntityKey(declaredType, ref);
    } catch {
      reject(path, "reference is not a known entity reference");
    }
    if (resolvable.get(derived) === declaredType) return derived;
    reject(path, `reference does not resolve to a known ${declaredType}`);
  }

  function requireEvidenceKeys(keys: readonly string[], path: string): void {
    for (const [index, key] of keys.entries()) {
      if (knownEvidence.has(key)) continue;
      reject(`${path}[${index}]`, "evidence reference does not resolve");
    }
  }

  for (const feature of draft.features) requireEvidenceKeys(feature.evidenceKeys, `features.${feature.key}.evidenceKeys`);
  for (const problem of draft.problems) requireEvidenceKeys(problem.evidenceKeys, `problems.${problem.key}.evidenceKeys`);
  for (const benefit of draft.benefits) requireEvidenceKeys(benefit.evidenceKeys, `benefits.${benefit.key}.evidenceKeys`);
  for (const claim of draft.claims) requireEvidenceKeys(claim.evidenceKeys, `claims.${claim.key}.evidenceKeys`);
  for (const workflow of draft.workflows) requireEvidenceKeys(workflow.evidenceKeys, `workflows.${workflow.key}.evidenceKeys`);
  if (draft.product) requireEvidenceKeys(draft.product.evidenceKeys, "product.evidenceKeys");
  for (const signal of draft.audienceSignals) {
    requireEvidenceKeys(signal.evidenceKeys, `audienceSignals.${signal.key}.evidenceKeys`);
  }
  for (const signal of draft.brandSignals) {
    requireEvidenceKeys(signal.evidenceKeys, `brandSignals.${signal.key}.evidenceKeys`);
  }

  for (const benefit of draft.benefits) {
    benefit.linkedFeatureKeys = benefit.linkedFeatureKeys.map((ref, index) =>
      resolveRef(ref, "FEATURE", `benefits.${benefit.key}.linkedFeatureRefs[${index}]`),
    );
  }
  for (const workflow of draft.workflows) {
    workflow.steps = workflow.steps.map((step, stepIndex) => ({
      ...step,
      featureKeys: step.featureKeys.map((ref, index) =>
        resolveRef(ref, "FEATURE", `workflows.${workflow.key}.steps[${stepIndex}].featureRefs[${index}]`),
      ),
    }));
    workflow.featureKeys = workflow.steps.flatMap((step) => step.featureKeys);
  }

  draft.relationships = expectArray(
    value["relationships"] ?? [],
    "relationships",
    MAX_DRAFT_ITEMS * 2,
  ).map((item, index) => {
    const path = `relationships[${index}]`;
    const entry = expectObject(item, path);
    expectKnownKeys(entry, ["type", "fromType", "fromRef", "toType", "toRef", "confidence"], path);
    const type = expectEnum(entry["type"], RELATIONSHIP_TYPES, `${path}.type`);
    const endpoints = RELATIONSHIP_ENDPOINTS[type];
    const fromType = expectEnum(entry["fromType"], [endpoints.from], `${path}.fromType`);
    const toType = expectEnum(entry["toType"], [endpoints.to], `${path}.toType`);
    return {
      type,
      fromType,
      fromKey: resolveRef(
        expectString(entry["fromRef"], `${path}.fromRef`, { max: MAX_NAME }),
        fromType,
        `${path}.fromRef`,
      ),
      toType,
      toKey: resolveRef(
        expectString(entry["toRef"], `${path}.toRef`, { max: MAX_NAME }),
        toType,
        `${path}.toRef`,
      ),
      confidence: expectOptionalEnum(
        entry["confidence"],
        INTELLIGENCE_CONFIDENCE_LEVELS,
        `${path}.confidence`,
        "MEDIUM",
      ),
    };
  });

  return draft;
}
