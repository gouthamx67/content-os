/**
 * Audio failures are typed because the API has to distinguish "the caller asked
 * for something impossible" (400/422) from "the renderer broke" (500). A code is
 * carried alongside the message so a log line or an error row can be grouped
 * without parsing English.
 */
export class AudioError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AudioError";
    this.code = code;
    this.status = status;
  }
}

/** The request is well-formed but describes an audio edit this engine refuses. */
export class AudioFeatureError extends AudioError {
  constructor(code: string, message: string) {
    super(code, message, 422);
    this.name = "AudioFeatureError";
  }
}

/** A job was cancelled while FFmpeg was running. */
export class AudioCancelledError extends Error {
  readonly code = "AUDIO_RENDER_CANCELLED";

  constructor(message = "Audio render was cancelled") {
    super(message);
    this.name = "AudioCancelledError";
  }
}

/** FFmpeg itself failed; the message is sanitized before it is stored. */
export class AudioExecutionError extends AudioError {
  constructor(message: string) {
    super("AUDIO_FFMPEG_FAILED", message, 500);
    this.name = "AudioExecutionError";
  }
}

export const AUDIO_ERROR_CODES = [
  "AUDIO_SOURCE_NOT_FOUND",
  "AUDIO_SOURCE_PROJECT_MISMATCH",
  "AUDIO_STREAM_MISSING",
  "AUDIO_TRACK_INVALID",
  "VIDEO_RENDER_NOT_FOUND",
  "VIDEO_RENDER_PROJECT_MISMATCH",
  "VIDEO_ARTIFACT_NOT_READY",
  "AUDIO_FFMPEG_FAILED",
  "AUDIO_RENDER_CANCELLED",
  "AUDIO_OUTPUT_INVALID",
] as const;
export type AudioErrorCode = (typeof AUDIO_ERROR_CODES)[number];
