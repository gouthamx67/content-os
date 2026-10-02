import { NextResponse } from "next/server";
import { HttpError } from "./http";
import { VisualValidationError } from "../modules/visual-motion-engine/domain/validation";

/**
 * One error shape for every visual route.
 *
 * A visual failure is usually the caller's: an unknown enum, an asset from
 * another project, a keyframe past the end of the composition. Reusing the
 * status already on the error keeps that fixable message on the wire instead of
 * collapsing it into a generic 500.
 */
export function visualErrorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof VisualValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof Error && error.name === "VisualValidationError") {
    const status = (error as { status?: number }).status ?? 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
