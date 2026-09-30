/**
 * Everything a direction claims is checked here, once, before it can be stored.
 *
 * The rules are deliberately unforgiving. A direction that references an asset
 * the project does not have, cites a claim the intelligence graph never
 * recorded, or promises a number nobody verified is not a direction with a
 * problem - it is a fabrication, and storing it would put a false claim in front
 * of a user who has no way to tell it apart from a real one.
 */

import type {
  CreativeContext,
  CreativeContextAsset,
} from "../domain/creative-context";
import {
  CREATIVE_ANGLES,
  isCreativeAngle,
  type CreativeDirection,
  type CreativeDirectionDraft,
} from "../domain/creative-direction";
import { getCreativeModePolicy, readsAsConceptualVisual, readsAsExperimentalHook } from "./creative-mode-policy";
import { isQuantifiedClaimSupported, QUANTIFIED_CLAIM_PATTERNS } from "./copy-claims";
import { isProductUiAsset } from "./creative-strength";

const MAX_FIELD_LENGTH = 600;
const MAX_LIST_ITEMS = 8;
const MAX_SENTENCE_LENGTH = 320;

export interface CreativeValidationIssue {
  code: string;
  message: string;
}

export class CreativeValidationFailure extends Error {
  constructor(readonly issues: CreativeValidationIssue[]) {
    super(
      issues.map((issue) => issue.message).join("; ") ||
        "Creative direction failed validation",
    );
    this.name = "CreativeValidationFailure";
  }
}

/**
 * Numbers a direction states. The patterns live in `copy-claims` because a
 * storyboard holds the same promise in a stricter form: the words that reach a
 * caption have to clear the same bar as a thesis.
 */
const QUANTIFIED_PATTERNS = QUANTIFIED_CLAIM_PATTERNS;

/** Fields the domain allows to be absent rather than filled in. */
const OPTIONAL_TEXT_FIELDS: readonly string[] = ["cta"];

/** Whether an optional field was genuinely left out, as opposed to left blank. */
function isAbsent(direction: CreativeDirection, label: string): boolean {
  const value: unknown = (direction as unknown as Record<string, unknown>)[label];
  return value === null || value === undefined;
}

/** Every free-text field a fabrication could hide in. */
function creativeText(direction: CreativeDirection): Array<[string, string]> {
  return [
    ["name", direction.name],
    ["thesis", direction.thesis],
    ["hook.statement", direction.hook.statement],
    ["hook.mechanism", direction.hook.mechanism],
    ["hook.emotionalTrigger", direction.hook.emotionalTrigger],
    ["audienceAngle", direction.audienceAngle],
    ["emotionalAngle", direction.emotionalAngle],
    ["narrativeSummary", direction.narrativeSummary],
    ["visualStrategy.approach", direction.visualStrategy.approach],
    ["visualStrategy.rationale", direction.visualStrategy.rationale],
    ["voiceDirection", direction.voiceDirection],
    ["musicDirection", direction.musicDirection],
    ["soundDirection", direction.soundDirection],
    ["cta", direction.cta ?? ""], // optional; see OPTIONAL_TEXT_FIELDS
    ["rationale", direction.rationale],
    ...direction.visualStrategy.productMoments.map(
      (moment, index) =>
        [`visualStrategy.productMoments[${index}]`, moment] as [string, string],
    ),
    ...direction.proofStrategy.proofPoints.map(
      (point, index) => [`proofStrategy.proofPoints[${index}]`, point] as [string, string],
    ),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Free text in, clean text out. Used by the AI parser, not by the validator. */
export function normalizeCreativeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function textField(
  value: unknown,
  label: string,
  issues: CreativeValidationIssue[],
  options: { max?: number; required?: boolean } = {},
): string {
  const max = options.max ?? MAX_FIELD_LENGTH;
  if (typeof value !== "string") {
    issues.push({
      code: "CREATIVE_FIELD_MISSING",
      message: `Creative direction field "${label}" must be a string`,
    });
    return "";
  }
  const cleaned = normalizeCreativeText(value);
  if (!cleaned) {
    if (options.required !== false) {
      issues.push({
        code: "CREATIVE_FIELD_MISSING",
        message: `Creative direction field "${label}" cannot be empty`,
      });
    }
    return "";
  }
  if (cleaned.length > max) {
    issues.push({
      code: "CREATIVE_FIELD_TOO_LONG",
      message: `Creative direction field "${label}" is longer than ${max} characters`,
    });
  }
  return cleaned;
}

function stringList(
  value: unknown,
  label: string,
  issues: CreativeValidationIssue[],
  options: { maxItems?: number; minItems?: number; maxLength?: number } = {},
): string[] {
  if (!Array.isArray(value)) {
    issues.push({
      code: "CREATIVE_FIELD_MISSING",
      message: `Creative direction field "${label}" must be a list`,
    });
    return [];
  }
  const maxItems = options.maxItems ?? MAX_LIST_ITEMS;
  if (value.length > maxItems) {
    issues.push({
      code: "CREATIVE_LIST_TOO_LONG",
      message: `Creative direction field "${label}" holds more than ${maxItems} items`,
    });
  }
  const minItems = options.minItems ?? 0;
  if (value.length < minItems) {
    issues.push({
      code: "CREATIVE_LIST_TOO_SHORT",
      message: `Creative direction field "${label}" needs at least ${minItems} items`,
    });
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeCreativeText(item))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => {
      const max = options.maxLength ?? MAX_SENTENCE_LENGTH;
      if (item.length > max) {
        issues.push({
          code: "CREATIVE_ITEM_TOO_LONG",
          message: `Creative direction item in "${label}" is longer than ${max} characters`,
        });
      }
      return item;
    });
}

function idList(
  value: unknown,
  label: string,
  issues: CreativeValidationIssue[],
  known: ReadonlySet<string>,
  code: string,
): string[] {
  if (!Array.isArray(value)) {
    issues.push({
      code: "CREATIVE_FIELD_MISSING",
      message: `Creative direction field "${label}" must be a list of ids`,
    });
    return [];
  }
  const ids = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const id of ids) {
    if (!known.has(id)) {
      issues.push({
        code,
        message: `Creative direction references ${id} in "${label}", which this project does not have`,
      });
    }
  }
  return [...new Set(ids)];
}

/**
 * Checks a direction against the context it claims to be built from. Throws a
 * `CreativeValidationFailure` listing every problem, so a rejected provider
 * output is debuggable instead of just refused.
 */
export function validateCreativeDirection(
  direction: CreativeDirection,
  context: CreativeContext,
): CreativeDirection {
  const issues: CreativeValidationIssue[] = [];

  if (!isCreativeAngle(direction.angle)) {
    issues.push({
      code: "CREATIVE_UNKNOWN_ANGLE",
      message: `Creative angle must be one of ${CREATIVE_ANGLES.join(", ")}`,
    });
  }

  if (direction.mode !== context.mode) {
    issues.push({
      code: "CREATIVE_MODE_MISMATCH",
      message: `Creative direction was written for ${direction.mode} but generated in ${context.mode}`,
    });
  }

  if (
    !Number.isInteger(direction.strengthScore) ||
    direction.strengthScore < 1 ||
    direction.strengthScore > 100
  ) {
    issues.push({
      code: "CREATIVE_INVALID_SCORE",
      message: "Creative strength must be an integer between 1 and 100",
    });
  }

  if (direction.projectId !== context.projectId) {
    issues.push({
      code: "CREATIVE_SCOPE_VIOLATION",
      message: "Creative direction does not belong to this project",
    });
  }

  if (direction.intentId !== context.intentId) {
    issues.push({
      code: "CREATIVE_SCOPE_VIOLATION",
      message: "Creative direction does not belong to this content request",
    });
  }

  // The rules are read from the mode being validated rather than from the policy
  // the context happens to carry, so a context built for one mode cannot grant a
  // direction written for another a looser set of limits.
  const policy = getCreativeModePolicy(direction.mode);

  const text = creativeText(direction);
  for (const [label, value] of text) {
    if (!value.trim()) {
      // A field the domain allows to be absent is not an empty field. The
      // difference is presence: `null` is a decision not to have a call to
      // action, whereas `""` or `"   "` is a field the author meant to fill in
      // and did not. So the optional field is judged on the value itself, not
      // on the flattened text.
      if (OPTIONAL_TEXT_FIELDS.includes(label) && isAbsent(direction, label)) {
        continue;
      }
      issues.push({
        code: "CREATIVE_FIELD_MISSING",
        message: `Creative direction field "${label}" cannot be empty`,
      });
      continue;
    }
    if (value.length > MAX_FIELD_LENGTH) {
      issues.push({
        code: "CREATIVE_FIELD_TOO_LONG",
        message: `Creative direction field "${label}" is longer than ${MAX_FIELD_LENGTH} characters`,
      });
    }
  }

  // A hook is one line. A paragraph here is a narrative summary that landed in
  // the wrong field, and it will read as one on screen.
  if (
    direction.hook.statement.trim().split(/\s+/).filter(Boolean).length > 25
  ) {
    issues.push({
      code: "CREATIVE_HOOK_TOO_LONG",
      message: "A creative hook is one line, not a paragraph",
    });
  }

  const knownAssetIds = new Set(context.assets.map((asset) => asset.id));
  const knownEvidenceIds = new Set(context.evidence.map((item) => item.id));
  const knownClaimIds = new Set(context.product.claims.map((claim) => claim.id));

  idList(
    direction.visualStrategy.assetIds ?? [],
    "visualStrategy.assetIds",
    issues,
    knownAssetIds,
    "CREATIVE_UNKNOWN_ASSET",
  );

  const claimIds = idList(
    direction.proofStrategy.claimIds,
    "proofStrategy.claimIds",
    issues,
    knownClaimIds,
    "CREATIVE_UNKNOWN_CLAIM",
  );
  const evidenceIds = idList(
    direction.proofStrategy.evidenceIds,
    "proofStrategy.evidenceIds",
    issues,
    knownEvidenceIds,
    "CREATIVE_UNKNOWN_EVIDENCE",
  );

  // Evidence has to belong to a cited claim, or it is decoration next to proof.
  const citedClaimIds = new Set(claimIds);
  for (const evidenceId of evidenceIds) {
    const evidence = context.evidence.find((item) => item.id === evidenceId);
    if (!evidence) continue;
    if (
      evidence.claimIds.length > 0 &&
      !evidence.claimIds.some((id) => citedClaimIds.has(id))
    ) {
      issues.push({
        code: "CREATIVE_EVIDENCE_MISMATCH",
        message: `Evidence ${evidenceId} is cited next to claims it does not support`,
      });
    }
  }

  // A claim the intelligence graph recorded as unverified cannot be used to
  // prove anything, in any mode.
  const unverified = context.product.claims.filter(
    (claim) =>
      citedClaimIds.has(claim.id) &&
      claim.verification !== "SUPPORTED" &&
      claim.verification !== "PARTIALLY_SUPPORTED",
  );
  for (const claim of unverified) {
    issues.push({
      code: "CREATIVE_CLAIM_UNVERIFIED",
      message: `Claim ${claim.id} is ${claim.verification} and cannot be used as proof`,
    });
  }

  const productUiAssets = context.assets.filter(isProductUiAsset);
  if (
    policy.requireProductUi &&
    productUiAssets.length === 0
  ) {
    issues.push({
      code: "CREATIVE_MODE_CONFLICT",
      message: `${context.mode} mode needs captured product UI, and this project has none`,
    });
  }
  if (
    policy.requireProductUi &&
    productUiAssets.length > 0 &&
    direction.visualStrategy.productMoments.length === 0
  ) {
    issues.push({
      code: "CREATIVE_MODE_REQUIRES_PRODUCT_UI",
      message: `${context.mode} mode requires the direction to show the real product`,
    });
  }

  if (
    !policy.allowConceptualVisuals &&
    readsAsConceptualVisual(direction.visualStrategy.approach)
  ) {
    issues.push({
      code: "CREATIVE_MODE_REQUIRES_PRODUCT_UI",
      message: `${context.mode} mode does not allow a conceptual visual in place of the product`,
    });
  }

  if (
    !policy.allowExperimentalHooks &&
    readsAsExperimentalHook(
      `${direction.hook.statement} ${direction.hook.mechanism}`,
    )
  ) {
    issues.push({
      code: "CREATIVE_MODE_CONFLICT",
      message: `${context.mode} mode does not allow an experimental opening`,
    });
  }

  if (!policy.allowedAngles.includes(direction.angle)) {
    issues.push({
      code: "CREATIVE_MODE_CONFLICT",
      message: `${context.mode} mode does not consider the ${direction.angle} angle`,
    });
  }


  issues.push(...fabricationIssues(context, citedClaimIds, text));

  if (issues.length > 0) {
    throw new CreativeValidationFailure(issues);
  }

  return direction;
}

/**
 * The fabrication scan, shared by the parser and the validator. Both need it:
 * the parser so a provider hears about an invented number at the moment it
 * happens, and the validator so a number cannot reach storage through a user
 * edit.
 */
function fabricationIssues(
  context: CreativeContext,
  citedClaimIds: ReadonlySet<string>,
  text: ReadonlyArray<readonly [string, string]>,
): CreativeValidationIssue[] {
  const issues: CreativeValidationIssue[] = [];
  // The fabrication check: a number in the copy has to be traceable.
  const supportableNumbers = new Set<string>();
  // A direction may describe the brief it was given. The duration and count come
  // from the resolved request rather than from a claim, so they are supportable
  // without a claim backing them.
  if (context.intent.durationSeconds) {
    supportableNumbers.add(String(context.intent.durationSeconds));
  }
  if (context.intent.quantity) {
    supportableNumbers.add(String(context.intent.quantity));
  }
  for (const claim of context.product.claims) {
    if (!citedClaimIds.has(claim.id)) continue;
    for (const match of claim.text.matchAll(
      /\d+(?:[.,]\d+)?\s?(?:%|x|percent|per cent|k|m|bn|b|times|gb|tb|mb)?|\$\s?\d+/gi,
    )) {
      supportableNumbers.add(match[0].toLowerCase().replace(/\s+/g, ""));
    }
  }
  for (const [label, value] of text) {
    for (const pattern of QUANTIFIED_PATTERNS) {
      const match = pattern.exec(value);
      if (!match) continue;
      if (!isQuantifiedClaimSupported(match[0], supportableNumbers)) {
        issues.push({
          code: "CREATIVE_UNSUPPORTED_QUANTIFIED_CLAIM",
          message: `"${label}" states ${match[0].trim()}, which no supported claim in this project backs`,
        });
      }
    }
  }


  return issues;
}

/**
 * The strict parser for provider output. A model that returns prose where a list
 * belongs, or a field the domain does not have, is refused rather than repaired:
 * a silently repaired direction is a direction nobody checked.
 */
export function parseCreativeDraft(
  value: unknown,
  context: CreativeContext,
): CreativeDirectionDraft {
  const issues: CreativeValidationIssue[] = [];
  const policy = getCreativeModePolicy(context.mode);
  const raw = isRecord(value) ? value : {};
  const draft = raw.draft && isRecord(raw.draft) ? raw.draft : raw;

  const hook = isRecord(draft.hook) ? draft.hook : {};
  const visual = isRecord(draft.visualStrategy) ? draft.visualStrategy : {};
  const proof = isRecord(draft.proofStrategy) ? draft.proofStrategy : {};

  const angle = draft.angle;
  if (!isCreativeAngle(angle)) {
    issues.push({
      code: "CREATIVE_UNKNOWN_ANGLE",
      message: `angle must be one of ${CREATIVE_ANGLES.join(", ")}`,
    });
  } else if (!policy.allowedAngles.includes(angle)) {
    issues.push({
      code: "CREATIVE_MODE_CONFLICT",
      message: `${context.mode} mode does not consider the ${angle} angle`,
    });
  }

  const assetIds = idList(
    visual.assetIds,
    "visualStrategy.assetIds",
    issues,
    new Set(context.assets.map((asset) => asset.id)),
    "CREATIVE_UNKNOWN_ASSET",
  );
  const unknownFields = Object.keys(draft).filter(
    (key) =>
      ![
        "name",
        "angle",
        "thesis",
        "hook",
        "audienceAngle",
        "emotionalAngle",
        "narrativeSummary",
        "visualStrategy",
        "proofStrategy",
        "voiceDirection",
        "musicDirection",
        "soundDirection",
        "cta",
        "rationale",
      ].includes(key),
  );
  if (unknownFields.length > 0) {
    issues.push({
      code: "CREATIVE_INVALID_OUTPUT",
      message: `Provider returned fields that are not part of a direction: ${unknownFields.join(", ")}`,
    });
  }

  const parsed = {
    name: textField(draft.name, "name", issues),
    angle: isCreativeAngle(angle) ? angle : "CUSTOM",
    thesis: textField(draft.thesis, "thesis", issues),
    hook: {
      statement: textField(hook.statement, "hook.statement", issues, {
        max: MAX_SENTENCE_LENGTH,
      }),
      mechanism: textField(hook.mechanism, "hook.mechanism", issues, {
        max: MAX_SENTENCE_LENGTH,
      }),
      emotionalTrigger: textField(
        hook.emotionalTrigger,
        "hook.emotionalTrigger",
        issues,
        { max: MAX_SENTENCE_LENGTH },
      ),
    },
    audienceAngle: textField(draft.audienceAngle, "audienceAngle", issues),
    emotionalAngle: textField(draft.emotionalAngle, "emotionalAngle", issues),
    narrativeSummary: textField(
      draft.narrativeSummary,
      "narrativeSummary",
      issues,
    ),
    visualStrategy: {
      approach: textField(visual.approach, "visualStrategy.approach", issues),
      rationale: textField(
        visual.rationale,
        "visualStrategy.rationale",
        issues,
      ),
      productMoments: stringList(
        visual.productMoments,
        "visualStrategy.productMoments",
        issues,
        { minItems: 1 },
      ),
      assetIds,
    },
    proofStrategy: {
      claimIds: idList(
        proof.claimIds,
        "proofStrategy.claimIds",
        issues,
        new Set(context.product.claims.map((claim) => claim.id)),
        "CREATIVE_UNKNOWN_CLAIM",
      ),
      evidenceIds: idList(
        proof.evidenceIds,
        "proofStrategy.evidenceIds",
        issues,
        new Set(context.evidence.map((item) => item.id)),
        "CREATIVE_UNKNOWN_EVIDENCE",
      ),
      proofPoints: stringList(
        proof.proofPoints,
        "proofStrategy.proofPoints",
        issues,
        { minItems: 1 },
      ),
    },
    voiceDirection: textField(draft.voiceDirection, "voiceDirection", issues),
    musicDirection: textField(draft.musicDirection, "musicDirection", issues),
    soundDirection: textField(draft.soundDirection, "soundDirection", issues),
    cta:
      draft.cta === null || draft.cta === undefined || draft.cta === ""
        ? null
        : textField(draft.cta, "cta", issues, { max: MAX_SENTENCE_LENGTH }),
    rationale: textField(draft.rationale, "rationale", issues),
  };

  // The provider hears about a fabricated number here rather than at the
  // service, where the only remedy left would be to discard the whole run.
  issues.push(
    ...fabricationIssues(
      context,
      new Set(parsed.proofStrategy.claimIds),
      creativeText(parsed as CreativeDirection),
    ),
  );

  if (issues.length > 0) {
    throw new CreativeValidationFailure(issues);
  }

  return parsed;
}

export function creativeAssetsById(
  context: CreativeContext,
): Map<string, CreativeContextAsset> {
  return new Map(context.assets.map((asset) => [asset.id, asset]));
}
