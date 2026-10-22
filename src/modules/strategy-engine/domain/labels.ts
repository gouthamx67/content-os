export const GENERIC_SUBJECT_LABELS = new Set([
  "about",
  "audience",
  "benefits",
  "features",
  "how it works",
  "overview",
  "pricing",
  "product",
  "proof",
  "the product",
  "use cases",
  "voice",
  "what it does",
  "what it is",
  "who it's for",
  "workflow",
]);

export function isGenericSubjectLabel(value: string): boolean {
  return GENERIC_SUBJECT_LABELS.has(value.trim().toLowerCase());
}
