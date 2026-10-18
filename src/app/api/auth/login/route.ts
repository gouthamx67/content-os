import { NextResponse } from "next/server";
import { authService } from "../../../../infrastructure/services";
import {
  buildSessionCookie,
} from "../../../../infrastructure/auth/cookies";
import {
  HttpError,
  isSameOrigin,
  parseJsonBody,
  wrapHttpError,
} from "../../../../lib/http";
import {
  clientIdentity,
  enforceRateLimit,
  RATE_LIMITS,
} from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const body = await parseJsonBody(request);

    if (!body) {
      return Response.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const email = String(body.email ?? "");
    const limited = await enforceRateLimit(
      RATE_LIMITS.authLogin,
      `${clientIdentity(request)}|${email.toLowerCase()}`,
    );
    if (limited) return limited;

    const result = await authService.login({
      email,
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
