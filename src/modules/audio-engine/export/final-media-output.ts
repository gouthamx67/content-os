import type {
  AudioRenderJobRecord,
  MuxedVideoArtifactRecord,
} from "../domain/types";

export const FINAL_MEDIA_CONTRACT_VERSION = 1 as const;

/**
 * The finished deliverable: video from CP15, audio from CP16, muxed into one
 * MP4. CP17 rewrites, captions and publishes from this contract, so it carries
 * both the dimensions it must preserve and the audio shape it must not change.
 */
export type FinalMediaOutput = {
  contractVersion: typeof FINAL_MEDIA_CONTRACT_VERSION;
  kind: "mp4";
  artifactId: string;
  audioRenderJobId: string;
  videoRenderJobId: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  audioSampleRate: number;
  audioChannels: number;
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
};

export function buildFinalMediaOutput(input: {
  muxed: MuxedVideoArtifactRecord;
  job: AudioRenderJobRecord;
  canvas: { width: number; height: number; frameRate: number };
}): FinalMediaOutput {
  return {
    contractVersion: FINAL_MEDIA_CONTRACT_VERSION,
    kind: "mp4",
    artifactId: input.muxed.id,
    audioRenderJobId: input.muxed.audioRenderJobId,
    videoRenderJobId: input.muxed.videoRenderJobId,
    width: input.canvas.width,
    height: input.canvas.height,
    frameRate: input.canvas.frameRate,
    durationMs: input.job.durationMs,
    audioSampleRate: input.job.sampleRate,
    audioChannels: input.job.channels,
    byteSize: input.muxed.byteSize,
    checksumSha256: input.muxed.checksumSha256,
    createdAt: input.muxed.createdAt,
  };
}
