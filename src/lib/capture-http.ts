import { NextResponse } from "next/server";
import { HttpError } from "./http";
import { CaptureValidationError } from "../modules/capture-engine/capture-validation";
import { CaptureTransitionError } from "../modules/capture-engine/session-state";

/**
 * One error shape for every capture route.
 *
 * Shared rather than repeated per route so a capture failure reads the same
 * whether it came from the session endpoint or a take action — and so a new route
 * cannot accidentally answer with a bare 500 for a 400 the user can fix.
 *
 * Capture errors carry their own status because they describe the request, not
 * the server: a take on a draft session or a MIME type we do not accept is a bad
 * request, and saying "something went wrong" would hide the one thing the user
 * could change.
 */
export function captureErrorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }

  if (error instanceof CaptureValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof CaptureTransitionError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof Error && error.name === "CaptureError") {
    const status = (error as { status?: number }).status ?? 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
