import type { PublicOrm } from "../../prisma/db";
import type { User } from "../../core/domain/auth";
import type {
  CreateUserInput,
  UserRepository,
} from "../../core/ports/user-repository";
import { pgTimestampToIso } from "../../lib/time";

function mapUser(row: {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

export class PostgresUserRepository
  implements UserRepository
{
  constructor(private readonly orm: PublicOrm) {}

  async create(input: CreateUserInput): Promise<User> {
    const row = await this.orm.User.create({
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
    });

    return mapUser(row);
  }

  async getById(id: string): Promise<User | null> {
    const row = await this.orm.User.first({ id });

    if (!row) {
      return null;
    }

    return mapUser(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.orm.User.where(
      (user) => user.email.eq(email),
    ).first();

    if (!row) {
      return null;
    }

    return mapUser(row);
  }
}