import type { Session } from "../domain/auth";

export type CreateSessionInput = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
};

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<Session>;

  findByTokenHash(tokenHash: string): Promise<Session | null>;

  deleteById(id: string): Promise<void>;

  deleteByUserId(userId: string): Promise<void>;
}