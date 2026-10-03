import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { AudioExecutionError } from "../errors";
import { probeAudio, type ProbedAudio } from "../ffmpeg/probe-audio";
import {
  probeMuxedVideo,
  type ProbedMuxedVideo,
} from "../ffmpeg/probe-muxed-video";
import { AUDIO_MIX_DEFAULTS } from "../domain/validation";

export type VerifiedAudioArtifact = {
  byteSize: number;
  checksumSha256: string;
  durationMs: number;
  audioCodec: string;
  sampleRate: number;
  channels: number;
};

export type VerifiedMuxedArtifact = {
  byteSize: number;
  checksumSha256: string;
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  sampleRate: number;
  channels: number;
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
 * Proves the WAV on disk is actually a 48 kHz stereo PCM mix of the right
 * length.
 *
 * A zero exit from FFmpeg is not enough: a filter graph can succeed and still
 * emit the wrong codec, a mono stream, or a fraction of a second. Probing the
 * bytes and comparing them to the job is what makes "succeeded" mean "there is a
 * real, playable mix".
 */
export async function verifyAudioArtifact(
  filePath: string,
  expectation: { sampleRate: number; channels: number; durationMs: number },
  deps: { probe?: (path: string) => Promise<ProbedAudio> } = {},
): Promise<VerifiedAudioArtifact> {
  const probe = deps.probe ?? probeAudio;
  const info = await probe(filePath);

  if (info.audioStreams !== 1) {
    throw new AudioExecutionError(
      `Expected exactly one audio stream, found ${info.audioStreams}`,
    );
  }

  if (info.audioCodec !== "pcm_s16le") {
    throw new AudioExecutionError(
      `Expected pcm_s16le, found ${info.audioCodec ?? "none"}`,
    );
  }

  if (info.sampleRate !== expectation.sampleRate) {
    throw new AudioExecutionError(
      `Expected ${expectation.sampleRate}Hz, found ${info.sampleRate ?? "none"}`,
    );
  }

  if (info.channels !== expectation.channels) {
    throw new AudioExecutionError(
      `Expected ${expectation.channels} channels, found ${info.channels ?? "none"}`,
    );
  }

  if (info.durationMs <= 0) {
    throw new AudioExecutionError("Audio artifact has no measurable duration");
  }

  const tolerance = Math.max(250, Math.round(expectation.durationMs * 0.1));
  if (Math.abs(info.durationMs - expectation.durationMs) > tolerance) {
    throw new AudioExecutionError(
      `Audio duration ${info.durationMs}ms differs from ${expectation.durationMs}ms`,
    );
  }

  const fileInfo = await stat(filePath);
  if (fileInfo.size <= 0) {
    throw new AudioExecutionError("Audio artifact is empty");
  }

  return {
    byteSize: fileInfo.size,
    checksumSha256: await checksum(filePath),
    durationMs: info.durationMs,
    audioCodec: info.audioCodec,
    sampleRate: info.sampleRate,
    channels: info.channels,
  };
}

/**
 * Proves the final MP4 still carries CP15's exact picture with the CP16 mix.
 *
 * The video stream is copied, not re-encoded, so its dimensions and codec must
 * match the source. The audio must be the contract's 48 kHz stereo AAC.
 */
export async function verifyMuxedVideoArtifact(
  filePath: string,
  expectation: { width: number; height: number; durationMs: number },
  deps: { probe?: (path: string) => Promise<ProbedMuxedVideo> } = {},
): Promise<VerifiedMuxedArtifact> {
  const probe = deps.probe ?? probeMuxedVideo;
  const info = await probe(filePath);

  if (info.videoStreams !== 1) {
    throw new AudioExecutionError(
      `Expected exactly one video stream, found ${info.videoStreams}`,
    );
  }

  if (info.audioStreams !== 1) {
    throw new AudioExecutionError(
      `Expected exactly one audio stream, found ${info.audioStreams}`,
    );
  }

  if (info.videoCodec !== "h264") {
    throw new AudioExecutionError(
      `Expected h264 video, found ${info.videoCodec ?? "none"}`,
    );
  }

  if (info.audioCodec !== "aac") {
    throw new AudioExecutionError(
      `Expected aac audio, found ${info.audioCodec ?? "none"}`,
    );
  }

  if (info.width !== expectation.width || info.height !== expectation.height) {
    throw new AudioExecutionError(
      `Final video is ${info.width}x${info.height}, expected ${expectation.width}x${expectation.height}`,
    );
  }

  if (info.sampleRate !== AUDIO_MIX_DEFAULTS.sampleRate) {
    throw new AudioExecutionError(
      `Expected ${AUDIO_MIX_DEFAULTS.sampleRate}Hz audio, found ${info.sampleRate ?? "none"}`,
    );
  }

  if (info.channels !== AUDIO_MIX_DEFAULTS.channels) {
    throw new AudioExecutionError(
      `Expected ${AUDIO_MIX_DEFAULTS.channels} audio channels, found ${info.channels ?? "none"}`,
    );
  }

  const tolerance = Math.max(400, Math.round(expectation.durationMs * 0.15));
  if (info.durationMs <= 0) {
    throw new AudioExecutionError("Final video has no measurable duration");
  }
  if (Math.abs(info.durationMs - expectation.durationMs) > tolerance) {
    throw new AudioExecutionError(
      `Final duration ${info.durationMs}ms differs from ${expectation.durationMs}ms`,
    );
  }

  const fileInfo = await stat(filePath);
  if (fileInfo.size <= 0) {
    throw new AudioExecutionError("Final video is empty");
  }

  return {
    byteSize: fileInfo.size,
    checksumSha256: await checksum(filePath),
    durationMs: info.durationMs,
    width: info.width ?? expectation.width,
    height: info.height ?? expectation.height,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    sampleRate: info.sampleRate,
    channels: info.channels,
  };
}
