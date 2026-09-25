import { db } from "../../prisma/db";
import type {
  SourceStorageCoordinator,
  SourceStorageTransaction,
} from "../../core/ports/source-storage-coordinator";
import { PostgresSourceRepository } from "./postgres-source-repository";

function lockTimeoutPlan() {
  return db.raw.sql`SET LOCAL lock_timeout = '5s'`.affectedCount().build();
}

function advisoryLockPlan(lockKey: string) {
  return db.raw.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS acquired
  `
    .returnsRow({ acquired: "pg/bool@1" })
    .build();
}

export class PostgresSourceStorageCoordinator implements SourceStorageCoordinator {
  async withSourceStorageLock<T>(
    sourceId: string,
    work: (transaction: SourceStorageTransaction) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(lockTimeoutPlan());
      await tx.query(advisoryLockPlan(`content-os/source-lock/v1/${sourceId}`));

      const sources = new PostgresSourceRepository(tx.orm.public);
      const transaction: SourceStorageTransaction = {
        sources,
        withStorageKeyLock: async (storageKey, nestedWork) => {
          await tx.query(advisoryLockPlan(`content-os/storage-lock/v1/${storageKey}`));
          return nestedWork(sources);
        },
      };

      return work(transaction);
    });
  }
}
