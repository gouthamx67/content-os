import type { UserRepository } from "./user-repository";
import type { SessionRepository } from "./session-repository";
import type { WorkspaceRepository } from "./workspace-repository";

export type TransactionContext = {
  users: UserRepository;
  sessions: SessionRepository;
  workspaces: WorkspaceRepository;
};

export interface DatabasePort {
  transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
  ): Promise<T>;
}