import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createAnalyzedProject,
  loadWritingTestContext,
  makeWorker,
  type Orm,
  type Services,
} from "./helpers";
import type { WritingGenerationWorker } from "../writing-generation-worker";

let orm: Orm;
let services: Services;
let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let worker: WritingGenerationWorker;

async function drain(): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if (!(await worker.tick())) return;
  }
  throw new Error("writing queue did not drain");
}

beforeAll(async () => {
  const loaded = await loadWritingTestContext();
  orm = loaded.orm;
  services = loaded.services;
  const created = await createAnalyzedProject(services);
  owner = created.owner;
  projectId = created.projectId;
  worker = makeWorker({ services });
  await drain();
});

afterAll(async () => {
  await cleanupUser(orm, owner, projectId);
});

describe("writing brand voice", () => {
  it("never persists a variant that uses a brand-forbidden term", async () => {
    const job = await services.writingGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      blockType: "HEADLINE",
      tone: "BRAND",
      length: "MEDIUM",
      objective: "AWARENESS",
      prompt: "Announce our scheduling tool without hype",
      variantCount: 5,
    });
    await drain();

    const record = await services.writingGenerationService.getJob({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(record.status).toBe("SUCCEEDED");

    const view = await services.writingGenerationService.getDocument({
      projectId,
      documentId: record.documentId!,
      userId: owner.user.id,
    });
    const snapshot = JSON.parse(view.document.contextSnapshot) as {
      brand: { prohibitedTerms: string[] };
    };
    const forbidden = snapshot.brand.prohibitedTerms.filter(Boolean);
    expect(forbidden.length).toBeGreaterThan(0);

    for (const variant of view.variants) {
      for (const term of forbidden) {
        expect(variant.text.toLowerCase()).not.toContain(term.toLowerCase());
      }
    }
    expect(view.document.brandVersion).not.toBeNull();
  });
});
