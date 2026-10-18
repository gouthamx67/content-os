/**
 * Server-side configuration contract.
 *
 * Mandatory configuration (the database) fails fast: a process that cannot
 * reach its database must not start and pretend to serve. Optional
 * integrations (publishing, remote LLM providers, storage overrides) never
 * crash unrelated product areas; they are reported as absent capabilities so
 * the UI and health routes can be honest instead of faking availability.
 *
 * The validator is environment-driven and dependency-free so it can run in
 * `src/instrumentation.ts`, in worker scripts, and in tests.
 */

export type ServerConfigIssue = {
  key: string;
  problem: string;
};

export class ServerConfigError extends Error {
  readonly issues: readonly ServerConfigIssue[];

  constructor(context: string, issues: readonly ServerConfigIssue[]) {
    super(
      `Invalid server configuration (${context}): ${issues
        .map((issue) => `${issue.key}: ${issue.problem}`)
        .join("; ")}`,
    );
    this.name = "ServerConfigError";
    this.issues = issues;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAbsoluteOrigin(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  const url = new URL(value);
  return url.pathname === "/" && url.search === "" && url.hash === "";
}

function isPositiveIntegerString(value: string): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

const PUBLISHING_MASTODON_KEYS = [
  "PUBLISHING_MASTODON_BASE_URL",
  "PUBLISHING_MASTODON_CLIENT_ID",
  "PUBLISHING_MASTODON_CLIENT_SECRET",
] as const;

export const KNOWN_NODE_ENVS = ["development", "test", "production"] as const;

export function collectServerConfigIssues(
  env: Record<string, string | undefined> = process.env,
): ServerConfigIssue[] {
  const issues: ServerConfigIssue[] = [];

  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) {
    issues.push({ key: "DATABASE_URL", problem: "required but not set" });
  } else {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
        issues.push({
          key: "DATABASE_URL",
          problem: `unsupported scheme ${parsed.protocol} (expected postgresql:)`,
        });
      }
    } catch {
      issues.push({ key: "DATABASE_URL", problem: "not a valid connection URL" });
    }
  }

  const nodeEnv = env["NODE_ENV"];
  if (nodeEnv && !(KNOWN_NODE_ENVS as readonly string[]).includes(nodeEnv)) {
    issues.push({
      key: "NODE_ENV",
      problem: `unknown value ${JSON.stringify(nodeEnv)} (expected development, test or production)`,
    });
  }

  const cookieName = env["SESSION_COOKIE_NAME"];
  if (cookieName !== undefined) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(cookieName)) {
      issues.push({
        key: "SESSION_COOKIE_NAME",
        problem: "must be 1-64 characters of [A-Za-z0-9._-]",
      });
    }
  }

  const appOrigin = env["CONTENT_OS_APP_ORIGIN"];
  if (appOrigin !== undefined && appOrigin !== "") {
    if (!isAbsoluteOrigin(appOrigin)) {
      issues.push({
        key: "CONTENT_OS_APP_ORIGIN",
        problem: "must be an absolute http(s) origin such as https://app.example.com",
      });
    }
  }

  const publishingKey = env["PUBLISHING_SECRET_KEY"];
  if (publishingKey !== undefined && publishingKey !== "") {
    let keyBytes = 0;
    try {
      keyBytes = Buffer.from(publishingKey, "base64").byteLength;
    } catch {
      keyBytes = 0;
    }
    if (keyBytes !== 32) {
      issues.push({
        key: "PUBLISHING_SECRET_KEY",
        problem: "must be 32 bytes of base64-encoded key material",
      });
    }
  }

  const mastodonPresent = PUBLISHING_MASTODON_KEYS.filter(
    (key) => env[key] !== undefined && env[key] !== "",
  );
  if (mastodonPresent.length > 0 && mastodonPresent.length < PUBLISHING_MASTODON_KEYS.length) {
    issues.push({
      key: "PUBLISHING_MASTODON_*",
      problem: `incomplete: set all of ${PUBLISHING_MASTODON_KEYS.join(", ")} or none`,
    });
  }
  const mastodonBase = env["PUBLISHING_MASTODON_BASE_URL"];
  if (mastodonBase !== undefined && mastodonBase !== "" && !isHttpUrl(mastodonBase)) {
    issues.push({
      key: "PUBLISHING_MASTODON_BASE_URL",
      problem: "must be an absolute http(s) URL",
    });
  }

  for (const key of ["WRITING_LLM_BASE_URL", "LOCALIZATION_LLM_BASE_URL"] as const) {
    const value = env[key];
    if (value !== undefined && value !== "" && !isHttpUrl(value)) {
      issues.push({ key, problem: "must be an absolute http(s) URL" });
    }
  }

  for (const key of ["WRITING_LLM_TIMEOUT_MS", "LOCALIZATION_LLM_TIMEOUT_MS"] as const) {
    const value = env[key];
    if (value !== undefined && value !== "" && !isPositiveIntegerString(value)) {
      issues.push({ key, problem: "must be a positive integer number of milliseconds" });
    }
  }

  const trustProxy = env["CONTENT_OS_TRUST_PROXY"];
  if (trustProxy !== undefined && trustProxy !== "" && trustProxy !== "1") {
    issues.push({
      key: "CONTENT_OS_TRUST_PROXY",
      problem: 'must be exactly "1" to enable trusted-proxy forwarded IPs',
    });
  }

  return issues;
}

/**
 * Throws when the environment violates the contract. `context` names the
 * process that failed (web/instrumentation/render-worker/...) so the operator
 * immediately knows where to look.
 */
export function assertServerConfig(
  context: string,
  env: Record<string, string | undefined> = process.env,
): void {
  const issues = collectServerConfigIssues(env);
  if (issues.length > 0) {
    throw new ServerConfigError(context, issues);
  }
}

export type FeatureCapability = {
  available: boolean;
  detail: string;
};

export type FeatureCapabilities = {
  publishing: FeatureCapability & { provider: string | null };
  writingProvider: FeatureCapability;
  localizationProvider: FeatureCapability;
};

/**
 * Optional-feature status, evaluated from configuration only. This never
 * probes a provider; it answers "is the feature configured at all", which is
 * exactly what the UI and /api/health need to distinguish "unavailable" from
 * "broken".
 */
export function describeFeatureCapabilities(
  env: Record<string, string | undefined> = process.env,
): FeatureCapabilities {
  const mastodonConfigured = PUBLISHING_MASTODON_KEYS.every(
    (key) => env[key] !== undefined && env[key] !== "",
  );
  const publishingKeyPresent =
    env["PUBLISHING_SECRET_KEY"] !== undefined && env["PUBLISHING_SECRET_KEY"] !== "";

  return {
    publishing: {
      available: mastodonConfigured && publishingKeyPresent,
      provider: mastodonConfigured ? "mastodon" : null,
      detail: mastodonConfigured
        ? publishingKeyPresent
          ? "configured"
          : "PUBLISHING_SECRET_KEY is not configured"
        : "no publishing provider is configured",
    },
    writingProvider: {
      available: Boolean(env["WRITING_LLM_BASE_URL"]),
      detail: env["WRITING_LLM_BASE_URL"]
        ? "configured"
        : "rules-based provider only",
    },
    localizationProvider: {
      available: Boolean(
        env["LOCALIZATION_LLM_BASE_URL"] ?? env["WRITING_LLM_BASE_URL"],
      ),
      detail:
        env["LOCALIZATION_LLM_BASE_URL"] ?? env["WRITING_LLM_BASE_URL"]
          ? "configured"
          : "local-rules substitution provider only",
    },
  };
}
