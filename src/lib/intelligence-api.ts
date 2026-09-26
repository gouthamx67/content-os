import {
  ASSET_ROLES,
  AUDIENCE_SIGNAL_KINDS,
  BRAND_SIGNAL_KINDS,
  CLAIM_TYPES,
  FEATURE_CATEGORIES,
  IMPORTANCE_LEVELS,
  VERIFICATION_STATUSES,
  type IntelligenceGraph,
  type IntelligenceRelationship,
} from "../core/domain/intelligence";
import { IntelligenceError, type AssertionKind } from "../core/domain/intelligence";
import type {
  UpdateAssetInput,
  UpdateAudienceSignalInput,
  UpdateBenefitInput,
  UpdateBrandSignalInput,
  UpdateClaimInput,
  UpdateFeatureInput,
  UpdateProblemInput,
  UpdateProductInput,
  UpdateWorkflowInput,
} from "../core/ports/intelligence-repository";
import { HttpError, jsonError, wrapHttpError } from "./http";

const ASSERTION_KIND_SET: ReadonlySet<string> = new Set<string>([
  "FACT",
  "INFERENCE",
  "USER_PROVIDED",
  "MARKETING_CLAIM",
]);

const INTELLIGENCE_ERROR_STATUS: Readonly<Record<string, number>> = {
  INTELLIGENCE_INVALID_INPUT: 400,
  INTELLIGENCE_NOT_FOUND: 404,
  INTELLIGENCE_ALREADY_RUNNING: 409,
  INTELLIGENCE_AI_INVALID_OUTPUT: 422,
  INTELLIGENCE_AI_UNAVAILABLE: 422,
  INTELLIGENCE_SOURCE_UNREADABLE: 422,
  INTELLIGENCE_SCOPE_VIOLATION: 403,
};

export function wrapIntelligenceHttpError(error: unknown): Response {
  if (error instanceof IntelligenceError) {
    return jsonError(
      INTELLIGENCE_ERROR_STATUS[error.code] ?? 500,
      error.message,
      { code: error.code },
    );
  }
  return wrapHttpError(error);
}

export type SerializedIntelligenceRelationship = Omit<
  IntelligenceRelationship,
  "projectId" | "createdAt"
>;

export type SerializedIntelligenceGraph = Omit<IntelligenceGraph, "relationships"> & {
  relationships: SerializedIntelligenceRelationship[];
};

function serializeRelationship(
  relationship: IntelligenceRelationship,
): SerializedIntelligenceRelationship {
  return {
    id: relationship.id,
    type: relationship.type,
    fromType: relationship.fromType,
    fromId: relationship.fromId,
    toType: relationship.toType,
    toId: relationship.toId,
    confidence: relationship.confidence,
  };
}

export function serializeGraph(graph: IntelligenceGraph): SerializedIntelligenceGraph {
  return {
    product: graph.product,
    features: graph.features,
    problems: graph.problems,
    benefits: graph.benefits,
    claims: graph.claims,
    workflows: graph.workflows,
    audienceSignals: graph.audienceSignals,
    brandSignals: graph.brandSignals,
    assets: graph.assets,
    evidence: graph.evidence,
    relationships: graph.relationships.map(serializeRelationship),
  };
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`);
  }
  return value;
}

function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function optionalAssertionKind(
  body: Record<string, unknown>,
  field = "assertionKind",
): AssertionKind | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (typeof value !== "string" || !ASSERTION_KIND_SET.has(value)) {
    throw new HttpError(400, `${field} must be a valid assertion kind`);
  }
  return value as AssertionKind;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required`);
  }
  return value;
}

export type ParsedCorrection =
  | { scope: "product"; changes: UpdateProductInput }
  | { scope: "FEATURE"; canonicalKey: string; changes: UpdateFeatureInput }
  | { scope: "PROBLEM"; canonicalKey: string; changes: UpdateProblemInput }
  | { scope: "BENEFIT"; canonicalKey: string; changes: UpdateBenefitInput }
  | { scope: "CLAIM"; canonicalKey: string; changes: UpdateClaimInput }
  | { scope: "WORKFLOW"; canonicalKey: string; changes: UpdateWorkflowInput }
  | { scope: "AUDIENCE_SIGNAL"; canonicalKey: string; changes: UpdateAudienceSignalInput }
  | { scope: "BRAND_SIGNAL"; canonicalKey: string; changes: UpdateBrandSignalInput }
  | { scope: "ASSET"; canonicalKey: string; changes: UpdateAssetInput };

const ENTITY_TYPES = [
  "FEATURE",
  "PROBLEM",
  "BENEFIT",
  "CLAIM",
  "WORKFLOW",
  "AUDIENCE_SIGNAL",
  "BRAND_SIGNAL",
  "ASSET",
] as const;

export type CorrectableEntityType = (typeof ENTITY_TYPES)[number];

function parseWorkflowSteps(
  body: Record<string, unknown>,
): UpdateWorkflowInput["steps"] | undefined {
  if (!("steps" in body)) return undefined;
  const value = body.steps;
  if (!Array.isArray(value)) {
    throw new HttpError(400, "steps must be an array");
  }
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError(400, `steps[${index}] must be an object`);
    }
    const step = entry as Record<string, unknown>;
    const featureIds = step.featureIds;
    if (featureIds !== undefined && !isStringArray(featureIds)) {
      throw new HttpError(400, `steps[${index}].featureIds must be an array of strings`);
    }
    return {
      order: typeof step.order === "number" ? step.order : index,
      action: requiredString(step, "action"),
      description: optionalString(step, "description") ?? null,
      featureIds: (featureIds as string[] | undefined) ?? [],
    };
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseCorrectionRequest(body: Record<string, unknown>): ParsedCorrection {
  const scope = body.scope;

  if (scope === "product") {
    const changes: UpdateProductInput = {};
    for (const field of [
      "name",
      "shortDescription",
      "longDescription",
      "category",
      "purpose",
      "valueProposition",
      "targetUserSummary",
    ] as const) {
      const value = optionalString(body, field);
      if (value !== undefined) changes[field] = value;
    }
    const assertionKind = optionalAssertionKind(body);
    if (assertionKind) changes.assertionKind = assertionKind;

    if (Object.keys(changes).length === 0) {
      throw new HttpError(400, "At least one field is required");
    }
    return { scope: "product", changes };
  }

  if (typeof scope !== "string" || !ENTITY_TYPES.includes(scope as CorrectableEntityType)) {
    throw new HttpError(400, `scope must be product or one of: ${ENTITY_TYPES.join(", ")}`);
  }

  const entityType = scope as CorrectableEntityType;
  const canonicalKey = requiredString(body, "canonicalKey");
  const assertionKind = optionalAssertionKind(body);

  switch (entityType) {
    case "FEATURE": {
      const changes: UpdateFeatureInput = {};
      assign(changes, "name", optionalString(body, "name"));
      assign(changes, "description", optionalString(body, "description"));
      assign(changes, "category", optionalEnum(body, "category", FEATURE_CATEGORIES));
      assign(changes, "importance", optionalEnum(body, "importance", IMPORTANCE_LEVELS));
      assign(changes, "assertionKind", assertionKind);
      requireFields(changes);
      return { scope: "FEATURE", canonicalKey, changes };
    }
    case "PROBLEM":
    case "BENEFIT": {
      const changes: UpdateProblemInput & UpdateBenefitInput = {};
      assign(changes, "name", optionalString(body, "name"));
      assign(changes, "description", optionalString(body, "description"));
      assign(changes, "assertionKind", assertionKind);
      requireFields(changes);
      return entityType === "PROBLEM"
        ? { scope: "PROBLEM", canonicalKey, changes }
        : { scope: "BENEFIT", canonicalKey, changes };
    }
    case "CLAIM": {
      const changes: UpdateClaimInput = {};
      assign(changes, "text", optionalString(body, "text"));
      assign(changes, "claimType", optionalEnum(body, "claimType", CLAIM_TYPES));
      assign(changes, "verification", optionalEnum(body, "verification", VERIFICATION_STATUSES));
      assign(changes, "assertionKind", assertionKind);
      requireFields(changes);
      return { scope: "CLAIM", canonicalKey, changes };
    }
    case "WORKFLOW": {
      const changes: UpdateWorkflowInput = {};
      assign(changes, "name", optionalString(body, "name"));
      assign(changes, "description", optionalString(body, "description"));
      assign(changes, "steps", parseWorkflowSteps(body));
      assign(changes, "assertionKind", assertionKind);
      requireFields(changes);
      return { scope: "WORKFLOW", canonicalKey, changes };
    }
    case "AUDIENCE_SIGNAL": {
      const changes: UpdateAudienceSignalInput = {};
      assign(changes, "segment", optionalString(body, "segment"));
      assign(changes, "description", optionalString(body, "description"));
      assign(changes, "kind", optionalEnum(body, "kind", AUDIENCE_SIGNAL_KINDS));
      assign(changes, "assertionKind", assertionKind);
      requireFields(changes);
      return { scope: "AUDIENCE_SIGNAL", canonicalKey, changes };
    }
    case "BRAND_SIGNAL": {
      const changes: UpdateBrandSignalInput = {};
      assign(changes, "label", optionalString(body, "label"));
      assign(changes, "value", optionalString(body, "value"));
      assign(changes, "kind", optionalEnum(body, "kind", BRAND_SIGNAL_KINDS));
      assign(changes, "assertionKind", assertionKind);
      requireFields(changes);
      return { scope: "BRAND_SIGNAL", canonicalKey, changes };
    }
    case "ASSET": {
      const changes: UpdateAssetInput = {};
      assign(changes, "name", optionalString(body, "name"));
      assign(changes, "role", optionalEnum(body, "role", ASSET_ROLES));
      assign(changes, "assertionKind", assertionKind);
      requireFields(changes);
      return { scope: "ASSET", canonicalKey, changes };
    }
  }
}

function requireFields(changes: object): void {
  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, "At least one field is required");
  }
}

function assign<T extends object>(
  changes: T,
  field: keyof T & string,
  value: unknown,
): void {
  if (value !== undefined) (changes as Record<string, unknown>)[field] = value;
}

export function parseSourceIds(body: Record<string, unknown>): string[] | undefined {
  if (!("sourceIds" in body)) return undefined;
  const value = body.sourceIds;
  if (!isStringArray(value)) {
    throw new HttpError(400, "sourceIds must be an array of strings");
  }
  return value;
}
