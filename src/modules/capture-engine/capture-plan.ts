export const CAPTURE_PLAN_MODES = [
  "CAMERA",
  "MICROPHONE",
  "SCREEN",
  "FILE",
] as const;

export type CapturePlanMode = (typeof CAPTURE_PLAN_MODES)[number];

/**
 * What CP11 already knows about one shot.
 *
 * `captureRequirements` is CP11's, not this file's: the engine reads a shot's
 * requirements rather than inventing them, so a storyboard change is what moves
 * the capture brief. Every field is optional because a storyboard written before
 * requirements existed still has to be capturable.
 */
export type CapturePlanShot = {
  id: string;
  title: string;
  captureRequirements?: {
    modes: string[];
    instructions: string[];
    required?: boolean;
  } | null;
};

export interface CapturePlanItem {
  shotId: string;
  shotTitle: string;
  requiredModes: CapturePlanMode[];
  instructions: string[];
  required: boolean;
}

export function buildCapturePlan(shots: CapturePlanShot[]): CapturePlanItem[] {
  return shots.map((shot) => ({
    shotId: shot.id,
    shotTitle: shot.title,
    requiredModes: normalizeModes(shot.captureRequirements?.modes ?? []),
    instructions: shot.captureRequirements?.instructions ?? [],
    // A shot with no requirements is capturable but not demanded. Defaulting to
    // true would put every unannotated shot on the critical path.
    required: shot.captureRequirements?.required ?? false,
  }));
}

/**
 * Unknown modes are dropped rather than passed through: a mode this engine
 * cannot honour would render as a button that cannot be pressed, which is worse
 * than naming only the modes that actually work.
 */
function normalizeModes(modes: string[]): CapturePlanMode[] {
  const allowed = new Set<string>(CAPTURE_PLAN_MODES);

  return modes.filter((mode): mode is CapturePlanMode =>
    allowed.has(mode),
  );
}

/**
 * Which modes the UI should offer for a shot: the ones CP11 asked for, or all of
 * them when the shot expressed no preference. The engine never narrows a user's
 * choice to what was planned — a shot marked CAMERA is a requirement, not a
 * prohibition on also importing a file for it.
 */
export function modesForPlanItem(
  item: CapturePlanItem,
): CapturePlanMode[] {
  return item.requiredModes.length > 0
    ? item.requiredModes
    : [...CAPTURE_PLAN_MODES];
}
