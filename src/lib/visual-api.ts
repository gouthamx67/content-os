import { HttpError } from "./http";

export type VisualBody = Record<string, unknown>;

export async function readJsonObject(request: Request): Promise<VisualBody> {
  const text = await request.text();

  if (text.trim().length === 0) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  return parsed as VisualBody;
}

export function requiredString(body: VisualBody, key: string): string {
  const value = body[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${key} must be a non-empty string`);
  }

  return value;
}

export function optionalString(
  body: VisualBody,
  key: string,
): string | undefined {
  const value = body[key];

  if (value === undefined) return undefined;

  if (typeof value !== "string") {
    throw new HttpError(400, `${key} must be a string`);
  }

  return value;
}

export function optionalNullableString(
  body: VisualBody,
  key: string,
): string | null | undefined {
  const value = body[key];

  if (value === undefined) return undefined;

  if (value === null) return null;

  if (typeof value !== "string") {
    throw new HttpError(400, `${key} must be a string or null`);
  }

  return value;
}

export function optionalNumber(
  body: VisualBody,
  key: string,
): number | undefined {
  const value = body[key];

  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `${key} must be a finite number`);
  }

  return value;
}

export function optionalNullableNumber(
  body: VisualBody,
  key: string,
): number | null | undefined {
  const value = body[key];

  if (value === undefined) return undefined;

  if (value === null) return null;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `${key} must be a finite number or null`);
  }

  return value;
}

export function requiredNumber(body: VisualBody, key: string): number {
  const value = optionalNumber(body, key);

  if (value === undefined) {
    throw new HttpError(400, `${key} is required`);
  }

  return value;
}

export function optionalBoolean(
  body: VisualBody,
  key: string,
): boolean | undefined {
  const value = body[key];

  if (value === undefined) return undefined;

  if (typeof value !== "boolean") {
    throw new HttpError(400, `${key} must be a boolean`);
  }

  return value;
}

export function optionalEnum<T extends string>(
  body: VisualBody,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = body[key];

  if (value === undefined) return undefined;

  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpError(400, `${key} is not a supported value`);
  }

  return value as T;
}

export function requiredEnum<T extends string>(
  body: VisualBody,
  key: string,
  allowed: readonly T[],
): T {
  const value = optionalEnum(body, key, allowed);

  if (value === undefined) {
    throw new HttpError(400, `${key} is required`);
  }

  return value;
}

export function optionalCount(
  body: VisualBody,
  key: string,
): number | undefined {
  const value = optionalNumber(body, key);

  if (value !== undefined && !Number.isInteger(value)) {
    throw new HttpError(400, `${key} must be a whole number`);
  }

  return value;
}

export function readTimeMs(request: Request): number {
  const url = new URL(request.url);
  const raw = url.searchParams.get("timeMs");

  if (raw === null) return 0;

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new HttpError(400, "timeMs must be a finite number");
  }

  return value;
}
