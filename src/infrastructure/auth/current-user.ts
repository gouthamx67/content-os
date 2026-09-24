import { cookies } from "next/headers";
import { authService } from "../services";
import { sessionCookieName } from "./cookies";
import type { PublicUser } from "../../core/domain/auth";

export async function getCurrentUser(): Promise<PublicUser | null> {
  const store = await cookies();

  const token = store.get(sessionCookieName())?.value;

  if (!token) {
    return null;
  }

  const session = await authService.currentSession(token);

  return session?.user ?? null;
}