/**
 * Resolution is where a parse becomes an intent with provenance. Three rules
 * govern everything here:
 *
 * 1. A user statement outranks a brand signal, which outranks a model guess.
 * 2. A default may only be applied when it is deterministic (a platform's own
 *    aspect ratio, a text type's single destination, quantity 1). Nothing about
 *    style, tone or hook is ever invented.
 * 3. What could not be resolved is named. A missing content type is reported,
 *    not guessed.
 */

import {
  getContentType,
  onlySupportedPlatform,
  type ContentTypeDefinition,
} from "../domain/content-type";
import { getPlatform } from "../domain/platform";
import {
  isAspectRatio,
  type AspectRatio,
  type ContentIntent,
  type ContentIntentConstraint,
  type ContentIntentConstraintKey,
  type IntentConfidence,
  type IntentResolutionMode,
  type IntentStatus,
  type IntentSubject,
} from "../domain/content-intent";
import {
  normalizeIntentStyle,
  normalizeIntentTone,
} from "../../lib/intent-lexicon";
import type { ContentIntentInterpretation } from "../ports/content-intent-interpreter";
import type { ParsedIntent } from "./content-intent-parser";

export type IntentResolutionContext = {
  projectId: string;

  sourceIds?: string[];

  brandVersion?: number;

  intelligenceSnapshotVersion?: number;

  /**
   * Subject mentions the service could link to real intelligence entities. The
   * resolver does not search the graph: linking is a repository concern, and a
   * pure resolver keeps the provenance rules testable on their own.
   */
  subjects?: IntentSubject[];

  /**
   * A tone read off the brand profile. Inference, so it is recorded as a BRAND
   * constraint and never as something the user said.
   */
  brandTone?: string;

  brandStyle?: string;

  now?: string;
};

export type ContentIntentEdit = {
  contentTypeId?: string | null;
  platforms?: string[] | null;
  durationSeconds?: number | null;
  aspectRatio?: AspectRatio | null;
  customAspectRatio?: { width: number; height: number } | null;
  quantity?: number | null;
  tone?: string | null;
  style?: string | null;
  language?: string | null;
  audience?: string | null;
  cta?: string | null;
  purpose?: string | null;
  status?: IntentStatus;
};

const ASPECT_RATIO_KEY: ContentIntentConstraintKey = "aspectRatio";

/**
 * A recorded ratio is what the user can read back: a named ratio as its name, a
 * custom one as its dimensions. "CUSTOM" on its own says nothing and cannot be
 * restored from the constraint alone.
 */
function aspectRatioValue(
  ratio: AspectRatio | null | undefined,
  custom: { width: number; height: number } | null | undefined,
): string | null {
  if (ratio === null || ratio === undefined) return null;
  if (ratio === "CUSTOM" && custom) return `${custom.width}x${custom.height}`;
  return ratio;
}

export class ContentIntentResolver {
  resolve(
    rawRequest: string,
    parsed: ParsedIntent,
    context: IntentResolutionContext,
    interpretation?: ContentIntentInterpretation | null,
  ): ContentIntent {
    const now = context.now ?? new Date().toISOString();

    const contentTypeId = parsed.contentTypeId ?? interpretation?.contentTypeId;
    const type = contentTypeId ? getContentType(contentTypeId) : null;
    const typeFromAi = !parsed.contentTypeId && Boolean(interpretation?.contentTypeId);

    const constraints: ContentIntentConstraint[] = [...parsed.constraints];
    if (typeFromAi && contentTypeId) {
      constraints.push({ key: "contentType", value: contentTypeId, source: "AI" });
    }
    const usedAi = { value: false };
    const usedBrand = { value: false };
    const notes: string[] = [...(interpretation?.notes ?? [])];

    const platforms = this.resolvePlatforms(
      parsed.platforms,
      type,
      interpretation,
      constraints,
      usedAi,
    );

    const durationSeconds =
      parsed.durationSeconds ??
      integerOrUndefined(interpretation?.durationSeconds);
    if (
      durationSeconds !== undefined &&
      parsed.durationSeconds === undefined &&
      interpretation?.durationSeconds !== undefined
    ) {
      constraints.push({
        key: "duration",
        value: String(interpretation.durationSeconds),
        source: "AI",
      });
      usedAi.value = true;
    }

    const quantity = this.resolveQuantity(parsed, constraints);
    const aspectRatio = this.resolveAspectRatio(
      parsed,
      type,
      platforms,
      interpretation,
      constraints,
      usedAi,
    );

    let language = parsed.language ?? normalizeLanguage(interpretation?.language);
    if (parsed.language === undefined && language !== undefined) {
      constraints.push({ key: "language", value: language, source: "AI" });
      usedAi.value = true;
    } else if (language === undefined) {
      language = "en";
      constraints.push({ key: "language", value: "en", source: "SYSTEM" });
      notes.push("CONSTRAINT_NOTE: language defaulted to en");
    }

    // User, then brand, then model: a brand signal is grounded in the brand
    // profile, a model guess is grounded in nothing.
    const tone =
      parsed.tone ??
      brandSignal("tone", context.brandTone, "BRAND", constraints, usedBrand, notes) ??
      (interpretation?.tone
        ? recordDerived("tone", interpretation.tone, "AI", constraints, usedAi)
        : undefined);

    const style =
      parsed.style ??
      brandSignal("style", context.brandStyle, "BRAND", constraints, usedBrand, notes) ??
      (interpretation?.style
        ? recordDerived("style", interpretation.style, "AI", constraints, usedAi)
        : undefined);

    // The audience and the CTA are the user's own words. A model may not write
    // either one: personas and copy are later checkpoints' work.
    const audience = parsed.audience;
    const cta = parsed.cta;
    const purpose = parsed.purpose ?? interpretation?.purpose ?? undefined;

    const subjects = [...(context.subjects ?? [])];
    const unresolvedFields = parsed.unresolvedFields.filter(
      (field) => !(field === "contentType" && type),
    );
    if (parsed.subjectMentions.length > 0 && subjects.length === 0) {
      unresolvedFields.push("subjects");
    }
    if (type && platforms.length === 0 && needsDestination(type)) {
      unresolvedFields.push("platform");
    }

    const mode = this.resolveMode({
      hasType: Boolean(type),
      typeOrigin: parsed.contentTypeOrigin,
      typeFromAi,
      unresolvedFields,
    });

    return {
      id: "",
      projectId: context.projectId,
      rawRequest,
      // An unresolved intent has no channel of its own. The placeholder keeps
      // the record well formed; `contentTypeId` and `unresolvedFields` are what
      // say the channel is not decided yet.
      channel: type?.channel ?? channelForPlatforms(platforms) ?? "VIDEO",
      contentTypeId: type?.id ?? "",
      purpose,
      platforms,
      subjects,
      audience,
      language,
      tone,
      style,
      durationSeconds,
      quantity,
      aspectRatio,
      customAspectRatio: parsed.customAspectRatio,
      cta,
      constraints: dedupeConstraints(constraints),
      resolutionMode: mode,
      status: statusForMode(mode),
      confidence: confidenceFor(mode, usedAi.value || usedBrand.value),
      unresolvedFields: dedupe(unresolvedFields),
      notes,
      sourceIds: [...(context.sourceIds ?? [])],
      brandVersion: context.brandVersion,
      intelligenceSnapshotVersion: context.intelligenceSnapshotVersion,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * A user edit rewrites the fields it touches and replaces the constraints for
   * those keys, so changing 30 seconds to 15 does not leave two USER durations
   * behind and read back as a conflict.
   */
  applyUserEdit(
    intent: ContentIntent,
    edit: ContentIntentEdit,
    now = new Date().toISOString(),
  ): ContentIntent {
    const next: ContentIntent = { ...intent, updatedAt: now };
    let constraints = [...intent.constraints];
    const replace = (key: ContentIntentConstraintKey, value: string | null) => {
      constraints = constraints.filter((entry) => entry.key !== key);
      if (value !== null) {
        constraints.push({ key, value, source: "USER" });
      }
    };

    if (edit.contentTypeId !== undefined) {
      const contentTypeId = edit.contentTypeId ?? "";
      next.contentTypeId = contentTypeId;
      const type = getContentType(contentTypeId);
      next.channel = type?.channel ?? next.channel;
    }

    if (edit.platforms !== undefined) {
      next.platforms = edit.platforms ? [...new Set(edit.platforms)] : [];
      constraints = constraints.filter((entry) => entry.key !== "platform");
      for (const platform of next.platforms) {
        constraints.push({ key: "platform", value: platform, source: "USER" });
      }
    }

    if (edit.durationSeconds !== undefined) {
      next.durationSeconds = edit.durationSeconds ?? undefined;
      replace("duration", edit.durationSeconds === null ? null : String(edit.durationSeconds));
    }

    if (edit.aspectRatio !== undefined) {
      next.aspectRatio = edit.aspectRatio ?? undefined;
      next.customAspectRatio = edit.customAspectRatio ?? undefined;
      replace(ASPECT_RATIO_KEY, aspectRatioValue(edit.aspectRatio, edit.customAspectRatio));
    } else if (edit.customAspectRatio !== undefined) {
      next.aspectRatio = edit.customAspectRatio ? "CUSTOM" : undefined;
      next.customAspectRatio = edit.customAspectRatio ?? undefined;
      replace(ASPECT_RATIO_KEY, next.aspectRatio ?? null);
    }

    if (edit.quantity !== undefined) {
      next.quantity = edit.quantity ?? 1;
      replace("quantity", String(next.quantity));
    }

    if (edit.tone !== undefined) {
      next.tone = edit.tone ?? undefined;
      replace("tone", edit.tone ?? null);
    }

    if (edit.style !== undefined) {
      next.style = edit.style ?? undefined;
      replace("style", edit.style ?? null);
    }

    if (edit.language !== undefined) {
      next.language = edit.language ?? undefined;
      replace("language", edit.language ?? null);
    }

    if (edit.audience !== undefined) {
      next.audience = edit.audience ?? undefined;
      replace("audience", edit.audience ?? null);
    }

    if (edit.cta !== undefined) {
      next.cta = edit.cta ?? undefined;
      replace("cta", edit.cta ?? null);
    }

    if (edit.purpose !== undefined) {
      next.purpose = edit.purpose ?? undefined;
    }

    next.constraints = dedupeConstraints(constraints);
    next.unresolvedFields = recomputeUnresolved(next);
    next.resolutionMode = this.resolveMode({
      hasType: Boolean(getContentType(next.contentTypeId)),
      typeOrigin: "EXPLICIT",
      typeFromAi: false,
      unresolvedFields: next.unresolvedFields,
    });
    next.status = edit.status ?? statusForMode(next.resolutionMode);
    next.confidence = confidenceFor(next.resolutionMode, false);

    return next;
  }

  private resolvePlatforms(
    parsed: string[],
    type: ContentTypeDefinition | null,
    interpretation: ContentIntentInterpretation | null | undefined,
    constraints: ContentIntentConstraint[],
    usedAi: { value: boolean },
  ): string[] {
    const platforms = [...parsed];
    const userConstraintPlatforms = new Set(
      constraints.filter((entry) => entry.key === "platform").map((entry) => entry.value),
    );

    // A model may fill an empty destination and nothing more. Stated platforms
    // are a decision, so an extra channel is never added on top of them.
    if (platforms.length === 0) {
      for (const platform of interpretation?.platforms ?? []) {
        if (platforms.includes(platform)) continue;
        if (!getPlatform(platform)) continue;
        platforms.push(platform);
        constraints.push({ key: "platform", value: platform, source: "AI" });
        usedAi.value = true;
      }
    }

    if (platforms.length > 0) return platforms;

    // A type that exists on exactly one platform is not a choice the user has
    // to make: a LinkedIn post is on LinkedIn.
    const implied = type ? onlySupportedPlatform(type) : null;
    if (implied && getPlatform(implied) && !userConstraintPlatforms.has(implied)) {
      constraints.push({ key: "platform", value: implied, source: "SYSTEM" });
      return [implied];
    }

    return platforms;
  }

  private resolveQuantity(
    parsed: ParsedIntent,
    constraints: ContentIntentConstraint[],
  ): number {
    if (parsed.quantityCandidates.length > 0) {
      return parsed.quantity;
    }

    // One is the only defensible number for a request that did not say. A model
    // asked to "estimate a sensible quantity" invents work nobody asked for, so
    // the quantity it reports is deliberately not applied.
    constraints.push({ key: "quantity", value: "1", source: "SYSTEM" });
    return 1;
  }

  private resolveAspectRatio(
    parsed: ParsedIntent,
    type: ContentTypeDefinition | null,
    platforms: string[],
    interpretation: ContentIntentInterpretation | null | undefined,
    constraints: ContentIntentConstraint[],
    usedAi: { value: boolean },
  ): AspectRatio | undefined {
    if (parsed.aspectRatioCandidates.length > 0) {
      return parsed.aspectRatio;
    }

    const fromAi = interpretation?.aspectRatio;
    if (isAspectRatio(fromAi)) {
      constraints.push({ key: ASPECT_RATIO_KEY, value: fromAi, source: "AI" });
      usedAi.value = true;
      return fromAi;
    }

    if (type && !type.supportsAspectRatio) return undefined;

    // A platform default is deterministic, but only when the platforms named do
    // not disagree with each other. Two destinations with different ratios mean
    // the ratio is genuinely undecided, so it stays unstated.
    const defaults = new Set(
      platforms
        .map((platform) => getPlatform(platform)?.defaultAspectRatio)
        .filter((ratio): ratio is string => Boolean(ratio)),
    );

    if (defaults.size !== 1) return undefined;

    const ratio = [...defaults][0];
    if (!isAspectRatio(ratio)) return undefined;

    constraints.push({ key: ASPECT_RATIO_KEY, value: ratio, source: "SYSTEM" });
    return ratio;
  }

  private resolveMode(input: {
    hasType: boolean;
    typeOrigin: ParsedIntent["contentTypeOrigin"];
    typeFromAi: boolean;
    unresolvedFields: string[];
  }): IntentResolutionMode {
    if (!input.hasType) return "NEEDS_CLARIFICATION";
    if (input.unresolvedFields.length > 0) return "PARTIAL";
    if (input.typeOrigin === "INFERRED" || input.typeFromAi) return "INFERRED";
    return "EXPLICIT";
  }
}

function statusForMode(mode: IntentResolutionMode): IntentStatus {
  switch (mode) {
    case "NEEDS_CLARIFICATION":
      return "NEEDS_CLARIFICATION";
    case "PARTIAL":
      return "DRAFT";
    default:
      return "RESOLVED";
  }
}

function confidenceFor(mode: IntentResolutionMode, inferred: boolean): IntentConfidence {
  if (mode === "NEEDS_CLARIFICATION") return "LOW";
  if (mode === "PARTIAL") return "MEDIUM";
  if (mode === "INFERRED" || inferred) return "MEDIUM";
  return "HIGH";
}

/** A text post or a campaign has nowhere to go without a destination. */
function needsDestination(type: ContentTypeDefinition): boolean {
  return type.channel === "TEXT" || type.channel === "CAMPAIGN";
}

function channelForPlatforms(platforms: string[]): ContentIntent["channel"] | null {
  const channels = new Set(
    platforms
      .map((platform) => getPlatform(platform)?.channels)
      .filter((value): value is NonNullable<typeof value> => Array.isArray(value))
      .flat(),
  );
  return channels.size === 1 ? [...channels][0] : null;
}

function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const code = value.trim().toLowerCase();
  return code.length === 2 ? code : undefined;
}

/**
 * Records a field that was not stated by the user but was supplied by the
 * brand or by a model, so the intent keeps saying where the value came from.
 */
/**
 * A brand voice signal is brand copy, not a CP09 value: "quirky" is a real word
 * in a brand profile and is not one of the tones CP09 can carry. It is dropped
 * with a note rather than normalised into the nearest supported tone, so the
 * user sees that their brand says something CP09 does not model.
 */
function brandSignal(
  key: "tone" | "style",
  value: string | undefined,
  source: "BRAND",
  constraints: ContentIntentConstraint[],
  used: { value: boolean },
  notes: string[],
): string | undefined {
  if (!value) return undefined;

  const supported = key === "tone" ? normalizeIntentTone(value) : normalizeIntentStyle(value);
  if (!supported) {
    notes.push(`BRAND_${key.toUpperCase()}_UNSUPPORTED: ${value}`);
    return undefined;
  }

  return recordDerived(key, supported, source, constraints, used);
}

function recordDerived(
  key: ContentIntentConstraintKey,
  value: string,
  source: "BRAND" | "AI",
  constraints: ContentIntentConstraint[],
  used?: { value: boolean },
): string {
  constraints.push({ key, value, source });
  used!.value = true;
  return value;
}

function integerOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function recomputeUnresolved(intent: ContentIntent): string[] {
  const unresolved: string[] = [];
  if (!getContentType(intent.contentTypeId)) unresolved.push("contentType");
  const type = getContentType(intent.contentTypeId);
  if (type && needsDestination(type) && intent.platforms.length === 0) {
    unresolved.push("platform");
  }
  return dedupe(unresolved);
}

function dedupeConstraints(
  constraints: ContentIntentConstraint[],
): ContentIntentConstraint[] {
  const seen = new Set<string>();
  const result: ContentIntentConstraint[] = [];
  for (const constraint of constraints) {
    const key = `${constraint.key} ${constraint.value} ${constraint.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(constraint);
  }
  return result;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
