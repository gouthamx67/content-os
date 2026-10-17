import type { PublishingRepository } from "../../core/ports/publishing-repository";
import type {
  PublicationRecord,
  PublicationSourceType,
  PublicationStatus,
  PublishingConnectionRecord,
  ValidationFinding,
} from "./domain/types";
import {
  CANCELLABLE_STATUSES,
  VALIDATABLE_STATUSES,
  isFutureInstant,
  isValidTimeZone,
} from "./domain/lifecycle";
import { VALIDATION_CODES, findingError } from "./domain/validation";
import { PublishingError } from "./errors";
import type { PublicationSourceResolver } from "./source-resolver";
import type { PublishingProviderRegistry } from "./providers/registry";
import { ProviderError, type PublishingProvider } from "./providers/ports";
import { sanitizeProviderMessage } from "./providers/http";
import type { PublishingCrypto, PublishingCryptoLoad } from "./secrets";
import { boundedAttemptMetadata } from "./serialization";

export type ProjectAuthorization = (
  projectId: string,
  userId: string,
) => Promise<void>;

export type PublishingServiceDeps = {
  repository: PublishingRepository;
  providers: PublishingProviderRegistry;
  resolver: PublicationSourceResolver;
  authorizeProject: ProjectAuthorization;
  loadCrypto: () => PublishingCryptoLoad;
  newId: (prefix: string) => string;
  now: () => string;
};

export type ProviderCatalogEntry = {
  id: string;
  displayName: string;
  capabilities: readonly string[];
};

export type ProviderCatalog = {
  providers: ProviderCatalogEntry[];
  cryptoProblem: string | null;
};

export type PublicationDetail = {
  publication: PublicationRecord;
  attempts: Awaited<ReturnType<PublishingRepository["listAttempts"]>>;
};

export type StartConnectionResult = {
  authorizationUrl: string;
  stateToken: string;
};

const OAUTH_STATE_TTL_MS = 10 * 60_000;

function statusForFailure(kind: ProviderError["failure"]["kind"]): PublicationStatus {
  return kind === "AMBIGUOUS" ? "AMBIGUOUS" : kind === "AUTH" ? "AUTH_REQUIRED" : "FAILED";
}

function codeForFailure(kind: ProviderError["failure"]["kind"]): string {
  switch (kind) {
    case "AUTH":
      return "PUBLISHING_PROVIDER_AUTH";
    case "PERMANENT":
      return "PUBLISHING_PROVIDER_REJECTED";
    case "RATE_LIMITED":
      return "PUBLISHING_PROVIDER_RATE_LIMITED";
    case "AMBIGUOUS":
      return "PUBLISHING_PROVIDER_AMBIGUOUS";
    case "TRANSIENT":
    case "NETWORK":
      return "PUBLISHING_NETWORK_ERROR";
  }
}

export class PublishingService {
  constructor(private readonly deps: PublishingServiceDeps) {}

  // ------------------------------------------------------------ providers

  async listProviders(userId: string, projectId: string): Promise<ProviderCatalog> {
    await this.deps.authorizeProject(projectId, userId);
    const cryptoLoad = this.deps.loadCrypto();
    return {
      providers: this.deps.providers.list().map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        capabilities: provider.capabilities,
      })),
      cryptoProblem: cryptoLoad.problem,
    };
  }

  // ---------------------------------------------------------- connections

  async listConnections(
    userId: string,
    projectId: string,
  ): Promise<PublishingConnectionRecord[]> {
    await this.deps.authorizeProject(projectId, userId);
    return this.deps.repository.listConnections(projectId);
  }

  async startConnection(
    userId: string,
    projectId: string,
    input: { providerId: string; redirectUri: string },
  ): Promise<StartConnectionResult> {
    await this.deps.authorizeProject(projectId, userId);
    const crypto = this.requireCrypto();
    const provider = this.requireProvider(input.providerId);
    const now = this.deps.now();
    const stateToken = crypto.stateSigner.sign({
      nonce: this.deps.newId("oauth"),
      projectId,
      userId,
      providerId: provider.id,
      exp: new Date(Date.parse(now) + OAUTH_STATE_TTL_MS).toISOString(),
    });
    return {
      authorizationUrl: provider.authorizeUrl({
        redirectUri: input.redirectUri,
        state: stateToken,
      }),
      stateToken,
    };
  }

  async completeConnection(
    userId: string,
    projectId: string,
    input: {
      code: string;
      stateToken: string;
      redirectUri: string;
    },
  ): Promise<PublishingConnectionRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const crypto = this.requireCrypto();
    const payload = crypto.stateSigner.verify(input.stateToken);
    const expiresAt =
      typeof payload?.["exp"] === "string" ? Date.parse(payload["exp"]) : Number.NaN;
    const providerId =
      typeof payload?.["providerId"] === "string" ? payload["providerId"] : null;
    if (
      !payload ||
      providerId === null ||
      payload["projectId"] !== projectId ||
      payload["userId"] !== userId ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.parse(this.deps.now())
    ) {
      throw new PublishingError(
        "PUBLISHING_OAUTH_STATE_INVALID",
        "The OAuth state did not match this project, user and provider, or it expired. Start the connection again.",
      );
    }
    const provider = this.requireProvider(providerId);

    let token;
    try {
      token = await provider.exchangeCode({
        code: input.code,
        redirectUri: input.redirectUri,
      });
    } catch (error) {
      throw new PublishingError(
        "PUBLISHING_OAUTH_EXCHANGE_FAILED",
        error instanceof ProviderError
          ? sanitizeProviderMessage(error.failure.message)
          : "The provider did not complete the token exchange.",
      );
    }

    let account;
    try {
      account = await provider.verifyCredential(token.accessToken);
    } catch (error) {
      throw new PublishingError(
        "PUBLISHING_PROVIDER_AUTH",
        error instanceof ProviderError
          ? sanitizeProviderMessage(error.failure.message)
          : "The provider rejected the new credential.",
      );
    }

    const connections = await this.deps.repository.listConnections(projectId);
    const conflicting = connections.find(
      (connection) =>
        connection.providerId === provider.id &&
        connection.status === "CONNECTED" &&
        connection.externalAccountId !== account.externalAccountId,
    );
    if (conflicting) {
      throw new PublishingError(
        "CONNECTION_ALREADY_CONNECTED",
        `This project already publishes through ${conflicting.displayName}. Disconnect it before connecting another account.`,
        { connectionId: conflicting.id },
      );
    }

    const now = this.deps.now();
    const existing = await this.deps.repository.findConnectionByAccount(
      projectId,
      provider.id,
      account.externalAccountId,
    );
    const credentialCiphertext = crypto.box.seal(token.accessToken);
    if (existing) {
      const updated = await this.deps.repository.updateConnection(
        projectId,
        existing.id,
        {
          updatedAt: now,
          displayName: account.displayName,
          scopes: token.scopes,
          capabilities: [...provider.capabilities],
          status: "CONNECTED",
          credentialCiphertext,
          credentialExpiresAt: token.expiresAt,
          connectedAt: now,
          disconnectedAt: null,
          lastErrorCode: null,
          lastCheckedAt: now,
        },
      );
      if (!updated) throw this.notFoundConnection(existing.id);
      return updated;
    }

    return this.deps.repository.createConnection({
      id: this.deps.newId("conn"),
      projectId,
      createdById: userId,
      providerId: provider.id,
      externalAccountId: account.externalAccountId,
      displayName: account.displayName,
      scopes: token.scopes,
      capabilities: [...provider.capabilities],
      status: "CONNECTED",
      credentialCiphertext,
      credentialExpiresAt: token.expiresAt,
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  async verifyConnection(
    userId: string,
    projectId: string,
    connectionId: string,
  ): Promise<PublishingConnectionRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const connection = await this.requireConnection(projectId, connectionId);
    const crypto = this.requireCrypto();
    const provider = this.requireProvider(connection.providerId);
    const now = this.deps.now();

    if (!connection.credentialCiphertext) {
      const updated = await this.deps.repository.updateConnection(
        projectId,
        connectionId,
        {
          updatedAt: now,
          status: "AUTH_REQUIRED",
          lastCheckedAt: now,
          lastErrorCode: "PUBLISHING_PROVIDER_AUTH",
        },
      );
      if (!updated) throw this.notFoundConnection(connectionId);
      return updated;
    }

    let status: PublishingConnectionRecord["status"] = "CONNECTED";
    let displayName = connection.displayName;
    let errorCode: string | null = null;
    try {
      const account = await provider.verifyCredential(
        this.openCredential(crypto, connection.credentialCiphertext),
      );
      displayName = account.displayName;
    } catch (error) {
      status = "AUTH_REQUIRED";
      errorCode =
        error instanceof ProviderError && error.failure.kind === "AUTH"
          ? "PUBLISHING_PROVIDER_AUTH"
          : "PUBLISHING_NETWORK_ERROR";
    }

    const updated = await this.deps.repository.updateConnection(
      projectId,
      connectionId,
      {
        updatedAt: now,
        status,
        displayName,
        lastCheckedAt: now,
        lastErrorCode: errorCode,
      },
    );
    if (!updated) throw this.notFoundConnection(connectionId);
    return updated;
  }

  async disconnectConnection(
    userId: string,
    projectId: string,
    connectionId: string,
  ): Promise<PublishingConnectionRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const now = this.deps.now();
    const updated = await this.deps.repository.updateConnection(
      projectId,
      connectionId,
      {
        updatedAt: now,
        status: "DISCONNECTED",
        credentialCiphertext: null,
        credentialExpiresAt: null,
        disconnectedAt: now,
        lastErrorCode: null,
      },
    );
    if (!updated) throw this.notFoundConnection(connectionId);
    return updated;
  }

  // --------------------------------------------------------- publications

  async listPublications(
    userId: string,
    projectId: string,
    filter?: Parameters<PublishingRepository["listPublications"]>[1],
  ): Promise<PublicationRecord[]> {
    await this.deps.authorizeProject(projectId, userId);
    return this.deps.repository.listPublications(projectId, filter);
  }

  async createPublication(
    userId: string,
    projectId: string,
    input: {
      connectionId: string;
      sourceType: PublicationSourceType;
      sourceId: string;
    },
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    await this.requireConnection(projectId, input.connectionId);

    const resolution = await this.deps.resolver.resolve(
      projectId,
      input.sourceType,
      input.sourceId,
    );
    if (!resolution.ok) {
      const findings = resolution.findings;
      if (findings.every((finding) => finding.code === VALIDATION_CODES.SOURCE_NOT_FOUND)) {
        throw new PublishingError(
          "SOURCE_NOT_FOUND",
          findings[0]?.message ?? "The publication source was not found.",
          { findings },
        );
      }
      throw new PublishingError(
        "SOURCE_UNRESOLVED",
        "The source is not ready to publish. Resolve the validation findings and create the publication again.",
        { findings },
      );
    }

    const now = this.deps.now();
    const source = resolution.source;
    return this.deps.repository.createPublication({
      id: this.deps.newId("pub"),
      projectId,
      createdById: userId,
      connectionId: input.connectionId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      sourceHash: source.snapshot.contentSha256,
      sourceSnapshot: source.snapshot,
      title: source.snapshot.title,
      content: source.snapshot.content,
      status: "DRAFT",
      idempotencyKey: this.deps.newId("pubidem"),
      validation: source.findings.length > 0 ? source.findings : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async getPublicationDetail(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationDetail> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    const attempts = await this.deps.repository.listAttempts(projectId, publicationId);
    return { publication, attempts };
  }

  async validatePublication(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    if (!VALIDATABLE_STATUSES.includes(publication.status)) {
      throw new PublishingError(
        "PUBLISHING_INVALID_TRANSITION",
        `A publication in ${publication.status} cannot be validated.`,
      );
    }

    const now = this.deps.now();
    const findings: ValidationFinding[] = [];
    const connection = await this.deps.repository.getConnection(
      projectId,
      publication.connectionId,
    );
    let provider: PublishingProvider | null = null;

    if (!connection) {
      findings.push(
        findingError(
          VALIDATION_CODES.CONNECTION_NOT_CONNECTED,
          "The destination connection for this publication no longer exists.",
          "Create the publication against a connected destination.",
        ),
      );
    } else {
      provider = this.deps.providers.get(connection.providerId);
      if (!provider) {
        findings.push(
          findingError(
            VALIDATION_CODES.PROVIDER_NOT_CONFIGURED,
            `Provider “${connection.providerId}” is not configured on this deployment.`,
            "Configure the provider credentials, then validate again.",
          ),
        );
      } else if (connection.status !== "CONNECTED") {
        findings.push(
          findingError(
            connection.status === "REVOKED"
              ? VALIDATION_CODES.CONNECTION_REVOKED
              : connection.status === "AUTH_REQUIRED"
                ? VALIDATION_CODES.CONNECTION_AUTH_REQUIRED
                : VALIDATION_CODES.CONNECTION_NOT_CONNECTED,
            `The destination account is ${connection.status}.`,
            "Reconnect the destination account, then validate again.",
          ),
        );
      }
    }

    const resolution = await this.deps.resolver.resolve(
      projectId,
      publication.sourceType,
      publication.sourceId,
    );
    let refreshed:
      | {
          sourceRevision: string;
          sourceHash: string;
          snapshot: PublicationRecord["sourceSnapshot"];
          title: string;
          content: string;
        }
      | null = null;
    if (resolution.ok) {
      refreshed = {
        sourceRevision: resolution.source.sourceRevision,
        sourceHash: resolution.source.snapshot.contentSha256,
        snapshot: resolution.source.snapshot,
        title: resolution.source.snapshot.title,
        content: resolution.source.snapshot.content,
      };
      findings.push(...resolution.source.findings);
    } else {
      findings.push(...resolution.findings);
    }

    if (provider) {
      findings.push(...provider.validateContent(publication.content));
      if (publication.content.trim().length === 0) {
        findings.push(
          findingError(
            VALIDATION_CODES.CONTENT_EMPTY,
            "The publication content is empty.",
            "Add content to the source document, then validate again.",
          ),
        );
      }
    }

    const clean = findings.every((finding) => finding.severity !== "ERROR");
    const stored = findings.length > 0 ? findings : null;
    const refreshColumns = refreshed ?? {
      sourceRevision: publication.sourceRevision,
      sourceHash: publication.sourceHash,
      snapshot: publication.sourceSnapshot,
      title: publication.title,
      content: publication.content,
    };

    if (clean) {
      const moved = await this.deps.repository.transitionPublication(
        projectId,
        publicationId,
        publication.status,
        {
          updatedAt: now,
          status: "READY",
          sourceRevision: refreshColumns.sourceRevision,
          sourceHash: refreshColumns.sourceHash,
          sourceSnapshot: refreshColumns.snapshot,
          title: refreshColumns.title,
          content: refreshColumns.content,
          validation: stored,
          validatedAt: now,
        },
      );
      if (!moved) throw this.invalidTransition(publication);
      return moved;
    }

    if (publication.status === "READY") {
      const demoted = await this.deps.repository.transitionPublication(
        projectId,
        publicationId,
        "READY",
        {
          updatedAt: now,
          status: "DRAFT",
          validation: stored,
          validatedAt: now,
        },
      );
      if (!demoted) throw this.invalidTransition(publication);
      return demoted;
    }

    const updated = await this.deps.repository.updatePublication(projectId, publicationId, {
      updatedAt: now,
      validation: stored,
      validatedAt: now,
    });
    if (!updated) throw this.notFoundPublication(publicationId);
    return updated;
  }

  async schedulePublication(
    userId: string,
    projectId: string,
    publicationId: string,
    input: { scheduledFor: string; timezone: string },
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    if (publication.status !== "READY") {
      throw new PublishingError(
        "PUBLISHING_INVALID_TRANSITION",
        `Only a READY publication can be scheduled; this one is ${publication.status}.`,
      );
    }
    if (!Number.isFinite(Date.parse(input.scheduledFor))) {
      throw new PublishingError(
        "PUBLICATION_SCHEDULE_INVALID",
        "scheduledFor must be an ISO 8601 instant.",
      );
    }
    if (!isValidTimeZone(input.timezone)) {
      throw new PublishingError(
        "PUBLICATION_SCHEDULE_INVALID",
        "timezone must be an IANA time zone name.",
      );
    }
    if (!isFutureInstant(input.scheduledFor, this.deps.now())) {
      throw new PublishingError(
        "PUBLICATION_SCHEDULE_IN_PAST",
        "The scheduled time must be in the future (at least 30 seconds ahead).",
      );
    }

    const moved = await this.deps.repository.transitionPublication(
      projectId,
      publicationId,
      "READY",
      {
        updatedAt: this.deps.now(),
        status: "SCHEDULED",
        scheduledFor: input.scheduledFor,
        scheduledTimezone: input.timezone,
      },
    );
    if (!moved) throw this.invalidTransition(publication);
    return moved;
  }

  async unschedulePublication(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    const moved = await this.deps.repository.transitionPublication(
      projectId,
      publicationId,
      "SCHEDULED",
      {
        updatedAt: this.deps.now(),
        status: "READY",
        scheduledFor: null,
        scheduledTimezone: null,
      },
    );
    if (!moved) throw this.invalidTransition(publication);
    return moved;
  }

  async queuePublication(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    const moved = await this.deps.repository.transitionPublication(
      projectId,
      publicationId,
      "READY",
      { updatedAt: this.deps.now(), status: "QUEUED" },
    );
    if (!moved) throw this.invalidTransition(publication);
    return moved;
  }

  async cancelPublication(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    if (!CANCELLABLE_STATUSES.includes(publication.status)) {
      throw new PublishingError(
        publication.status === "PUBLISHED" || publication.status === "CANCELLED"
          ? "PUBLICATION_ALREADY_COMPLETED"
          : "PUBLISHING_INVALID_TRANSITION",
        `A publication in ${publication.status} cannot be cancelled.`,
      );
    }
    const moved = await this.deps.repository.transitionPublication(
      projectId,
      publicationId,
      publication.status,
      {
        updatedAt: this.deps.now(),
        status: "CANCELLED",
        cancelledAt: this.deps.now(),
      },
    );
    if (!moved) throw this.invalidTransition(publication);
    return moved;
  }

  async retryPublication(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    if (publication.status === "AUTH_REQUIRED") {
      throw new PublishingError(
        "PUBLISHING_PROVIDER_AUTH",
        "The destination account needs to be reconnected before this publication can be retried.",
      );
    }
    if (publication.status !== "FAILED") {
      throw new PublishingError(
        "PUBLISHING_INVALID_TRANSITION",
        `Only a FAILED publication can be retried; this one is ${publication.status}.`,
      );
    }
    const moved = await this.deps.repository.transitionPublication(
      projectId,
      publicationId,
      "FAILED",
      { updatedAt: this.deps.now(), status: "QUEUED" },
    );
    if (!moved) throw this.invalidTransition(publication);
    return moved;
  }

  async reconcilePublication(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    const moved = await this.deps.repository.transitionPublication(
      projectId,
      publicationId,
      "AMBIGUOUS",
      { updatedAt: this.deps.now(), status: "QUEUED" },
    );
    if (!moved) throw this.invalidTransition(publication);
    return moved;
  }

  // ------------------------------------------------------------ dispatch

  /**
   * Executes one publication the worker has already claimed into PUBLISHING.
   *
   * The source is re-resolved first: if the bytes changed since validation the
   * publication turns STALE instead of publishing content nobody approved. The
   * provider boundary classifies every failure, and the attempt is recorded
   * before the status moves, so evidence always exists for the state.
   */
  async dispatchClaimed(
    publication: PublicationRecord,
  ): Promise<PublicationRecord | null> {
    const projectId = publication.projectId;
    const now = this.deps.now();

    const resolution = await this.deps.resolver.resolve(
      projectId,
      publication.sourceType,
      publication.sourceId,
    );
    if (!resolution.ok) {
      return this.moveFromPublishing(publication, "STALE", {
        lastErrorCode: "SOURCE_UNRESOLVED",
        lastErrorMessage:
          resolution.findings[0]?.message ??
          "The publication source could not be resolved.",
      });
    }
    if (resolution.source.snapshot.contentSha256 !== publication.sourceHash) {
      return this.moveFromPublishing(publication, "STALE", {
        lastErrorCode: "SOURCE_UNRESOLVED",
        lastErrorMessage:
          "The source changed after validation; validate the publication again before publishing.",
      });
    }

    const connection = await this.deps.repository.getConnection(
      projectId,
      publication.connectionId,
    );
    if (!connection || connection.status !== "CONNECTED") {
      if (connection && connection.status !== "CONNECTED") {
        await this.deps.repository.updateConnection(projectId, connection.id, {
          updatedAt: now,
          status: connection.status === "DISCONNECTED" ? "DISCONNECTED" : "AUTH_REQUIRED",
          lastCheckedAt: now,
          lastErrorCode: "PUBLISHING_PROVIDER_AUTH",
        });
      }
      return this.moveFromPublishing(publication, "AUTH_REQUIRED", {
        lastErrorCode: "PUBLISHING_PROVIDER_AUTH",
        lastErrorMessage: "The destination account is not connected.",
      });
    }

    const cryptoLoad = this.deps.loadCrypto();
    if (!cryptoLoad.crypto) {
      return this.moveFromPublishing(publication, "FAILED", {
        lastErrorCode: "PUBLISHING_SECRETS_UNAVAILABLE",
        lastErrorMessage: cryptoLoad.problem ?? "Publishing secrets are unavailable.",
        lastErrorRetryable: true,
      });
    }

    const provider = this.deps.providers.get(connection.providerId);
    if (!provider) {
      return this.moveFromPublishing(publication, "FAILED", {
        lastErrorCode: "PUBLISHING_PROVIDER_UNAVAILABLE",
        lastErrorMessage: `Provider “${connection.providerId}” is not configured.`,
        lastErrorRetryable: false,
      });
    }

    if (!connection.credentialCiphertext) {
      return this.moveFromPublishing(publication, "AUTH_REQUIRED", {
        lastErrorCode: "PUBLISHING_PROVIDER_AUTH",
        lastErrorMessage: "The stored credential is missing; reconnect the account.",
      });
    }

    let credential: string;
    try {
      credential = cryptoLoad.crypto.box.open(connection.credentialCiphertext);
    } catch {
      return this.moveFromPublishing(publication, "FAILED", {
        lastErrorCode: "PUBLISHING_SECRETS_UNAVAILABLE",
        lastErrorMessage: "The stored credential could not be decrypted.",
        lastErrorRetryable: true,
      });
    }

    const attemptNumber = publication.attemptedCount + 1;
    const startedAt = now;
    try {
      const result = await provider.publish({
        credential,
        content: publication.content,
        idempotencyKey: publication.idempotencyKey,
      });
      const finishedAt = this.deps.now();
      await this.deps.repository.recordAttempt({
        id: this.deps.newId("attempt"),
        projectId,
        publicationId: publication.id,
        attemptNumber,
        outcome: "SUCCEEDED",
        providerRequestId: result.providerRequestId,
        errorCode: null,
        errorMessage: null,
        retryable: null,
        metadata: boundedAttemptMetadata({
          durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
        }),
        startedAt,
        finishedAt,
      });
      const moved = await this.deps.repository.transitionPublication(
        projectId,
        publication.id,
        "PUBLISHING",
        {
          updatedAt: finishedAt,
          status: "PUBLISHED",
          attemptedCount: attemptNumber,
          externalPostId: result.externalPostId,
          externalUrl: result.externalUrl,
          externalPublishedAt: result.publishedAt,
          publishedAt: finishedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorRetryable: null,
          analyticsRequestedAt: finishedAt,
          analyticsClaimedAt: null,
          analyticsErrorCode: null,
          analyticsErrorMessage: null,
        },
      );
      if (moved) return moved;
      return this.deps.repository.getPublication(projectId, publication.id);
    } catch (error) {
      const finishedAt = this.deps.now();
      const providerError = error instanceof ProviderError ? error : null;
      const kind = providerError?.failure.kind ?? "NETWORK";
      const message = sanitizeProviderMessage(
        providerError?.failure.message ??
          (error instanceof Error ? error.message : "The publish request failed."),
      );
      const status = statusForFailure(kind);
      await this.deps.repository.recordAttempt({
        id: this.deps.newId("attempt"),
        projectId,
        publicationId: publication.id,
        attemptNumber,
        outcome: status === "AMBIGUOUS" ? "AMBIGUOUS" : "FAILED",
        providerRequestId: null,
        errorCode: codeForFailure(kind),
        errorMessage: message,
        retryable: providerError?.failure.retryable ?? true,
        metadata: boundedAttemptMetadata({
          httpStatus: providerError?.failure.httpStatus ?? null,
          durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
        }),
        startedAt,
        finishedAt,
      });

      if (status === "AUTH_REQUIRED") {
        await this.deps.repository.updateConnection(projectId, connection.id, {
          updatedAt: finishedAt,
          status: "AUTH_REQUIRED",
          lastCheckedAt: finishedAt,
          lastErrorCode: "PUBLISHING_PROVIDER_AUTH",
        });
      }

      const moved = await this.deps.repository.transitionPublication(
        projectId,
        publication.id,
        "PUBLISHING",
        {
          updatedAt: finishedAt,
          status,
          attemptedCount: attemptNumber,
          lastErrorCode: codeForFailure(kind),
          lastErrorMessage: message,
          lastErrorRetryable: providerError?.failure.retryable ?? true,
        },
      );
      if (moved) return moved;
      return this.deps.repository.getPublication(projectId, publication.id);
    }
  }

  // ------------------------------------------------------------- helpers

  private async moveFromPublishing(
    publication: PublicationRecord,
    status: PublicationStatus,
    changes: {
      lastErrorCode: string;
      lastErrorMessage: string;
      lastErrorRetryable?: boolean | null;
    },
  ): Promise<PublicationRecord | null> {
    const moved = await this.deps.repository.transitionPublication(
      publication.projectId,
      publication.id,
      "PUBLISHING",
      {
        updatedAt: this.deps.now(),
        status,
        lastErrorCode: changes.lastErrorCode,
        lastErrorMessage: sanitizeProviderMessage(changes.lastErrorMessage),
        lastErrorRetryable: changes.lastErrorRetryable ?? null,
      },
    );
    if (moved) return moved;
    return this.deps.repository.getPublication(publication.projectId, publication.id);
  }

  private requireCrypto(): PublishingCrypto {
    const cryptoLoad = this.deps.loadCrypto();
    if (!cryptoLoad.crypto) {
      throw new PublishingError(
        "PUBLISHING_SECRETS_UNAVAILABLE",
        cryptoLoad.problem ?? "Publishing secrets are unavailable.",
      );
    }
    return cryptoLoad.crypto;
  }

  private openCredential(crypto: PublishingCrypto, envelope: string): string {
    try {
      return crypto.box.open(envelope);
    } catch {
      throw new PublishingError(
        "PUBLISHING_SECRETS_UNAVAILABLE",
        "The stored credential could not be decrypted.",
      );
    }
  }

  private requireProvider(providerId: string): PublishingProvider {
    const provider = this.deps.providers.get(providerId);
    if (!provider) {
      throw new PublishingError(
        "PUBLISHING_PROVIDER_UNAVAILABLE",
        `Provider “${providerId}” is not configured on this deployment.`,
      );
    }
    return provider;
  }

  private async requireConnection(
    projectId: string,
    connectionId: string,
  ): Promise<PublishingConnectionRecord> {
    const connection = await this.deps.repository.getConnection(projectId, connectionId);
    if (!connection) throw this.notFoundConnection(connectionId);
    return connection;
  }

  private async requirePublication(
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    const publication = await this.deps.repository.getPublication(projectId, publicationId);
    if (!publication) throw this.notFoundPublication(publicationId);
    return publication;
  }

  private notFoundConnection(connectionId: string): PublishingError {
    return new PublishingError(
      "CONNECTION_NOT_FOUND",
      `Publishing connection ${connectionId} was not found in this project.`,
    );
  }

  private notFoundPublication(publicationId: string): PublishingError {
    return new PublishingError(
      "PUBLICATION_NOT_FOUND",
      `Publication ${publicationId} was not found in this project.`,
    );
  }

  private invalidTransition(publication: PublicationRecord): PublishingError {
    return new PublishingError(
      "PUBLISHING_INVALID_TRANSITION",
      `The publication is no longer in ${publication.status}; reload it and try again.`,
    );
  }
}
