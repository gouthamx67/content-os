import { NextResponse } from "next/server";
import { authService } from "../../../../infrastructure/services";
import {
  buildSessionCookie,
} from "../../../../infrastructure/auth/cookies";
import {
  parseJsonBody,
  wrapHttpError,
} from "../../../../lib/http";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);

    if (!body) {
      return Response.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const result = await authService.login({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
    });

    const response = NextResponse.json({
      user: result.user,
      expiresAt: result.expiresAt,
    });

    response.cookies.set(
      buildSessionCookie(
        result.token,
        result.sessionLifetimeSeconds,
      ),
    );

    return response;
  } catch (error) {
    return wrapHttpError(error);
  }
}