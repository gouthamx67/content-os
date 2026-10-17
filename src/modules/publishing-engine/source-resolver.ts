import type { WritingRepository } from "../../core/ports/writing-repository";
import type { CampaignRepository } from "../../core/ports/campaign-repository";
import type {
  PublicationSourceType,
  ResolvedPublicationSource,
  ValidationFinding,
} from "./domain/types";
import {
  VALIDATION_CODES,
  findingError,
  findingWarning,
} from "./domain/validation";
import { buildPublishableSnapshot } from "./serialization";

export type SourceResolution =
  | { ok: true; source: ResolvedPublicationSource }
  | { ok: false; findings: ValidationFinding[] };

/**
 * Turns a project-owned source (a writing document, or a campaign deliverable
 * whose linked writing document carries the published text) into an immutable
 * publishable snapshot plus the findings its own provenance earns.
 *
 * The resolver never invents content: if the source cannot be read, or the
 * campaign/deliverable is not approved and ready, the caller gets findings
 * instead of a snapshot, and validation records exactly that.
 */
export class PublicationSourceResolver {
  constructor(
    private readonly deps: {
      writing: WritingRepository;
      campaigns: CampaignRepository;
    },
  ) {}

  async resolve(
    projectId: string,
    sourceType: PublicationSourceType,
    sourceId: string,
  ): Promise<SourceResolution> {
    return sourceType === "WRITING_DOCUMENT"
      ? this.resolveWritingDocument(projectId, sourceId)
      : this.resolveCampaignDeliverable(projectId, sourceId);
  }

  private async resolveWritingDocument(
    projectId: string,
    documentId: string,
  ): Promise<SourceResolution> {
    const document = await this.deps.writing.getDocument(projectId, documentId);
    if (!document) {
      return {
        ok: false,
        findings: [
          findingError(
            VALIDATION_CODES.SOURCE_NOT_FOUND,
            `Writing document ${documentId} was not found in this project.`,
            "Choose an existing writing document.",
          ),
        ],
      };
    }

    const snapshot = buildPublishableSnapshot({
      title: document.title,
      content: document.content,
      sourceLabel: `Writing document “${document.title}” (v${document.version})`,
      approvalNote: null,
    });

    return {
      ok: true,
      source: {
        sourceType: "WRITING_DOCUMENT",
        sourceId: document.id,
        sourceRevision: `v${document.version}`,
        snapshot,
        findings: await this.groundingFindings(projectId, document.id),
      },
    };
  }

  private async resolveCampaignDeliverable(
    projectId: string,
    deliverableId: string,
  ): Promise<SourceResolution> {
    const deliverable = await this.deps.campaigns.getDeliverableForProject(
      projectId,
      deliverableId,
    );
    if (!deliverable) {
      return {
        ok: false,
        findings: [
          findingError(
            VALIDATION_CODES.SOURCE_NOT_FOUND,
            `Campaign deliverable ${deliverableId} was not found in this project.`,
            "Choose a deliverable from a campaign in this project.",
          ),
        ],
      };
    }

    const campaign = await this.deps.campaigns.getCampaign(
      projectId,
      deliverable.campaignId,
    );
    if (!campaign) {
      return {
        ok: false,
        findings: [
          findingError(
            VALIDATION_CODES.SOURCE_NOT_FOUND,
            `The campaign that owns deliverable ${deliverable.id} was not found in this project.`,
            null,
          ),
        ],
      };
    }

    const findings: ValidationFinding[] = [];
    if (campaign.status !== "APPROVED") {
      findings.push(
        findingError(
          VALIDATION_CODES.SOURCE_NOT_APPROVED,
          `Campaign “${campaign.name}” is ${campaign.status}; publishing requires an approved campaign.`,
          "Approve the campaign, then validate again.",
        ),
      );
    }
    if (deliverable.status !== "READY") {
      findings.push(
        findingError(
          VALIDATION_CODES.SOURCE_NOT_APPROVED,
          `Deliverable “${deliverable.title}” is ${deliverable.status}; publishing requires a READY deliverable.`,
          "Mark the deliverable READY once its work is complete.",
        ),
      );
    }

    const writingDocumentId = deliverable.links.writingDocumentId;
    if (writingDocumentId === null) {
      findings.push(
        findingError(
          VALIDATION_CODES.SOURCE_LINKS_AMBIGUOUS,
          deliverable.links.editorDocumentId
            ? "The deliverable links an editor document; publishing currently requires a linked writing document."
            : "The deliverable has no linked writing document to publish.",
          "Link a writing document to this deliverable in the campaign plan.",
        ),
      );
      return { ok: false, findings };
    }
    if (findings.some((finding) => finding.severity === "ERROR")) {
      return { ok: false, findings };
    }

    const document = await this.deps.writing.getDocument(projectId, writingDocumentId);
    if (!document) {
      return {
        ok: false,
        findings: [
          findingError(
            VALIDATION_CODES.SOURCE_NOT_FOUND,
            "The deliverable's linked writing document was not found in this project.",
            "Re-link the deliverable to a writing document that exists.",
          ),
        ],
      };
    }

    const snapshot = buildPublishableSnapshot({
      title: document.title,
      content: document.content,
      sourceLabel: `Campaign “${campaign.name}” → deliverable “${deliverable.title}” → writing “${document.title}” (v${document.version})`,
      approvalNote: campaign.approvedAt
        ? `Campaign approved at revision r${campaign.revisionNumber} on ${campaign.approvedAt}.`
        : null,
    });

    return {
      ok: true,
      source: {
        sourceType: "CAMPAIGN_DELIVERABLE",
        sourceId: deliverable.id,
        sourceRevision: `r${campaign.revisionNumber}:v${document.version}`,
        snapshot,
        findings: [
          ...findings,
          ...(await this.groundingFindings(projectId, document.id)),
        ],
      },
    };
  }

  private async groundingFindings(
    projectId: string,
    documentId: string,
  ): Promise<ValidationFinding[]> {
    const claims = await this.deps.writing.listClaims(projectId, documentId);
    if (claims.length === 0) {
      return [
        findingWarning(
          VALIDATION_CODES.SOURCE_GROUNDING_NOT_EVALUATED,
          "This document has no grounding claims, so its statements were not checked against project sources.",
          "Run grounding on the document before publishing authoritative content.",
        ),
      ];
    }
    const unsupported = claims.filter(
      (claim) => claim.status === "UNSUPPORTED",
    ).length;
    const review = claims.filter((claim) => claim.status === "REVIEW").length;
    if (unsupported + review === 0) return [];
    return [
      findingError(
        VALIDATION_CODES.SOURCE_GROUNDING_UNSUPPORTED,
        `${unsupported} unsupported and ${review} review-flagged claim(s) remain in the document.`,
        "Resolve unsupported or review-flagged claims in the writing document, then validate again.",
      ),
    ];
  }
}
