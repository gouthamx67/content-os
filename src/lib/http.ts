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

const MAX_JSON_BODY_BYTES = 6 * 1024 * 1024;
const MAX_BODY_CHUNKS = 8192;

async function readJsonBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) return null;

  const reader = request.body.getReader();
  let body = new Uint8Array(Math.min(MAX_JSON_BODY_BYTES, 64 * 1024));
  let size = 0;
  let chunks = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!result.value) continue;
      chunks += 1;
      if (chunks > MAX_BODY_CHUNKS) return null;
      const required = size + result.value.byteLength;
      if (required > MAX_JSON_BODY_BYTES) return null;
      if (required > body.length) {
        const next = new Uint8Array(Math.min(MAX_JSON_BODY_BYTES, Math.max(required, body.length * 2)));
        next.set(body.subarray(0, size));
        body = next;
      }
      body.set(result.value, size);
      size = required;
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  return size === body.length ? body : body.slice(0, size);
}

export async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const bytes = await readJsonBody(request);
    if (!bytes) return null;
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;

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
  fallbackStatus = 500,
): Response {
  if (error instanceof HttpError) {
    return jsonError(error.status, error.message);
  }

  if (fallbackStatus >= 500) {
    return jsonError(500, "Request failed");
  }

  if (error instanceof Error) {
    return jsonError(fallbackStatus, error.message);
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