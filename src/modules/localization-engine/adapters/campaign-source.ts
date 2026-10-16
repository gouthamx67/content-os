import type { CampaignRepository } from "../../../core/ports/campaign-repository";
import type {
  ExtractedSource,
  LocalizationSourceAdapter,
  SourceSegmentDraft,
} from "../integrations/ports";

/**
 * CP21 launch campaigns.
 *
 * The campaign's brief fields and every deliverable's title and brief become
 * segments. The campaign revision number is the source revision, so any later
 * edit to the campaign marks an existing localization stale.
 */
export class CampaignSourceAdapter implements LocalizationSourceAdapter {
  readonly sourceType = "CAMPAIGN" as const;

  constructor(private readonly campaigns: CampaignRepository) {}

  async extract(input: {
    projectId: string;
    sourceId: string;
    sourceLocale: string;
  }): Promise<ExtractedSource | null> {
    const campaign = await this.campaigns.getCampaign(
      input.projectId,
      input.sourceId,
    );
    if (!campaign) return null;

    const drafts: SourceSegmentDraft[] = [];
    const push = (path: string, kind: SourceSegmentDraft["kind"], text: string) => {
      if (text.trim().length === 0) return;
      drafts.push({ path, kind, sourceText: text });
    };

    const base = `campaign:${campaign.id}`;
    push(`${base}:name`, "HEADLINE", campaign.name);
    push(`${base}:objective`, "METADATA", campaign.objective);
    push(`${base}:audience`, "METADATA", campaign.audienceSummary);
    push(`${base}:keyMessage`, "BODY", campaign.keyMessage);

    const deliverables = await this.campaigns.listDeliverables(campaign.id);
    for (const deliverable of deliverables) {
      const prefix = `${base}:deliverable:${deliverable.id}`;
      push(`${prefix}:title`, "HEADLINE", deliverable.title);
      push(`${prefix}:objective`, "METADATA", deliverable.brief.objective);
      push(`${prefix}:keyMessage`, "BODY", deliverable.brief.keyMessage);
      if (deliverable.brief.notes) {
        push(`${prefix}:notes`, "BODY", deliverable.brief.notes);
      }
    }

    return {
      sourceRevision: `r${campaign.revisionNumber}`,
      sourceLocale: input.sourceLocale,
      drafts,
    };
  }
}
