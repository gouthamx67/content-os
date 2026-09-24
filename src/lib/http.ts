export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function jsonError(
  status: number,
  error: string,
  extras: Record<string, unknown> = {},
): Response {
  return Response.json(
    {
      error,
      ...extras,
    },
    {
      status,
    },
  );
}

export function notFound(message = "Not found"): Response {
  return jsonError(404, message);
}

export async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();

    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return null;
    }

    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function wrapHttpError(
  error: unknown,
  fallbackStatus = 400,
): Response {
  if (error instanceof HttpError) {
    return jsonError(error.status, error.message);
  }

  if (error instanceof Error) {
    return jsonError(
      fallbackStatus,
      error.message,
    );
  }

  return jsonError(fallbackStatus, "Request failed");
}

export function isSameOrigin(
  request: Request,
): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    return true;
  }

  const url = new URL(request.url);

  return origin === url.origin;
}