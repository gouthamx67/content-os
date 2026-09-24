export function normalizeMetadata(
  value: unknown,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  return undefined;
}