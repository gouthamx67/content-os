import type { WritingObjective } from "../domain/types";
import {
  DEFAULT_OBJECTIVE,
  isWritingObjective,
  objectiveDirective,
  normalizeObjective,
} from "../domain/objectives";

/** Validates and normalizes an objective coming from an API payload. */
export function resolveObjective(value: unknown): WritingObjective {
  if (typeof value === "string" && isWritingObjective(value)) {
    return value;
  }
  return DEFAULT_OBJECTIVE;
}

export { normalizeObjective, objectiveDirective };
