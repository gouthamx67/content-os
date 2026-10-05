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

describe("writing rewrite history", () => {
  it("appends a new variant without overwriting history", async () => {
    const job = await services.writingGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      blockType: "BODY",
      tone: "PROFESSIONAL",
      length: "LONG",
      objective: "PRODUCT_EXPLANATION",
      prompt: "Explain the product",
      variantCount: 3,
    });
    await drain();

    const jobRecord = await services.writingGenerationService.getJob({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    const before = await services.writingGenerationService.getDocument({
      projectId,
      documentId: jobRecord.documentId!,
      userId: owner.user.id,
    });

    const rewritten = await services.writingGenerationService.rewrite({
      projectId,
      documentId: before.document.id,
      instruction: "SHORTEN",
      userId: owner.user.id,
    });
    expect(rewritten.instruction).toBe("SHORTEN");
    expect(rewritten.selected).toBe(true);

    const after = await services.writingGenerationService.getDocument({
      projectId,
      documentId: before.document.id,
      userId: owner.user.id,
    });
    expect(after.variants.length).toBe(before.variants.length + 1);
    expect(after.document.version).toBe(before.document.version + 1);
    expect(after.document.selectedVariantId).toBe(rewritten.id);

    // Every original variant is still present, untouched.
    for (const original of before.variants) {
      const stillThere = after.variants.find((v) => v.id === original.id);
      expect(stillThere?.text).toBe(original.text);
    }
  });

  it("rejects an unsupported instruction", async () => {
    const documents = await services.writingGenerationService.listDocuments({
      projectId,
      userId: owner.user.id,
    });
    await expect(
      services.writingGenerationService.rewrite({
        projectId,
        documentId: documents[0]!.id,
        instruction: "YELL_LOUDER" as never,
        userId: owner.user.id,
      }),
    ).rejects.toMatchObject({ code: "WRITING_UNSUPPORTED_INSTRUCTION" });
  });
});
