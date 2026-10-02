export const MOTION_PRESET_IDS = [
  "FADE_IN",
  "FADE_OUT",
  "SLIDE_UP",
  "SLIDE_LEFT",
  "ZOOM_IN",
  "PULSE",
  "KEN_BURNS",
] as const;

export type MotionPresetId = (typeof MOTION_PRESET_IDS)[number];

export type MotionPreset = {
  id: MotionPresetId;
  label: string;
  description: string;
};

/**
 * Presets are keyframe recipes, not a second animation engine. Applying one
 * writes ordinary keyframes, so a user can then edit them like any other motion
 * rather than being trapped in an opaque preset.
 */
export const MOTION_PRESETS: Readonly<Record<MotionPresetId, MotionPreset>> = {
  FADE_IN: {
    id: "FADE_IN",
    label: "Fade in",
    description: "Opacity rises from 0 to 1 across the opening.",
  },
  FADE_OUT: {
    id: "FADE_OUT",
    label: "Fade out",
    description: "Opacity falls from 1 to 0 across the close.",
  },
  SLIDE_UP: {
    id: "SLIDE_UP",
    label: "Slide up",
    description: "The layer rises from below into place.",
  },
  SLIDE_LEFT: {
    id: "SLIDE_LEFT",
    label: "Slide left",
    description: "The layer enters from the right.",
  },
  ZOOM_IN: {
    id: "ZOOM_IN",
    label: "Zoom in",
    description: "A slow scale from 1.0 to 1.2.",
  },
  PULSE: {
    id: "PULSE",
    label: "Pulse",
    description: "A dip to half opacity and back.",
  },
  KEN_BURNS: {
    id: "KEN_BURNS",
    label: "Ken Burns",
    description: "A combined slow scale and drift.",
  },
};

export function isMotionPresetId(value: unknown): value is MotionPresetId {
  return (
    typeof value === "string" &&
    (MOTION_PRESET_IDS as readonly string[]).includes(value)
  );
}
