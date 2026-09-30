/**
 * A creative style is a reusable way of framing a piece of content. Each one
 * carries the narrative moves that make that framing work, expressed as
 * functions over grounded facts, so a style can only produce a direction from
 * material the project actually has.
 *
 * The ten styles here are the deterministic director's repertoire. `DEMO` and
 * `CUSTOM` are valid angles an AI director may choose, but nothing deterministic
 * produces them: a demo angle with no recorded walkthrough and a custom angle
 * with no brief to follow are both inventions.
 */

import type {
  CreativeAngle,
  CreativeDirectionDraft,
} from "./creative-direction";

export const CREATIVE_STYLE_IDS = [
  "PROBLEM_SOLUTION",
  "PRODUCT_FIRST",
  "WORKFLOW",
  "TRANSFORMATION",
  "FOUNDER",
  "TECHNICAL",
  "SOCIAL",
  "EMOTIONAL",
  "EDUCATIONAL",
  "BEFORE_AFTER",
] as const;
export type CreativeStyleId = (typeof CREATIVE_STYLE_IDS)[number];

/** Everything a style is allowed to build from, all of it grounded. */
export interface CreativeStyleFacts {
  productName: string;
  valueProposition: string;
  problemStatement: string;
  problemDetail: string;
  featureStatement: string;
  featureDetail: string;
  benefitStatement: string;
  workflowStatement: string;
  audienceSummary: string;
  brandVoiceSummary: string;
  cta: string | null;
  /** Claims the project can actually stand behind, with their evidence. */
  supportedClaimIds: string[];
  supportedEvidenceIds: string[];
  supportedClaimTexts: string[];
  /** The project's real product-UI captures, when it has any. */
  productUiAssets: Array<{ id: string; name: string }>;
  /** Names of any project assets at all, used as proof of existence. */
  supportingAssetNames: string[];
  /** True when the project has evidence, so "we tested it" can be honest. */
  hasEvidence: boolean;
}

export interface CreativeStyleBuild {
  name: string;
  angle: CreativeAngle;
  thesis: string;
  hookStatement: string;
  hookMechanism: string;
  hookEmotionalTrigger: string;
  audienceAngle: string;
  emotionalAngle: string;
  narrativeSummary: string;
  visualApproach: string;
  visualRationale: string;
  productMoments: string[];
  assetIds: string[];
  proofPoints: string[];
  voiceDirection: string;
  musicDirection: string;
  soundDirection: string;
  rationale: string;
}

export interface CreativeStyle {
  id: CreativeStyleId;
  label: string;
  description: string;
  angles: CreativeAngle[];
  bestFor: string;
  avoidWhen: string;
  /** Given to an AI director as the one idea it is being asked to explore. */
  promptFragment: string;
  build(facts: CreativeStyleFacts): CreativeStyleBuild;
}

/**
 * A style that leans on the product being on screen needs somewhere to point.
 * With no captured UI there is nothing to promise, so the moment falls back to
 * a description of what to capture rather than a claim that it exists.
 */
function productMomentsFrom(
  facts: CreativeStyleFacts,
  moment: string,
  fallback: string,
): { productMoments: string[]; assetIds: string[] } {
  if (facts.productUiAssets.length === 0) {
    return { productMoments: [fallback], assetIds: [] };
  }
  const used = facts.productUiAssets.slice(0, 2);
  return {
    productMoments: [
      `Capture the real interface: ${moment}`,
      ...used.map((asset) => `Use the captured "${asset.name}" screen`),
    ],
    assetIds: used.map((asset) => asset.id),
  };
}

const PROBLEM_SOLUTION: CreativeStyle = {
  id: "PROBLEM_SOLUTION",
  label: "Problem → Solution",
  description:
    "Name the problem in the audience's own words, then show the product as the way out of it.",
  angles: ["PROBLEM_SOLUTION"],
  bestFor: "Audiences who feel the pain but do not know a fix exists.",
  avoidWhen:
    "The problem is uncontested or the audience already knows the product solves it.",
  promptFragment:
    "Open on the problem as the audience experiences it, then turn to the product as the way out. Do not soften the problem or oversell the fix.",
  build(facts) {
    return {
      name: `${facts.productName}: the problem, then the way out`,
      angle: "PROBLEM_SOLUTION",
      thesis: `${facts.problemStatement} - and ${facts.valueProposition} is how it gets solved.`,
      hookStatement: `${facts.problemStatement}`,
      hookMechanism: "Open on a concrete, recognisable moment from the problem",
      hookEmotionalTrigger: "The discomfort of recognising your own situation",
      audienceAngle: `For ${facts.audienceSummary} who deal with ${facts.problemStatement.toLowerCase()}`,
      emotionalAngle: "Relief, earned by being understood before being sold to",
      narrativeSummary: `The piece stays on ${facts.problemStatement} long enough for the audience to feel it, then brings in ${facts.featureStatement} as the concrete way out, closing on the proof that it works.`,
      visualApproach: `Sit with the problem in its real texture, then cut to ${facts.featureStatement} being used rather than described.`,
      visualRationale: `A problem shown as a lived moment is what makes the turn to ${facts.productName} feel earned rather than advertised.`,
      ...productMomentsFrom(
        facts,
        `the interface doing ${facts.featureStatement.toLowerCase()}`,
        `Show ${facts.featureStatement} doing the work the problem made tedious`,
      ),
      proofPoints: proofPointsFor(facts, `${facts.benefitStatement} because ${facts.featureStatement}`),
      voiceDirection: facts.brandVoiceSummary || "Plain, specific, and unhurried",
      musicDirection: "Low, sustained, with the turn marked by a single change",
      soundDirection: "Real interface sound where it is honest, quiet otherwise",
      rationale: `The project's own intelligence names ${facts.problemStatement} as a problem, and ${facts.featureStatement} as the feature that answers it.`,
    };
  },
};

const PRODUCT_FIRST: CreativeStyle = {
  id: "PRODUCT_FIRST",
  label: "Product First",
  description:
    "Lead with what the product is and what it does, and let the value arrive through use.",
  angles: ["PRODUCT_FIRST"],
  bestFor: "Audiences evaluating the product on capability.",
  avoidWhen: "The product is unfamiliar and needs a category explained first.",
  promptFragment:
    "Show the product in the first beat and make every claim about it visible. Depth over hype: the audience is checking, not being sold to.",
  build(facts) {
    return {
      name: `${facts.productName}, doing its thing`,
      angle: "PRODUCT_FIRST",
      thesis: `${facts.valueProposition}`,
      hookStatement: `${facts.featureStatement} - on screen before it is explained.`,
      hookMechanism: "Open on the product already in use",
      hookEmotionalTrigger: "Immediate clarity about what this is",
      audienceAngle: `For ${facts.audienceSummary} who need to see it work before they believe it`,
      emotionalAngle: "Confidence built from direct observation",
      narrativeSummary: `The product is on screen from the start. ${facts.featureStatement} carries the middle, and the piece ends on the evidence that it does what it claims.`,
      visualApproach: `Interface-first, ${facts.featureStatement.toLowerCase()} shown in full, with the surrounding work kept out of frame.`,
      visualRationale: `An audience evaluating a product trusts what it can watch, so the product gets the screen and the adjectives get cut.`,
      ...productMomentsFrom(
        facts,
        `the interface doing ${facts.featureStatement.toLowerCase()}`,
        `Show ${facts.featureStatement} in the interface, unscripted`,
      ),
      proofPoints: proofPointsFor(facts, `${facts.featureStatement}, demonstrated rather than described`),
      voiceDirection: facts.brandVoiceSummary || "Direct, technical, and free of adjectives",
      musicDirection: "Minimal, rhythmic to the interface, never competing with it",
      soundDirection: "Interface audio as the primary sound, no music bed under speech",
      rationale: `The project has ${facts.featureStatement} recorded as a real capability, which is the strongest thing this direction can lead with.`,
    };
  },
};

const WORKFLOW: CreativeStyle = {
  id: "WORKFLOW",
  label: "Workflow",
  description:
    "Walk the one workflow that changed, step by step, in the order it happens.",
  angles: ["WORKFLOW"],
  bestFor: "Audiences with an existing process they are trying to improve.",
  avoidWhen: "The product does not displace a workflow the audience already runs.",
  promptFragment:
    "Follow one real workflow in order. Show the before and after of the steps, not the features in isolation.",
  build(facts) {
    return {
      name: `Inside the ${facts.workflowStatement || "new"} workflow`,
      angle: "WORKFLOW",
      thesis: `${facts.workflowStatement || facts.valueProposition}, one step at a time.`,
      hookStatement: `The whole workflow, end to end, in the order it actually happens.`,
      hookMechanism: "Open on the first step of the process, mid-flow",
      hookEmotionalTrigger: "Familiarity with a process you already run",
      audienceAngle: `For ${facts.audienceSummary} who run this process today`,
      emotionalAngle: "The relief of a process that got shorter",
      narrativeSummary: `${facts.workflowStatement || facts.featureStatement} is followed step by step. Each step shows what it cost before and what it costs now, and the piece ends where the workflow ends.`,
      visualApproach: `Sequential and in-order, ${facts.featureStatement.toLowerCase()} as the turning point rather than the whole story.`,
      visualRationale: `A process change is only credible in sequence; out-of-order shots would hide the very improvement being claimed.`,
      ...productMomentsFrom(
        facts,
        `each step of ${facts.workflowStatement || "the workflow"}`,
        `Show ${facts.featureStatement} replacing the manual step it displaces`,
      ),
      proofPoints: proofPointsFor(facts, `${facts.workflowStatement || facts.featureStatement}, step by step`),
      voiceDirection: facts.brandVoiceSummary || "Procedural, calm, and specific about each step",
      musicDirection: "A steady pulse that marks the step boundaries",
      soundDirection: "Real interaction sound at each transition",
      rationale: `The intelligence graph records ${facts.workflowStatement || facts.featureStatement} as an actual workflow, so the steps can be shown rather than described.`,
    };
  },
};

const TRANSFORMATION: CreativeStyle = {
  id: "TRANSFORMATION",
  label: "Transformation",
  description:
    "Contrast the before and after states so the size of the change is felt, not claimed.",
  angles: ["BEFORE_AFTER", "TRANSFORMATION"],
  bestFor: "Audiences who doubt change is worth the effort.",
  avoidWhen:
    "No before state can be shown honestly, which would make the contrast fiction.",
  promptFragment:
    "Make the before and after states concrete and comparable. Same frame, same subject, different outcome.",
  build(facts) {
    return {
      name: `What changes with ${facts.productName}`,
      angle: "TRANSFORMATION",
      thesis: `${facts.problemStatement} becomes ${facts.benefitStatement}.`,
      hookStatement: `The same work, before and after ${facts.productName}.`,
      hookMechanism: "Direct visual contrast between two states",
      hookEmotionalTrigger: "The gap between how it was and how it could be",
      audienceAngle: `For ${facts.audienceSummary} weighing whether the change is worth it`,
      emotionalAngle: "Anticipation, resolved into recognition",
      narrativeSummary: `The before state is shown honestly, without mockery. ${facts.featureStatement} changes it, and the after state is given the same weight so the difference is visible rather than asserted.`,
      visualApproach: `Matched framing on both sides of the change, with ${facts.featureStatement} as the only difference.`,
      visualRationale: `Two comparable frames prove a change; two different framings only assert one.`,
      ...productMomentsFrom(
        facts,
        `the after state of ${facts.featureStatement.toLowerCase()}`,
        `Show the result of ${facts.featureStatement} beside the way it was done`,
      ),
      proofPoints: proofPointsFor(facts, `${facts.problemStatement} becoming ${facts.benefitStatement}`),
      voiceDirection: facts.brandVoiceSummary || "Measured, with both sides given their due",
      musicDirection: "Two treatments, one for each state, resolving between them",
      soundDirection: "The tactile sounds of before and after, kept comparable",
      rationale: `The project records ${facts.problemStatement} and ${facts.benefitStatement} as paired facts, so the contrast can be shown honestly.`,
    };
  },
};

const FOUNDER: CreativeStyle = {
  id: "FOUNDER",
  label: "Founder",
  description:
    "A person and the reason behind the product, for audiences who buy from conviction.",
  angles: ["FOUNDER"],
  bestFor: "Audiences who trust a person more than a feature list.",
  avoidWhen:
    "There is no founder story to tell, which would make this pure invention.",
  promptFragment:
    "Ground the piece in one real person and one real reason. Do not manufacture a founder narrative that the project does not support.",
  build(facts) {
    return {
      name: `Why ${facts.productName} exists`,
      angle: "FOUNDER",
      thesis: `${facts.valueProposition} - and it exists because ${facts.problemStatement} was worth solving.`,
      hookStatement: `The reason ${facts.productName} was built, told by whoever built it.`,
      hookMechanism: "A person and a stated reason, without a product pitch",
      hookEmotionalTrigger: "Candour",
      audienceAngle: `For ${facts.audienceSummary} who want to know who is behind this`,
      emotionalAngle: "Trust, from a stated motive rather than a promised outcome",
      narrativeSummary: `One person explains why ${facts.problemStatement} was worth their time. ${facts.featureStatement} is shown as the result of that reason, and the piece closes on what the product does now.`,
      visualApproach: `A person and a working environment, with ${facts.featureStatement} visible in the background rather than presented.`,
      visualRationale: `A founder direction loses its credibility the moment it turns into a pitch, so the product stays in the background.`,
      ...productMomentsFrom(
        facts,
        `${facts.featureStatement} as the maker would show it`,
        `Show ${facts.featureStatement} in use, unpolished`,
      ),
      proofPoints: proofPointsFor(facts, `the reason behind ${facts.valueProposition}`),
      voiceDirection: facts.brandVoiceSummary || "First person, unpolished, specific",
      musicDirection: "Sparse, or none",
      soundDirection: "Room tone and real speech, no production gloss",
      rationale: `The intelligence graph ties ${facts.problemStatement} to the product's purpose, which is the honest core of a founder story.`,
    };
  },
};

const TECHNICAL: CreativeStyle = {
  id: "TECHNICAL",
  label: "Technical",
  description:
    "Explain the mechanism underneath, for audiences who want to know how it actually works.",
  angles: ["TECHNICAL", "EDUCATIONAL"],
  bestFor: "Technical buyers who reject outcomes without mechanisms.",
  avoidWhen: "The mechanism is not something the project can disclose.",
  promptFragment:
    "Explain how it works, with the mechanism rather than the benefit as the subject. Accuracy beats persuasion here.",
  build(facts) {
    return {
      name: `How ${facts.productName} works`,
      angle: "TECHNICAL",
      thesis: `${facts.featureStatement} works because of how ${facts.productName} is built.`,
      hookStatement: `How ${facts.featureStatement} actually works, underneath.`,
      hookMechanism: "Open on the mechanism, not the result",
      hookEmotionalTrigger: "The pleasure of understanding a system",
      audienceAngle: `For ${facts.audienceSummary} who need the mechanism to be real`,
      emotionalAngle: "Intellectual satisfaction",
      narrativeSummary: `The piece explains the mechanism behind ${facts.featureStatement}, names its limits honestly, and shows where ${facts.benefitStatement} comes from as a consequence.`,
      visualApproach: `Diagrammatic and close, with ${facts.featureStatement} explained in the interface where it can be seen.`,
      visualRationale: `A technical audience trusts a mechanism shown in context far more than one described over a diagram.`,
      ...productMomentsFrom(
        facts,
        `the interface behaviour behind ${facts.featureStatement.toLowerCase()}`,
        `Show the interface behaving in the way the mechanism describes`,
      ),
      proofPoints: proofPointsFor(facts, `${facts.featureStatement}, explained at the level it works`),
      voiceDirection: facts.brandVoiceSummary || "Precise, unhurried, and willing to state limits",
      musicDirection: "Almost none",
      soundDirection: "Precise, small sounds that mark each step of the explanation",
      rationale: `The project records ${facts.featureStatement} with enough specificity to explain rather than merely assert.`,
    };
  },
};

const SOCIAL: CreativeStyle = {
  id: "SOCIAL",
  label: "Social",
  description:
    "Built to be shared: one clear idea, no preamble, and a reason to pass it on.",
  angles: ["SOCIAL"],
  bestFor: "Feeds where the piece competes for a second of attention.",
  avoidWhen:
    "The platform rewards depth over reach, where a hook-only approach underdelivers.",
  promptFragment:
    "One idea per piece, front-loaded, no preamble. Make it worth passing on rather than merely watchable.",
  build(facts) {
    return {
      name: `One idea: ${facts.benefitStatement}`,
      angle: "SOCIAL",
      thesis: `${facts.benefitStatement}.`,
      hookStatement: `${facts.benefitStatement}.`,
      hookMechanism: "The claim is the first and only thing said",
      hookEmotionalTrigger: "Immediate utility",
      audienceAngle: `For ${facts.audienceSummary} scrolling past everything else`,
      emotionalAngle: "Recognition, fast enough to feel like a find",
      narrativeSummary: `A single idea - ${facts.benefitStatement} - stated in the first beat, supported by ${facts.featureStatement} once, and repeated rather than elaborated.`,
      visualApproach: `Tight, legible at a glance, ${facts.featureStatement.toLowerCase()} visible in a single frame.`,
      visualRationale: `A shared piece is judged in the first second, so everything that is not the idea gets cut.`,
      ...productMomentsFrom(
        facts,
        `one frame showing ${facts.featureStatement.toLowerCase()}`,
        `Show ${facts.featureStatement} in one legible frame`,
      ),
      proofPoints: proofPointsFor(facts, `${facts.benefitStatement}, stated once and shown once`),
      voiceDirection: facts.brandVoiceSummary || "Short, declarative, and free of filler",
      musicDirection: "One strong, short hook and nothing after it",
      soundDirection: "One clean sound at the cut, then speech",
      rationale: `The project records ${facts.benefitStatement} as a supported benefit, so the single idea is one the project can stand behind in public.`,
    };
  },
};

const EMOTIONAL: CreativeStyle = {
  id: "EMOTIONAL",
  label: "Emotional",
  description:
    "Lead with how the work feels to the person living it, with the product as the quiet answer.",
  angles: ["EMOTIONAL"],
  bestFor: "Audiences who have stopped caring about feature comparisons.",
  avoidWhen:
    "The category is a numbers conversation, where feeling would be read as evasion.",
  promptFragment:
    "Begin from the lived feeling, not the feature. The product arrives late, as relief rather than as a solution.",
  build(facts) {
    return {
      name: `What ${facts.problemStatement} feels like`,
      angle: "EMOTIONAL",
      thesis: `The relief of ${facts.benefitStatement}, after ${facts.problemStatement}.`,
      hookStatement: `What it is like to live with ${facts.problemStatement}.`,
      hookMechanism: "Begin with the feeling, hold it, and let the product arrive late",
      hookEmotionalTrigger: "Being understood",
      audienceAngle: `For ${facts.audienceSummary} who has stopped looking for features`,
      emotionalAngle: "Exhaustion, then relief",
      narrativeSummary: `The piece spends its first half inside ${facts.problemStatement} as it is actually experienced. ${facts.productName} enters late and quietly, and ${facts.benefitStatement} is the last thing shown rather than the first thing claimed.`,
      visualApproach: `Close, unhurried, and human, with ${facts.featureStatement.toLowerCase()} arriving as a small quiet moment.`,
      visualRationale: `An emotional direction fails if the product arrives as a pitch, so the reveal stays understated.`,
      ...productMomentsFrom(
        facts,
        `a quiet moment with ${facts.featureStatement.toLowerCase()}`,
        `Show ${facts.featureStatement} without commentary`,
      ),
      proofPoints: proofPointsFor(facts, `${facts.benefitStatement}, felt rather than claimed`),
      voiceDirection: facts.brandVoiceSummary || "Warm, plain, and unhurried",
      musicDirection: "Generous space, one sustained theme",
      soundDirection: "Close-mic speech with room around it",
      rationale: `The project's intelligence describes ${facts.problemStatement} in the audience's terms, which is what an emotional direction needs to be honest.`,
    };
  },
};

const EDUCATIONAL: CreativeStyle = {
  id: "EDUCATIONAL",
  label: "Educational",
  description:
    "Teach something the audience can use, with the product as the tool they end up holding.",
  angles: ["EDUCATIONAL", "TECHNICAL"],
  bestFor: "Audiences who need to be convinced they have a problem worth solving.",
  avoidWhen:
    "The audience is already expert and would find the teaching patronising.",
  promptFragment:
    "Teach one thing properly. The product is the tool you happen to end up holding, not the subject of the lesson.",
  build(facts) {
    return {
      name: `How to think about ${facts.problemStatement}`,
      angle: "EDUCATIONAL",
      thesis: `${facts.problemStatement} is a solvable problem, and this is how it is solved.`,
      hookStatement: `Why ${facts.problemStatement} keeps happening.`,
      hookMechanism: "Open on a question the audience has actually had",
      hookEmotionalTrigger: "Recognition of a pattern",
      audienceAngle: `For ${facts.audienceSummary} who suspect there is a better way`,
      emotionalAngle: "The relief of a problem being named precisely",
      narrativeSummary: `The piece explains why ${facts.problemStatement} persists, using the audience's own experience as the evidence. ${facts.featureStatement} arrives as the practical answer, and the piece closes on the outcome.`,
      visualApproach: `Instructional and legible, with ${facts.featureStatement.toLowerCase()} demonstrated as the worked example.`,
      visualRationale: `A teaching piece is only fair if the audience could follow it themselves, so complexity stays off screen.`,
      ...productMomentsFrom(
        facts,
        `${facts.featureStatement} as a worked example`,
        `Work ${facts.featureStatement} through step by step on screen`,
      ),
      proofPoints: proofPointsFor(facts, `the explanation of ${facts.problemStatement}`),
      voiceDirection: facts.brandVoiceSummary || "Explanatory, patient, and precise about terms",
      musicDirection: "Unobtrusive, consistent, never editorial",
      soundDirection: "Clear narration with room for thought",
      rationale: `The project records ${facts.problemStatement} and ${facts.featureStatement} with enough detail to teach rather than assert.`,
    };
  },
};

const BEFORE_AFTER: CreativeStyle = {
  id: "BEFORE_AFTER",
  label: "Before → After",
  description:
    "A literal side-by-side of the way of working before and the way of working now.",
  angles: ["BEFORE_AFTER"],
  bestFor: "Audiences convinced by visible change rather than by description.",
  avoidWhen: "The before state cannot be shown, or would require a competitor to be mocked.",
  promptFragment:
    "Show the two states side by side, comparably framed. The difference must be the only thing that changes.",
  build(facts) {
    return {
      name: `Before and after: ${facts.productName}`,
      angle: "BEFORE_AFTER",
      thesis: `The same job, before and after ${facts.productName}.`,
      hookStatement: `The same work, two ways.`,
      hookMechanism: "Split or sequential comparison of the two states",
      hookEmotionalTrigger: "Instant comprehension of the difference",
      audienceAngle: `For ${facts.audienceSummary} who want the difference in one glance`,
      emotionalAngle: "Obviousness - the change needs no argument",
      narrativeSummary: `Both states are shown with the same subject and the same framing. ${facts.featureStatement} is the only difference, and the piece lets the comparison close itself.`,
      visualApproach: `Matched pairs throughout, with ${facts.featureStatement.toLowerCase()} as the single variable.`,
      visualRationale: `Comparability is the whole argument; a matched pair makes the change self-evident without a claim.`,
      ...productMomentsFrom(
        facts,
        `the after half of ${facts.featureStatement.toLowerCase()}`,
        `Show the after state of ${facts.featureStatement} against the way it was done`,
      ),
      proofPoints: proofPointsFor(facts, `the visible difference ${facts.featureStatement} makes`),
      voiceDirection: facts.brandVoiceSummary || "Plain, comparative, and low in volume",
      musicDirection: "A matched rhythm across both halves",
      soundDirection: "The same sounds in both states, changed only where the work changed",
      rationale: `The project records ${facts.featureStatement} as a real change to how work gets done, so a literal comparison is available.`,
    };
  },
};

/** The proof points a style may make, drawn only from what the project can back. */
function proofPointsFor(
  facts: CreativeStyleFacts,
  lead: string,
): string[] {
  const points = [lead];
  if (facts.hasEvidence && facts.supportedClaimTexts.length > 0) {
    points.push(
      `Show the evidence behind "${facts.supportedClaimTexts[0]}" rather than repeating it.`,
    );
  }
  if (facts.productUiAssets.length > 0) {
    points.push(
      `Use the captured "${facts.productUiAssets[0].name}" screen as the visual proof.`,
    );
  }
  if (facts.supportedClaimTexts.length > 1) {
    points.push(
      `Give "${facts.supportedClaimTexts[1]}" its own moment instead of listing it.`,
    );
  }
  return points;
}

export const CREATIVE_STYLES: Readonly<Record<CreativeStyleId, CreativeStyle>> = {
  PROBLEM_SOLUTION,
  PRODUCT_FIRST,
  WORKFLOW,
  TRANSFORMATION,
  FOUNDER,
  TECHNICAL,
  SOCIAL,
  EMOTIONAL,
  EDUCATIONAL,
  BEFORE_AFTER,
};

export const CREATIVE_STYLE_LIST: readonly CreativeStyle[] =
  CREATIVE_STYLE_IDS.map((id) => CREATIVE_STYLES[id]);

/** Turns a style's build into a full draft, filling in the provenance the style must not own. */
/**
 * Close up the seam where a template's own punctuation meets an inserted fact.
 * A fact is a phrase, so a template that ends the sentence around it can leave
 * "teams.." or "showing, ," behind. This is mechanical tidying of the join, not
 * rewriting anyone's words.
 */
function tidy(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*([.!?])/g, "$2")
    .replace(/\.{2,}/g, ".")
    .replace(/,\.(?= |$)/, ".")
    .replace(/^\s+|\s+$/g, "");
}

/** Tidy every string a build produced, in place. */
function tidyBuild(build: CreativeStyleBuild): CreativeStyleBuild {
  return {
    ...build,
    name: tidy(build.name),
    thesis: tidy(build.thesis),
    hookStatement: tidy(build.hookStatement),
    hookMechanism: tidy(build.hookMechanism),
    hookEmotionalTrigger: tidy(build.hookEmotionalTrigger),
    audienceAngle: tidy(build.audienceAngle),
    emotionalAngle: tidy(build.emotionalAngle),
    narrativeSummary: tidy(build.narrativeSummary),
    visualApproach: tidy(build.visualApproach),
    visualRationale: tidy(build.visualRationale),
    productMoments: build.productMoments.map(tidy),
    proofPoints: build.proofPoints.map(tidy),
    voiceDirection: tidy(build.voiceDirection),
    musicDirection: tidy(build.musicDirection),
    soundDirection: tidy(build.soundDirection),
    rationale: tidy(build.rationale),
  };
}

export function draftFromStyle(
  style: CreativeStyle,
  facts: CreativeStyleFacts,
  extra: {
    claimIds: string[];
    evidenceIds: string[];
    cta: string | null;
  },
): CreativeDirectionDraft {
  const build = tidyBuild(style.build(facts));

  return {
    name: build.name,
    angle: build.angle,
    thesis: build.thesis,
    hook: {
      statement: build.hookStatement,
      mechanism: build.hookMechanism,
      emotionalTrigger: build.hookEmotionalTrigger,
    },
    audienceAngle: build.audienceAngle,
    emotionalAngle: build.emotionalAngle,
    narrativeSummary: build.narrativeSummary,
    visualStrategy: {
      approach: build.visualApproach,
      rationale: build.visualRationale,
      productMoments: build.productMoments,
      assetIds: build.assetIds,
    },
    proofStrategy: {
      claimIds: extra.claimIds,
      evidenceIds: extra.evidenceIds,
      proofPoints: build.proofPoints,
    },
    voiceDirection: build.voiceDirection,
    musicDirection: build.musicDirection,
    soundDirection: build.soundDirection,
    cta: extra.cta,
    rationale: build.rationale,
  };
}
