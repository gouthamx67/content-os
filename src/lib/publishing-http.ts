import { HttpError } from "./http";
import { PublishingError } from "../modules/publishing-engine/errors";

/**
 * One error shape for every publishing route.
 *
 * Publishing errors carry their own HTTP status and code; everything else is
 * either the caller's session (401) or an unexpected server failure (500).
 */
export function publishingErrorResponse(error: unknown): Response {
  if (error instanceof PublishingError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...error.extras,
      },
      { status: error.status },
    );
  }

  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json({ error: "Request failed" }, { status: 500 });
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required`);
  }
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`);
  }
  return value;
}

export const PUBLISHING_STATE_COOKIE = "publishing_oauth_state";

/** Matches the service's state TTL so the cookie cannot outlive its state. */
export function publishStateMaxAgeSeconds(): number {
  return 600;
}

/**
 * The OAuth state cookie is scoped to the project's own publishing routes, so
 * a callback handler for another project cannot read it, and it expires with
 * the state itself.
 */
export function serializeStateCookie(
  value: string,
  projectId: string,
  maxAgeSeconds: number,
): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${PUBLISHING_STATE_COOKIE}=${value}; Path=/api/projects/${projectId}/publishing; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function readStateCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const entry = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PUBLISHING_STATE_COOKIE}=`));
  if (!entry) return null;
  return entry.slice(PUBLISHING_STATE_COOKIE.length + 1);
}

export function clearStateCookie(projectId: string): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${PUBLISHING_STATE_COOKIE}=; Path=/api/projects/${projectId}/publishing; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
