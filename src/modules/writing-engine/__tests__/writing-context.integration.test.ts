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

describe("writing context", () => {
  it("folds intent, direction and scene into the frozen context", async () => {
    const job = await services.writingGenerationService.enqueue({
      projectId: project.projectId,
      requestedById: project.owner.user.id,
      blockType: "SCRIPT",
      tone: "CONVERSATIONAL",
      length: "MEDIUM",
      objective: "CONVERSION",
      prompt: "Write the launch script",
      variantCount: 3,
      intentId: project.intentId,
      directionId: project.directionId,
      storyboardId: project.storyboardId,
      sceneId: project.sceneId,
    });
    await drain();

    const record = await services.writingGenerationService.getJob({
      projectId: project.projectId,
      jobId: job.id,
      userId: project.owner.user.id,
    });
    const snapshot = JSON.parse(record.contextSnapshot) as {
      facts: unknown[];
      sourceIds: string[];
      intent: { id: string } | null;
      direction: { id: string } | null;
      scene: { sceneId: string } | null;
    };

    expect(snapshot.facts.length).toBeGreaterThan(0);
    expect(snapshot.intent?.id).toBe(project.intentId);
    expect(snapshot.direction?.id).toBe(project.directionId);
    expect(snapshot.scene?.sceneId).toBe(project.sceneId);

    const view = await services.writingGenerationService.getDocument({
      projectId: project.projectId,
      documentId: record.documentId!,
      userId: project.owner.user.id,
    });
    expect(view.document.intentId).toBe(project.intentId);
    expect(view.document.directionId).toBe(project.directionId);
    expect(view.document.sceneId).toBe(project.sceneId);
  });
});
