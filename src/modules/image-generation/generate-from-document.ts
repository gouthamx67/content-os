import type {
  GraphicDocumentRecord,
  ImageGenerationJobRecord,
  ImageGenerationProvider,
} from "./domain/types";
import type { ImageGenerationService } from "./generation-service";

/**
 * Renders a saved document. The document supplies the artwork, so the job takes
 * the fixed design graph path rather than asking a template to redraw it.
 */
export function generateFromDocument(
  service: ImageGenerationService,
  args: {
    document: GraphicDocumentRecord;
    userId: string;
    prompt?: string;
    provider?: ImageGenerationProvider;
  },
): Promise<ImageGenerationJobRecord> {
  return service.enqueue({
    projectId: args.document.projectId,
    requestedById: args.userId,
    templateType: args.document.templateType,
    prompt: args.prompt ?? args.document.name,
    width: args.document.width,
    height: args.document.height,
    outputFormat: args.document.outputFormat,
    transparent: args.document.transparent,
    provider: args.provider,
    graphicDocumentId: args.document.id,
  });
}
