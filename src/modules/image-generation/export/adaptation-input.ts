import type {
  GeneratedImageAssetRecord,
  GraphicTemplateType,
  ImageOutputFormat,
} from "../domain/types";
import { generatedAssetRef } from "../assets/asset-reference";

export type AdaptationInput = {
  sourceAssetRef: string;
  projectId: string;
  templateType: GraphicTemplateType;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  transparent: boolean;
  mimeType: string;
};

/**
 * The shape CP19 receives when it adapts an existing generation into a new
 * format. It carries the logical ref and the intrinsic properties of the source,
 * never a storage key.
 */
export function toAdaptationInput(args: {
  asset: GeneratedImageAssetRecord;
  templateType: GraphicTemplateType;
}): AdaptationInput {
  return {
    sourceAssetRef: generatedAssetRef(args.asset.id),
    projectId: args.asset.projectId,
    templateType: args.templateType,
    width: args.asset.width,
    height: args.asset.height,
    outputFormat: args.asset.outputFormat,
    transparent: args.asset.transparent,
    mimeType: args.asset.mimeType,
  };
}
