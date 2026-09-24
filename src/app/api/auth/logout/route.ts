import { NextResponse } from "next/server";
import { authService } from "../../../../infrastructure/services";
import {
  buildClearSessionCookie,
  readSessionToken,
} from "../../../../infrastructure/auth/cookies";

export async function POST(request: Request) {
  await authService.logout(readSessionToken(request));

  const response = NextResponse.json({ ok: true });

  response.cookies.set(buildClearSessionCookie());

  return response;
}