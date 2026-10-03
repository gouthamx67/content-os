import type {
  GenerationContext,
  GraphicDesignGraph,
  GraphicTemplateType,
  ImageOutputFormat,
} from "../domain/types";

export type GraphicTemplateBuildInput = {
  context: GenerationContext;
  width: number;
  height: number;
  transparent: boolean;
};

export type GraphicTemplate = {
  type: GraphicTemplateType;
  label: string;
  description: string;
  defaultWidth: number;
  defaultHeight: number;
  supportsTransparency: boolean;
  defaultFormat: ImageOutputFormat;
  /** Deterministic: same context plus size always yields the same graph. */
  build(input: GraphicTemplateBuildInput): GraphicDesignGraph;
};
