import { stableStringify } from "../../video-rendering/serialization/stable-json";
import { ImageGenerationError } from "../errors";
import type { GraphicDesignGraph } from "../domain/types";
import { validateDesignGraph } from "../domain/validation";

/**
 * A design graph is stored as deterministic JSON text so its digest is stable
 * across readers and processes. Parsing validates the graph before anything is
 * allowed to draw it.
 */
export function serializeDesignGraph(graph: GraphicDesignGraph): string {
  validateDesignGraph(graph);
  return stableStringify(graph);
}

export function parseDesignGraph(json: string): GraphicDesignGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ImageGenerationError(
      "IMAGE_INVALID_REQUEST",
      "The stored design graph is not valid JSON",
      500,
    );
  }

  const graph = parsed as GraphicDesignGraph;
  validateDesignGraph(graph);
  return graph;
}
