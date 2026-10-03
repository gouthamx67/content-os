import type {
  GraphicDesignGraph,
  GraphicDocumentRecord,
  GraphicTemplateType,
  ImageOutputFormat,
} from "../domain/types";
import { parseDesignGraph } from "../serialization/graphic-document";

export type EditorGraphicContract = {
  documentId: string;
  projectId: string;
  name: string;
  templateType: GraphicTemplateType;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  transparent: boolean;
  designGraph: GraphicDesignGraph;
  designGraphHash: string;
  contractVersion: number;
};

/**
 * The hand-off CP20 consumes to edit a saved design. It exposes the graph, not
 * the storage, so an editor never needs to know where any of this is kept.
 */
export function toEditorContract(
  document: GraphicDocumentRecord,
): EditorGraphicContract {
  return {
    documentId: document.id,
    projectId: document.projectId,
    name: document.name,
    templateType: document.templateType,
    width: document.width,
    height: document.height,
    outputFormat: document.outputFormat,
    transparent: document.transparent,
    designGraph: parseDesignGraph(document.designGraph),
    designGraphHash: document.designGraphHash,
    contractVersion: document.contractVersion,
  };
}
