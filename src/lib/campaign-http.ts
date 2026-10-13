import { HttpError } from "./http";
import { CampaignError } from "../modules/campaign-engine/errors";

/**
 * One error shape for every campaign route.
 *
 * Campaign errors carry their own HTTP status; everything else is either the
 * caller's session (401) or an unexpected server failure (500).
 */
export function campaignErrorResponse(error: unknown): Response {
  if (error instanceof CampaignError) {
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

export function optionalRevisionNumber(
  body: Record<string, unknown>,
): number | undefined {
  const value = body["expectedRevisionNumber"];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "expectedRevisionNumber must be a positive integer");
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
