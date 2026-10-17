import type {
  AnalyticsCompleteness,
  MetricProvenance,
  ProviderCapability,
  ValidationFinding,
} from "../domain/types";

/**
 * The provider boundary.
 *
 * A provider is the only thing that talks to the outside platform, and it must
 * classify every failure honestly: AUTH (token rejected), PERMANENT (the
 * platform refused the content), TRANSIENT and RATE_LIMITED (retry may work),
 * AMBIGUOUS (the request may have landed — reconcile before retrying), or
 * NETWORK (the request was never sent). The engine's retry policy reads these
 * classifications rather than guessing from status codes.
 */

export type ProviderFailureKind =
  | "AUTH"
  | "PERMANENT"
  | "TRANSIENT"
  | "RATE_LIMITED"
  | "AMBIGUOUS"
  | "NETWORK";

export type ProviderFailure = {
  kind: ProviderFailureKind;
  message: string;
  retryable: boolean;
  httpStatus: number | null;
};

export class ProviderError extends Error {
  readonly failure: ProviderFailure;

  constructor(failure: ProviderFailure) {
    super(failure.message);
    this.name = "ProviderError";
    this.failure = failure;
  }
}

export type ProviderAccount = {
  externalAccountId: string;
  displayName: string;
  scopes: string[];
};

export type ProviderToken = {
  accessToken: string;
  scopes: string[];
  expiresAt: string | null;
};

export type ProviderPublishInput = {
  credential: string;
  content: string;
  idempotencyKey: string;
};

export type ProviderPublishResult = {
  externalPostId: string;
  externalUrl: string;
  publishedAt: string;
  providerRequestId: string | null;
};

export type ProviderMetricReading = {
  metricKey: string;
  value: number;
  unit: string;
  definition: string;
  windowStart: string;
  windowEnd: string;
  asOf: string;
  provenance: MetricProvenance;
  completeness: AnalyticsCompleteness;
};

export interface PublishingProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: readonly ProviderCapability[];

  /** Where the browser is sent to approve access; never includes a token. */
  authorizeUrl(input: { redirectUri: string; state: string }): string;

  exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<ProviderToken>;

  verifyCredential(credential: string): Promise<ProviderAccount>;

  /** Provider-level content rules (length, unsupported content). */
  validateContent(content: string): ValidationFinding[];

  publish(input: ProviderPublishInput): Promise<ProviderPublishResult>;

  fetchMetrics(
    credential: string,
    externalPostId: string,
  ): Promise<ProviderMetricReading[]>;
}
