import type { ValidationFinding } from "../domain/types";
import { PROVIDER_METRIC_DEFINITIONS } from "../domain/metrics";
import { VALIDATION_CODES, findingError } from "../domain/validation";
import {
  ProviderError,
  type ProviderAccount,
  type ProviderMetricReading,
  type ProviderPublishInput,
  type ProviderPublishResult,
  type ProviderToken,
  type PublishingProvider,
} from "./ports";
import {
  TransportError,
  providerErrorMessage,
  requestIdFrom,
  requestJson,
} from "./http";

/**
 * The real Mastodon provider.
 *
 * Every call is a real HTTP request against the configured instance base URL.
 * The instance is deployment configuration, never project input, so a
 * connection cannot point the credential at an arbitrary host. `publish`
 * sends `Idempotency-Key`; a transport failure after the request was sent is
 * classified AMBIGUOUS, and the reconciliation retry reuses the same key,
 * which Mastodon answers with the original status instead of a duplicate.
 */

export type MastodonConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  maxCharacters?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_MAX_CHARACTERS = 500;
const OAUTH_SCOPES = "read write";

export class MastodonPublishingProvider implements PublishingProvider {
  readonly id = "mastodon";
  readonly displayName = "Mastodon";
  readonly capabilities = ["TEXT_POST", "IDEMPOTENT_PUBLISH"] as const;

  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly maxCharacters: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(config: MastodonConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.maxCharacters = config.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 15_000;
    this.fetchImpl = config.fetchImpl;
  }

  authorizeUrl(input: { redirectUri: string; state: string }): string {
    const url = new URL("/oauth/authorize", this.baseUrl);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OAUTH_SCOPES);
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<ProviderToken> {
    const result = await this.request({
      path: "/oauth/token",
      method: "POST",
      form: {
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
        scope: OAUTH_SCOPES,
      },
    });

    if (result.status === 200) {
      const body = result.body as Record<string, unknown> | null;
      const accessToken = body?.["access_token"];
      if (typeof accessToken !== "string" || accessToken.length === 0) {
        throw new ProviderError({
          kind: "PERMANENT",
          message: "Provider token response did not include an access token",
          retryable: false,
          httpStatus: result.status,
        });
      }
      const scope =
        typeof body?.["scope"] === "string" ? body["scope"] : OAUTH_SCOPES;
      const expiresIn =
        typeof body?.["expires_in"] === "number" ? body["expires_in"] : null;
      return {
        accessToken,
        scopes: scope.split(/\s+/).filter(Boolean),
        expiresAt:
          expiresIn === null
            ? null
            : new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    }

    if (result.status === 400 || result.status === 401 || result.status === 403) {
      throw new ProviderError({
        kind: "AUTH",
        message: providerErrorMessage(
          result.body,
          `Provider refused the authorization code (HTTP ${result.status})`,
        ),
        retryable: false,
        httpStatus: result.status,
      });
    }

    throw new ProviderError({
      kind: result.status >= 500 ? "TRANSIENT" : "PERMANENT",
      message: providerErrorMessage(
        result.body,
        `Provider token exchange failed (HTTP ${result.status})`,
      ),
      retryable: result.status >= 500,
      httpStatus: result.status,
    });
  }

  async verifyCredential(credential: string): Promise<ProviderAccount> {
    const result = await this.request({
      path: "/api/v1/accounts/verify_credentials",
      method: "GET",
      credential,
    });

    if (result.status === 200) {
      const body = result.body as Record<string, unknown> | null;
      const id = body?.["id"];
      if (typeof id !== "string" || id.length === 0) {
        throw new ProviderError({
          kind: "PERMANENT",
          message: "Provider account response did not include an id",
          retryable: false,
          httpStatus: result.status,
        });
      }
      const displayName =
        (typeof body?.["display_name"] === "string" &&
          body["display_name"].trim()) ||
        (typeof body?.["username"] === "string" && body["username"]) ||
        (typeof body?.["acct"] === "string" && body["acct"]) ||
        `account ${id}`;
      return {
        externalAccountId: id,
        displayName: String(displayName),
        scopes: [...this.oauthScopes()],
      };
    }

    throw this.httpFailure(result.status, result.body, "account verification");
  }

  validateContent(content: string): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    if (content.trim().length === 0) {
      findings.push(
        findingError(
          VALIDATION_CODES.CONTENT_EMPTY,
          "The publishable content is empty.",
          "Add content to the source before validating.",
        ),
      );
    }
    if (content.length > this.maxCharacters) {
      findings.push(
        findingError(
          VALIDATION_CODES.CONTENT_TOO_LONG,
          `The content is ${content.length} characters; this provider accepts ${this.maxCharacters}.`,
          `Shorten the content to ${this.maxCharacters} characters or fewer.`,
        ),
      );
    }
    return findings;
  }

  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.idempotencyKey)) {
      throw new ProviderError({
        kind: "PERMANENT",
        message: "Idempotency key is not a valid header value",
        retryable: false,
        httpStatus: null,
      });
    }

    let result;
    try {
      result = await this.request({
        path: "/api/v1/statuses",
        method: "POST",
        credential: input.credential,
        form: { status: input.content, visibility: "public" },
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new ProviderError({
          kind: "AMBIGUOUS",
          message: error.timedOut
            ? "Provider did not answer before the timeout; the post may or may not exist and will be reconciled with the same idempotency key"
            : "The publish request failed after being sent; the post may or may not exist and will be reconciled with the same idempotency key",
          retryable: true,
          httpStatus: null,
        });
      }
      throw error;
    }

    if (result.status === 200 || result.status === 201) {
      const body = result.body as Record<string, unknown> | null;
      const id = body?.["id"];
      if (typeof id !== "string" || id.length === 0 || !/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new ProviderError({
          kind: "AMBIGUOUS",
          message:
            "Provider accepted the request but returned no usable post id; reconcile before retrying",
          retryable: true,
          httpStatus: result.status,
        });
      }
      const url = typeof body?.["url"] === "string" ? body["url"] : "";
      const createdAt =
        typeof body?.["created_at"] === "string" &&
        Number.isFinite(Date.parse(body["created_at"]))
          ? new Date(body["created_at"]).toISOString()
          : new Date().toISOString();
      return {
        externalPostId: id,
        externalUrl: url,
        publishedAt: createdAt,
        providerRequestId: requestIdFrom(result.headers),
      };
    }

    const failure = this.httpFailure(result.status, result.body, "publish");
    throw new ProviderError({
      ...failure.failure,
      retryable:
        failure.failure.kind === "TRANSIENT" ||
        failure.failure.kind === "RATE_LIMITED",
    });
  }

  async fetchMetrics(
    credential: string,
    externalPostId: string,
  ): Promise<ProviderMetricReading[]> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(externalPostId)) {
      throw new ProviderError({
        kind: "PERMANENT",
        message: "Post id is not a valid provider id",
        retryable: false,
        httpStatus: null,
      });
    }

    let result;
    try {
      result = await this.request({
        path: `/api/v1/statuses/${externalPostId}`,
        method: "GET",
        credential,
      });
    } catch (error) {
      if (error instanceof TransportError) {
        throw new ProviderError({
          kind: "TRANSIENT",
          message: "Provider metrics request could not be completed",
          retryable: true,
          httpStatus: null,
        });
      }
      throw error;
    }

    if (result.status !== 200) {
      throw this.httpFailure(result.status, result.body, "metrics");
    }

    const body = result.body as Record<string, unknown> | null;
    const asOf = new Date().toISOString();
    const windowStart =
      typeof body?.["created_at"] === "string" &&
      Number.isFinite(Date.parse(body["created_at"]))
        ? new Date(body["created_at"]).toISOString()
        : asOf;

    const readings: ProviderMetricReading[] = [];
    for (const definition of PROVIDER_METRIC_DEFINITIONS) {
      const raw = body?.[`${definition.key}_count`];
      if (raw === undefined) continue;
      if (
        typeof raw !== "number" ||
        !Number.isInteger(raw) ||
        raw < 0 ||
        !Number.isFinite(raw)
      ) {
        throw new ProviderError({
          kind: "PERMANENT",
          message: `Provider returned an invalid value for ${definition.key}`,
          retryable: false,
          httpStatus: result.status,
        });
      }
      readings.push({
        metricKey: definition.key,
        value: raw,
        unit: definition.unit,
        definition: definition.definition,
        windowStart,
        windowEnd: asOf,
        asOf,
        provenance: "PROVIDER_API",
        completeness: "COMPLETE",
      });
    }

    return readings;
  }

  private oauthScopes(): string[] {
    return OAUTH_SCOPES.split(/\s+/).filter(Boolean);
  }

  private httpFailure(
    status: number,
    body: unknown,
    operation: string,
  ): ProviderError {
    if (status === 401 || status === 403) {
      return new ProviderError({
        kind: "AUTH",
        message: providerErrorMessage(
          body,
          "The provider rejected the stored credential; reconnect the account",
        ),
        retryable: false,
        httpStatus: status,
      });
    }
    if (status === 429) {
      return new ProviderError({
        kind: "RATE_LIMITED",
        message: providerErrorMessage(
          body,
          "The provider is rate limiting this account",
        ),
        retryable: true,
        httpStatus: status,
      });
    }
    if (status >= 500) {
      return new ProviderError({
        kind: "TRANSIENT",
        message: providerErrorMessage(
          body,
          `The provider failed the ${operation} request (HTTP ${status})`,
        ),
        retryable: true,
        httpStatus: status,
      });
    }
    return new ProviderError({
      kind: "PERMANENT",
      message: providerErrorMessage(
        body,
        `The provider refused the ${operation} request (HTTP ${status})`,
      ),
      retryable: false,
      httpStatus: status,
    });
  }

  private async request(input: {
    path: string;
    method: "GET" | "POST";
    credential?: string;
    form?: Record<string, string>;
    idempotencyKey?: string;
  }) {
    const headers: Record<string, string> = {};
    if (input.credential) {
      headers["authorization"] = `Bearer ${input.credential}`;
    }
    if (input.idempotencyKey) {
      headers["idempotency-key"] = input.idempotencyKey;
    }
    return requestJson({
      url: `${this.baseUrl}${input.path}`,
      method: input.method,
      headers,
      form: input.form,
      timeoutMs: this.requestTimeoutMs,
      fetchImpl: this.fetchImpl,
    });
  }
}
