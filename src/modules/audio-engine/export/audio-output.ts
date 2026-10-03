import type { AudioArtifactRecord } from "../domain/types";

export const AUDIO_OUTPUT_CONTRACT_VERSION = 1 as const;

/**
 * The contract CP17 consumes for a finished audio-only render.
 *
 * It describes the artifact, not the storage layout: the id is what a later
 * checkpoint resolves bytes through, and the checksum lets it prove the bytes it
 * gets back are the bytes this render produced.
 */
export type AudioOutput = {
  contractVersion: typeof AUDIO_OUTPUT_CONTRACT_VERSION;
  kind: "wav";
  artifactId: string;
  audioRenderJobId: string;
  sampleRate: number;
  channels: number;
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
};

export function buildAudioOutput(
  artifact: AudioArtifactRecord,
  mix: { sampleRate: number; channels: number },
): AudioOutput {
  return {
    contractVersion: AUDIO_OUTPUT_CONTRACT_VERSION,
    kind: "wav",
    artifactId: artifact.id,
    audioRenderJobId: artifact.audioRenderJobId,
    sampleRate: mix.sampleRate,
    channels: mix.channels,
    byteSize: artifact.byteSize,
    checksumSha256: artifact.checksumSha256,
    createdAt: artifact.createdAt,
  };
}
