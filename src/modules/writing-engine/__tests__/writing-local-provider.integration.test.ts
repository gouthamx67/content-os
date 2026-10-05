import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { WRITING_BLOCK_TYPES } from "../domain/types";

let orm: Orm;
let services: Services;
let project: FullProjectContext;
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
  project = await createFullProject(services);
  worker = makeWorker({ services });
  await drain();
});

afterAll(async () => {
  await cleanupUser(orm, project.owner, project.projectId);
});

describe("writing local provider", () => {
  it("exposes only the configured providers", () => {
    expect(services.writingProviderRegistry.providers).toContain("LOCAL_RULES");
    expect(
      services.writingProviderRegistry.resolve("LOCAL_RULES").id,
    ).toBe("LOCAL_RULES");
  });

  it("refuses an unconfigured remote provider with a 409", async () => {
    await expect(
      services.writingGenerationService.enqueue({
        projectId: project.projectId,
        requestedById: project.owner.user.id,
        blockType: "HEADLINE",
        tone: "BRAND",
        length: "MEDIUM",
        objective: "AWARENESS",
        prompt: "Remote please",
        provider: "REMOTE_LLM",
      }),
    ).rejects.toMatchObject({ status: 409, code: "WRITING_PROVIDER_UNAVAILABLE" });
  });

  it("grounds every block type", async () => {
    for (const blockType of WRITING_BLOCK_TYPES) {
      const job = await services.writingGenerationService.enqueue({
        projectId: project.projectId,
        requestedById: project.owner.user.id,
        blockType,
        tone: "PROFESSIONAL",
        length: "MEDIUM",
        objective: "PRODUCT_EXPLANATION",
        prompt: `Write a ${blockType.toLowerCase()}`,
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
      expect(record.status, `${blockType} failed: ${record.errorCode}`).toBe(
        "SUCCEEDED",
      );
      expect(record.documentId).toBeTruthy();

      const view = await services.writingGenerationService.getDocument({
        projectId: project.projectId,
        documentId: record.documentId!,
        userId: project.owner.user.id,
      });
      expect(view.document.blockType).toBe(blockType);
      expect(view.variants.length).toBeGreaterThan(0);
      for (const claim of view.claims) {
        expect(claim.status).not.toBe("UNSUPPORTED");
      }
    }
  });
});
