import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ResolvedAudioSource } from "./audio-source-resolver";

/**
 * Copies a resolved source into the render work directory.
 *
 * The bytes live in the work directory only for the life of the render; nothing
 * is written back to capture or asset storage. The file is named from the track
 * index, not from user input, so a malicious name cannot influence the path.
 */
export async function materializeAudioSource(
  source: ResolvedAudioSource,
  workDir: string,
  index: number,
): Promise<string> {
  await mkdir(workDir, { recursive: true });

  const target = path.join(workDir, `audio-${index}${extensionFor(source.mimeType)}`);
  await pipeline(source.open(), createWriteStream(target));
  return target;
}

function extensionFor(mimeType: string): string {
  if (mimeType.startsWith("video/")) return ".mp4";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return ".wav";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "audio/flac") return ".flac";
  return ".m4a";
}
