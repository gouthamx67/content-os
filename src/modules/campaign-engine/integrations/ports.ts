import type { LaunchKitAsset } from "../domain/types";

/**
 * What a deliverable may link to.
 *
 * The names are the engines the project already owns, not new concepts: a
 * campaign references a source, a content intent, a writing document, an
 * adaptation batch, an editor document, a generated graphic, or an asset. The
 * campaign never copies their bytes.
 */
export const ARTIFACT_KINDS = [
  "source",
  "intent",
  "writing",
  "adaptation",
  "editor",
  "graphic",
  "asset",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const LINK_SLOTS = [
  "intentId",
  "writingDocumentId",
  "adaptationBatchId",
  "editorDocumentId",
  "graphicDocumentId",
] as const;
export type LinkSlot = (typeof LINK_SLOTS)[number];

export const KIND_BY_SLOT: Record<LinkSlot, ArtifactKind> = {
  intentId: "intent",
  writingDocumentId: "writing",
  adaptationBatchId: "adaptation",
  editorDocumentId: "editor",
  graphicDocumentId: "graphic",
};

/**
 * `FOUND` belongs to the project; `MISSING` does not exist; `FOREIGN` exists but
 * belongs to a different project. The distinction is what lets a cross-project
 * link be a hard refusal while a deleted artifact is a readiness finding.
 */
export type ArtifactStatus = "FOUND" | "MISSING" | "FOREIGN";

export type ResolvedAsset = LaunchKitAsset;

/**
 * The read side of the project's artifacts. Implemented by the container over
 * the owning repositories, so the campaign engine depends on this shape rather
 * than on any one engine's persistence.
 */
export type CampaignArtifacts = {
  locate(projectId: string, kind: ArtifactKind, id: string): Promise<ArtifactStatus>;

  /**
   * The text a publisher would ship for a deliverable: the selected variant of a
   * writing document. Never a storage path.
   */
  copy(
    projectId: string,
    documentId: string,
  ): Promise<{ title: string; content: string } | null>;

  assets(
    projectId: string,
    assetIds: readonly string[],
  ): Promise<ResolvedAsset[]>;
};

/**
 * The grounding the project can offer a campaign: which sources exist, which
 * version of intelligence and brand it is working from, and which platforms its
 * intents declared. `null` versions mean the project has not produced them yet,
 * which readiness treats as "not grounded" rather than as zero.
 */
export type CampaignGroundingFacts = {
  sourceIds: string[];
  intelligenceVersion: number | null;
  brandVersion: number | null;
  projectPlatforms: string[];
};

export type CampaignGroundingProvider = {
  gather(projectId: string): Promise<CampaignGroundingFacts>;
};
