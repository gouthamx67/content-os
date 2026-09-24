import { db } from "../../prisma/db";
import type {
  DatabasePort,
  TransactionContext,
} from "../../core/ports/database";
import { PostgresUserRepository } from "./postgres-user-repository";
import { PostgresSessionRepository } from "./postgres-session-repository";
import { PostgresWorkspaceRepository } from "./postgres-workspace-repository";

export class PostgresDatabase implements DatabasePort {
  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      const orm = tx.orm.public;

      const context: TransactionContext = {
        users: new PostgresUserRepository(orm),
        sessions: new PostgresSessionRepository(orm),
        workspaces: new PostgresWorkspaceRepository(orm),
      };

      return work(context);
    });
  }
}

export const postgresDatabase = new PostgresDatabase();