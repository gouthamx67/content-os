import { HttpError } from "../../../lib/http";
import {
  AUDIO_AUTOMATION_PROPERTIES,
  AUDIO_TRACK_KINDS,
  type AudioAutomationPointRecord,
  type AudioTrackKind,
  type AudioTrackRecord,
} from "./types";

export const MAX_AUDIO_DURATION_MS = 600_000;
export const MAX_AUDIO_TRACKS = 64;

export const AUDIO_MIX_DEFAULTS = {
  sampleRate: 48_000,
  channels: 2,
} as const;

export const AUDIO_GAIN_RANGE = { min: -60, max: 12 } as const;
export const AUDIO_PAN_RANGE = { min: -1, max: 1 } as const;
export const AUDIO_DUCK_RANGE = { min: -48, max: 0 } as const;

export class AudioValidationError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = "AudioValidationError";
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A track must name a supported kind, a real source, and fit inside the
 * composition. Everything is checked here rather than at FFmpeg time so a bad
 * edit is refused before a worker picks it up.
 */
export function validateAudioTrackInput(input: {
  kind: unknown;
  name: unknown;
  sourceRef: unknown;
  startMs: unknown;
  sourceOffsetMs: unknown;
  durationMs: unknown;
  gainDb: unknown;
  pan: unknown;
  fadeInMs: unknown;
  fadeOutMs: unknown;
  mute: unknown;
  solo: unknown;
  duckVoiceoverDb: unknown;
  compositionDurationMs: number;
}): void {
  if (
    typeof input.kind !== "string" ||
    !(AUDIO_TRACK_KINDS as readonly string[]).includes(input.kind)
  ) {
    throw new AudioValidationError("Track kind is invalid");
  }

  if (!isNonEmptyString(input.name)) {
    throw new AudioValidationError("Track name is required");
  }

  if (!isNonEmptyString(input.sourceRef)) {
    throw new AudioValidationError("Track source reference is required");
  }

  if (!isInteger(input.startMs) || input.startMs < 0) {
    throw new AudioValidationError("Track startMs must be a non-negative integer");
  }

  if (!isInteger(input.sourceOffsetMs) || input.sourceOffsetMs < 0) {
    throw new AudioValidationError(
      "Track sourceOffsetMs must be a non-negative integer",
    );
  }

  if (!isInteger(input.durationMs) || input.durationMs <= 0) {
    throw new AudioValidationError("Track durationMs must be a positive integer");
  }

  if (input.startMs + input.durationMs > input.compositionDurationMs) {
    throw new AudioValidationError(
      "Track extends past the end of the composition",
    );
  }

  if (
    !isFiniteNumber(input.gainDb) ||
    input.gainDb < AUDIO_GAIN_RANGE.min ||
    input.gainDb > AUDIO_GAIN_RANGE.max
  ) {
    throw new AudioValidationError(
      `Track gainDb must be between ${AUDIO_GAIN_RANGE.min} and ${AUDIO_GAIN_RANGE.max}`,
    );
  }

  if (
    !isFiniteNumber(input.pan) ||
    input.pan < AUDIO_PAN_RANGE.min ||
    input.pan > AUDIO_PAN_RANGE.max
  ) {
    throw new AudioValidationError(
      `Track pan must be between ${AUDIO_PAN_RANGE.min} and ${AUDIO_PAN_RANGE.max}`,
    );
  }

  if (!isInteger(input.fadeInMs) || input.fadeInMs < 0) {
    throw new AudioValidationError("Track fadeInMs must be a non-negative integer");
  }

  if (!isInteger(input.fadeOutMs) || input.fadeOutMs < 0) {
    throw new AudioValidationError("Track fadeOutMs must be a non-negative integer");
  }

  if (input.fadeInMs + input.fadeOutMs > input.durationMs) {
    throw new AudioValidationError(
      "Track fades together cannot be longer than the track",
    );
  }

  if (typeof input.mute !== "boolean") {
    throw new AudioValidationError("Track mute must be a boolean");
  }

  if (typeof input.solo !== "boolean") {
    throw new AudioValidationError("Track solo must be a boolean");
  }

  if (
    input.duckVoiceoverDb !== null &&
    input.duckVoiceoverDb !== undefined &&
    (!isFiniteNumber(input.duckVoiceoverDb) ||
      input.duckVoiceoverDb < AUDIO_DUCK_RANGE.min ||
      input.duckVoiceoverDb > AUDIO_DUCK_RANGE.max)
  ) {
    throw new AudioValidationError(
      `Track duckVoiceoverDb must be between ${AUDIO_DUCK_RANGE.min} and ${AUDIO_DUCK_RANGE.max}, or null`,
    );
  }
}

export function validateAutomationInput(input: {
  property: unknown;
  timeMs: unknown;
  value: unknown;
  durationMs: number;
}): void {
  if (
    typeof input.property !== "string" ||
    !(AUDIO_AUTOMATION_PROPERTIES as readonly string[]).includes(input.property)
  ) {
    throw new AudioValidationError("Only VOLUME_DB automation is supported");
  }

  if (
    !isInteger(input.timeMs) ||
    input.timeMs < 0 ||
    input.timeMs > input.durationMs
  ) {
    throw new AudioValidationError(
      "Automation timeMs must fall inside the track duration",
    );
  }

  if (
    !isFiniteNumber(input.value) ||
    input.value < AUDIO_GAIN_RANGE.min ||
    input.value > AUDIO_GAIN_RANGE.max
  ) {
    throw new AudioValidationError(
      `Automation value must be between ${AUDIO_GAIN_RANGE.min} and ${AUDIO_GAIN_RANGE.max}`,
    );
  }
}

/**
 * The whole composition is validated as a unit so a track cannot be added that
 * pushes the track count or total length past what a worker will accept.
 */
export function validateAudioComposition(
  tracks: readonly Pick<AudioTrackRecord, "id">[],
  durationMs: number,
): void {
  if (tracks.length > MAX_AUDIO_TRACKS) {
    throw new AudioValidationError(
      `An audio composition may hold at most ${MAX_AUDIO_TRACKS} tracks`,
    );
  }

  if (durationMs <= 0 || durationMs > MAX_AUDIO_DURATION_MS) {
    throw new AudioValidationError(
      `Audio duration must be between 1 and ${MAX_AUDIO_DURATION_MS}ms`,
    );
  }

  const ids = new Set<string>();
  for (const track of tracks) {
    if (ids.has(track.id)) {
      throw new AudioValidationError(`Duplicate track id ${track.id}`);
    }
    ids.add(track.id);
  }
}

/** A stable list of the automation points a track holds, sorted by time. */
export function sortAutomation(
  points: readonly AudioAutomationPointRecord[],
): AudioAutomationPointRecord[] {
  return points
    .slice()
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
}

export type AudioTrackKindInput = AudioTrackKind;
