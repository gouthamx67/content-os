import type { AdaptationRepository } from "../../../core/ports/adaptation-repository";
import type {
  ExtractedSource,
  LocalizationSourceAdapter,
  SourceSegmentDraft,
} from "../integrations/ports";
import { splitParagraphs } from "./text";

/**
 * CP19 adapted text outputs.
 *
 * Only a job whose output is text can be localized; an image or video job has no
 * text to extract and resolves to `null`, which the extractor reports as a
 * missing source rather than inventing an empty job.
 */
export class AdaptationSourceAdapter implements LocalizationSourceAdapter {
  readonly sourceType = "ADAPTATION_JOB" as const;

  constructor(private readonly adaptations: { getJob: AdaptationRepository["getJob"] }) {}

  async extract(input: {
    projectId: string;
    sourceId: string;
    sourceLocale: string;
  }): Promise<ExtractedSource | null> {
    const job = await this.adaptations.getJob(input.projectId, input.sourceId);
    if (!job || job.outputText === null) return null;

    const drafts: SourceSegmentDraft[] = [];
    splitParagraphs(job.outputText).forEach((paragraph, index) => {
      drafts.push({
        path: `adaptation:${job.id}:body:${index}`,
        kind: "BODY",
        sourceText: paragraph,
        metadata: { platformId: job.platformId, formatId: job.formatId },
      });
    });

    return {
      sourceRevision: `r${job.updatedAt}`,
      sourceLocale: input.sourceLocale,
      drafts,
    };
  }
}
