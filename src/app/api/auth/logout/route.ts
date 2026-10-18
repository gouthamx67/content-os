import { NextResponse } from "next/server";
import { authService } from "../../../../infrastructure/services";
import {
  buildClearSessionCookie,
  readSessionToken,
} from "../../../../infrastructure/auth/cookies";
import { isSameOrigin, jsonError } from "../../../../lib/http";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonError(403, "Cross-origin request");
  }

  await authService.logout(readSessionToken(request));

  const response = NextResponse.json({ ok: true });

  response.cookies.set(buildClearSessionCookie());

  return response;
}
