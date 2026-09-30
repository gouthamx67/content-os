/**
 * Assembles the creative context from the project's own records. This is the one
 * place that reads intelligence, brand, assets and the intent together, so the
 * rest of CP10 can treat "what the project actually contains" as a given.
 *
 * Everything here is derived on the server. No caller can widen it, which is what
 * makes the validator's rejections meaningful: a rejected asset id is not
 * something the browser was allowed to make up in the first place.
 */

import type { ContentIntent } from "../domain/content-intent";
import { getContentType } from "../domain/content-type";
import {
  brandContext,
  type CreativeContext,
  type CreativeContextAsset,
  type CreativeContextEvidence,
  type CreativeContextProduct,
} from "../domain/creative-context";
import type { BrandExecutionProfile } from "../domain/brand";
import type { IntelligenceGraph } from "../domain/intelligence";
import type { Asset } from "../domain/asset";
import { getCreativeModePolicy } from "./creative-mode-policy";

/** Asset types that can stand in for the real product interface. */
const PRODUCT_UI_TYPES = new Set(["PRODUCT_UI", "SCREENSHOT"]);

function toContextAsset(
  asset: IntelligenceGraph["assets"][number],
): CreativeContextAsset {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.mediaType,
    role: asset.role,
    isProductUi:
      PRODUCT_UI_TYPES.has(asset.mediaType) ||
      asset.role === "PRODUCT_UI" ||
      asset.role === "FEATURE_PROOF",
    origin: "INTELLIGENCE",
  };
}

function toProjectAsset(asset: Asset): CreativeContextAsset {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    role: null,
    isProductUi: PRODUCT_UI_TYPES.has(asset.type),
    origin: "PROJECT",
  };
}

function toProduct(graph: IntelligenceGraph): CreativeContextProduct {
  return {
    name: graph.product?.name ?? "",
    description:
      graph.product?.shortDescription ?? graph.product?.longDescription ?? "",
    valueProposition:
      graph.product?.valueProposition ?? graph.product?.purpose ?? "",
    features: graph.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      description: feature.description ?? "",
    })),
    problems: graph.problems.map((problem) => ({
      id: problem.id,
      description: problem.description ?? problem.name ?? "",
    })),
    benefits: graph.benefits.map((benefit) => ({
      id: benefit.id,
      description: benefit.description ?? benefit.name ?? "",
    })),
    workflows: graph.workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      steps: workflow.steps.map((step) => step.action),
    })),
    claims: graph.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      verification: claim.verification,
      evidenceIds: graph.relationships
        .filter(
          (relationship) =>
            relationship.type === "CLAIM_SUPPORTED_BY_EVIDENCE" &&
            relationship.fromId === claim.id,
        )
        .map((relationship) => relationship.toId),
    })),
    audienceSummary: graph.product?.targetUserSummary ?? "",
  };
}

function toEvidence(graph: IntelligenceGraph): CreativeContextEvidence[] {
  return graph.evidence.map((item) => ({
    id: item.id,
    kind: item.kind,
    locator: item.locator,
    snippet: item.excerpt ?? "",
    claimIds: graph.relationships
      .filter(
        (relationship) =>
          relationship.type === "CLAIM_SUPPORTED_BY_EVIDENCE" &&
          relationship.toId === item.id,
      )
      .map((relationship) => relationship.fromId),
  }));
}

export interface CreativeContextInput {
  intent: ContentIntent;
  graph: IntelligenceGraph;
  brand: BrandExecutionProfile | null;
  assets: Asset[];
  mode: string;
  intelligenceVersion: number | null;
}

export function buildCreativeContext(
  input: CreativeContextInput,
): CreativeContext {
  const policy = getCreativeModePolicy(input.mode);
  const contentType = getContentType(input.intent.contentTypeId);
  const customRatio = input.intent.customAspectRatio;

  return {
    projectId: input.intent.projectId,
    intentId: input.intent.id,
    intent: {
      channel: input.intent.channel,
      contentTypeName: contentType?.name ?? "Content",
      purpose: input.intent.purpose ?? null,
      audience: input.intent.audience ?? null,
      tone: input.intent.tone ?? null,
      style: input.intent.style ?? null,
      language: input.intent.language ?? null,
      cta: input.intent.cta ?? null,
      durationSeconds: input.intent.durationSeconds ?? null,
      quantity: input.intent.quantity,
      aspectRatio: customRatio
        ? `${customRatio.width}x${customRatio.height}`
        : input.intent.aspectRatio ?? null,
      platforms: [...input.intent.platforms],
      rawRequest: input.intent.rawRequest,
      subjects: input.intent.subjects.map((subject) => ({
        type: subject.type,
        id: subject.id,
      })),
      constraints: input.intent.constraints.map(
        (constraint) => `${constraint.key}: ${constraint.value}`,
      ),
    },
    product: toProduct(input.graph),
    brand: brandContext(input.brand),
    assets: [
      ...input.graph.assets.map(toContextAsset),
      ...input.assets.map(toProjectAsset),
    ],
    evidence: toEvidence(input.graph),
    mode: policy.mode,
    policy,
    brandVersion: input.intent.brandVersion ?? input.brand?.version ?? null,
    intelligenceVersion:
      input.intent.intelligenceSnapshotVersion ?? input.intelligenceVersion,
  };
}
