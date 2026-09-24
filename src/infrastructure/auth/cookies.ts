export type SessionCookie = {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict";
  path: string;
  maxAge: number;
};

export function sessionCookieName(): string {
  return (
    process.env["SESSION_COOKIE_NAME"] ?? "content_os_session"
  );
}

export function isSecureEnvironment(): boolean {
  return process.env["NODE_ENV"] === "production";
}

export function buildSessionCookie(
  token: string,
  maxAgeSeconds: number,
): SessionCookie {
  return {
    name: sessionCookieName(),
    value: token,
    httpOnly: true,
    secure: isSecureEnvironment(),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function buildClearSessionCookie(): SessionCookie {
  return {
    name: sessionCookieName(),
    value: "",
    httpOnly: true,
    secure: isSecureEnvironment(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  };
}

export function readSessionToken(
  request: Request,
): string | undefined {
  const name = sessionCookieName();

  const header = request.headers.get("cookie");

  if (!header) {
    return undefined;
  }

  const cookie = header
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name);

  if (!cookie || cookie.length < 2) {
    return undefined;
  }

  return decodeURIComponent(cookie.slice(1).join("="));
}