/**
 * Assembles the storyboard context from a direction and the project's own
 * records.
 *
 * The creative context is already the answer to "what does this project
 * actually contain", so this derives from it rather than reading the graph a
 * second time. Two things get added on top:
 *
 *  - The chosen direction, flattened. A storyboard is written against one
 *    argument, and a planner that could see several would be free to drift.
 *  - Browser sessions. A shot that can be checked against a session this project
 *    already ran is a shot somebody can capture; one that cannot is a wish.
 *
 * As with the creative context, everything is derived on the server. That closed
 * set is what makes the validator's reference rejections mean something: a
 * feature id the planner invented was never available to it in the first place.
 */

import type { ContentIntent } from "../domain/content-intent";
import type { CreativeContext } from "../domain/creative-context";
import type { CreativeDirection } from "../domain/creative-direction";
import { getContentType } from "../domain/content-type";
import type { BrowserSession } from "../domain/browser";
import { browserTraceId } from "../domain/storyboard-context";
import type {
  StoryboardContext,
  StoryboardContextBrowserCapture,
  StoryboardContextWorkflow,
} from "../domain/storyboard-context";

/** How many sessions a plan may draw on. A piece demonstrates a few flows. */
const MAX_CAPTURE_SESSIONS = 5;
/** Enough steps to describe a flow without embedding a whole trace in every plan. */
const MAX_TRACE_IDS_PER_SESSION = 12;

/**
 * The target duration the request fixed, in milliseconds, or null when it fixed
 * none.
 *
 * There is no default here on purpose. Whether a piece with no stated length gets
 * a sensible one, or whether it cannot have a timeline at all, is a decision
 * about the content type that belongs to the service — a context that quietly
 * invented 30 seconds would make that decision invisible.
 */
export function requestedDurationMsFor(intent: ContentIntent): number | null {
  const seconds = intent.durationSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }
  return null;
}

function toWorkflows(context: CreativeContext): StoryboardContextWorkflow[] {
  return context.product.workflows.map((workflow) => {
    const featureIds = workflow.steps
      .map((step) =>
        context.product.features.find((feature) =>
          step.toLowerCase().includes(feature.name.toLowerCase()),
        )?.id,
      )
      .filter((id): id is string => id !== undefined);

    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.name,
      steps: workflow.steps.map((action, index) => ({
        id: `${workflow.id}_step_${index}`,
        order: index,
        action,
        description: action,
        featureIds,
      })),
      featureIds,
      // A workflow inherits the evidence of the features it exercises: that is
      // what makes it demonstrable rather than asserted.
      evidenceIds: context.product.features
        .filter((feature) => featureIds.includes(feature.id))
        .flatMap((feature) =>
          context.evidence
            .filter((item) => item.claimIds.length > 0)
            .map((item) => item.id),
        )
        .filter((id, index, all) => all.indexOf(id) === index),
    };
  });
}

/**
 * Sessions worth capturing against. Only completed ones: an open or failed
 * session is a trace of something that went wrong, and building a shot on it
 * would plan to reproduce the failure.
 */
function toCaptures(
  sessions: readonly BrowserSession[],
): StoryboardContextBrowserCapture[] {
  return sessions
    .filter((session) => session.status === "COMPLETED")
    .slice(0, MAX_CAPTURE_SESSIONS)
    .map((session) => ({
      id: session.id,
      url: session.currentUrl || session.initialUrl,
      goal: session.goal ?? "",
      status: session.status,
      traceIds: Array.from({ length: session.actionCount }, (_, index) =>
        browserTraceId(session.id, index),
      ).slice(0, MAX_TRACE_IDS_PER_SESSION),
    }));
}

export interface StoryboardContextInput {
  context: CreativeContext;
  intent: ContentIntent;
  direction: CreativeDirection;
  targetDurationMs: number;
  sessions?: readonly BrowserSession[];
}

export function buildStoryboardContext(
  input: StoryboardContextInput,
): StoryboardContext {
  const { context, intent, direction, targetDurationMs } = input;
  const contentType = getContentType(intent.contentTypeId);

  return {
    projectId: context.projectId,
    intentId: context.intentId,
    directionId: direction.id,
    mode: direction.mode,
    policy: context.policy,
    requirements: {
      targetDurationMs,
      aspectRatio: context.intent.aspectRatio,
      platforms: [...context.intent.platforms],
      language: context.intent.language,
      tone: context.intent.tone,
      style: context.intent.style,
      channel: context.intent.channel,
      contentTypeName: contentType?.name ?? context.intent.contentTypeName,
      rawRequest: intent.rawRequest,
      audience: context.intent.audience,
      cta: direction.cta ?? context.intent.cta,
    },
    direction: {
      id: direction.id,
      name: direction.name,
      angle: direction.angle,
      mode: direction.mode,
      creativeRunId: direction.creativeRunId,
      thesis: direction.thesis,
      hook: direction.hook,
      audienceAngle: direction.audienceAngle,
      emotionalAngle: direction.emotionalAngle,
      narrativeSummary: direction.narrativeSummary,
      visualStrategy: direction.visualStrategy,
      proofStrategy: direction.proofStrategy,
      voiceDirection: direction.voiceDirection,
      musicDirection: direction.musicDirection,
      soundDirection: direction.soundDirection,
      cta: direction.cta,
      rationale: direction.rationale,
    },
    product: {
      name: context.product.name,
      description: context.product.description,
      valueProposition: context.product.valueProposition,
      audienceSummary: context.product.audienceSummary,
      features: context.product.features.map((feature) => ({
        id: feature.id,
        name: feature.name,
        description: feature.description,
        // A feature is provable through the claims that mention it; the mapping
        // is by name because the graph holds no feature-to-claim edge.
        evidenceIds: context.evidence
          .filter((item) =>
            item.claimIds.some((claimId) => {
              const claim = context.product.claims.find(
                (entry) => entry.id === claimId,
              );
              return claim
                ? claim.text.toLowerCase().includes(feature.name.toLowerCase())
                : false;
            }),
          )
          .map((item) => item.id),
      })),
      workflows: toWorkflows(context),
      problems: context.product.problems,
      benefits: context.product.benefits,
      claims: context.product.claims,
    },
    brand: {
      name: context.brand.name,
      positioning: context.product.valueProposition,
      tagline: "",
      voiceSummary: context.brand.executionSummary,
      tone: [...context.brand.tone],
      visualStyle: context.brand.style.join(", "),
      colors: [],
      fonts: [],
      preferredTerms: [],
      avoidTerms: [],
      version: context.brandVersion,
    },
    assets: context.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      role: asset.role,
      isProductUi: asset.isProductUi,
      width: null,
      height: null,
      durationMs: null,
      origin: asset.origin,
    })),
    evidence: context.evidence.map((item) => ({
      id: item.id,
      kind: item.kind,
      locator: item.locator,
      snippet: item.snippet,
      claimIds: item.claimIds,
    })),
    browserCaptures: toCaptures(input.sessions ?? []),
    brandVersion: context.brandVersion,
    intelligenceVersion: context.intelligenceVersion,
  };
}
