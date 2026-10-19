import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  PRODUCT_BRIEF,
  cleanupUser,
  loadWritingTestContext,
  registerUser,
  type Orm,
  type Services,
} from "../../modules/writing-engine/__tests__/helpers";

/**
 * Container-level proof for the model-assisted interpretation seam.
 *
 * With `CONTENT_OS_AI_INTERPRETATION=1` and a configured endpoint, the
 * creative-direction service composes the AI director ahead of the
 * deterministic one, and what the model returns is what the service stores —
 * after the shared validator has checked it against the project's own context.
 * When the model answers with something unusable, the service falls back and
 * records that it did; nothing is stored as if the model had spoken.
 *
 * The endpoint is a local HTTP server, so the network boundary is real while
 * the test does not depend on a vendor key.
 */

type Owner = Awaited<ReturnType<Services["authService"]["register"]>>;

const VALID_DIRECTIONS = {
  directions: [
    {
      name: "Chasing status, ending mornings",
      angle: "PROBLEM_SOLUTION",
      thesis: "Scheduled exports remove the status chase",
      hook: {
        statement: "Chasing status eats a morning",
        mechanism: "Open on a real moment",
        emotionalTrigger: "Recognition",
      },
      audienceAngle: "For engineering leads who report weekly",
      emotionalAngle: "Relief",
      narrativeSummary: "The problem, then the fix, then the proof",
      visualStrategy: {
        approach: "The real schedule screen",
        rationale: "The real screen is the proof",
        productMoments: ["The export queue"],
        assetIds: [],
      },
      proofStrategy: {
        claimIds: [],
        evidenceIds: [],
        proofPoints: ["Show the queued export"],
      },
      voiceDirection: "Plain and direct",
      musicDirection: "Low and sustained",
      soundDirection: "Interface sound",
      cta: "Start free trial",
      rationale: "It uses what the project recorded",
    },
  ],
};

let server: ReturnType<typeof createServer>;
let answer: "valid" | "garbage" = "valid";
let systemPrompt = "";
let userPrompt = "";
let services: Services;
let orm: Orm;
let owner: Owner;
let projectId = "";
let intentId = "";

function listen(serverToStart: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    serverToStart.listen(0, "127.0.0.1", () => {
      const address = serverToStart.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(raw) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      systemPrompt = parsed.messages?.[0]?.content ?? "";
      userPrompt = parsed.messages?.[1]?.content ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: "stub-ai-1",
          choices: [
            {
              message: {
                content:
                  answer === "valid"
                    ? JSON.stringify(VALID_DIRECTIONS)
                    : "I would rather describe it in prose.",
              },
            },
          ],
        }),
      );
    });
  });

  const port = await listen(server);

  process.env["CONTENT_OS_AI_INTERPRETATION"] = "1";
  process.env["CONTENT_OS_AI_BASE_URL"] = `http://127.0.0.1:${port}/v1`;
  process.env["CONTENT_OS_AI_MODEL"] = "stub-ai-1";

  const loaded = await loadWritingTestContext();
  orm = loaded.orm;
  services = loaded.services;

  owner = await registerUser(services, "cp10-ai");
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP10 AI interpretation" },
    owner.user.id,
  );
  projectId = project.id;

  await services.inputService.createBatch(projectId, owner.user.id, [
    { type: "text", name: "Product brief", value: PRODUCT_BRIEF },
  ]);
  await services.intelligenceService.analyze(projectId, owner.user.id, {});
  await services.brandService.analyze(projectId, owner.user.id);

  const resolved = await services.contentIntentService.resolve({
    projectId,
    userId: owner.user.id,
    request: "Make a 30 second launch video for LinkedIn announcing our scheduling",
  });
  intentId = resolved.intent.id;
}, 120_000);

afterAll(async () => {
  delete process.env["CONTENT_OS_AI_INTERPRETATION"];
  delete process.env["CONTENT_OS_AI_BASE_URL"];
  delete process.env["CONTENT_OS_AI_MODEL"];
  await cleanupUser(orm, owner, projectId);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("creative direction with the AI interpretation seam", () => {
  it("stores the model's validated direction and reports it as the provider", async () => {
    answer = "valid";

    const generated = await services.creativeDirectorService.generate({
      projectId,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });

    expect(generated.provider).toBe("ai-creative-director");
    expect(generated.fallbackFrom).toBeNull();
    expect(generated.model).toBe("stub-ai-1");
    expect(generated.directions.length).toBeGreaterThan(0);
    expect(generated.directions[0]!.name).toBe("Chasing status, ending mornings");

    // The model received the real prompt: mode binding, project facts and the
    // JSON contract. It was not handed an empty envelope.
    expect(systemPrompt).toContain("creative director");
    expect(systemPrompt).toContain("BALANCED");
    expect(systemPrompt).toContain("Do NOT write scenes");
    expect(userPrompt).toContain("Northwind Analytics");
    expect(userPrompt).toContain("Framings to draw from");
  }, 60_000);

  it("falls back to the deterministic director and says so when the model is unusable", async () => {
    answer = "garbage";

    const generated = await services.creativeDirectorService.generate({
      projectId,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });

    expect(generated.provider).toBe("deterministic-creative-director");
    expect(generated.fallbackFrom).toBe("ai-creative-director");
    expect(generated.fallbackReason).toBeTruthy();
    expect(generated.directions.length).toBeGreaterThan(0);
  }, 60_000);
});
