/**
 * Deterministic JSON.
 *
 * `JSON.stringify` follows insertion order, so two objects with the same keys
 * written in a different order produce different bytes and therefore different
 * hashes. Sorting keys here is what makes `sceneSha256` a property of the scene
 * rather than of how the row happened to be assembled.
 */
export function stableStringify(value: unknown): string {
  return write(value);
}

function write(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Cannot serialize a non-finite number");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      return Array.isArray(value) ? writeArray(value) : writeObject(value);
    default:
      throw new TypeError(`Cannot serialize a ${typeof value} value`);
  }
}

function writeArray(value: readonly unknown[]): string {
  return `[${value.map((entry) => write(entry)).join(",")}]`;
}

function writeObject(value: object): string {
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();

  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${write(record[key])}`)
    .join(",")}}`;
}
