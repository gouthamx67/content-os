import {
  MOTION_EASINGS,
  MOTION_PROPERTIES,
  VISUAL_EFFECT_TYPES,
  VISUAL_FIT_MODES,
  VISUAL_LAYER_TYPES,
} from "./domain/types";

/**
 * Re-exported vocabularies for the client.
 *
 * The workspace renders selects from these rather than hard-coding option lists,
 * so adding an enum member once makes it appear in the UI without a second edit.
 */
export const motionPalette = {
  properties: MOTION_PROPERTIES,
  easings: MOTION_EASINGS,
} as const;

export const effectPalette = {
  types: VISUAL_EFFECT_TYPES,
} as const;

export const fitPalette = {
  modes: VISUAL_FIT_MODES,
} as const;

export const layerPalette = {
  types: VISUAL_LAYER_TYPES,
} as const;
