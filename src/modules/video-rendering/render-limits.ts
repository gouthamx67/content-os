/**
 * The renderer is a bounded worker, not an unbounded executor. Every limit here
 * is checked before FFmpeg is spawned so a hostile or accidental job is refused
 * cheaply rather than after it has consumed a core and a hundred megabytes.
 */
export const RENDER_LIMITS = {
  maxWidth: 3840,
  maxHeight: 3840,
  maxDurationMs: 10 * 60 * 1000,
  maxLayers: 100,
  maxFrameRate: 120,
  maxConcurrentJobs: 1,
} as const;

export const RENDER_OUTPUT = {
  format: "MP4",
  container: "mp4",
  mimeType: "video/mp4",
  videoCodec: "h264",
  pixelFormat: "yuv420p",
} as const;
