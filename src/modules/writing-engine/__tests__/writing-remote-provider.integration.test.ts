import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  cleanupUser,
  createFullProject,
  loadWritingTestContext,
  makeWorker,
  type FullProjectContext,
  type Orm,
  type Services,
} from "./helpers";
import type { WritingGenerationWorker } from "../writing-generation-worker";

/**
 * Full-engine proof that `REMOTE_LLM` runs through the real wiring.
 *
 * Two local HTTP servers stand in for OpenAI-compatible model endpoints: the
 * primary answers 500 (a retryable server-side failure), the fallback answers a
 * strict-JSON completion. The container is imported with the environment
 * pointing at them, so this exercises the path the product actually walks —
 * env → container → provider registry → worker → shared transport with
 * failover → response parsing → CP18 grounding validation → persistence with
 * provenance. No vendor key is involved and nothing is mocked at the module
 * level; the network boundary is real HTTP.
 */

const PRIMARY_VARIANTS = [
  "Scheduled exports send a status report on a fixed schedule.",
  "Northwind Analytics is a scheduling tool for engineering teams.",
];

let primaryServer: ReturnType<typeof createServer>;
let fallbackServer: ReturnType<typeof createServer>;
let primaryCalls = 0;
let fallbackCalls = 0;
let capturedPrompt = "";
let services: Services;
let orm: Orm;
let project: FullProjectContext;
let worker: WritingGenerationWorker;

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function drain(): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if (!(await worker.tick())) return;
  }
  throw new Error("writing queue did not drain");
}

beforeAll(async () => {
  primaryServer = createServer((_req, res) => {
    primaryCalls += 1;
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "primary is down" } }));
  });

  fallbackServer = createServer((req, res) => {
    fallbackCalls += 1;
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(raw) as { messages?: Array<{ content?: string }> };
      capturedPrompt = parsed.messages?.[1]?.content ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: "stub-writing-1",
          choices: [
            {
              message: {
                content: JSON.stringify({ variants: PRIMARY_VARIANTS }),
              },
            },
          ],
        }),
      );
    });
  });

  const primaryPort = await listen(primaryServer);
  const fallbackPort = await listen(fallbackServer);

  process.env["WRITING_LLM_BASE_URL"] = `http://127.0.0.1:${primaryPort}/v1`;
  process.env["WRITING_LLM_MODEL"] = "stub-primary";
  process.env["WRITING_LLM_FALLBACK_BASE_URL"] = `http://127.0.0.1:${fallbackPort}/v1`;
  process.env["WRITING_LLM_FALLBACK_MODEL"] = "stub-writing-1";

  const loaded = await loadWritingTestContext();
  orm = loaded.orm;
  services = loaded.services;
  project = await createFullProject(services);
  worker = makeWorker({ services });
  await drain();
}, 120_000);

afterAll(async () => {
  delete process.env["WRITING_LLM_BASE_URL"];
  delete process.env["WRITING_LLM_MODEL"];
  delete process.env["WRITING_LLM_FALLBACK_BASE_URL"];
  delete process.env["WRITING_LLM_FALLBACK_MODEL"];
  await cleanupUser(orm, project.owner, project.projectId);
  await new Promise<void>((resolve) => primaryServer.close(() => resolve()));
  await new Promise<void>((resolve) => fallbackServer.close(() => resolve()));
});

describe("writing remote provider inside the engine", () => {
  it("registers REMOTE_LLM when the endpoint is configured", () => {
    expect(services.writingProviderRegistry.providers).toContain("REMOTE_LLM");
  });

  it("generates grounded variants through a real HTTP boundary, failing over once", async () => {
    const before = { primary: primaryCalls, fallback: fallbackCalls };

    const job = await services.writingGenerationService.enqueue({
      projectId: project.projectId,
      requestedById: project.owner.user.id,
      blockType: "HEADLINE",
      tone: "BRAND",
      length: "SHORT",
      objective: "AWARENESS",
      prompt: "Announce scheduled exports",
      provider: "REMOTE_LLM",
      variantCount: 2,
      intentId: project.intentId,
      directionId: project.directionId,
      sceneId: project.sceneId,
    });
    await drain();

    const record = await services.writingGenerationService.getJob({
      projectId: project.projectId,
      jobId: job.id,
      userId: project.owner.user.id,
    });

    expect(record.status, record.errorMessage ?? "").toBe("SUCCEEDED");
    expect(record.provider).toBe("REMOTE_LLM");
    expect(record.providerModel).toBe("stub-writing-1");
    expect(record.providerVersion).toBe("remote-llm");

    // The primary endpoint failed exactly once and the fallback answered once:
    // the transport moved to the second endpoint without giving up.
    expect(primaryCalls - before.primary).toBe(1);
    expect(fallbackCalls - before.fallback).toBe(1);

    // The fallback received the grounded prompt built from the project's own
    // facts; the model saw real context, not an empty envelope.
    expect(capturedPrompt).toContain("Scheduled exports send a status report");
    expect(capturedPrompt).toContain(
      'Return strict JSON: {"variants": ["...", "..."]}',
    );

    const view = await services.writingGenerationService.getDocument({
      projectId: project.projectId,
      documentId: record.documentId!,
      userId: project.owner.user.id,
    });
    expect(view.variants.length).toBeGreaterThan(0);
    const texts = view.variants.map((variant) => variant.text);
    expect(texts).toContain(PRIMARY_VARIANTS[0]);
    for (const claim of view.claims) {
      expect(claim.status).not.toBe("UNSUPPORTED");
    }
  }, 60_000);
});
