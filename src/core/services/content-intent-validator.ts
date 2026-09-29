/**
 * Validation is the layer that refuses to be helpful. It answers one question:
 * can this intent be handed to CP10 as it stands?
 *
 * Three classes of issue exist. Capability issues say the content type cannot do
 * what the user asked (a duration on a post). Compatibility issues say a
 * destination cannot carry this asset. Conflict issues say the request contains
 * two answers to one question, which is reported rather than silently decided.
 */

import { getContentType } from "../domain/content-type";
import { getPlatform } from "../domain/platform";
import {
  isAspectRatio,
  type ContentIntent,
  type ContentIntentConstraintKey,
} from "../domain/content-intent";

/**
 * The limits CP09 enforces, published so the editor can offer the same bounds
 * the server will accept. A client that guesses a different maximum is a client
 * that sends requests the server refuses.
 */
export const INTENT_LIMITS = {
  maxDurationSeconds: 3600,
  maxQuantity: 100,
  maxCustomEdge: 20_000,
} as const;

const MAX_DURATION_SECONDS = INTENT_LIMITS.maxDurationSeconds;
const MAX_QUANTITY = INTENT_LIMITS.maxQuantity;
const MAX_CUSTOM_EDGE = INTENT_LIMITS.maxCustomEdge;

export type ContentIntentValidationOptions = {
  /**
   * An implicit request ("make something for this") is a legitimate draft: it
   * exists so the user can be asked what they meant. The service persists those
   * and only enforces everything else about them.
   */
  allowUnresolvedType?: boolean;
};

export class ContentIntentValidator {
  validate(
    intent: ContentIntent,
    options: ContentIntentValidationOptions = {},
  ): string[] {
    const issues: string[] = [];

    if (!intent.contentTypeId) {
      if (!options.allowUnresolvedType) {
        issues.push("CONTENT_TYPE_REQUIRED");
      }
      return issues;
    }

    const type = getContentType(intent.contentTypeId);
    if (!type) {
      issues.push("CONTENT_TYPE_UNSUPPORTED");
      return issues;
    }

    if (intent.channel !== type.channel) {
      issues.push("CONTENT_TYPE_CHANNEL_MISMATCH");
    }

    if (intent.durationSeconds !== undefined) {
      if (!type.supportsDuration) {
        issues.push("CONTENT_TYPE_DOES_NOT_SUPPORT_DURATION");
      }
      if (
        !Number.isInteger(intent.durationSeconds) ||
        intent.durationSeconds <= 0 ||
        intent.durationSeconds > MAX_DURATION_SECONDS
      ) {
        issues.push("INVALID_DURATION");
      }
    }

    if (intent.aspectRatio !== undefined) {
      if (!type.supportsAspectRatio) {
        issues.push("CONTENT_TYPE_DOES_NOT_SUPPORT_ASPECT_RATIO");
      }
      if (!isAspectRatio(intent.aspectRatio)) {
        issues.push("INVALID_ASPECT_RATIO");
      }
      if (intent.aspectRatio === "CUSTOM" && !intent.customAspectRatio) {
        issues.push("CUSTOM_ASPECT_RATIO_REQUIRED");
      }
    }

    if (intent.customAspectRatio && intent.aspectRatio !== "CUSTOM") {
      issues.push("CUSTOM_ASPECT_RATIO_MISMATCH");
    }

    if (intent.customAspectRatio) {
      const { width, height } = intent.customAspectRatio;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > MAX_CUSTOM_EDGE ||
        height > MAX_CUSTOM_EDGE
      ) {
        issues.push("INVALID_CUSTOM_ASPECT_RATIO");
      }
    }

    if (intent.quantity !== 1 && !type.supportsQuantity) {
      issues.push("CONTENT_TYPE_DOES_NOT_SUPPORT_QUANTITY");
    }
    if (
      !Number.isInteger(intent.quantity) ||
      intent.quantity < 1 ||
      intent.quantity > MAX_QUANTITY
    ) {
      issues.push("INVALID_QUANTITY");
    }

    if (intent.tone !== undefined && !type.supportsTone) {
      issues.push("CONTENT_TYPE_DOES_NOT_SUPPORT_TONE");
    }

    if (intent.style !== undefined && !type.supportsStyle) {
      issues.push("CONTENT_TYPE_DOES_NOT_SUPPORT_STYLE");
    }

    if (intent.language !== undefined && !type.supportsLanguage) {
      issues.push("CONTENT_TYPE_DOES_NOT_SUPPORT_LANGUAGE");
    }

    for (const platformId of intent.platforms) {
      const platform = getPlatform(platformId);
      if (!platform) {
        // A content type may list a surface that is not a destination (a
        // voiceover's "video"), so an unknown id is simply never attachable.
        issues.push(`PLATFORM_UNSUPPORTED:${platformId}`);
        continue;
      }
      if (!platform.channels.includes(type.channel)) {
        issues.push(`PLATFORM_CHANNEL_UNSUPPORTED:${platformId}`);
      }
      if (!type.supportedPlatforms.includes(platformId)) {
        // One code, one meaning: this destination cannot carry this output. A
        // launch video on a YouTube Short is the same failure as a thumbnail on
        // LinkedIn, and both are answered the same way.
        issues.push(`PLATFORM_UNSUPPORTED:${platformId}`);
      }
    }

    issues.push(...conflictIssues(intent));

    return issues;
  }
}

/**
 * A conflict is two user answers to the same question. Only USER constraints
 * can conflict with each other: a platform default that disagrees with a stated
 * ratio is not a conflict, and a model guess is never a reason to fail.
 */
function isDimensionPair(value: string): boolean {
  return /^\d{2,5}x\d{2,5}$/.test(value);
}

function conflictIssues(intent: ContentIntent): string[] {
  const issues: string[] = [];

  const userValues = (key: ContentIntentConstraintKey): string[] => [
    ...new Set(
      intent.constraints
        .filter((entry) => entry.key === key && entry.source === "USER")
        .map((entry) => entry.value),
    ),
  ];

  const durations = userValues("duration");
  if (durations.length > 1) {
    issues.push("CONFLICTING_DURATION");
  } else if (
    durations.length === 1 &&
    intent.durationSeconds !== undefined &&
    Number(durations[0]) !== intent.durationSeconds
  ) {
    issues.push("CONFLICTING_DURATION");
  }

  const quantities = userValues("quantity");
  if (quantities.length > 1) {
    issues.push("CONFLICTING_QUANTITY");
  } else if (
    quantities.length === 1 &&
    Number(quantities[0]) !== intent.quantity
  ) {
    issues.push("CONFLICTING_QUANTITY");
  }

  const ratios = userValues("aspectRatio");
  if (ratios.length > 1) {
    issues.push("CONFLICTING_ASPECT_RATIO");
  } else if (
    ratios.length === 1 &&
    intent.aspectRatio !== undefined &&
    ratios[0] !== intent.aspectRatio &&
    // A custom ratio is stored as its dimensions, so "1080x1920" and CUSTOM are
    // the same answer written two ways.
    !(intent.aspectRatio === "CUSTOM" && isDimensionPair(ratios[0]))
  ) {
    issues.push("CONFLICTING_ASPECT_RATIO");
  }

  return issues;
}
