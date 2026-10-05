import {
  WRITING_OBJECTIVES,
  type WritingObjective,
} from "./types";

export const DEFAULT_OBJECTIVE: WritingObjective = "AWARENESS";

export function isWritingObjective(value: unknown): value is WritingObjective {
  return (
    typeof value === "string" &&
    (WRITING_OBJECTIVES as readonly string[]).includes(value)
  );
}

export function normalizeObjective(value: unknown): WritingObjective | null {
  return isWritingObjective(value) ? value : null;
}

/** A one-line steer the local provider reads when shaping copy. */
export function objectiveDirective(objective: WritingObjective): string {
  switch (objective) {
    case "AWARENESS":
      return "Introduce the product and the problem it removes.";
    case "EDUCATION":
      return "Explain how it works plainly, without over-claiming.";
    case "CONSIDERATION":
      return "Give a reason to prefer this over the status quo.";
    case "CONVERSION":
      return "Make one clear ask and remove friction from it.";
    case "RETENTION":
      return "Remind the reader of the value they already chose.";
    case "PRODUCT_EXPLANATION":
      return "Describe what the product is and what it does.";
  }
}
