import { createId } from "../../../lib/id";
import type { AudioRepository } from "../../../core/ports/audio-repository";
import type { AudioCompositionRecord } from "../domain/types";
import {
  AUDIO_MIX_DEFAULTS,
  AudioValidationError,
} from "../domain/validation";

export type VisualCompositionSummary = {
  id: string;
  projectId: string;
  name: string;
  durationMs: number;
};

export type EnsureAudioCompositionDeps = {
  repository: AudioRepository;
  visualCompositionFor: (args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }) => Promise<VisualCompositionSummary>;
};

export type EnsureAudioCompositionArgs = {
  projectId: string;
  compositionId: string;
  userId: string;
};

/**
 * Returns the audio composition that belongs to a visual composition, creating
 * an empty one on first use.
 *
 * The visual composition is the duration authority: the audio timeline is only
 * meaningful for as long as the video is. The created duration is the longer of
 * the visual duration and any track already placed, so growing the video grows
 * the audio but a later shrink can never silently truncate an existing track.
 */
export async function ensureAudioComposition(
  deps: EnsureAudioCompositionDeps,
  args: EnsureAudioCompositionArgs,
): Promise<AudioCompositionRecord> {
  const visual = await deps.visualCompositionFor(args);

  if (visual.projectId !== args.projectId) {
    throw new AudioValidationError(
      "Visual composition does not belong to this project",
    );
  }

  const existing = await deps.repository.getCompositionByVisual(
    args.projectId,
    visual.id,
  );

  if (existing) {
    const maxTrackEnd = existing.tracks.reduce(
      (end, track) => Math.max(end, track.startMs + track.durationMs),
      0,
    );
    const target = Math.max(visual.durationMs, maxTrackEnd);

    if (existing.durationMs !== target) {
      await deps.repository.updateCompositionDuration({
        projectId: args.projectId,
        audioCompositionId: existing.id,
        durationMs: target,
        updatedAt: new Date().toISOString(),
      });

      return { ...existing, durationMs: target };
    }

    return existing;
  }

  const now = new Date().toISOString();

  return deps.repository.createComposition({
    id: createId("acmp"),
    projectId: args.projectId,
    compositionId: visual.id,
    name: `${visual.name} audio`,
    sampleRate: AUDIO_MIX_DEFAULTS.sampleRate,
    channels: AUDIO_MIX_DEFAULTS.channels,
    durationMs: visual.durationMs,
    status: "DRAFT",
    createdById: args.userId,
    createdAt: now,
    updatedAt: now,
  });
}
