import { ImageGenerationError } from "../errors";
import {
  GRAPHIC_ELEMENT_TYPES,
  GRAPHIC_TEMPLATE_TYPES,
  IMAGE_OUTPUT_FORMATS,
  type GraphicBackground,
  type GraphicDesignGraph,
  type GraphicElement,
  type ImageGenerationRequest,
  type ImageOutputFormat,
} from "./types";
import { IMAGE_GENERATION_LIMITS } from "../generation-limits";

export const MAX_IMAGE_WIDTH = IMAGE_GENERATION_LIMITS.maxWidth;
export const MAX_IMAGE_HEIGHT = IMAGE_GENERATION_LIMITS.maxHeight;
export const MAX_ELEMENTS = IMAGE_GENERATION_LIMITS.maxElements;

function fail(message: string): never {
  throw new ImageGenerationError("IMAGE_INVALID_REQUEST", message, 400);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateGenerationRequest(
  request: ImageGenerationRequest,
): void {
  if (!request || typeof request !== "object") {
    fail("A generation request is required");
  }

  if (!GRAPHIC_TEMPLATE_TYPES.includes(request.templateType)) {
    fail(`Unknown graphic template: ${String(request.templateType)}`);
  }

  if (typeof request.prompt !== "string") {
    fail("A prompt is required");
  }

  const prompt = request.prompt.trim();
  if (prompt.length === 0) {
    fail("A prompt is required");
  }
  if (request.prompt.length > IMAGE_GENERATION_LIMITS.maxPromptLength) {
    fail(
      `Prompt exceeds ${IMAGE_GENERATION_LIMITS.maxPromptLength} characters`,
    );
  }

  const width = request.width ?? 1080;
  const height = request.height ?? 1080;

  if (!isPositiveInt(width) || width > MAX_IMAGE_WIDTH) {
    fail(`Width must be an integer between 1 and ${MAX_IMAGE_WIDTH}`);
  }
  if (!isPositiveInt(height) || height > MAX_IMAGE_HEIGHT) {
    fail(`Height must be an integer between 1 and ${MAX_IMAGE_HEIGHT}`);
  }
  if (width * height > IMAGE_GENERATION_LIMITS.maxPixels) {
    fail(
      `Requested pixel count exceeds ${IMAGE_GENERATION_LIMITS.maxPixels}`,
    );
  }

  const format = request.outputFormat ?? "PNG";
  if (!IMAGE_OUTPUT_FORMATS.includes(format)) {
    fail(`Unknown output format: ${String(format)}`);
  }
  if (format === "JPEG" && request.transparent) {
    throw new ImageGenerationError(
      "IMAGE_INVALID_REQUEST",
      "JPEG does not support transparency; use PNG",
      422,
    );
  }
}

export function validateDesignGraph(graph: GraphicDesignGraph): void {
  if (!graph || typeof graph !== "object") {
    fail("A design graph is required");
  }
  if (graph.contractVersion !== 1) {
    fail(`Unsupported design graph contract version: ${graph.contractVersion}`);
  }
  if (!isPositiveInt(graph.width) || graph.width > MAX_IMAGE_WIDTH) {
    fail(`Design width must be between 1 and ${MAX_IMAGE_WIDTH}`);
  }
  if (!isPositiveInt(graph.height) || graph.height > MAX_IMAGE_HEIGHT) {
    fail(`Design height must be between 1 and ${MAX_IMAGE_HEIGHT}`);
  }
  if (graph.width * graph.height > IMAGE_GENERATION_LIMITS.maxPixels) {
    fail("Design pixel count exceeds the limit");
  }
  if (!isBackground(graph.background)) {
    fail("Design background must be a colour or transparent");
  }
  if (!Array.isArray(graph.elements)) {
    fail("Design elements must be an array");
  }
  if (graph.elements.length === 0) {
    fail("A design graph needs at least one element");
  }
  if (graph.elements.length > MAX_ELEMENTS) {
    fail(`A design graph may not exceed ${MAX_ELEMENTS} elements`);
  }

  const ids = new Set<string>();
  for (const element of graph.elements) {
    validateElement(element, graph, ids);
  }
}

function isBackground(value: unknown): value is GraphicBackground {
  if (!value || typeof value !== "object") return false;
  const background = value as Record<string, unknown>;
  if (background["kind"] === "TRANSPARENT") return true;
  return (
    background["kind"] === "COLOR" &&
    typeof background["color"] === "string" &&
    background["color"].length > 0
  );
}

function validateElement(
  element: GraphicElement,
  graph: GraphicDesignGraph,
  ids: Set<string>,
): void {
  if (!element || typeof element !== "object") {
    fail("Every design element must be an object");
  }
  if (typeof element.id !== "string" || element.id.length === 0) {
    fail("Every design element needs an id");
  }
  if (ids.has(element.id)) {
    fail(`Duplicate design element id: ${element.id}`);
  }
  ids.add(element.id);

  if (!GRAPHIC_ELEMENT_TYPES.includes(element.type)) {
    fail(`Unknown element type: ${String(element.type)}`);
  }

  for (const key of ["x", "y", "width", "height"] as const) {
    if (!isFiniteNumber(element[key])) {
      fail(`Element ${element.id} has a non-finite ${key}`);
    }
  }
  if (element.width <= 0 || element.height <= 0) {
    fail(`Element ${element.id} has a non-positive size`);
  }
  if (!Number.isInteger(element.zIndex)) {
    fail(`Element ${element.id} has a non-integer zIndex`);
  }

  if (element.type === "TEXT") {
    if (typeof element.text !== "string") {
      fail(`Text element ${element.id} needs text`);
    }
    if (element.text.length > IMAGE_GENERATION_LIMITS.maxTextLength) {
      fail(`Text element ${element.id} exceeds the text length limit`);
    }
  }

  if (element.type === "IMAGE") {
    if (typeof element.assetRef !== "string" || element.assetRef.length === 0) {
      fail(`Image element ${element.id} needs an assetRef`);
    }
  }

  if (element.x + element.width > graph.width + 0.001 || element.y + element.height > graph.height + 0.001) {
    fail(`Element ${element.id} extends beyond the design bounds`);
  }
}

export function coerceOutputFormat(value: unknown): ImageOutputFormat {
  if (IMAGE_OUTPUT_FORMATS.includes(value as ImageOutputFormat)) {
    return value as ImageOutputFormat;
  }
  fail(`Unknown output format: ${String(value)}`);
}
