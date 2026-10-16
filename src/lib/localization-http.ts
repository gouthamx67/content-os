import { HttpError } from "./http";
import { LocalizationError } from "../modules/localization-engine/errors";

/**
 * One error shape for every localization route.
 *
 * Localization errors carry their own HTTP status; everything else is either
 * the caller's session (401) or an unexpected server failure (500).
 */
export function localizationErrorResponse(error: unknown): Response {
  if (error instanceof LocalizationError) {
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

/**
 * Every optimistic write names the revision the client last saw. Requiring it
 * here stops a route from silently defaulting to the head and clobbering a
 * concurrent edit.
 */
export function requireRevisionNumber(body: Record<string, unknown>): number {
  const value = body["expectedRevisionNumber"];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "expectedRevisionNumber is required");
  }
  return value;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} is required`);
  }
  return value;
}

export function parsePage(searchParams: URLSearchParams): {
  limit: number;
  offset: number;
} {
  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new HttpError(400, "Invalid pagination");
  }
  return { limit, offset };
}
