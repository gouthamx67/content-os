/**
 * Startup configuration gate.
 *
 * `register` runs once before the Next.js server accepts requests. Mandatory
 * configuration problems (for example a missing or malformed DATABASE_URL)
 * abort the process instead of surfacing as a confusing 500 on the first
 * request. Optional integrations are not checked here; they are reported as
 * capabilities by /api/health and fail per-route.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const { assertServerConfig, ServerConfigError } = await import("./lib/server-config");
  const { logEvent, sanitizeError } = await import("./lib/observability");

  try {
    assertServerConfig("web startup");
    const { describeFeatureCapabilities } = await import("./lib/server-config");
    const capabilities = describeFeatureCapabilities();
    logEvent("info", "startup.config_valid", {
      publishingAvailable: capabilities.publishing.available,
      writingProviderAvailable: capabilities.writingProvider.available,
      localizationProviderAvailable: capabilities.localizationProvider.available,
    });
  } catch (error) {
    if (error instanceof ServerConfigError) {
      logEvent("error", "startup.config_invalid", {
        context: "web startup",
        issues: error.issues.map((issue) => `${issue.key}: ${issue.problem}`),
      });
    } else {
      logEvent("error", "startup.config_check_failed", {
        error: sanitizeError(error),
      });
    }
    process.exitCode = 1;
    throw error;
  }
}
