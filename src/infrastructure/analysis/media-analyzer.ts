import type { Source } from "../../core/domain/source";
import type {
  SourceAnalysisContext,
  SourceAnalysisResult,
  SourceAnalyzer,
} from "../../core/ports/source-analyzer";
import { addDraftEvidence, emptyIntelligenceDraft } from "../../core/domain/intelligence-draft";
import { canonicalEntityKey } from "../../core/domain/intelligence-canonical";
import { truncate } from "./text";

export interface MediaProbe {
  format: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  quality: Record<string, string | number | boolean>;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return out;
}

function uint32(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, false);
}

export function probeImage(bytes: Uint8Array): MediaProbe {
  const empty: MediaProbe = { format: null, width: null, height: null, durationMs: null, quality: {} };
  if (bytes.byteLength < 13) return empty;

  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") {
    if (bytes.byteLength < 33) return { ...empty, format: "png" };
    if (ascii(bytes, 12, 4) !== "IHDR") return { ...empty, format: "png" };
    return {
      format: "png",
      width: uint32(bytes, 16),
      height: uint32(bytes, 20),
      durationMs: null,
      quality: {
        bitDepth: bytes[24],
        colorType: bytes[25],
        hasAlpha: bytes[25] === 4 || bytes[25] === 6,
        interlaced: bytes[28] === 1,
      },
    };
  }

  if (ascii(bytes, 0, 3) === "GIF") {
    return {
      format: "gif",
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
      durationMs: null,
      quality: { animated: ascii(bytes, 0, 6) === "GIF89a" && bytes.byteLength > 1_000 },
    };
  }

  if (ascii(bytes, 0, 2) === "BM" && bytes.byteLength >= 26) {
    const width = Math.abs(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(18, true));
    const height = Math.abs(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(22, true));
    return { format: "bmp", width, height, durationMs: null, quality: {} };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 9 < bytes.byteLength) {
      if (bytes[cursor] !== 0xff) {
        cursor += 1;
        continue;
      }
      const marker = bytes[cursor + 1];
      const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isStartOfFrame) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return {
          format: "jpeg",
          width: view.getUint16(cursor + 7, false),
          height: view.getUint16(cursor + 5, false),
          durationMs: null,
          quality: { progressive: marker === 0xc2, components: bytes[cursor + 9] },
        };
      }
      if (length <= 0) break;
      cursor += 2 + length;
    }
    return { format: "jpeg", width: null, height: null, durationMs: null, quality: {} };
  }

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP" && bytes.byteLength >= 30) {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { format: "webp", width, height, durationMs: null, quality: { hasAlpha: (bytes[20] & 0x10) !== 0 } };
    }
    if (chunk === "VP8 ") {
      return {
        format: "webp",
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
        durationMs: null,
        quality: { lossy: true },
      };
    }
    return { format: "webp", width: null, height: null, durationMs: null, quality: {} };
  }

  return empty;
}

interface Atom {
  type: string;
  start: number;
  end: number;
}

const CONTAINER_ATOMS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta"]);

function readAtoms(bytes: Uint8Array, start: number, end: number, depth: number, out: Atom[]): void {
  let cursor = start;
  while (cursor + 8 <= end && depth < 8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let size = view.getUint32(cursor, false);
    const type = ascii(bytes, cursor + 4, 4);
    let headerSize = 8;
    if (size === 1 && cursor + 16 <= end) {
      const high = view.getUint32(cursor + 8, false);
      const low = view.getUint32(cursor + 12, false);
      size = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = end - cursor;
    }
    if (size < headerSize || cursor + size > end) break;
    out.push({ type, start: cursor + headerSize, end: cursor + size });
    if (CONTAINER_ATOMS.has(type)) {
      readAtoms(bytes, cursor + headerSize, cursor + size, depth + 1, out);
    }
    cursor += size;
  }
}

export function probeIsoMedia(bytes: Uint8Array): MediaProbe {
  const empty: MediaProbe = { format: null, width: null, height: null, durationMs: null, quality: {} };
  if (bytes.byteLength < 16) return empty;
  const head = ascii(bytes, 4, 4);
  if (head !== "ftyp" && !CONTAINER_ATOMS.has(ascii(bytes, 4, 4))) return empty;

  const atoms: Atom[] = [];
  readAtoms(bytes, 0, bytes.byteLength, 0, atoms);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let durationMs: number | null = null;
  const mvhd = atoms.find((atom) => atom.type === "mvhd");
  if (mvhd && mvhd.start + 20 <= mvhd.end) {
    const version = bytes[mvhd.start];
    try {
      if (version === 1 && mvhd.start + 32 <= mvhd.end) {
        const timescale = view.getUint32(mvhd.start + 20, false);
        const high = view.getUint32(mvhd.start + 24, false);
        const low = view.getUint32(mvhd.start + 28, false);
        const duration = high * 2 ** 32 + low;
        if (timescale > 0) durationMs = Math.round((duration / timescale) * 1000);
      } else {
        const timescale = view.getUint32(mvhd.start + 12, false);
        const duration = view.getUint32(mvhd.start + 16, false);
        if (timescale > 0) durationMs = Math.round((duration / timescale) * 1000);
      }
    } catch {
      durationMs = null;
    }
  }

  let width: number | null = null;
  let height: number | null = null;
  for (const tkhd of atoms.filter((atom) => atom.type === "tkhd")) {
    try {
      const version = bytes[tkhd.start];
      const base = version === 1 ? tkhd.start + 92 : tkhd.start + 76;
      if (base + 8 > tkhd.end) continue;
      const w = view.getUint32(base, false) / 65536;
      const h = view.getUint32(base + 4, false) / 65536;
      if (w > 0 && h > 0) {
        width = Math.round(w);
        height = Math.round(h);
        break;
      }
    } catch {
      continue;
    }
  }

  const brand = atoms.find((atom) => atom.type === "ftyp");
  const format = brand && brand.start + 4 <= brand.end ? ascii(bytes, brand.start, 4).trim().toLowerCase() : null;
  return { format, width, height, durationMs, quality: { atomCount: atoms.length } };
}

export function probeWav(bytes: Uint8Array): MediaProbe {
  if (bytes.byteLength < 44) return { format: null, width: null, height: null, durationMs: null, quality: {} };
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return { format: null, width: null, height: null, durationMs: null, quality: {} };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 12;
  let byteRate: number | null = null;
  while (cursor + 8 <= bytes.byteLength) {
    const id = ascii(bytes, cursor, 4);
    const size = view.getUint32(cursor + 4, true);
    if (id === "fmt " && cursor + 8 + 12 <= bytes.byteLength) {
      byteRate = view.getUint32(cursor + 16, true);
    }
    if (id === "data" && byteRate && byteRate > 0) {
      return {
        format: "wav",
        width: null,
        height: null,
        durationMs: Math.round((Math.min(size, bytes.byteLength - cursor - 8) / byteRate) * 1000),
        quality: {},
      };
    }
    cursor += 8 + size + (size % 2);
  }
  return { format: "wav", width: null, height: null, durationMs: null, quality: {} };
}

const MP3_BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MP3_RATES = [44100, 48000, 32000, 0];

export function probeMp3(bytes: Uint8Array): MediaProbe {
  const limit = Math.min(bytes.byteLength, 200_000);
  for (let index = 0; index + 4 <= limit; index += 1) {
    if (bytes[index] !== 0xff || (bytes[index + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (bytes[index + 1] >> 3) & 0x03;
    const layerBits = (bytes[index + 1] >> 1) & 0x03;
    if (versionBits === 1 || layerBits === 0) continue;
    const bitrate = MP3_BITRATES_V1_L3[(bytes[index + 2] >> 4) & 0x0f];
    const sampleRate = MP3_RATES[(bytes[index + 2] >> 2) & 0x03];
    if (bitrate === 0 || sampleRate === 0) continue;
    const durationMs = Math.round(((bytes.byteLength - index) * 8) / (bitrate * 1000) * 1000);
    return {
      format: "mp3",
      width: null,
      height: null,
      durationMs,
      quality: { sampleRate, bitrateKbps: bitrate, id3: ascii(bytes, 0, 3) === "ID3" },
    };
  }
  return { format: "mp3", width: null, height: null, durationMs: null, quality: {} };
}

export function probeMedia(bytes: Uint8Array, source: Source): MediaProbe {
  if (source.type === "IMAGE") return probeImage(bytes);
  if (source.type === "VIDEO") return probeIsoMedia(bytes);
  if (source.type === "AUDIO") {
    const wav = probeWav(bytes);
    if (wav.format) return wav;
    const iso = probeIsoMedia(bytes);
    if (iso.format) return iso;
    return probeMp3(bytes);
  }
  return { format: null, width: null, height: null, durationMs: null, quality: {} };
}

export class MediaAnalyzer implements SourceAnalyzer {
  readonly id = "media";

  supports(source: Source): boolean {
    return source.type === "IMAGE" || source.type === "VIDEO" || source.type === "AUDIO";
  }

  async analyze(context: SourceAnalysisContext): Promise<SourceAnalysisResult> {
    const draft = emptyIntelligenceDraft();
    const notes: string[] = [];
    const { source } = context;

    if (!context.bytes) {
      notes.push("Media bytes were not stored locally, so no technical metadata could be probed");
      return { draft, notes };
    }

    const probe = probeMedia(context.bytes, source);
    if (probe.format === null && probe.width === null && probe.durationMs === null) {
      notes.push(`The ${source.type.toLowerCase()} header could not be recognised, so no technical signals were recorded`);
      return { draft, notes };
    }

    const evidenceKey = addDraftEvidence(draft, {
      sourceId: source.id,
      kind: "EXTRACTED_METADATA",
      locator: `metadata:${source.name}`,
      excerpt: JSON.stringify(probe.quality),
      metadata: null,
    }).key;
    const mediaType = source.type === "IMAGE" ? "OTHER" : source.type === "VIDEO" ? "EXISTING_VIDEO" : "OTHER";
    const role = source.type === "VIDEO" ? "SUPPORTING" : "SUPPORTING";
    const quality: Record<string, string | number | boolean> = {
      ...probe.quality,
      hasDimensions: probe.width !== null && probe.height !== null,
      hasDuration: probe.durationMs !== null,
    };

    draft.assets.push({
      key: canonicalEntityKey("ASSET", source.name),
      sourceId: source.id,
      name: truncate(source.name, 200),
      mediaType,
      role,
      storageKey: source.storageKey,
      mimeType: source.mimeType,
      width: probe.width,
      height: probe.height,
      durationMs: probe.durationMs,
      qualitySignals: JSON.stringify(quality),
      relatedFeatureKeys: [],
      relatedClaimKeys: [],
      confidence: probe.format ? "HIGH" : "LOW",
      assertionKind: "FACT",
      sourceIds: [source.id],
      evidenceKeys: [evidenceKey],
    });

    if (probe.width === null || probe.height === null) {
      notes.push("Dimensions could not be determined from the media header");
    }
    if (source.type !== "IMAGE" && probe.durationMs === null) {
      notes.push("Duration could not be determined from the media container");
    }
    return { draft, notes };
  }
}
