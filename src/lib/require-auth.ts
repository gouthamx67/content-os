import { authService } from "../infrastructure/services";
import { readSessionToken } from "../infrastructure/auth/cookies";
import type { PublicUser } from "../core/domain/auth";
import { HttpError } from "./http";

export type AuthenticatedRequest = {
  user: PublicUser;
};

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedRequest | null> {
  const token = readSessionToken(request);

  const session = await authService.currentSession(token);

  if (!session) {
    return null;
  }

  return { user: session.user };
}

export async function requireUser(
  request: Request,
): Promise<AuthenticatedRequest> {
  const authenticated = await authenticateRequest(request);

  if (!authenticated) {
    throw new HttpError(401, "Authentication required");
  }

  return authenticated;
}