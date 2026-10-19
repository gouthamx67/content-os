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

/**
 * Every OpenAI-compatible endpoint the runtime can be pointed at: each
 * domain's primary plus its three numbered fallback slots.
 */
const LLM_ENDPOINT_PREFIXES = [
  "WRITING_LLM",
  "WRITING_LLM_FALLBACK",
  "WRITING_LLM_FALLBACK_2",
  "WRITING_LLM_FALLBACK_3",
  "LOCALIZATION_LLM",
  "LOCALIZATION_LLM_FALLBACK",
  "LOCALIZATION_LLM_FALLBACK_2",
  "LOCALIZATION_LLM_FALLBACK_3",
  "CONTENT_OS_AI",
  "CONTENT_OS_AI_FALLBACK",
  "CONTENT_OS_AI_FALLBACK_2",
  "CONTENT_OS_AI_FALLBACK_3",
  "IMAGE_LLM",
] as const;

function endpointConfigured(
  env: Record<string, string | undefined>,
  prefix: string,
): boolean {
  const baseUrl = env[`${prefix}_BASE_URL`];
  const model = env[`${prefix}_MODEL`];
  return Boolean(baseUrl && baseUrl !== "" && model && model !== "");
}

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

  for (const prefix of LLM_ENDPOINT_PREFIXES) {
    const baseUrl = env[`${prefix}_BASE_URL`];
    const model = env[`${prefix}_MODEL`];
    const baseUrlSet = baseUrl !== undefined && baseUrl !== "";
    const modelSet = model !== undefined && model !== "";
    if (baseUrlSet && !isHttpUrl(baseUrl)) {
      issues.push({
        key: `${prefix}_BASE_URL`,
        problem: "must be an absolute http(s) URL",
      });
    }
    if (baseUrlSet !== modelSet) {
      issues.push({
        key: `${prefix}_BASE_URL/${prefix}_MODEL`,
        problem: `incomplete endpoint: set both ${prefix}_BASE_URL and ${prefix}_MODEL, or neither`,
      });
    }
    const timeout = env[`${prefix}_TIMEOUT_MS`];
    if (timeout !== undefined && timeout !== "" && !isPositiveIntegerString(timeout)) {
      issues.push({
        key: `${prefix}_TIMEOUT_MS`,
        problem: "must be a positive integer number of milliseconds",
      });
    }
  }

  const aiEndpointConfigured =
    endpointConfigured(env, "CONTENT_OS_AI") ||
    endpointConfigured(env, "WRITING_LLM");

  for (const gate of ["CONTENT_OS_AI_INTERPRETATION", "CONTENT_OS_AI_BROWSER"] as const) {
    const value = env[gate];
    if (value === undefined || value === "") continue;
    if (value !== "1") {
      issues.push({
        key: gate,
        problem: 'must be exactly "1" to enable the model-assisted path',
      });
      continue;
    }
    if (!aiEndpointConfigured) {
      issues.push({
        key: gate,
        problem:
          "requires a configured model endpoint: set CONTENT_OS_AI_BASE_URL/CONTENT_OS_AI_MODEL (or WRITING_LLM_BASE_URL/WRITING_LLM_MODEL)",
      });
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
  aiProvider: FeatureCapability;
  aiInterpretation: FeatureCapability;
  aiBrowser: FeatureCapability;
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

  const aiConfigured =
    endpointConfigured(env, "CONTENT_OS_AI") ||
    endpointConfigured(env, "WRITING_LLM");
  const interpretationEnabled = env["CONTENT_OS_AI_INTERPRETATION"] === "1";
  const browserEnabled = env["CONTENT_OS_AI_BROWSER"] === "1";
  const writingConfigured = endpointConfigured(env, "WRITING_LLM");
  const localizationConfigured =
    endpointConfigured(env, "LOCALIZATION_LLM") || writingConfigured;

  // Slot N is configured if any prefix allowed for that slot is complete; the
  // prefix lists mirror each factory's precedence (localization and the AI seam
  // inherit the writing chain when their own slots are absent).
  const FALLBACK_SUFFIXES = ["", "_2", "_3"] as const;
  const fallbackCount = (prefixes: readonly string[]): number =>
    FALLBACK_SUFFIXES.filter((suffix) =>
      prefixes.some((prefix) => endpointConfigured(env, `${prefix}${suffix}`)),
    ).length;
  const endpointDetail = (count: number): string =>
    count > 0 ? `configured with ${count} fallback endpoint(s)` : "configured";

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
    aiProvider: {
      available: aiConfigured,
      detail: aiConfigured
        ? endpointDetail(
            fallbackCount(["CONTENT_OS_AI_FALLBACK", "WRITING_LLM_FALLBACK"]),
          )
        : "no model endpoint is configured",
    },
    aiInterpretation: {
      available: interpretationEnabled && aiConfigured,
      detail: !aiConfigured
        ? "no model endpoint is configured"
        : interpretationEnabled
          ? "enabled with a configured model endpoint"
          : "disabled (set CONTENT_OS_AI_INTERPRETATION=1 to enable)",
    },
    aiBrowser: {
      available: browserEnabled && aiConfigured,
      detail: !aiConfigured
        ? "no model endpoint is configured"
        : browserEnabled
          ? "enabled with a configured model endpoint"
          : "disabled (set CONTENT_OS_AI_BROWSER=1 to enable)",
    },
    writingProvider: {
      available: writingConfigured,
      detail: writingConfigured
        ? endpointDetail(fallbackCount(["WRITING_LLM_FALLBACK"]))
        : "rules-based provider only",
    },
    localizationProvider: {
      available: localizationConfigured,
      detail: localizationConfigured
        ? endpointDetail(
            fallbackCount(["LOCALIZATION_LLM_FALLBACK", "WRITING_LLM_FALLBACK"]),
          )
        : "local-rules substitution provider only",
    },
  };
}
