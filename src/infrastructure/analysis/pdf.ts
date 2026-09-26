import { inflateRawSync, inflateSync } from "node:zlib";

export interface PdfExtraction {
  text: string;
  pageCount: number | null;
  notes: string[];
}

const MAX_OUTPUT_CHARS = 200_000;
const MAX_STREAMS = 400;

const OCTAL_ESCAPE = /\\([0-7]{1,3})/g;
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "\\": "\\",
  "(": "(",
  ")": ")",
};

export function decodePdfLiteralString(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) break;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      index += 1;
      continue;
    }
    if (next >= "0" && next <= "7") {
      OCTAL_ESCAPE.lastIndex = index;
      const match = OCTAL_ESCAPE.exec(value);
      if (match) {
        out += String.fromCharCode(Number.parseInt(match[1], 8) & 0xff);
        index = match.index + match[0].length - 1;
        continue;
      }
    }
    if (next === "\n") {
      index += 1;
      continue;
    }
    out += next;
    index += 1;
  }
  return out;
}

function decodeHexString(value: string): string {
  const hex = value.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let index = 0; index + 1 < hex.length; index += 2) {
    const code = Number.parseInt(hex.slice(index, index + 2), 16);
    if (code >= 32 || code === 9 || code === 10 || code === 13) out += String.fromCharCode(code);
  }
  return out;
}

const TEXT_SHOW = /\((?:\\.|[^\\()])*\)|\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\][]|\\.)*\]\s*TJ|<[0-9a-fA-F\s]*>/g;

function extractStringsFromContentStream(content: string): string {
  let out = "";
  TEXT_SHOW.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEXT_SHOW.exec(content)) !== null) {
    const token = match[0];
    if (token.startsWith("<")) {
      out += decodeHexString(token.slice(1, -1));
      continue;
    }
    for (const piece of token.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
      out += decodePdfLiteralString(piece[0].slice(1, -1));
    }
    if (/T[Jj]\s*$/.test(token.trim())) out += " ";
  }
  return out;
}

function findStreams(bytes: Uint8Array): Uint8Array[] {
  const marker = new TextEncoder().encode("stream");
  const endMarker = new TextEncoder().encode("endstream");
  const streams: Uint8Array[] = [];
  let cursor = 0;

  while (cursor < bytes.length && streams.length < MAX_STREAMS) {
    const start = indexOfBytes(bytes, marker, cursor);
    if (start === -1) break;

    let dataStart = start + marker.byteLength;
    if (bytes[dataStart] === 0x0d) dataStart += 1;
    if (bytes[dataStart] === 0x0a) dataStart += 1;

    const end = indexOfBytes(bytes, endMarker, dataStart);
    if (end === -1) break;
    streams.push(bytes.subarray(dataStart, end));
    cursor = end + endMarker.byteLength;
  }
  return streams;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const limit = haystack.length - needle.byteLength;
  const first = needle[0];
  for (let index = from; index <= limit; index += 1) {
    if (haystack[index] !== first) continue;
    let matched = true;
    for (let offset = 1; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

function inflateStream(data: Uint8Array): Uint8Array | null {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  for (const inflate of [inflateRawSync, inflateSync]) {
    try {
      const result = inflate(buffer);
      if (result.byteLength > 0) return new Uint8Array(result);
    } catch {
      // try the next strategy
    }
  }
  return null;
}

export function extractPdfText(bytes: Uint8Array): PdfExtraction {
  const notes: string[] = [];
  const latin = Buffer.from(bytes).toString("latin1");
  if (!latin.startsWith("%PDF-")) {
    return { text: "", pageCount: null, notes: ["The file does not start with a PDF header"] };
  }

  const pageMatches = latin.match(/\/Type\s*\/Page[^s]/g);
  const pageCount = pageMatches ? pageMatches.length : null;

  const streams = findStreams(bytes);
  if (streams.length === 0) {
    return {
      text: "",
      pageCount,
      notes: ["No content streams were found; the PDF may be image-only or encrypted"],
    };
  }

  let text = "";
  let decodedStreams = 0;
  for (const stream of streams) {
    const isProbablyBinary = stream.byteLength > 0 && stream[0] !== 0x28 && stream[0] !== 0x3c && stream[0] !== 0x2f;
    const candidate = isProbablyBinary ? inflateStream(stream) : stream;
    if (!candidate) continue;
    const content = Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength).toString("latin1");
    if (!/BT[\s\S]*?ET/.test(content)) continue;
    decodedStreams += 1;
    const extracted = extractStringsFromContentStream(content);
    if (extracted.length === 0) continue;
    text += `${extracted}\n`;
    if (text.length >= MAX_OUTPUT_CHARS) {
      text = text.slice(0, MAX_OUTPUT_CHARS);
      notes.push("PDF text extraction stopped at the output size limit");
      break;
    }
  }

  if (decodedStreams === 0) {
    notes.push("No text-showing operators were found; the PDF may be scanned or image-only");
  }
  notes.push("PDF text extraction is best-effort and is recorded with reduced confidence");
  return { text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), pageCount, notes };
}
