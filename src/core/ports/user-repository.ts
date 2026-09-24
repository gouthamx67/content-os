import type { User } from "../domain/auth";

export type CreateUserInput = {
  id: string;
  email: string;
  passwordHash: string;
};

export interface UserRepository {
  create(input: CreateUserInput): Promise<User>;

  getById(id: string): Promise<User | null>;

  findByEmail(email: string): Promise<User | null>;
}