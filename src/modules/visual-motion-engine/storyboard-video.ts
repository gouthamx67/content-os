/**
 * Turns a storyboard into a renderable visual composition.
 *
 * The product promise is "one page to real content", so the project page must
 * be able to build a video without sending the user to the composition editor.
 * This module is the deterministic part of that: it maps scenes and timings to
 * layers and opacity keyframes. The client runner performs the API calls.
 *
 * Text layers switch by opacity, not by editing content, because a layer's
 * text is fixed for the whole composition. Each scene gets three keyframes:
 * hidden before its start, visible for its window, then faded out.
 */

export const STORYBOARD_VIDEO_FORMATS = [
  "VERTICAL",
  "LANDSCAPE",
  "SQUARE",
] as const;

export type StoryboardVideoFormat =
  (typeof STORYBOARD_VIDEO_FORMATS)[number];

export type StoryboardVideoScene = {
  name: string;
  startMs: number;
  endMs: number;
  textOverlays?: Array<{ text: string }>;
  voiceoverPlan?: { text: string } | null;
};

export type StoryboardVideoStoryboard = {
  name: string;
  durationMs: number;
  scenes: StoryboardVideoScene[];
};

export type StoryboardVideoLayer = {
  name: string;
  type: "TEXT" | "MEDIA" | "SHAPE";
  textContent?: string;
  assetRef?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  opacity?: number;
  fit?: "COVER";
  keyframes?: Array<{
    property: "OPACITY";
    timeMs: number;
    fromValue: number;
    toValue: number;
    easing: "LINEAR" | "EASE_OUT";
  }>;
};

export type StoryboardVideoPlan = {
  composition: {
    name: string;
    width: number;
    height: number;
    frameRate: number;
    durationMs: number;
  };
  layers: StoryboardVideoLayer[];
};

const FORMAT_DIMENSIONS: Record<
  StoryboardVideoFormat,
  { width: number; height: number }
> = {
  VERTICAL: { width: 1080, height: 1920 },
  LANDSCAPE: { width: 1920, height: 1080 },
  SQUARE: { width: 1080, height: 1080 },
};

const MAX_DURATION_MS = 300_000;
const FADE_MS = 150;

function compact(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Splits display copy into at most `maxLines` lines that each fit the text box.
 * `drawtext` does not wrap on its own, so an unwrapped sentence would run off
 * the frame instead of being readable.
 */
function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }

  if (line && lines.length < maxLines) lines.push(line);

  if (words.join(" ").length > lines.join(" ").length) {
    const last = lines.length - 1;
    if (last >= 0) lines[last] = compact(lines[last]!, maxChars);
  }

  return lines;
}

function cleanLine(text: string | null | undefined): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (lower === "undefined" || lower === "null") return "";
  return normalized;
}

function sceneLine(scene: StoryboardVideoScene): string {
  const overlay =
    scene.textOverlays
      ?.map((entry) => cleanLine(entry.text))
      .filter(Boolean)
      .join(" ") ?? "";
  return overlay || cleanLine(scene.voiceoverPlan?.text);
}

/**
 * Fits a scene's window without ever producing two keyframes at one time.
 * A scene that starts at zero is already covered; a very short scene skips the
 * fade instead of squeezing three keyframes into a few milliseconds.
 */
function sceneKeyframes(
  startMs: number,
  endMs: number,
): NonNullable<StoryboardVideoLayer["keyframes"]> {
  const keyframes: NonNullable<StoryboardVideoLayer["keyframes"]> = [];

  if (startMs > 0) {
    keyframes.push({
      property: "OPACITY",
      timeMs: startMs - 1,
      fromValue: 0,
      toValue: 0,
      easing: "LINEAR",
    });
  }

  keyframes.push({
    property: "OPACITY",
    timeMs: startMs,
    fromValue: 1,
    toValue: 1,
    easing: "LINEAR",
  });

  const fadeStart = endMs - FADE_MS;

  if (fadeStart > startMs) {
    keyframes.push({
      property: "OPACITY",
      timeMs: fadeStart,
      fromValue: 1,
      toValue: 0,
      easing: "EASE_OUT",
    });
  }

  // A keyframe interpolates until the next keyframe or the end of the
  // composition. Without this final step the fade would ease toward zero for
  // the rest of the video and the previous scene would stay faintly visible
  // under every later scene.
  keyframes.push({
    property: "OPACITY",
    timeMs: endMs,
    fromValue: 0,
    toValue: 0,
    easing: "LINEAR",
  });

  return keyframes;
}

export function buildStoryboardVideoPlan(input: {
  storyboard: StoryboardVideoStoryboard;
  format: StoryboardVideoFormat;
  backgroundAssetId?: string | null;
}): StoryboardVideoPlan {
  const { width, height } = FORMAT_DIMENSIONS[input.format];
  const margin = Math.round(width * 0.08);
  const boxWidth = width - margin * 2;

  const lastEnd = input.storyboard.scenes.reduce(
    (end, scene) => Math.max(end, scene.endMs),
    0,
  );
  const durationMs = Math.min(
    MAX_DURATION_MS,
    Math.max(1_000, input.storyboard.durationMs, lastEnd),
  );

  const layers: StoryboardVideoLayer[] = [];

  if (input.backgroundAssetId) {
    layers.push({
      name: "Product screenshot",
      type: "MEDIA",
      assetRef: `asset:${input.backgroundAssetId}`,
      x: 0,
      y: 0,
      width,
      height,
      zIndex: 1,
      fit: "COVER",
    });
  }

  layers.push({
    name: "Text backdrop",
    type: "SHAPE",
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 2,
    opacity: 0.62,
  });

  const titleBoxHeight = 110;
  const titleFont = Math.round(titleBoxHeight * 0.5);
  const titleChars = Math.max(
    12,
    Math.floor(boxWidth / (titleFont * 0.58)),
  );

  layers.push({
    name: "Title",
    type: "TEXT",
    textContent: compact(input.storyboard.name, titleChars),
    x: margin,
    y: margin,
    width: boxWidth,
    height: titleBoxHeight,
    zIndex: 4,
  });

  const sceneBoxHeight = 120;
  const sceneFont = Math.round(sceneBoxHeight * 0.5);
  const sceneChars = Math.max(12, Math.floor(boxWidth / (sceneFont * 0.58)));
  const sceneY = Math.round((height - sceneBoxHeight) / 2);

  for (const scene of input.storyboard.scenes) {
    const startMs = Math.min(durationMs, Math.max(0, scene.startMs));
    const endMs = Math.min(durationMs, Math.max(startMs, scene.endMs));
    if (endMs <= startMs) continue;

    const line = sceneLine(scene);
    if (!line) continue;

    layers.push({
      name: `Scene · ${compact(scene.name, 40)}`,
      type: "TEXT",
      textContent: wrapLines(line, sceneChars, 2).join("\n"),
      x: margin,
      y: sceneY,
      width: boxWidth,
      height: sceneBoxHeight,
      zIndex: 3,
      keyframes: sceneKeyframes(startMs, endMs),
    });
  }

  return {
    composition: {
      name: `${compact(input.storyboard.name, 60)} video`,
      width,
      height,
      frameRate: 30,
      durationMs,
    },
    layers,
  };
}
