import type { PublicOrm } from "../../prisma/db";
import type { Session } from "../../core/domain/auth";
import type {
  CreateSessionInput,
  SessionRepository,
} from "../../core/ports/session-repository";
import { pgTimestampToIso } from "../../lib/time";

function mapSession(row: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}): Session {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: pgTimestampToIso(row.expiresAt),
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

export class PostgresSessionRepository
  implements SessionRepository
{
  constructor(private readonly orm: PublicOrm) {}

  async create(input: CreateSessionInput): Promise<Session> {
    const row = await this.orm.Session.create({
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });

    return mapSession(row);
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<Session | null> {
    const row = await this.orm.Session.where(
      (session) => session.tokenHash.eq(tokenHash),
    ).first();

    if (!row) {
      return null;
    }

    return mapSession(row);
  }

  async deleteById(id: string): Promise<void> {
    await this.orm.Session.where({ id }).delete();
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.orm.Session.where(
      (session) => session.userId.eq(userId),
    ).delete();
  }
}