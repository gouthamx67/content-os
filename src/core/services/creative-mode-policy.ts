/**
 * The mode decides how far a direction may stray, and each one has to differ in
 * what it actually permits rather than only in what it is called.
 *
 * `maxUnverifiedClaims` is zero in every policy and is typed as the literal `0`
 * so that adding a looser mode is a type error rather than a silent change to
 * what the project is allowed to have said.
 */

import {
  CREATIVE_ANGLES,
  isCreativeMode,
  type CreativeAngle,
  type CreativeMode,
} from "../domain/creative-direction";
import type { CreativeModePolicy } from "../domain/creative-context";
import { CreativeError } from "../domain/creative-direction";

const ALL_ANGLES: readonly CreativeAngle[] = CREATIVE_ANGLES;

/** Angles that lean on the product being visible rather than argued. */
const GROUNDED_ANGLES: readonly CreativeAngle[] = [
  "PROBLEM_SOLUTION",
  "PRODUCT_FIRST",
  "WORKFLOW",
  "TRANSFORMATION",
  "FOUNDER",
  "TECHNICAL",
  "EDUCATIONAL",
  "BEFORE_AFTER",
  "DEMO",
];

const POLICIES: Readonly<Record<CreativeMode, CreativeModePolicy>> = {
  GUIDED: {
    mode: "GUIDED",
    label: "Guided",
    description:
      "Straightforward and product-forward. The real interface does the arguing, and the hook has to be a plain statement of a fact.",
    allowMetaphor: false,
    allowExperimentalHooks: false,
    requireProductUi: true,
    allowConceptualVisuals: false,
    maxUnverifiedClaims: 0,
    allowedAngles: GROUNDED_ANGLES,
  },
  BALANCED: {
    mode: "BALANCED",
    label: "Balanced",
    description:
      "The default. Real product UI is preferred, and a metaphor or an unconventional opening is allowed when the proof stays underneath it.",
    allowMetaphor: true,
    allowExperimentalHooks: true,
    requireProductUi: false,
    allowConceptualVisuals: true,
    maxUnverifiedClaims: 0,
    allowedAngles: ALL_ANGLES,
  },
  WILD: {
    mode: "WILD",
    label: "Wild",
    description:
      "The most experimental framing allowed. The look and the opening can be unconventional, but every capability still has to exist and every claim still has to be supported.",
    allowMetaphor: true,
    allowExperimentalHooks: true,
    requireProductUi: false,
    allowConceptualVisuals: true,
    maxUnverifiedClaims: 0,
    allowedAngles: ALL_ANGLES,
  },
};

export function getCreativeModePolicy(mode: string): CreativeModePolicy {
  if (!isCreativeMode(mode)) {
    throw new CreativeError(
      "CREATIVE_MODE_REQUIRED",
      `Creative mode must be one of GUIDED, BALANCED or WILD`,
    );
  }

  return POLICIES[mode];
}

export function creativeModeRegistry(): Array<{
  id: CreativeMode;
  label: string;
  description: string;
}> {
  return Object.values(POLICIES).map((policy) => ({
    id: policy.mode,
    label: policy.label,
    description: policy.description,
  }));
}

/**
 * Phrases that mark an opening as a device rather than a statement of fact.
 * Guided work may not open on one: a metaphor in a trustworthy format reads as
 * a trick, and the mode exists for people who asked for no tricks.
 */
const EXPERIMENTAL_MARKERS: readonly RegExp[] = [
  /\bimagine\b/i,
  /\bimagine if\b/i,
  /\bas if\b/i,
  /\bas though\b/i,
  /\bas if the world\b/i,
  /\bthink of it as\b/i,
  /\bmetafor\b/i,
  /\bmetaphor/i,
  /\bsurreal\b/i,
  /\bdream (?:like|sequence)\b/i,
  /\bwhat if\b/i,
  /\bonly imagine\b/i,
];

export function readsAsExperimentalHook(text: string): boolean {
  return EXPERIMENTAL_MARKERS.some((marker) => marker.test(text));
}

/** Modes allow a conceptual look, but Guided is the one that has to refuse it. */
export function readsAsConceptualVisual(text: string): boolean {
  return (
    /\b(?:stylised|stylized|surreal|abstract(?:ed)? (?:visual|shape|form)|impressionist|metaphori)/i.test(
      text,
    ) || /\b(?:drawn|painted|illustrated) (?:rather than|instead of) (?:the )?(?:real|actual)/i.test(text)
  );
}
