import { describe, expect, it } from "vitest";
import { ContentIntentError, type ContentIntent } from "../domain/content-intent";
import type { BrandProfile } from "../domain/brand";
import type { BrandRepository } from "../ports/brand-repository";
import type { ContentIntentRepository } from "../ports/content-intent-repository";
import type { ContentIntentInterpretationProvider } from "../ports/content-intent-interpreter";
import type { IntelligenceRepository } from "../ports/intelligence-repository";
import { createId } from "../../lib/id";
import { ContentIntentService } from "./content-intent-service";
import { ContentIntentValidator } from "./content-intent-validator";

const PROJECT_ID = "project-1";
const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

class InMemoryIntentRepository implements ContentIntentRepository {
  rows = new Map<string, ContentIntent>();

  async create(intent: ContentIntent): Promise<ContentIntent> {
    const stored: ContentIntent = { ...intent, id: intent.id || createId("intent") };
    this.rows.set(stored.id, stored);
    return stored;
  }

  async getById(id: string): Promise<ContentIntent | null> {
    return this.rows.get(id) ?? null;
  }

  async listForProject(projectId: string): Promise<ContentIntent[]> {
    return [...this.rows.values()].filter((row) => row.projectId === projectId);
  }

  async update(intent: ContentIntent): Promise<ContentIntent> {
    this.rows.set(intent.id, intent);
    return intent;
  }
}

class FakeProjectService {
  authorized: string[] = [];
  denied = new Set<string>();

  getAuthorized = async (projectId: string, userId: string) => {
    this.authorized.push(`${projectId}:${userId}`);
    if (this.denied.has(projectId)) {
      throw new ContentIntentError(
        "INTENT_FORBIDDEN",
        "You do not have access to this project",
      );
    }
    return { id: projectId } as never;
  };
}

function brandWithTone(tone: string): BrandProfile {
  return {
    projectId: PROJECT_ID,
    version: 3,
    voiceSignals: [{ kind: "TONE", value: tone, source: "USER_INPUT" }],
  } as unknown as BrandProfile;
}

function intelligenceWithFeature(): Partial<IntelligenceRepository> {
  return {
    latestSnapshot: async () => ({ version: 12 }) as never,
    listFeatures: async () => [
      { id: "feature-analytics", name: "Analytics" },
      { id: "feature-sso", name: "SSO" },
    ] as never,
    listWorkflows: async () => [
      { id: "workflow-onboarding", name: "Onboarding" },
    ] as never,
  };
}

function buildService(options: {
  brand?: Partial<BrandRepository>;
  intelligence?: Partial<IntelligenceRepository>;
  interpretationProvider?: ContentIntentInterpretationProvider | null;
  denied?: boolean;
} = {}) {
  const repository = new InMemoryIntentRepository();
  const projectService = new FakeProjectService();
  if (options.denied) projectService.denied.add(PROJECT_ID);

  const service = new ContentIntentService({
    projectService,
    repository,
    validator: new ContentIntentValidator(),
    brand: options.brand as never,
    intelligence: options.intelligence as never,
    interpretationProvider: options.interpretationProvider ?? null,
  });

  return { service, repository, projectService };
}

describe("ContentIntentService.resolve", () => {
  it("persists a validated intent and returns no clarifications when it is complete", async () => {
    const { service, repository } = buildService();

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second cinematic launch video for LinkedIn",
    });

    expect(result.intent.id).not.toBe("");
    expect(result.intent.contentTypeId).toBe("video.launch");
    expect(result.intent.status).toBe("RESOLVED");
    expect(result.clarifications).toEqual([]);
    expect(result.aiApplied).toBe(false);
    expect(await repository.listForProject(PROJECT_ID)).toHaveLength(1);
  });

  it("asks what is missing instead of inventing an output", async () => {
    const { service } = buildService();

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make something for this.",
    });

    expect(result.intent.status).toBe("NEEDS_CLARIFICATION");
    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0].field).toBe("contentType");
    expect(result.clarifications[0].options?.length).toBeGreaterThan(0);
  });

  it("asks for a destination and a duration when a video is missing both", async () => {
    const { service } = buildService();

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a launch video",
    });

    const fields = result.clarifications.map((entry) => entry.field);
    expect(fields).toContain("duration");
    expect(fields).not.toContain("contentType");
  });

  it("does not ask for a platform a video can live without", async () => {
    const { service } = buildService();

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second launch video",
    });

    expect(result.clarifications.map((entry) => entry.field)).not.toContain(
      "platform",
    );
  });

  it("refuses a request whose content type cannot carry what was asked for", async () => {
    const { service, repository } = buildService();

    await expect(
      service.resolve({
        projectId: PROJECT_ID,
        userId: USER_ID,
        request: "Make a 30 second thumbnail",
      }),
    ).rejects.toMatchObject({ code: "INTENT_VALIDATION_FAILED" });

    expect(await repository.listForProject(PROJECT_ID)).toHaveLength(0);
  });

  it("refuses an empty request", async () => {
    const { service } = buildService();

    await expect(
      service.resolve({ projectId: PROJECT_ID, userId: USER_ID, request: "   " }),
    ).rejects.toMatchObject({ code: "INTENT_REQUEST_EMPTY" });
  });

  it("reads the brand tone without asking the user for one", async () => {
    const { service } = buildService({
      brand: { getByProjectId: async () => brandWithTone("Confident") },
    });

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a launch video",
    });

    expect(result.intent.tone).toBe("confident");
    expect(result.intent.brandVersion).toBe(3);
    expect(result.intent.constraints).toContainEqual({
      key: "tone",
      value: "confident",
      source: "BRAND",
    });
  });

  it("still resolves when the brand profile cannot be read", async () => {
    const { service } = buildService({
      brand: {
        getByProjectId: async () => {
          throw new Error("brand table missing");
        },
      },
    });

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a launch video",
    });

    expect(result.intent.status).toBe("RESOLVED");
    expect(result.intent.tone).toBeUndefined();
  });

  it("links a subject mention to a real intelligence entity", async () => {
    const { service } = buildService({
      intelligence: intelligenceWithFeature(),
    });

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Create 5 TikTok concepts about the analytics feature",
    });

    expect(result.intent.subjects).toEqual([
      { type: "FEATURE", id: "feature-analytics" },
    ]);
    expect(result.intent.intelligenceSnapshotVersion).toBe(12);
    expect(result.intent.unresolvedFields).not.toContain("subjects");
  });

  it("leaves a mention unresolved instead of guessing which entity it meant", async () => {
    const { service } = buildService({ intelligence: intelligenceWithFeature() });

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Create 5 TikTok concepts about the reporting feature",
    });

    expect(result.intent.subjects).toEqual([]);
    expect(result.intent.unresolvedFields).toContain("subjects");
  });

  it("does not read the brand for a request that already stated a tone and a style", async () => {
    // Counting the read is the point: a brand read that is then ignored is a
    // query spent for nothing, and a throwing read cannot prove it was skipped.
    let brandReads = 0;
    const { service } = buildService({
      brand: {
        getByProjectId: async () => {
          brandReads += 1;
          return brandWithTone("Confident");
        },
      },
    });

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second confident cinematic launch video for LinkedIn",
    });

    expect(result.intent.status).toBe("RESOLVED");
    expect(result.intent.tone).toBe("confident");
    expect(brandReads).toBe(0);
  });

  it("reads the brand for a request that left a tone to the brand", async () => {
    let brandReads = 0;
    const { service } = buildService({
      brand: {
        getByProjectId: async () => {
          brandReads += 1;
          return brandWithTone("Confident");
        },
      },
    });

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second launch video for LinkedIn",
    });

    expect(brandReads).toBe(1);
    const tone = result.intent.constraints.find(
      (constraint) => constraint.key === "tone",
    );
    expect(tone?.source).toBe("BRAND");
  });

  it("uses the model to close a gap the rules could not", async () => {
    let calls = 0;
    const { service } = buildService({
      interpretationProvider: {
        id: "fake",
        interpret: async () => {
          calls += 1;
          return {
            contentTypeId: "video.explainer",
            purpose: "education",
            platforms: ["youtube"],
            durationSeconds: 90,
            aspectRatio: "16:9",
            language: "en",
            tone: "informative",
            style: undefined,
            quantity: 1,
            provider: "fake",
            model: "fake-model",
            notes: ["Read as an educational explainer"],
          };
        },
      },
    });

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make something for this.",
    });

    expect(calls).toBe(1);
    expect(result.aiApplied).toBe(true);
    expect(result.aiErrorCode).toBeNull();
    expect(result.intent.contentTypeId).toBe("video.explainer");
    expect(result.intent.resolutionMode).toBe("INFERRED");
    expect(result.intent.notes).toContain("Read as an educational explainer");
    expect(result.clarifications).toEqual([]);
  });

  it("keeps the deterministic result when the model fails", async () => {
    const { service } = buildService({
      interpretationProvider: {
        id: "fake",
        interpret: async () => {
          throw new ContentIntentError(
            "INTENT_AI_INVALID_OUTPUT",
            "unparseable",
          );
        },
      },
    });

    const result = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make something for this.",
    });

    expect(result.aiApplied).toBe(false);
    expect(result.aiErrorCode).toBe("INTENT_AI_INVALID_OUTPUT");
    expect(result.intent.status).toBe("NEEDS_CLARIFICATION");
    expect(result.intent.contentTypeId).toBe("");
    expect(result.notes.join(" ")).toContain("deterministic result");
  });

  it("does not call the model for a request the rules fully understood", async () => {
    let calls = 0;
    const { service } = buildService({
      interpretationProvider: {
        id: "fake",
        interpret: async () => {
          calls += 1;
          throw new Error("should not be called");
        },
      },
    });

    await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second 16:9 launch video for LinkedIn",
    });

    expect(calls).toBe(0);
  });

  it("refuses to resolve for a user who cannot see the project", async () => {
    const { service } = buildService({ denied: true });

    await expect(
      service.resolve({
        projectId: PROJECT_ID,
        userId: OTHER_USER_ID,
        request: "Make a launch video",
      }),
    ).rejects.toMatchObject({ code: "INTENT_FORBIDDEN" });
  });
});

describe("ContentIntentService access", () => {
  it("returns an intent to its own project and hides it from another project", async () => {
    const { service } = buildService();
    const created = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second launch video for LinkedIn",
    });

    const found = await service.get(PROJECT_ID, created.intent.id, USER_ID);
    expect(found.intent.id).toBe(created.intent.id);

    await expect(service.get("project-2", created.intent.id, USER_ID)).rejects.toMatchObject(
      { code: "INTENT_NOT_FOUND" },
    );
  });

  it("checks access before revealing whether an intent exists", async () => {
    const { service, projectService } = buildService();
    projectService.denied.add("project-2");
    const created = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second launch video for LinkedIn",
    });

    // project-2 does not exist for this user at all, so the answer is "no
    // access" whether or not the intent id is real.
    await expect(
      service.get("project-2", created.intent.id, USER_ID),
    ).rejects.toMatchObject({ code: "INTENT_FORBIDDEN" });
    await expect(
      service.get("project-2", "intent-does-not-exist", USER_ID),
    ).rejects.toMatchObject({ code: "INTENT_FORBIDDEN" });

    expect(projectService.authorized).toContain(`project-2:${USER_ID}`);
  });

  it("lists only the project's own intents", async () => {
    const { service, repository } = buildService();
    await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second launch video for LinkedIn",
    });
    repository.rows.set("foreign", {
      ...(await repository.listForProject(PROJECT_ID))[0],
      id: "foreign",
      projectId: "project-2",
    });

    const listed = await service.list(PROJECT_ID, USER_ID);
    expect(listed.map((entry) => entry.intent.id)).not.toContain("foreign");
  });
});

describe("ContentIntentService.update", () => {
  it("applies an edit and drops the clarifications it answered", async () => {
    const { service } = buildService();
    const draft = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make something for this.",
    });

    const updated = await service.update(
      PROJECT_ID,
      draft.intent.id,
      USER_ID,
      { contentTypeId: "video.social" },
    );

    expect(updated.intent.resolutionMode).toBe("EXPLICIT");
    expect(updated.intent.status).toBe("RESOLVED");
    expect(updated.clarifications.map((entry) => entry.field)).not.toContain(
      "contentType",
    );
  });

  it("records the edit as a user constraint", async () => {
    const { service } = buildService();
    const created = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 15 second TikTok video",
    });

    const updated = await service.update(
      PROJECT_ID,
      created.intent.id,
      USER_ID,
      { durationSeconds: 45 },
    );

    expect(updated.intent.constraints).toContainEqual({
      key: "duration",
      value: "45",
      source: "USER",
    });
    expect(
      updated.intent.constraints.filter(
        (entry) => entry.key === "duration" && entry.source === "USER",
      ),
    ).toHaveLength(1);
  });

  it("rejects an edit the content type cannot carry", async () => {
    const { service } = buildService();
    const created = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a thumbnail",
    });

    await expect(
      service.update(PROJECT_ID, created.intent.id, USER_ID, {
        durationSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: "INTENT_VALIDATION_FAILED" });
  });

  it("rejects an unsupported content type id instead of storing it", async () => {
    const { service } = buildService();
    const created = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second launch video",
    });

    await expect(
      service.update(PROJECT_ID, created.intent.id, USER_ID, {
        contentTypeId: "video.hologram",
      }),
    ).rejects.toMatchObject({ code: "INTENT_INVALID_INPUT" });
  });

  it("rejects an empty edit", async () => {
    const { service } = buildService();
    const created = await service.resolve({
      projectId: PROJECT_ID,
      userId: USER_ID,
      request: "Make a 30 second launch video",
    });

    await expect(
      service.update(PROJECT_ID, created.intent.id, USER_ID, {}),
    ).rejects.toMatchObject({ code: "INTENT_INVALID_INPUT" });
  });
});
