const BOM = 0xfeff;

export function decodeUtf8(bytes: Uint8Array): string {
  const view = bytes.length > 0 && bytes[0] === BOM ? bytes.subarray(1) : bytes;
  return new TextDecoder("utf-8", { fatal: false }).decode(view);
}

export function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncate(value: string, max: number): string {
  const collapsed = collapseWhitespace(value);
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
};

export function decodeHtmlEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

export function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "));
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/;

export function splitSentences(text: string): string[] {
  const normalized = collapseWhitespace(text);
  if (normalized.length === 0) return [];
  return normalized
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function isMeaningfulPhrase(value: string, minLength = 3, maxLength = 300): boolean {
  const collapsed = collapseWhitespace(value);
  if (collapsed.length < minLength || collapsed.length > maxLength) return false;
  if (!/[a-z0-9]/i.test(collapsed)) return false;
  if (collapsed.length > 0 && /^(?:https?:|www\.)\S+$/i.test(collapsed)) return false;
  return true;
}
