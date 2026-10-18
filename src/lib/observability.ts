/**
 * Minimal structured logging and redaction for CP24.
 *
 * There is no logging framework in this project (and CP24 deliberately does
 * not add one), so this module is the single place that turns an event into a
 * machine-readable log line and guarantees secrets never reach it. Every
 * worker script and HTTP error path funnels through here instead of printing
 * raw Error objects, which would leak driver/proxy details and, in the worst
 * case, credentials attached to error causes.
 */

const REDACTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "bearer [redacted]"],
  [
    /\b(access_token|refresh_token|client_secret|client_id_secret|api[_-]?key|apikey|password|passwd|secret|session_token|authorization)\b\s*[:=]\s*"?[^\s",;&}]+"?/gi,
    "$1=[redacted]",
  ],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, "[redacted-jwt]"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[redacted-b64]"],
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export type SanitizedError = {
  name: string;
  message: string;
  code?: string | number;
};

/**
 * Converts any thrown value into a bounded, redacted shape. The stack is
 * intentionally dropped: stacks carry absolute paths and sometimes argument
 * snapshots, and operators get better information from the structured fields.
 */
export function sanitizeError(error: unknown): SanitizedError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: redactSecrets(error.message).slice(0, 500),
      ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    };
  }
  return {
    name: "UnknownError",
    message: redactSecrets(String(error)).slice(0, 500),
  };
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      out[key] = redactSecrets(value);
    } else if (value instanceof Error) {
      out[key] = sanitizeError(value);
    } else if (value === undefined) {
      continue;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Writes one JSON log line. `event` is the stable, machine-greppable name
 * (for example `worker.crash` or `rate_limit.store_failed`); everything else
 * belongs in `fields`, which is redacted before serialization.
 */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  options: { service?: string } = {},
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(options.service ? { service: options.service } : {}),
    ...redactFields(fields),
  });
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function requestIdFrom(request: Request): string {
  const provided = request.headers.get("x-request-id");
  if (provided && /^[A-Za-z0-9._-]{8,128}$/.test(provided)) {
    return provided;
  }
  return `req_${crypto.randomUUID()}`;
}
