import { createHash } from "node:crypto";
import { createInputBundle } from "../domain/input-bundle";
import {
  DEFAULT_INPUT_LIMITS,
  INPUT_KIND_TO_SOURCE_TYPE,
  InputError,
  type InputBundle,
  type InputLimits,
  type JsonObject,
  type JsonValue,
  type NormalizedInput,
} from "../domain/input";
import type { InputProvider } from "../domain/input-provider";
import { normalizeBatch, type RawInput } from "../domain/input-normalizer";
import type { SourceRepository } from "../ports/source-repository";
import type { SourceStorageCoordinator } from "../ports/source-storage-coordinator";
import type { StorageProvider } from "../ports/storage-provider";
import { createId } from "../../lib/id";
import type { ProjectService } from "./project-service";

export interface InputServiceDependencies {
  projectService: Pick<ProjectService, "getAuthorized">;
  sourceRepository: SourceRepository;
  storageCoordinator: SourceStorageCoordinator;
  storageProvider: Pick<StorageProvider, "put" | "delete">;
  inputProvider: InputProvider;
  limits?: InputLimits;
}

function inputUri(input: NormalizedInput): string | null {
  return input.origin === "url" || input.origin === "repository" ? input.value : null;
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}

function baseMetadata(input: NormalizedInput): JsonObject {
  if (input.origin === "clipboard") {
    return { origin: input.origin, encoding: "utf-8", characters: input.value.length };
  }
  if (input.origin === "upload") {
    return {
      origin: input.origin,
      originalName: input.file.name,
      ...(input.file.relativePath ? { relativePath: input.file.relativePath } : {}),
      ...(input.file.lastModified === undefined ? {} : { lastModified: input.file.lastModified }),
    };
  }
  if (input.origin === "folder") {
    return {
      origin: input.origin,
      fileCount: input.files.length,
      sizeBytes: input.files.reduce((total, file) => total + file.bytes.byteLength, 0),
    };
  }
  return { origin: input.origin };
}

function fallbackError(input: NormalizedInput): InputError {
  if (input.origin === "url") return new InputError("URL_BLOCKED", "URL could not be acquired safely");
  if (input.origin === "repository") {
    return new InputError("REPOSITORY_UNAVAILABLE", "Repository could not be acquired");
  }
  return new InputError("INVALID_FILE", "Input could not be validated");
}

function toInputError(error: unknown, input: NormalizedInput): InputError {
  if (error instanceof InputError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new InputError("URL_TIMEOUT", "Input acquisition timed out");
  }
  return fallbackError(input);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const MAX_BATCH_DURATION_MS = 60_000;

export class InputService {
  private readonly limits: InputLimits;

  constructor(private readonly dependencies: InputServiceDependencies) {
    this.limits = dependencies.limits ?? DEFAULT_INPUT_LIMITS;
  }

  async createBatch(
    projectId: string,
    userId: string,
    rawInputs: readonly RawInput[],
    signal?: AbortSignal,
  ): Promise<InputBundle> {
    await this.dependencies.projectService.getAuthorized(projectId, userId);
    const inputs = normalizeBatch(rawInputs, this.limits);
    const batchController = new AbortController();
    const batchTimer = setTimeout(() => batchController.abort(), MAX_BATCH_DURATION_MS);
    const batchSignal = signal ? AbortSignal.any([signal, batchController.signal]) : batchController.signal;

    try {
      for (const input of inputs) {
        await this.ingest(projectId, input, batchSignal);
      }
    } finally {
      clearTimeout(batchTimer);
    }
    return this.getAuthorizedBundle(projectId);
  }

  async authorize(projectId: string, userId: string): Promise<void> {
    await this.dependencies.projectService.getAuthorized(projectId, userId);
  }

  async getBundle(projectId: string, userId: string): Promise<InputBundle> {
    await this.dependencies.projectService.getAuthorized(projectId, userId);
    return this.getAuthorizedBundle(projectId);
  }

  async getInput(projectId: string, userId: string, sourceId: string) {
    await this.dependencies.projectService.getAuthorized(projectId, userId);
    const source = await this.dependencies.sourceRepository.getById(sourceId);
    if (!source || source.projectId !== projectId) {
      throw new InputError("INPUT_NOT_FOUND", "Input not found");
    }
    return source;
  }

  async deleteInput(projectId: string, userId: string, sourceId: string): Promise<void> {
    await this.dependencies.projectService.getAuthorized(projectId, userId);

    await this.dependencies.storageCoordinator.withSourceStorageLock(
      sourceId,
      async ({ sources, withStorageKeyLock }) => {
        const source = await sources.getById(sourceId);
        if (!source || source.projectId !== projectId) {
          throw new InputError("INPUT_NOT_FOUND", "Input not found");
        }

        if (!source.storageKey) {
          await sources.deleteById(sourceId);
          return;
        }

        await withStorageKeyLock(source.storageKey, async (lockedSources) => {
          const current = await lockedSources.getById(sourceId);
          if (!current || current.projectId !== projectId) {
            throw new InputError("INPUT_NOT_FOUND", "Input not found");
          }
          if (!current.storageKey) {
            await lockedSources.deleteById(sourceId);
            return;
          }

          const storageKey = current.storageKey;
          await lockedSources.deleteById(sourceId);
          if ((await lockedSources.countByStorageKey(storageKey)) === 0) {
            try {
              await this.dependencies.storageProvider.delete(storageKey);
            } catch {
              throw new InputError("STORAGE_FAILED", "Stored input could not be deleted");
            }
          }
        });
      },
    );
  }

  private async getAuthorizedBundle(projectId: string): Promise<InputBundle> {
    const sources = await this.dependencies.sourceRepository.listByProject(projectId);
    return createInputBundle(projectId, sources);
  }

  private async cleanupUnreferencedStorage(sourceId: string, storageKey: string): Promise<void> {
    await this.dependencies.storageCoordinator.withSourceStorageLock(
      sourceId,
      async ({ withStorageKeyLock }) => {
        await withStorageKeyLock(storageKey, async (sources) => {
          if ((await sources.countByStorageKey(storageKey)) === 0) {
            try {
              await this.dependencies.storageProvider.delete(storageKey);
            } catch {
              throw new InputError("STORAGE_FAILED", "Stored input could not be deleted");
            }
          }
        });
      },
    );
  }

  private async ingest(projectId: string, input: NormalizedInput, signal?: AbortSignal): Promise<void> {
    const source = await this.dependencies.sourceRepository.create({
      id: createId("source"),
      projectId,
      type: INPUT_KIND_TO_SOURCE_TYPE[input.kind],
      name: input.name,
      uri: inputUri(input),
      metadata: stableJson(baseMetadata(input)),
      status: "QUEUED",
      mimeType: null,
      sizeBytes: null,
      contentHash: null,
      storageKey: null,
      errorCode: null,
      errorMessage: null,
    });
    let attemptedStorageKey: string | null = null;

    try {
      const processing = await this.dependencies.sourceRepository.update(source.id, {
        status: "PROCESSING",
        errorCode: null,
        errorMessage: null,
      });
      if (!processing) throw new InputError("INPUT_NOT_FOUND", "Input disappeared during ingestion");

      if (input.origin === "url" && input.kind === "figma") {
        await this.dependencies.storageCoordinator.withSourceStorageLock(
          source.id,
          async ({ sources }) => {
            const current = await sources.getById(source.id);
            if (!current) throw new InputError("INPUT_NOT_FOUND", "Input disappeared during ingestion");
            const updated = await sources.update(source.id, {
              status: "READY",
              metadata: stableJson({ ...baseMetadata(input), processing: "reference_only" }),
            });
            if (!updated) throw new InputError("INPUT_NOT_FOUND", "Input disappeared during ingestion");
          },
        );
        return;
      }

      const acquired =
        input.origin === "clipboard"
          ? {
              kind: input.kind,
              name: input.name,
              mimeType: "text/plain; charset=utf-8",
              bytes: new TextEncoder().encode(input.value),
              metadata: {},
            }
          : await this.dependencies.inputProvider.acquire(input, this.limits, signal);
      const contentHash = sha256(acquired.bytes);
      const storageKey = `projects/${projectId}/inputs/${contentHash}/original`;

      await this.dependencies.storageCoordinator.withSourceStorageLock(
        source.id,
        async ({ sources, withStorageKeyLock }) => {
          const current = await sources.getById(source.id);
          if (!current) throw new InputError("INPUT_NOT_FOUND", "Input disappeared during ingestion");

          await withStorageKeyLock(storageKey, async (lockedSources) => {
            const duplicate = await lockedSources.findByContentHash(projectId, contentHash);
            if (duplicate?.storageKey && duplicate.storageKey !== storageKey) {
              throw new InputError("STORAGE_FAILED", "Stored input has an invalid storage key");
            }
            attemptedStorageKey = storageKey;
            try {
              await this.dependencies.storageProvider.put(storageKey, acquired.bytes, acquired.mimeType);
            } catch {
              throw new InputError("STORAGE_FAILED", "Input could not be stored");
            }

            const updated = await lockedSources.update(source.id, {
              name: acquired.name,
              status: "READY",
              mimeType: acquired.mimeType,
              sizeBytes: acquired.bytes.byteLength,
              contentHash,
              storageKey,
              metadata: stableJson({ ...baseMetadata(input), ...acquired.metadata }),
              errorCode: null,
              errorMessage: null,
            });
            if (!updated) throw new InputError("INPUT_NOT_FOUND", "Input disappeared during ingestion");
          });
        },
      );
      attemptedStorageKey = null;
    } catch (error) {
      if (attemptedStorageKey) {
        try {
          await this.cleanupUnreferencedStorage(source.id, attemptedStorageKey);
        } catch (cleanupError) {
          console.error("Failed to clean up input storage", cleanupError);
        }
      }
      const failure = toInputError(error, input);
      try {
        await this.dependencies.sourceRepository.update(source.id, {
          status: "FAILED",
          errorCode: failure.code,
          errorMessage: failure.message.slice(0, 1_000),
        });
      } catch (failureUpdateError) {
        console.error("Failed to persist input failure", failureUpdateError);
      }
    }
  }
}
