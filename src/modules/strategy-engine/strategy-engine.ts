import type {
  RecommendationContext,
} from "../../core/domain/recommendation-context";
import {
  CONTENT_TYPES,
  getContentType,
} from "../../core/domain/content-type";
import { getPlatform } from "../../core/domain/platform";
import { isGenericSubjectLabel } from "./domain/labels";
import type { CreativeAngle } from "../../core/domain/creative-direction";
import type { OptimizationRecommendationRecord } from "../publishing-engine/domain/types";
import type {
  SocialStrategy,
  StrategyAudience,
  StrategyContentPlay,
  StrategyEvidenceLevel,
  StrategyGuardrail,
  StrategyMeasurement,
  StrategyPlatformPlay,
  StrategyPlatformRole,
  StrategyThesis,
  StrategyTiming,
  StrategyTimingWindow,
} from "./domain/types";

export type StrategyPerformanceInput = {
  publishedCount: number;
  measuredCount: number;
  timingRecommendations: OptimizationRecommendationRecord[];
};

export type BuildStrategyInput = {
  context: RecommendationContext;
  performance: StrategyPerformanceInput;
  now: string;
};

type SubjectType =
  | "PRODUCT"
  | "FEATURE"
  | "PROBLEM"
  | "BENEFIT"
  | "WORKFLOW"
  | "CLAIM";

type Subject = {
  type: SubjectType;
  id: string | null;
  label: string;
  proof: string;
  proofReady: boolean;
};

type ContentTypeChoice = {
  id: string;
  name: string;
};

type PlayBlueprint = {
  id: string;
  angle: CreativeAngle;
  subjectTypes: SubjectType[];
  title: (subject: Subject) => string;
  hook: (subject: Subject, context: RecommendationContext) => string;
  preferredContentTypes: string[];
  successSignal: string;
};

const IMPORTANCE_RANK: Record<string, number> = {
  PRIMARY: 0,
  SECONDARY: 1,
  TERTIARY: 2,
};



const ANGLE_LABELS: Record<CreativeAngle, string> = {
  PROBLEM_SOLUTION: "Problem and solution",
  PRODUCT_FIRST: "Product first",
  WORKFLOW: "How it works",
  TRANSFORMATION: "Transformation",
  FOUNDER: "Founder-led",
  TECHNICAL: "Technical proof",
  SOCIAL: "Social proof",
  EMOTIONAL: "Emotional",
  EDUCATIONAL: "Educational",
  BEFORE_AFTER: "Before and after",
  DEMO: "Product demo",
  CUSTOM: "Custom",
};

const PLATFORM_PLAYBOOK: Record<
  string,
  {
    role: StrategyPlatformRole;
    job: string;
    format: string[];
    cadence: string;
  }
> = {
  linkedin: {
    role: "AUTHORITY",
    job: "Establish authority with the people who buy, and distribute the proof to them.",
    format: ["text.linkedin", "video.product_demo", "image.carousel"],
    cadence: "2 posts per week",
  },
  x: {
    role: "REACH",
    job: "Test points of view in public and earn fast distribution through argument.",
    format: ["text.x", "video.social", "image.ad"],
    cadence: "3 short posts per week",
  },
  instagram: {
    role: "PROOF",
    job: "Make the result visible enough to save, share and remember.",
    format: ["image.carousel", "video.social", "image.ad"],
    cadence: "3 posts per week",
  },
  tiktok: {
    role: "REACH",
    job: "Earn cold attention by showing the product doing the work, not by explaining it.",
    format: ["video.social", "video.product_demo", "video.ad"],
    cadence: "3-4 posts per week",
  },
  youtube: {
    role: "AUTHORITY",
    job: "Build depth, search durability and the long version of the argument.",
    format: ["video.explainer", "video.product_demo", "video.launch"],
    cadence: "1 long-form post per week",
  },
  youtube_short: {
    role: "REACH",
    job: "Cut one proof point into a repeatable short-form format.",
    format: ["video.social", "video.product_demo"],
    cadence: "2 shorts per week",
  },
  product_hunt: {
    role: "LAUNCH",
    job: "Concentrate attention into one launch moment instead of treating it as a channel.",
    format: ["text.product_hunt", "video.launch", "image.thumbnail"],
    cadence: "one launch, then referrals",
  },
  website: {
    role: "CONVERSION",
    job: "Turn interest into belief with the proof a buyer checks before acting.",
    format: ["video.product_demo", "video.explainer", "image.thumbnail"],
    cadence: "evergreen, reviewed monthly",
  },
  email: {
    role: "OWNED",
    job: "Own the relationship and repeat the argument without renting attention.",
    format: ["campaign.launch", "image.ad"],
    cadence: "1 send per week",
  },
  podcast: {
    role: "AUTHORITY",
    job: "Earn trust through the long conversation the short formats cannot hold.",
    format: ["audio.voiceover"],
    cadence: "1 episode per week",
  },
};

const PLAY_BLUEPRINTS: PlayBlueprint[] = [
  {
    id: "workaround",
    angle: "PROBLEM_SOLUTION",
    subjectTypes: ["PROBLEM", "BENEFIT"],
    title: (subject) => `Make ${subject.label} the enemy`,
    hook: (subject, context) =>
      `Open on the cost of ${subject.label}. Do not mention ${context.product?.name ?? "the product"} until the audience recognizes the workaround.`,
    preferredContentTypes: ["video.explainer", "text.linkedin", "video.social"],
    successSignal: "Saves and comments per reach",
  },
  {
    id: "finished-output",
    angle: "DEMO",
    subjectTypes: ["FEATURE", "WORKFLOW"],
    title: (subject) => `Show ${subject.label} finishing the job`,
    hook: (subject) =>
      `Open on the finished output from ${subject.label}, then rewind into the work it removed.`,
    preferredContentTypes: ["video.product_demo", "video.social", "image.ad"],
    successSignal: "Three-second hold and profile visits",
  },
  {
    id: "handoff",
    angle: "WORKFLOW",
    subjectTypes: ["WORKFLOW", "FEATURE"],
    title: (subject) => `Break ${subject.label} at the handoff`,
    hook: (subject) =>
      `Show the handoff inside ${subject.label} where the work usually breaks, not the polished end screen.`,
    preferredContentTypes: ["image.carousel", "video.explainer", "text.linkedin"],
    successSignal: "Saves per impression",
  },
  {
    id: "old-way-new-way",
    angle: "BEFORE_AFTER",
    subjectTypes: ["BENEFIT", "PROBLEM", "PRODUCT"],
    title: (subject) => `Put ${subject.label} side by side`,
    hook: (subject) =>
      `Put the old way and the ${subject.label} outcome in the same frame. Let the contrast carry the argument.`,
    preferredContentTypes: ["video.social", "image.ad", "image.carousel"],
    successSignal: "Shares and saves",
  },
  {
    id: "mechanism",
    angle: "TECHNICAL",
    subjectTypes: ["CLAIM", "FEATURE", "WORKFLOW"],
    title: (subject) => `Prove the mechanism behind ${subject.label}`,
    hook: (subject) =>
      `Take ${subject.label} apart and show the mechanism. A claim without a mechanism is just a slogan.`,
    preferredContentTypes: ["video.explainer", "text.linkedin", "video.product_demo"],
    successSignal: "Comments that ask how",
  },
  {
    id: "position",
    angle: "FOUNDER",
    subjectTypes: ["PRODUCT", "PROBLEM", "CLAIM"],
    title: () => "Take a position the category avoids",
    hook: (_subject, context) =>
      `Say the sentence the category avoids. Make the audience feel the cost of the workaround before you name ${context.product?.name ?? "the product"}.`,
    preferredContentTypes: ["text.linkedin", "text.x", "video.social"],
    successSignal: "Qualified replies and profile visits",
  },
  {
    id: "failure-mode",
    angle: "EDUCATIONAL",
    subjectTypes: ["PROBLEM", "WORKFLOW", "FEATURE"],
    title: (subject) => `Teach the failure mode behind ${subject.label}`,
    hook: (subject) =>
      `Break down the mistake that makes ${subject.label} worse, then show the shorter path.`,
    preferredContentTypes: ["image.carousel", "video.explainer", "text.linkedin"],
    successSignal: "Saves per reach",
  },
  {
    id: "screenshot",
    angle: "SOCIAL",
    subjectTypes: ["BENEFIT", "CLAIM", "FEATURE"],
    title: (subject) => `Turn ${subject.label} into a screenshot`,
    hook: (subject) =>
      `Show the result from ${subject.label} that someone would screenshot, not a testimonial graphic.`,
    preferredContentTypes: ["image.ad", "image.carousel", "video.social"],
    successSignal: "Shares and saves",
  },
];

export function buildSocialStrategy(input: BuildStrategyInput): SocialStrategy {
  const { context, performance, now } = input;
  const subjects = buildSubjects(context);
  const supportedClaims = context.claims.filter(
    (claim) => claim.verification === "SUPPORTED",
  );
  const topProblem = [...context.problems].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];
  const topBenefit = [...context.benefits].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];
  const topFeature = specificFeatures(context).sort(
    (left, right) =>
      (IMPORTANCE_RANK[left.importance] ?? 9) -
        (IMPORTANCE_RANK[right.importance] ?? 9) ||
      right.confidence - left.confidence,
  )[0];
  const thesis = buildThesis(context, subjects);
  const audience = buildAudience(context, topProblem, topBenefit);
  const platforms = buildPlatforms(context, subjects, supportedClaims, topBenefit);
  const timing = buildTiming(context, performance);
  const plays = buildPlays(context, subjects, platforms);
  const guardrails = buildGuardrails(context, performance, topFeature);
  const measurement = buildMeasurement(performance);
  const missingInputs = buildMissingInputs(context, performance, platforms);

  const confidence: StrategyEvidenceLevel =
    timing.status === "MEASURED"
      ? "MEASURED"
      : context.product && context.audienceSignals.length > 0
        ? "GROUNDED"
        : "HYPOTHESIS";

  return {
    generatedAt: now,
    confidence,
    thesis,
    audience,
    platforms,
    timing,
    contentSystem: {
      principle:
        "One subject, one angle, one proof, one ask. The format changes before the argument does.",
      rotationRule:
        "Never repeat a subject in the same format. If a subject returns, change the angle, the platform and the opening frame. Rotate proof, not adjectives.",
      plays,
    },
    guardrails,
    measurement,
    missingInputs,
    sourceSummary: {
      features: context.features.length,
      specificFeatures: specificFeatures(context).length,
      problems: context.problems.length,
      benefits: context.benefits.length,
      workflows: context.workflows.length,
      supportedClaims: supportedClaims.length,
      audienceSignals: context.audienceSignals.length,
      measuredPosts: performance.measuredCount,
      publishedPosts: performance.publishedCount,
    },
  };
}

function buildThesis(
  context: RecommendationContext,
  subjects: Subject[],
): StrategyThesis {
  const product = context.product;
  const supportedClaim = context.claims.find(
    (claim) => claim.verification === "SUPPORTED",
  );
  const topProblem = [...context.problems].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];
  const topBenefit = [...context.benefits].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];
  const topFeature = specificFeatures(context).sort(
    (left, right) =>
      (IMPORTANCE_RANK[left.importance] ?? 9) -
        (IMPORTANCE_RANK[right.importance] ?? 9) ||
      right.confidence - left.confidence,
  )[0];

  const basis = [
    product ? `Product: ${product.name}` : null,
    topProblem ? `Problem: ${topProblem.name}` : null,
    topBenefit ? `Desired outcome: ${topBenefit.name}` : null,
    topFeature ? `Feature: ${topFeature.name}` : null,
    supportedClaim ? `Supported claim: ${supportedClaim.text}` : null,
  ].filter((entry): entry is string => entry !== null);

  if (!product) {
    return {
      headline: "Do not make content for a product you cannot describe",
      argument:
        "There is no product record yet. Content produced now would invent the category, the audience and the proof at the same time. Fix the product story first, then publish.",
      proof:
        "No usable product description or value proposition is recorded yet.",
      evidenceLevel: "HYPOTHESIS",
      basis,
    };
  }

  const proof = supportedClaim
    ? `The strongest recorded proof is: “${supportedClaim.text}”.`
    : topFeature?.evidenceIds.length
      ? `Show ${topFeature.name} in the real interface instead of describing it.`
      : subjects.find((subject) => subject.proofReady)?.proof ??
        "No usable proof is recorded yet. Capture the product doing the work before publishing.";

  if (context.audienceSignals.length === 0) {
    return {
      headline: "Narrow before you scale",
      argument: `${product.name} has a product story but no named audience. Content built for everyone reads like content built for no one. Pick one segment and one expensive problem before increasing output.`,
      proof,
      evidenceLevel: "HYPOTHESIS",
      basis,
    };
  }

  if (topProblem && topBenefit) {
    return {
      headline: "Make the workaround the enemy",
      argument: `${product.name} should not open with features. The audience already recognizes ${topProblem.name}; show the shorter path to ${topBenefit.name}. The product is the proof, not the opening line.`,
      proof,
      evidenceLevel: "GROUNDED",
      basis,
    };
  }

  if (topBenefit || product.valueProposition) {
    return {
      headline: "Sell the finished outcome, not the tool",
      argument: `${product.name} becomes interesting at the moment the work is already done. Lead with ${topBenefit?.name ?? product.valueProposition}; let the workflow be the evidence rather than the pitch.`,
      proof,
      evidenceLevel: "GROUNDED",
      basis,
    };
  }

  if (topProblem) {
    return {
      headline: "Name the problem before the product",
      argument: `The audience has to recognize ${topProblem.name} before ${product.name} has a reason to exist in the feed. Earn attention with the problem, then show the mechanism.`,
      proof,
      evidenceLevel: "GROUNDED",
      basis,
    };
  }

  if (supportedClaim) {
    return {
      headline: "Make proof the creative",
      argument: `${product.name} has a supported claim but no recorded audience pain. Put the proof in front and let the audience tell you which problem it solves.`,
      proof,
      evidenceLevel: "GROUNDED",
      basis,
    };
  }

  return {
    headline: "Build a point of view before a content calendar",
    argument: `${product.name} has no recorded problem, benefit or proof. A posting schedule would only make the absence louder. Decide what the product changes, for whom, and what evidence proves it.`,
    proof,
    evidenceLevel: "HYPOTHESIS",
    basis,
  };
}

function buildAudience(
  context: RecommendationContext,
  topProblem: RecommendationContext["problems"][number] | undefined,
  topBenefit: RecommendationContext["benefits"][number] | undefined,
): StrategyAudience {
  const segments = context.audienceSignals.map((signal) => signal.segment);
  const missing: string[] = [];
  if (segments.length === 0) missing.push("A named audience segment");
  if (!topProblem) missing.push("The pain this audience already recognizes");
  if (!topBenefit && !context.product?.valueProposition) {
    missing.push("The outcome the audience wants");
  }

  return {
    summary:
      segments.length > 0
        ? `The project names ${segments.join(", ")}. Write to one of them at a time; a post that addresses all of them addresses none.`
        : "No audience signal is recorded. The strategist refuses to invent one. Name one segment and one expensive problem before increasing output.",
    segments,
    pain: topProblem?.name ?? null,
    desiredOutcome:
      topBenefit?.name ?? context.product?.valueProposition ?? null,
    missing,
    evidenceLevel: segments.length > 0 ? "GROUNDED" : "HYPOTHESIS",
  };
}

function buildPlatforms(
  context: RecommendationContext,
  subjects: Subject[],
  supportedClaims: RecommendationContext["claims"],
  topBenefit: RecommendationContext["benefits"][number] | undefined,
): StrategyPlatformPlay[] {
  if (!context.product && subjects.length === 0 && context.audienceSignals.length === 0) {
    return [];
  }

  const explicit = context.availablePlatforms.filter((id) => getPlatform(id));
  const inferred = explicit.length > 0 ? [] : inferPlatforms(context);
  const candidates = explicit.length > 0 ? explicit : inferred;

  const ranked = [...new Set(candidates)]
    .sort(
      (left, right) =>
        platformFit(context, right, inferred) - platformFit(context, left, inferred),
    )
    .slice(0, 3);

  const proofToLeadWith =
    supportedClaims.find((claim) => claim.verification === "SUPPORTED")?.text ??
    topBenefit?.name ??
    subjects.find((subject) => subject.proofReady)?.proof ??
    "No proof is recorded yet. Capture the product doing the work first.";

  return ranked.flatMap((platformId) => {
    const platform = getPlatform(platformId);
    const playbook = PLATFORM_PLAYBOOK[platformId];
    if (!platform || !playbook) return [];
    const format = resolveContentType(platformId, playbook.format);
    if (!format) return [];

    return [
      {
        platformId,
        platformName: platform.name,
        role: playbook.role,
        job: playbook.job,
        contentTypeId: format.id,
        format: format.name,
        cadence: playbook.cadence,
        proofToLeadWith,
        why:
          explicit.includes(platformId)
            ? `${platform.name} is already part of this project's platform surface. ${playbook.job}`
            : `No platform evidence is recorded yet. ${platform.name} is a starting hypothesis based on the audience vocabulary in the project, not a measured preference.`,
        evidenceLevel: explicit.includes(platformId) ? "GROUNDED" : "HYPOTHESIS",
      },
    ];
  });
}

function inferPlatforms(context: RecommendationContext): string[] {
  const text = [
    context.product?.name,
    context.product?.description,
    context.product?.category,
    context.product?.valueProposition,
    ...context.audienceSignals.map((signal) => signal.segment),
    ...context.audienceSignals.map((signal) => signal.description),
    ...context.problems.map((problem) => problem.name),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(" ")
    .toLowerCase();

  if (/\b(developer|engineering|api|infrastructure|technical)\b/.test(text)) {
    return ["x", "linkedin", "youtube"];
  }
  if (/\b(b2b|saas|founder|startup|marketing|product team|agency|enterprise)\b/.test(text)) {
    return ["linkedin", "x", "youtube"];
  }
  if (/\b(creator|designer|consumer|fashion|beauty|food|travel|lifestyle)\b/.test(text)) {
    return ["instagram", "tiktok", "youtube_short"];
  }
  return ["linkedin", "instagram", "youtube"];
}

function platformFit(
  context: RecommendationContext,
  platformId: string,
  inferred: readonly string[],
): number {
  const priority = context.platformPriority[platformId] ?? 0;
  const inference = inferred.includes(platformId) ? 40 : 0;
  const explicit = context.availablePlatforms.includes(platformId) ? 10 : 0;
  return priority + inference + explicit;
}

function resolveContentType(
  platformId: string,
  preferred: readonly string[],
): ContentTypeChoice | null {
  for (const id of preferred) {
    const definition = getContentType(id);
    if (definition?.supportedPlatforms.includes(platformId)) {
      return { id: definition.id, name: definition.name };
    }
  }

  const fallback = CONTENT_TYPES.find((definition) =>
    definition.supportedPlatforms.includes(platformId),
  );
  return fallback ? { id: fallback.id, name: fallback.name } : null;
}

function buildTiming(
  context: RecommendationContext,
  performance: StrategyPerformanceInput,
): StrategyTiming {
  const measured = performance.timingRecommendations.filter(
    (recommendation) =>
      recommendation.category === "TIMING_WINDOW" &&
      recommendation.status !== "DISMISSED" &&
      recommendation.proposedChanges.suggestedWindowStartHourUtc !== null &&
      recommendation.proposedChanges.suggestedWindowEndHourUtc !== null,
  );

  if (measured.length > 0) {
    const windows: StrategyTimingWindow[] = measured.flatMap((recommendation) => {
      const start = recommendation.proposedChanges.suggestedWindowStartHourUtc;
      const end = recommendation.proposedChanges.suggestedWindowEndHourUtc;
      if (start === null || end === null) return [];
      return [
        {
          label: `${formatHour(start)}-${formatHour(end)} UTC`,
          startHourUtc: start,
          endHourUtc: end,
          confidence: recommendation.confidence,
          note: recommendation.title,
        },
      ];
    });

    return {
      status: "MEASURED",
      headline: "Your own data has a window worth defending",
      detail:
        measured[0]?.explanation ??
        "This project's published posts show a repeatable timing pattern.",
      windows,
      measurement:
        "Keep the creative constant and publish into the winning window for at least three more posts before treating it as a rule.",
      evidence: measured.map((recommendation) => recommendation.evidence.comparison),
      evidenceLevel: "MEASURED",
    };
  }

  const measuredCount = performance.measuredCount;
  return {
    status: "EXPERIMENT",
    headline: "Do not guess a post time. Buy the answer.",
    detail:
      measuredCount < 3
        ? `Only ${measuredCount} published post(s) have complete engagement readings. The optimizer needs at least three before it can compare windows, so every time slot below is a hypothesis, not a recommendation.`
        : "There are measured posts, but no window is strong enough to call. Keep the test running instead of promoting a hunch.",
    windows: [
      {
        label: "08:00-10:00 UTC",
        startHourUtc: 8,
        endHourUtc: 10,
        confidence: "HYPOTHESIS",
        note: "Test window A",
      },
      {
        label: "12:00-14:00 UTC",
        startHourUtc: 12,
        endHourUtc: 14,
        confidence: "HYPOTHESIS",
        note: "Test window B",
      },
      {
        label: "17:00-19:00 UTC",
        startHourUtc: 17,
        endHourUtc: 19,
        confidence: "HYPOTHESIS",
        note: "Test window C",
      },
    ],
    measurement:
      "Publish the same format into each window for two weeks. Change only the time, then compare measured engagement per post. If the audience timezone is unknown, resolve that before treating any window as a rule.",
    evidence: [
      `Measured posts available: ${measuredCount}. Timing recommendations available: 0.`,
      context.product
        ? `Product context: ${context.product.name}.`
        : "No product context recorded.",
    ],
    evidenceLevel: "HYPOTHESIS",
  };
}

function buildPlays(
  context: RecommendationContext,
  subjects: Subject[],
  platforms: StrategyPlatformPlay[],
): StrategyContentPlay[] {
  if (subjects.length === 0 || platforms.length === 0) return [];

  const plays: StrategyContentPlay[] = [];
  const uniqueSubjectCount = new Set(
    subjects.map((subject) => `${subject.type}:${subject.label}`),
  ).size;
  const maximum = Math.min(6, Math.max(3, uniqueSubjectCount * 2));
  let platformOffset = 0;

  for (const blueprint of PLAY_BLUEPRINTS) {
    if (plays.length >= maximum) break;
    const subject = chooseSubject(subjects, plays, blueprint);
    if (!subject) continue;

    const platform = findPlatformForBlueprint(platforms, blueprint, platformOffset);
    if (!platform) continue;
    platformOffset += 1;

    const contentType =
      resolveContentType(platform.platformId, blueprint.preferredContentTypes) ??
      resolveContentType(platform.platformId, [platform.contentTypeId]);
    if (!contentType) continue;

    const covered = context.existingContent.some(
      (content) =>
        subject.id !== null &&
        content.subjectIds.includes(subject.id) &&
        content.contentTypeId === contentType.id,
    );

    plays.push({
      id: `play_${plays.length + 1}_${blueprint.id}`,
      sequence: plays.length + 1,
      title: blueprint.title(subject),
      angle: blueprint.angle,
      angleLabel: ANGLE_LABELS[blueprint.angle],
      subjectType: subject.type.toLowerCase(),
      subjectLabel: subject.label,
      platformId: platform.platformId,
      platformName: platform.platformName,
      contentTypeId: contentType.id,
      format: contentType.name,
      hook: blueprint.hook(subject, context),
      proof: subject.proofReady
        ? subject.proof
        : `${subject.proof} Capture proof before publishing; do not assert it.`,
      proofReady: subject.proofReady,
      whyNow: covered
        ? `This subject already appears in a ${contentType.name}. Do not repeat the same argument; use this angle only if it changes the proof.`
        : `No existing ${contentType.name} covers this subject, so this is a real gap rather than a remix.`,
      cta: ctaForPlatform(platform.platformId),
      successSignal: blueprint.successSignal,
      repeatRule:
        "If this subject returns, change the format, platform and opening frame.",
    });
  }

  return plays;
}

function chooseSubject(
  subjects: Subject[],
  plays: StrategyContentPlay[],
  blueprint: PlayBlueprint,
): Subject | null {
  const usage = new Map<string, number>();
  for (const play of plays) {
    usage.set(play.subjectLabel, (usage.get(play.subjectLabel) ?? 0) + 1);
  }

  const unused = subjects.filter(
    (subject) => !plays.some((play) => play.subjectLabel === subject.label),
  );
  const fromUnused = unused.find((subject) =>
    blueprint.subjectTypes.includes(subject.type),
  );
  if (fromUnused) return fromUnused;

  const ordered = [...subjects].sort(
    (left, right) =>
      (usage.get(left.label) ?? 0) - (usage.get(right.label) ?? 0),
  );
  return (
    ordered.find((subject) => blueprint.subjectTypes.includes(subject.type)) ??
    null
  );
}

function findPlatformForBlueprint(
  platforms: StrategyPlatformPlay[],
  blueprint: PlayBlueprint,
  offset: number,
): StrategyPlatformPlay | null {
  for (let index = 0; index < platforms.length; index += 1) {
    const candidate = platforms[(offset + index) % platforms.length];
    if (!candidate) continue;
    if (resolveContentType(candidate.platformId, blueprint.preferredContentTypes)) {
      return candidate;
    }
  }
  return platforms[offset % platforms.length] ?? null;
}

function buildSubjects(context: RecommendationContext): Subject[] {
  const supportedClaims = context.claims.filter(
    (claim) => claim.verification === "SUPPORTED",
  );

  const features = specificFeatures(context)
    .sort(
      (left, right) =>
        (IMPORTANCE_RANK[left.importance] ?? 9) -
          (IMPORTANCE_RANK[right.importance] ?? 9) ||
        right.confidence - left.confidence,
    )
    .map<Subject>((feature) => ({
      type: "FEATURE",
      id: feature.id,
      label: feature.name,
      proof:
        feature.evidenceIds.length > 0
          ? `${feature.evidenceIds.length} evidence item(s) on file for ${feature.name}. Show it in the real interface.`
          : `No evidence captured yet. Show ${feature.name} in the real interface before claiming it.`,
      proofReady: feature.evidenceIds.length > 0,
    }));

  const problems = [...context.problems]
    .sort((left, right) => right.confidence - left.confidence)
    .map<Subject>((problem) => ({
      type: "PROBLEM",
      id: problem.id,
      label: problem.name,
      proof:
        problem.evidenceIds.length > 0
          ? `${problem.evidenceIds.length} evidence item(s) on file for ${problem.name}.`
          : `No evidence captured yet. Use a real audience example of ${problem.name}, not a hypothetical.`,
      proofReady: problem.evidenceIds.length > 0,
    }));

  const workflows = [...context.workflows]
    .sort((left, right) => right.confidence - left.confidence)
    .map<Subject>((workflow) => ({
      type: "WORKFLOW",
      id: workflow.id,
      label: workflow.name,
      proof:
        workflow.evidenceIds.length > 0
          ? `${workflow.evidenceIds.length} evidence item(s) on file. Walk through ${workflow.steps.slice(0, 4).join(" -> ")}.`
          : workflow.steps.length > 0
            ? `No evidence captured yet. Walk through ${workflow.steps.slice(0, 4).join(" -> ")} and capture the result.`
            : `No evidence captured yet. Show the real steps inside ${workflow.name}.`,
      proofReady: workflow.evidenceIds.length > 0,
    }));

  const benefits = [...context.benefits]
    .sort((left, right) => right.confidence - left.confidence)
    .map<Subject>((benefit) => ({
      type: "BENEFIT",
      id: benefit.id,
      label: benefit.name,
      proof:
        benefit.evidenceIds.length > 0
          ? `${benefit.evidenceIds.length} evidence item(s) on file for ${benefit.name}.`
          : `No evidence captured yet. Show the artifact that exists after ${benefit.name}.`,
      proofReady: benefit.evidenceIds.length > 0,
    }));

  const claims = supportedClaims.map<Subject>((claim) => ({
    type: "CLAIM",
    id: claim.id,
    label: claim.text,
    proof:
      claim.evidenceIds.length > 0
        ? claim.text
        : `Supported claim, but no evidence item is linked yet: ${claim.text}`,
    proofReady: claim.evidenceIds.length > 0,
  }));

  const product = context.product
    ? [
        {
          type: "PRODUCT" as const,
          id: null,
          label: context.product.name,
          proof:
            supportedClaims.find((claim) => claim.evidenceIds.length > 0)?.text ??
            `No proof captured yet. Show ${context.product.name} doing the work before describing it.`,
          proofReady: supportedClaims.some(
            (claim) => claim.evidenceIds.length > 0,
          ),
        },
      ]
    : [];

  const seen = new Set<string>();
  return interleave([
    features,
    problems,
    workflows,
    benefits,
    claims,
    product,
  ]).filter((subject) => {
    const identity = `${subject.type}:${subject.label}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function interleave(groups: Subject[][]): Subject[] {
  const result: Subject[] = [];
  let index = 0;
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const group of groups) {
      const item = group[index];
      if (item) {
        result.push(item);
        remaining = true;
      }
    }
    index += 1;
  }
  return result;
}

function buildGuardrails(
  context: RecommendationContext,
  performance: StrategyPerformanceInput,
  topFeature: RecommendationContext["features"][number] | undefined,
): StrategyGuardrail[] {
  const guardrails: StrategyGuardrail[] = [];
  const unsupported = context.claims.filter(
    (claim) => claim.verification !== "SUPPORTED",
  );
  if (unsupported.length > 0) {
    guardrails.push({
      title: "Claims under quarantine",
      detail: `${unsupported.length} claim(s) are not supported by the project's evidence. Do not use them in hooks, captions or calls to action.`,
      severity: "STOP",
    });
  }

  if (performance.measuredCount === 0) {
    guardrails.push({
      title: "No performance promises",
      detail:
        "No published post has complete engagement readings yet. Do not imply a result the project has not measured.",
      severity: "STOP",
    });
  }

  const featuresWithoutEvidence = context.features.filter(
    (feature) => feature.evidenceIds.length === 0 && feature.sourceIds.length === 0,
  );
  if (featuresWithoutEvidence.length > 0) {
    guardrails.push({
      title: "Proof debt",
      detail: `${featuresWithoutEvidence.length} feature(s) have no recorded source or evidence. Capture the proof before making them the subject of a play.`,
      severity: "CHECK",
    });
  }

  if (
    topFeature &&
    topFeature.evidenceIds.length === 0 &&
    topFeature.sourceIds.length === 0
  ) {
    guardrails.push({
      title: "Do not lead with the primary feature",
      detail: `${topFeature.name} is marked primary but has no evidence. Lead with a problem or a supported claim until the feature is provable.`,
      severity: "CHECK",
    });
  }

  const avoid = context.brand?.terms.avoid ?? [];
  if (avoid.length > 0) {
    guardrails.push({
      title: "Banned language",
      detail: `The brand profile says to avoid: ${avoid.join(", ")}. Treat that as a hard constraint, not a suggestion.`,
      severity: "STOP",
    });
  }

  guardrails.push({
    title: "One idea per asset",
    detail:
      "Every asset gets one subject, one angle, one proof and one ask. Two ideas in one post means neither is remembered.",
    severity: "CHECK",
  });

  guardrails.push({
    title: "Re-cut, do not repost",
    detail:
      "The same asset is not native on every platform. Change the opening frame, the proof order and the ask before publishing it again.",
    severity: "CHECK",
  });

  return guardrails.slice(0, 6);
}

function buildMeasurement(
  performance: StrategyPerformanceInput,
): StrategyMeasurement {
  const measuredPosts = performance.measuredCount;
  const ready = measuredPosts >= 3;
  return {
    readiness: ready ? "MEASURED" : "NEEDS_DATA",
    headline: ready
      ? "You can compare, but not conclude"
      : "You are not measuring yet",
    detail:
      measuredPosts === 0
        ? "No published post has complete engagement readings. Anything that sounds like performance advice would be invented, so the strategy stays a hypothesis portfolio."
        : measuredPosts < 3
          ? `Only ${measuredPosts} published post(s) have complete readings. The optimizer needs at least three before it will compare windows or outliers.`
          : `${measuredPosts} published post(s) have complete readings. That is enough to compare angles, not enough to call a permanent rule.`,
    measuredPosts,
    publishedPosts: performance.publishedCount,
    nextCheck:
      "After the next six posts, keep the two angles with the best engagement per post and retire the rest.",
    decisionRule:
      "Keep an angle only if it beats the project median on engagement per post across at least three posts. Do not call a winner from one post.",
    evidenceLevel: measuredPosts > 0 ? "MEASURED" : "HYPOTHESIS",
  };
}

function buildMissingInputs(
  context: RecommendationContext,
  performance: StrategyPerformanceInput,
  platforms: StrategyPlatformPlay[],
): string[] {
  const missing: string[] = [];
  if (!context.product) missing.push("A product description");
  if (specificFeatures(context).length === 0) {
    missing.push(
      context.features.length > 0
        ? "A specific product feature (the extracted labels are section headings)"
        : "A specific product feature",
    );
  }
  if (context.audienceSignals.length === 0) missing.push("A named audience segment");
  if (context.problems.length === 0) missing.push("The problem the audience feels");
  if (context.benefits.length === 0) missing.push("The outcome the audience wants");
  if (context.workflows.length === 0) missing.push("A repeatable workflow to show");
  if (context.claims.filter((claim) => claim.verification === "SUPPORTED").length === 0) {
    missing.push("A supported claim");
  }
  if (performance.measuredCount === 0) missing.push("Measured post performance");
  if (platforms.every((platform) => platform.evidenceLevel === "HYPOTHESIS")) {
    missing.push("Platform evidence");
  }
  if (!context.brand) missing.push("A brand profile");
  return missing.slice(0, 8);
}

function specificFeatures(
  context: RecommendationContext,
): RecommendationContext["features"] {
  return context.features.filter(
    (feature) => !isGenericSubjectLabel(feature.name),
  );
}

function ctaForPlatform(platformId: string): string {
  const ctas: Record<string, string> = {
    linkedin: "Invite a reply or a workflow audit.",
    x: "Ask for a counterexample.",
    instagram: "Ask for a save.",
    tiktok: "Ask for a follow for the next teardown.",
    youtube: "Invite a subscribe for the full walkthrough.",
    youtube_short: "Ask for a follow for the next proof point.",
    product_hunt: "Ask for an upvote only after the proof lands.",
    website: "Invite a demo.",
    email: "Invite a reply.",
    podcast: "Invite a listen.",
  };
  return ctas[platformId] ?? "Invite one concrete next step.";
}

function formatHour(hour: number): string {
  return String(hour).padStart(2, "0") + ":00";
}
