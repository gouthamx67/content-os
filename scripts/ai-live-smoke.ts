import "dotenv/config";
import { inspectImage } from "../src/modules/image-generation/artifact/image-metadata";
import { verifyGeneratedImage } from "../src/modules/image-generation/artifact/verify-image";
import { aiHordeConfigFromEnv } from "../src/modules/image-generation/providers/ai-horde-image-provider";
import { getImageProvider } from "../src/modules/image-generation/providers/registry";
import { pollinationsConfigFromEnv } from "../src/modules/image-generation/providers/pollinations-image-provider";
import { remoteImageConfigFromEnv } from "../src/modules/image-generation/providers/remote-image-provider";
import { AiBrandInterpretationProvider } from "../src/infrastructure/ai/brand-interpretation-provider";
import { AiContentIntentInterpreter } from "../src/infrastructure/ai/content-intent-interpreter";
import { AiContentRecommendationRefiner } from "../src/infrastructure/ai/content-recommendation-interpreter";
import { AiCreativeDirector } from "../src/infrastructure/ai/creative-director";
import { AiIntelligenceInterpretationProvider } from "../src/infrastructure/ai/intelligence-interpretation-provider";
import { AiStoryboardPlanner } from "../src/infrastructure/ai/storyboard-planner";
import { CONTENT_TYPES } from "../src/core/domain/content-type";
import { PLATFORMS } from "../src/core/domain/platform";
import { emptyRecommendationContext } from "../src/core/domain/recommendation-context";
import type { ContentOpportunity } from "../src/core/domain/content-opportunity";
import {
  createRemoteAiProvider,
  remoteAiConfigFromEnv,
  remoteAiFallbackChainFromEnv,
} from "../src/infrastructure/ai/remote-ai-provider";
import { CREATIVE_ANGLES } from "../src/core/domain/creative-direction";
import { llmEndpointLabel } from "../src/lib/llm-chat";
import {
  createRemoteLlmLocalizationProvider,
  localizationLlmConfigFromEnv,
  localizationLlmFallbackChainFromEnv,
} from "../src/modules/localization-engine/services/remote-llm-provider";
import type { LocalizationProviderRequest } from "../src/modules/localization-engine/integrations/ports";
import { buildFacts } from "../src/modules/writing-engine/context/context-facts";
import { validateVariant } from "../src/modules/writing-engine/claims/validate-variant";
import type { WritingContext } from "../src/modules/writing-engine/domain/types";
import {
  createRemoteLlmProvider,
  remoteLlmConfigFromEnv,
  remoteLlmFallbackChainFromEnv,
} from "../src/modules/writing-engine/providers/remote-llm-provider";
import { makeCreativeContext, makeStoryboardContext } from "../src/testing/fakes";

/**
 * Bounded live inference smoke test.
 *
 * One request per model-backed feature, through the same provider code the
 * product uses, against whatever endpoints the environment configures. This is
 * the command that turns "the provider is wired" into observed evidence: it
 * prints the serving host and model for every call, and nothing is reported as
 * PASS that did not come back from a real endpoint.
 *
 * Cost bound: exactly one request per feature, short prompts, per-endpoint
 * timeouts from the environment. Nothing here retries a paid call beyond the
 * transport's own failover chain.
 *
 * Usage:
 *   npm run ai:smoke
 *
 * Exit codes:
 *   0 — every configured feature passed
 *   1 — at least one configured feature failed (unconfigured ones are UNVERIFIED)
 *   2 — nothing was configured to test; run it once a real endpoint exists
 */

type Status = "PASS" | "FAIL" | "UNVERIFIED";

type Entry = {
  feature: string;
  status: Status;
  endpoint: string | null;
  model: string | null;
  ms: number | null;
  detail: string;
};

const entries: Entry[] = [];
const started = Date.now();

function hostOf(baseUrl: string): string {
  return llmEndpointLabel(baseUrl);
}

async function run(
  feature: string,
  execute: () => Promise<Omit<Entry, "feature" | "ms">>,
): Promise<void> {
  const begin = Date.now();
  try {
    const outcome = await execute();
    entries.push({ feature, ...outcome, ms: Date.now() - begin });
  } catch (error) {
    entries.push({
      feature,
      status: "FAIL",
      endpoint: null,
      model: null,
      ms: Date.now() - begin,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function writingContext(): WritingContext {
  const product = {
    name: "Northwind Analytics",
    category: "Scheduling",
    purpose: "Keep engineering teams aligned on delivery",
    shortDescription: "a scheduling tool for engineering teams",
    longDescription: "Schedules exports and reports status automatically",
    valueProposition: "one canonical delivery status",
    targetUser: "engineering leads",
    sourceIds: ["source_1"],
    features: [
      {
        id: "feature_1",
        name: "Scheduled exports",
        description: "Exports run on a schedule and report status automatically",
        sourceIds: ["source_1"],
      },
    ],
    benefits: [
      {
        id: "benefit_1",
        name: "Fewer status meetings",
        description: "The schedule replaces ad-hoc check-ins",
        sourceIds: ["source_1"],
      },
    ],
    problems: [
      {
        id: "problem_1",
        name: "Scattered updates",
        description: "Delivery status lives in many places",
        sourceIds: ["source_1"],
      },
    ],
    workflows: [
      {
        id: "workflow_1",
        name: "Set a schedule",
        steps: ["Choose a cadence", "Pick recipients"],
        sourceIds: ["source_1"],
      },
    ],
    claims: [
      {
        id: "claim_1",
        text: "Exports run on a schedule and report status automatically",
        sourceIds: ["source_1"],
      },
    ],
    audienceSignals: [
      {
        id: "audience_1",
        segment: "Engineering leads",
        description: "They report delivery progress weekly",
        sourceIds: ["source_1"],
      },
    ],
  };

  return {
    projectId: "smoke_project",
    blockType: "HEADLINE",
    objective: "AWARENESS",
    tone: "BRAND",
    length: "SHORT",
    audience: "engineering leads",
    language: "en",
    userRequest: "Announce that exports can run on a schedule",
    product,
    brand: {
      name: "Northwind Analytics",
      tagline: "Delivery status without the meetings",
      valueProposition: "one canonical delivery status",
      positioning: "for engineering teams",
      voiceSummary: "Plain and direct",
      preferredTerms: [],
      prohibitedTerms: [],
      voiceSignals: [],
      guidelines: [],
      version: 1,
    },
    intent: null,
    direction: null,
    scene: null,
    sourceIds: ["source_1"],
    facts: buildFacts(product, new Set(["source_1"])),
    brandVersion: 1,
    intelligenceVersion: 1,
    createdAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const writing = remoteLlmConfigFromEnv();
  const localization = localizationLlmConfigFromEnv();
  const ai = remoteAiConfigFromEnv();
  const imageChain = [
    remoteImageConfigFromEnv(),
    aiHordeConfigFromEnv(),
    pollinationsConfigFromEnv(),
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const image = imageChain[0] ?? null;

  console.log("AI live smoke — one bounded request per configured feature\n");

  if (!writing && !localization && !ai && !image) {
    console.log(
      "UNVERIFIED: no model endpoint is configured. Set WRITING_LLM_BASE_URL/WRITING_LLM_MODEL (or CONTENT_OS_AI_*, LOCALIZATION_LLM_*, IMAGE_LLM_*, IMAGE_HORDE_BASE_URL, IMAGE_POLLINATIONS_BASE_URL) and run `npm run ai:smoke` again.",
    );
    process.exit(2);
  }

  if (writing) {
    const chain = [writing, ...remoteLlmFallbackChainFromEnv()];
    await run("Writing engine (REMOTE_LLM provider)", async () => {
      const context = writingContext();
      const provider = createRemoteLlmProvider(writing, remoteLlmFallbackChainFromEnv());
      const result = await provider.generate({ context, variantCount: 2 });
      const accepted = result.candidates.filter(
        (candidate) => validateVariant(candidate.text, context).accepted,
      );
      return {
        status: accepted.length > 0 ? "PASS" : "FAIL",
        endpoint: chain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: result.providerModel,
        detail: `${result.candidates.length} candidate(s), ${accepted.length} passed grounding validation (${accepted[0]?.text.slice(0, 80) ?? "none"})`,
      };
    });
  } else {
    entries.push({
      feature: "Writing engine (REMOTE_LLM provider)",
      status: "UNVERIFIED",
      endpoint: null,
      model: null,
      ms: null,
      detail: "WRITING_LLM_BASE_URL/WRITING_LLM_MODEL are not set",
    });
  }

  if (localization) {
    const chain = [localization, ...localizationLlmFallbackChainFromEnv()];
    await run("Localization engine (remote-llm provider)", async () => {
      const request: LocalizationProviderRequest = {
        strategy: "TRANSLATE",
        sourceLocale: "en",
        targetLocale: "es",
        segments: [
          {
            id: "seg_1",
            kind: "HEADLINE",
            path: "headline",
            sourceText: "Ship delivery updates on a schedule.",
            targetText: null,
            placeholders: [],
            glossary: {},
            metadata: {},
          },
          {
            id: "seg_2",
            kind: "BODY",
            path: "body",
            sourceText: "Exports run on a schedule and report status automatically.",
            targetText: null,
            placeholders: [],
            glossary: {},
            metadata: {},
          },
        ],
        glossary: [
          { term: "Northwind Analytics", translation: "Northwind Analytics", doNotTranslate: true },
        ],
      };
      const provider = createRemoteLlmLocalizationProvider(
        localization,
        localizationLlmFallbackChainFromEnv(),
      );
      const result = await provider.localize(request);
      const complete = result.segments.filter((segment) => segment.targetText.trim().length > 0);
      return {
        status: complete.length === request.segments.length ? "PASS" : "FAIL",
        endpoint: chain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: result.providerModel,
        detail: `${complete.length}/${request.segments.length} segments translated (${result.segments[0]?.targetText.slice(0, 80) ?? "none"})`,
      };
    });
  } else {
    entries.push({
      feature: "Localization engine (remote-llm provider)",
      status: "UNVERIFIED",
      endpoint: null,
      model: null,
      ms: null,
      detail: "no localization or writing endpoint is set",
    });
  }

  if (ai) {
    const chain = [ai, ...remoteAiFallbackChainFromEnv()];
    await run("Creative direction (AI interpretation seam)", async () => {
      const provider = createRemoteAiProvider(ai, remoteAiFallbackChainFromEnv());
      const director = new AiCreativeDirector(provider);
      const result = await director.generate({
        context: makeCreativeContext({ mode: "BALANCED" }),
        count: 3,
        angles: CREATIVE_ANGLES.slice(0, 3),
      });
      return {
        status: result.proposals.length > 0 ? "PASS" : "FAIL",
        endpoint: chain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: result.model,
        detail: `${result.proposals.length} validated direction(s) (${result.proposals[0]?.name ?? "none"})`,
      };
    });

    await run("Intent interpretation (AI seam)", async () => {
      const provider = createRemoteAiProvider(ai, remoteAiFallbackChainFromEnv());
      const interpreter = new AiContentIntentInterpreter(provider);
      const result = await interpreter.interpret({
        projectId: "smoke-intent",
        rawRequest:
          "Create a 30-second product demo video for Northwind Analytics on YouTube in English, confident tone.",
        contentTypes: CONTENT_TYPES.map((entry) => ({
          id: entry.id,
          name: entry.name,
          description: entry.description,
          channel: entry.channel,
          supportedPlatforms: entry.supportedPlatforms,
        })),
        platforms: PLATFORMS.map((entry) => ({
          id: entry.id,
          name: entry.name,
          channels: entry.channels,
        })),
      });
      return {
        status: result.contentTypeId ? "PASS" : "FAIL",
        endpoint: chain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: result.model,
        detail: `${result.contentTypeId ?? "no content type"} on ${result.platforms.join("/") || "no platform"}${result.durationSeconds ? `, ${result.durationSeconds}s` : ""} (${result.provider})`,
      };
    });

    await run("Brand interpretation (AI seam)", async () => {
      const provider = createRemoteAiProvider(ai, remoteAiFallbackChainFromEnv());
      const interpreter = new AiBrandInterpretationProvider(provider);
      const result = await interpreter.interpret({
        projectId: "smoke-brand",
        sources: [
          { id: "src_brand", type: "DOCUMENT", name: "Northwind brand guide" },
        ],
        evidence: [
          {
            key: "ev_tone",
            sourceId: "src_brand",
            kind: "DOCUMENT_SECTION",
            locator: "guide.md#voice",
          },
        ],
        observations:
          "The guide says Northwind speaks plainly, leads with outcomes for operations teams, avoids hype, and uses short sentences.",
        deterministicFields: [],
      });
      const written =
        result.text.length + result.voiceSignals.length + result.terms.length;
      return {
        status: written > 0 ? "PASS" : "FAIL",
        endpoint: chain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: result.model,
        detail: `${result.text.length} text field(s), ${result.voiceSignals.length} voice signal(s), ${result.terms.length} term(s)`,
      };
    });

    await run("Intelligence interpretation (AI seam)", async () => {
      const provider = createRemoteAiProvider(ai, remoteAiFallbackChainFromEnv());
      const interpreter = new AiIntelligenceInterpretationProvider(provider);
      const result = await interpreter.interpret({
        projectId: "smoke-intelligence",
        sources: [
          { id: "src_readme", type: "DOCUMENT", name: "Northwind README" },
        ],
        evidence: [
          {
            key: "ev_export",
            sourceId: "src_readme",
            kind: "DOCUMENT_SECTION",
            locator: "README.md#features",
          },
        ],
        observations:
          "Northwind Analytics lets teams schedule recurring exports and automatically delivers status reports to stakeholders. It targets operations teams that rebuild reports by hand.",
      });
      const draft = result.draft;
      const items =
        draft.features.length +
        draft.workflows.length +
        draft.problems.length +
        draft.benefits.length +
        draft.claims.length;
      return {
        status: items > 0 ? "PASS" : "FAIL",
        endpoint: chain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: result.model,
        detail: `${draft.features.length} feature(s), ${draft.workflows.length} workflow(s), ${draft.claims.length} claim(s)`,
      };
    });

    await run("Recommendation refinement (AI seam)", async () => {
      const provider = createRemoteAiProvider(ai, remoteAiFallbackChainFromEnv());
      const refiner = new AiContentRecommendationRefiner(provider);
      const now = new Date().toISOString();
      const opportunities: ContentOpportunity[] = [
        {
          id: "",
          projectId: "smoke-recommendations",
          key: "video.product_demo:feature:feat_exports:youtube",
          templateId: "workflow_demo",
          contentTypeId: "video.product_demo",
          channel: "VIDEO",
          platform: "youtube",
          subjectType: "FEATURE",
          subjectId: "feat_exports",
          subjectLabel: "Scheduled exports",
          title: "Demo scheduled exports",
          rationale:
            "A concrete workflow the project already supports on a platform it already uses.",
          reasons: ["Grounded in the export workflow", "Fits the video channel"],
          missingInputs: [],
          priorityScore: 70,
          evidence: {
            sourceIds: ["src_readme"],
            evidenceIds: ["ev_export"],
            entityIds: ["feat_exports"],
          },
          status: "ACTIVE",
          selectedIntentId: null,
          dismissedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "",
          projectId: "smoke-recommendations",
          key: "text.linkedin_post:benefit:ben_delivery:linkedin",
          templateId: "benefit_post",
          contentTypeId: "text.linkedin_post",
          channel: "TEXT",
          platform: "linkedin",
          subjectType: "BENEFIT",
          subjectId: "ben_delivery",
          subjectLabel: "Automatic delivery",
          title: "Explain automatic delivery",
          rationale:
            "Turns an existing benefit into a short post for a channel the project uses.",
          reasons: ["Grounded in the delivery benefit", "Fits the text channel"],
          missingInputs: ["No customer quote yet"],
          priorityScore: 55,
          evidence: {
            sourceIds: ["src_readme"],
            evidenceIds: ["ev_export"],
            entityIds: ["ben_delivery"],
          },
          status: "ACTIVE",
          selectedIntentId: null,
          dismissedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ];
      const context = emptyRecommendationContext("smoke-recommendations");
      context.availablePlatforms = ["youtube", "linkedin"];
      const refined = await refiner.refine(context, opportunities);
      const complete = refined.length === opportunities.length;
      return {
        status: complete ? "PASS" : "FAIL",
        endpoint: chain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: null,
        detail: `${refined.length}/${opportunities.length} recommendation(s) refined (${refined[0]?.title ?? "none"})`,
      };
    });

    await run("Storyboard planning (AI seam)", async () => {
      const provider = createRemoteAiProvider(ai, remoteAiFallbackChainFromEnv());
      const planner = new AiStoryboardPlanner(provider);
      const result = await planner.plan({
        context: makeStoryboardContext({ targetDurationMs: 30_000 }),
        sceneTypes: ["HOOK", "PROOF", "CTA"],
      });
      const named = result.scenes.filter((scene) => scene.name?.trim()).length;
      return {
        status: result.scenes.length === 3 ? "PASS" : "FAIL",
        endpoint: chain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: result.model,
        detail: `${result.scenes.length}/3 scene(s), ${named} named (${result.scenes[0]?.name ?? "none"})`,
      };
    });
  } else {
    entries.push({
      feature: "Creative direction (AI interpretation seam)",
      status: "UNVERIFIED",
      endpoint: null,
      model: null,
      ms: null,
      detail: "CONTENT_OS_AI_* / WRITING_LLM_* are not set",
    });
    for (const feature of [
      "Intent interpretation (AI seam)",
      "Brand interpretation (AI seam)",
      "Intelligence interpretation (AI seam)",
      "Recommendation refinement (AI seam)",
      "Storyboard planning (AI seam)",
    ]) {
      entries.push({
        feature,
        status: "UNVERIFIED",
        endpoint: null,
        model: null,
        ms: null,
        detail: "CONTENT_OS_AI_* / WRITING_LLM_* are not set",
      });
    }
  }

  if (image) {
    await run("Image generation (REMOTE_IMAGE provider)", async () => {
      const provider = getImageProvider("REMOTE_IMAGE");
      const result = await provider.generate({
        graph: {
          contractVersion: 1,
          width: 512,
          height: 512,
          background: { kind: "COLOR", color: "#101828" },
          elements: [
            {
              id: "text_1",
              type: "TEXT",
              x: 24,
              y: 24,
              width: 400,
              height: 64,
              zIndex: 1,
              text: "Ship faster",
              style: { fill: "#f2f4f7", fontSize: 40 },
            },
          ],
        },
        width: 512,
        height: 512,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      });
      const metadata = await inspectImage(result.bytes);
      await verifyGeneratedImage({
        bytes: result.bytes,
        metadata,
        expected: { width: 512, height: 512, format: "PNG", transparent: false },
      });
      return {
        status: "PASS",
        endpoint: imageChain.map((entry) => hostOf(entry.baseUrl)).join(" > "),
        model: result.providerModel,
        detail: `${result.bytes.byteLength} bytes, ${metadata.width}x${metadata.height} ${metadata.format}`,
      };
    });
  } else {
    entries.push({
      feature: "Image generation (REMOTE_IMAGE provider)",
      status: "UNVERIFIED",
      endpoint: null,
      model: null,
      ms: null,
      detail:
        "IMAGE_LLM_BASE_URL/IMAGE_LLM_MODEL, IMAGE_HORDE_BASE_URL and IMAGE_POLLINATIONS_BASE_URL are not set",
    });
  }

  for (const entry of entries) {
    console.log(
      `[${entry.status}] ${entry.feature}\n    endpoint: ${entry.endpoint ?? "—"}\n    model: ${entry.model ?? "—"}${entry.ms === null ? "" : `\n    duration: ${entry.ms} ms`}\n    ${entry.detail}\n`,
    );
  }

  const failed = entries.filter((entry) => entry.status === "FAIL");
  const passed = entries.filter((entry) => entry.status === "PASS");
  console.log(
    `Summary: ${passed.length} passed, ${failed.length} failed, ${entries.length - passed.length - failed.length} unverified (${Date.now() - started} ms)`,
  );

  if (failed.length > 0) process.exit(1);
  if (passed.length === 0) process.exit(2);
}

void main().catch((error) => {
  console.error(
    `AI live smoke aborted: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
