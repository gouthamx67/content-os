import type { SourceRepository } from "./source-repository";

export interface SourceStorageTransaction {
  readonly sources: SourceRepository;

  withStorageKeyLock<T>(
    storageKey: string,
    work: (sources: SourceRepository) => Promise<T>,
  ): Promise<T>;
}

export interface SourceStorageCoordinator {
  withSourceStorageLock<T>(
    sourceId: string,
    work: (transaction: SourceStorageTransaction) => Promise<T>,
  ): Promise<T>;
}
