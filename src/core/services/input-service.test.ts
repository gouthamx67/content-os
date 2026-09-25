import { describe, expect, it, vi } from "vitest";
import type { Project } from "../domain/project";
import type { SourceRepository } from "../ports/source-repository";
import type {
  SourceStorageCoordinator,
  SourceStorageTransaction,
} from "../ports/source-storage-coordinator";
import type { StorageProvider } from "../ports/storage-provider";
import { InputService } from "./input-service";
import { InputError } from "../domain/input-normalizer";
import type { InputProvider } from "../domain/input-provider";

const userId = "user-1";
const projectId = "project-1";
const fixedDate = new Date("2026-09-25T00:00:00.000Z");

const project: Project = {
  id: projectId,
  workspaceId: "workspace-1",
  name: "Demo",
  status: "created",
  createdAt: fixedDate.toISOString(),
  updatedAt: fixedDate.toISOString(),
  sources: [],
  assets: [],
};

class MemorySourceRepository implements SourceRepository {
  readonly records = new Map<
    string,
    Parameters<SourceRepository["create"]>[0] & { id: string; createdAt: string; updatedAt: string }
  >();

  async create(input: Parameters<SourceRepository["create"]>[0]) {
    const record = {
      ...input,
      id: input.id,
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
    };
    this.records.set(record.id, record);
    return record;
  }

  async update(id: string, changes: Parameters<SourceRepository["update"]>[1]) {
    const record = this.records.get(id);
    if (!record) return null;
    const updated = { ...record, ...changes, updatedAt: fixedDate.toISOString() };
    this.records.set(id, updated);
    return updated;
  }

  async getById(id: string) {
    return this.records.get(id) ?? null;
  }

  async listByProject(projectId: string) {
    return [...this.records.values()].filter((record) => record.projectId === projectId);
  }

  async deleteById(id: string) {
    this.records.delete(id);
  }

  async findByContentHash(projectId: string, contentHash: string) {
    return [...this.records.values()].find(
      (record) => record.projectId === projectId && record.contentHash === contentHash,
    ) ?? null;
  }

  async countByStorageKey(storageKey: string) {
    return [...this.records.values()].filter((record) => record.storageKey === storageKey).length;
  }
}

class MemorySourceStorageCoordinator implements SourceStorageCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly repository: SourceRepository) {}

  async withSourceStorageLock<T>(
    sourceId: string,
    work: (transaction: SourceStorageTransaction) => Promise<T>,
  ): Promise<T> {
    return this.withLock(`source:${sourceId}`, async () =>
      work({
        sources: this.repository,
        withStorageKeyLock: (storageKey, nestedWork) =>
          this.withLock(`storage:${storageKey}`, () => nestedWork(this.repository)),
      }),
    );
  }

  private async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}

function createService(
  repository = new MemorySourceRepository(),
  inputProvider: InputProvider = {
    acquire: vi.fn(async (input) => ({
      kind: input.kind,
      name: input.name,
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([1, 2, 3]),
      metadata: {},
    })),
  },
  storageProvider: Pick<StorageProvider, "put" | "delete"> = {
    put: vi.fn(async (key, data) => ({
      uri: `memory://${key}`,
      key,
      size: data.byteLength,
    })),
    delete: vi.fn(async () => undefined),
  },
  authorized = true,
  storageCoordinator = new MemorySourceStorageCoordinator(repository),
) {
  const getAuthorized = vi.fn(async () => {
    if (!authorized) throw new Error("unauthorized");
    return project;
  });

  return {
    repository,
    inputProvider,
    storageProvider,
    getAuthorized,
    service: new InputService({
      projectService: { getAuthorized },
      sourceRepository: repository,
      storageCoordinator,
      storageProvider,
      inputProvider,
    }),
  };
}

describe("InputService", () => {
  it("creates separate Source records while content-addressing duplicate text", async () => {
    const context = createService();

    const bundle = await context.service.createBatch(projectId, userId, [
      { type: "text", value: "same brief", name: "First" },
      { type: "text", value: "same brief", name: "Second" },
    ]);

    expect(bundle.inputs).toHaveLength(2);
    expect(bundle.inputs.map((input) => input.status)).toEqual(["READY", "READY"]);
    expect(bundle.inputs[0]?.contentHash).toBe(bundle.inputs[1]?.contentHash);
    expect(bundle.inputs[0]?.storageKey).toBe(bundle.inputs[1]?.storageKey);
    expect(bundle.versions).toHaveLength(1);
    expect(context.inputProvider.acquire).not.toHaveBeenCalled();
    expect(context.storageProvider.put).toHaveBeenCalledTimes(2);
    expect(JSON.parse(bundle.inputs[0]?.metadata ?? "{}")).toMatchObject({ origin: "clipboard" });
  });

  it("persists stable failed state without failing an entire mixed batch", async () => {
    const inputProvider: InputProvider = {
      acquire: vi.fn(async () => {
        throw new InputError("URL_TIMEOUT", "The URL timed out");
      }),
    };
    const context = createService(new MemorySourceRepository(), inputProvider);

    const bundle = await context.service.createBatch(projectId, userId, [
      { type: "url", value: "https://example.com", kind: "website" },
      { type: "text", value: "still accepted" },
    ]);

    expect(bundle.inputs.map((input) => input.status)).toEqual(["FAILED", "READY"]);
    expect(bundle.inputs[0]).toMatchObject({ errorCode: "URL_TIMEOUT", errorMessage: "The URL timed out" });
    expect(bundle.inputs[0]?.contentHash).toBeNull();
  });

  it("reuses one stored object across duplicate uploads and deletes it only after the last reference", async () => {
    const context = createService();
    const file = { name: "brief.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("brief") };

    const bundle = await context.service.createBatch(projectId, userId, [
      { type: "upload", file },
      { type: "upload", file: { ...file, name: "renamed.txt" } },
    ]);
    const storageKey = bundle.inputs[0]?.storageKey;
    const sourceIds = bundle.inputs.map((input) => input.id);

    expect(context.storageProvider.put).toHaveBeenCalledTimes(2);
    await context.service.deleteInput(projectId, userId, sourceIds[0]!);
    expect(context.storageProvider.delete).not.toHaveBeenCalled();
    await context.service.deleteInput(projectId, userId, sourceIds[1]!);
    expect(context.storageProvider.delete).toHaveBeenCalledWith(storageKey);
  });

  it("authorizes before acquiring or persisting any input", async () => {
    const context = createService(new MemorySourceRepository(), undefined, undefined, false);

    await expect(
      context.service.createBatch(projectId, userId, [{ type: "upload", file: { name: "a.txt", mimeType: "text/plain", bytes: new Uint8Array([1]) } }]),
    ).rejects.toThrowError("unauthorized");
    expect(context.getAuthorized).toHaveBeenCalledWith(projectId, userId);
    expect(context.inputProvider.acquire).not.toHaveBeenCalled();
    expect(context.repository.records.size).toBe(0);
  });

  it("keeps Figma URL references available without pretending to process the design", async () => {
    const context = createService();

    const bundle = await context.service.createBatch(projectId, userId, [
      { type: "url", value: "https://www.figma.com/design/abc/My-file", kind: "figma" },
    ]);

    expect(bundle.inputs[0]).toMatchObject({
      type: "FIGMA",
      status: "READY",
      uri: "https://www.figma.com/design/abc/My-file",
      contentHash: null,
      storageKey: null,
    });
    expect(context.inputProvider.acquire).not.toHaveBeenCalled();
  });
});
