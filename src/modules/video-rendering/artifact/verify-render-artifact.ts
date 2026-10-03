import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { probeMedia, type ProbedMedia } from "../ffmpeg/ffprobe";
import { RenderExecutionError } from "../errors";
import { RENDER_OUTPUT } from "../render-limits";

export type VerifiedArtifact = {
  byteSize: number;
  checksumSha256: string;
  width: number;
  height: number;
  durationMs: number;
  videoCodec: string;
  formatName: string;
  videoStreams: number;
  audioStreams: number;
};

export type ArtifactExpectation = {
  width: number;
  height: number;
  durationMs: number;
};

export type VerifyDependencies = {
  probe?: (filePath: string) => Promise<ProbedMedia>;
};

async function checksum(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

/**
 * Proves the bytes on disk are actually an MP4 the contract promised.
 *
 * A zero exit code from FFmpeg is not enough: a filter graph can succeed and
 * still emit the wrong dimensions, drop to a single frame, or fall back to a
 * different codec. Probing the artifact and comparing it to the job's canvas is
 * what makes "succeeded" mean "there is a playable file of the right shape".
 */
export async function verifyRenderArtifact(
  filePath: string,
  expectation: ArtifactExpectation,
  dependencies: VerifyDependencies = {},
): Promise<VerifiedArtifact> {
  const probe = dependencies.probe ?? probeMedia;
  const info = await probe(filePath);

  if (info.videoStreams !== 1) {
    throw new RenderExecutionError(
      `Expected exactly one video stream, found ${info.videoStreams}`,
    );
  }

  if (info.videoCodec !== RENDER_OUTPUT.videoCodec) {
    throw new RenderExecutionError(
      `Expected ${RENDER_OUTPUT.videoCodec}, found ${info.videoCodec ?? "none"}`,
    );
  }

  if (info.width !== expectation.width || info.height !== expectation.height) {
    throw new RenderExecutionError(
      `Artifact is ${info.width}x${info.height}, expected ${expectation.width}x${expectation.height}`,
    );
  }

  if (!info.formatName.includes(RENDER_OUTPUT.container)) {
    throw new RenderExecutionError(
      `Artifact container is ${info.formatName || "unknown"}`,
    );
  }

  const tolerance = Math.max(250, Math.round(expectation.durationMs * 0.1));
  if (info.durationMs <= 0) {
    throw new RenderExecutionError("Artifact has no measurable duration");
  }
  if (Math.abs(info.durationMs - expectation.durationMs) > tolerance) {
    throw new RenderExecutionError(
      `Artifact duration ${info.durationMs}ms differs from ${expectation.durationMs}ms`,
    );
  }

  const fileInfo = await stat(filePath);
  if (fileInfo.size <= 0) {
    throw new RenderExecutionError("Artifact is empty");
  }

  return {
    byteSize: fileInfo.size,
    checksumSha256: await checksum(filePath),
    width: info.width ?? expectation.width,
    height: info.height ?? expectation.height,
    durationMs: info.durationMs,
    videoCodec: info.videoCodec ?? RENDER_OUTPUT.videoCodec,
    formatName: info.formatName,
    videoStreams: info.videoStreams,
    audioStreams: info.audioStreams,
  };
}
