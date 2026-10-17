import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * A clearly-labeled stub Mastodon instance for the CP23 browser specs.
 *
 * The Next.js server and the publishing worker are started with this server's
 * URL as PUBLISHING_MASTODON_BASE_URL, so the browser flow crosses a real HTTP
 * boundary: the OAuth redirect, the token exchange, the credential check, the
 * status POST (including the Idempotency-Key replay) and the metric reads all
 * happen over the wire against a deterministic implementation. Nothing here
 * pretends to be the live provider; it exists so the suite can prove the
 * engine's real protocol behavior without vendor credentials.
 */

export type MastodonStubCounts = {
  favourites?: number;
  reblogs?: number;
  replies?: number;
};

export type MastodonStubPublishRequest = {
  idempotencyKey: string | null;
  postId: string | null;
  replayed: boolean;
  mode: string;
};

export type MastodonStubStatus = {
  postId: string;
  body: string;
  idempotencyKey: string;
  createdAt: string;
  counts: MastodonStubCounts | null;
  requestId: string;
};

export type MastodonPublishMode =
  | "accept"
  | "reject"
  | "rate-limit"
  | "abort-after-record";

export type MastodonStubController = {
  baseUrl: string;
  port: number;
  accessToken: string;
  tokenExchanges: number;
  authorizeNavigations: number;
  credentialChecks: number;
  metricReads: number;
  publishRequests: MastodonStubPublishRequest[];
  statuses: Map<string, MastodonStubStatus>;
  setPublishMode(mode: MastodonPublishMode): void;
  setMetricsFor(postId: string, counts: MastodonStubCounts): void;
  setDefaultMetrics(counts: MastodonStubCounts | null): void;
  publishedStatusIds(): string[];
  reset(): void;
  close(): Promise<void>;
};

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => resolve(raw));
  });
}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function startOnPort(port: number): Promise<MastodonStubController> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const accessToken = "e2e-access-token";
  const statuses = new Map<string, MastodonStubStatus>();
  const byIdempotencyKey = new Map<string, string>();
  let metricsFor = new Map<string, MastodonStubCounts>();
  let defaultMetrics: MastodonStubCounts | null = null;
  let publishMode: MastodonPublishMode = "accept";
  let nextPostNumber = 1;
  let nextRequestNumber = 1;

  const controller: MastodonStubController = {
    baseUrl,
    port,
    accessToken,
    tokenExchanges: 0,
    authorizeNavigations: 0,
    credentialChecks: 0,
    metricReads: 0,
    publishRequests: [],
    statuses,
    setPublishMode(mode) {
      publishMode = mode;
    },
    setMetricsFor(postId, counts) {
      metricsFor = new Map(metricsFor).set(postId, counts);
    },
    setDefaultMetrics(counts) {
      defaultMetrics = counts;
    },
    publishedStatusIds() {
      return [...statuses.keys()];
    },
    reset() {
      statuses.clear();
      byIdempotencyKey.clear();
      metricsFor = new Map();
      defaultMetrics = null;
      publishMode = "accept";
      controller.tokenExchanges = 0;
      controller.authorizeNavigations = 0;
      controller.credentialChecks = 0;
      controller.metricReads = 0;
      controller.publishRequests = [];
      nextPostNumber = 1;
      nextRequestNumber = 1;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", baseUrl);
      const path = url.pathname;

      if (request.method === "GET" && path === "/__stub/health") {
        return sendJson(response, 200, { ok: true, port });
      }

      if (request.method === "GET" && path === "/oauth/authorize") {
        controller.authorizeNavigations += 1;
        const redirectUri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state") ?? "";
        if (!redirectUri) {
          return sendJson(response, 400, { error: "redirect_uri is required" });
        }
        const target = new URL(redirectUri);
        target.searchParams.set("code", "e2e-code");
        target.searchParams.set("state", state);
        response.writeHead(302, { location: target.toString() });
        response.end();
        return;
      }

      if (request.method === "POST" && path === "/oauth/token") {
        controller.tokenExchanges += 1;
        await readBody(request);
        return sendJson(response, 200, {
          access_token: accessToken,
          token_type: "Bearer",
          scope: "read write",
          created_at: Math.floor(Date.now() / 1000),
        });
      }

      const authorization = request.headers["authorization"];
      const authed = authorization === `Bearer ${accessToken}`;

      if (
        request.method === "GET" &&
        path === "/api/v1/accounts/verify_credentials"
      ) {
        if (!authed) return sendJson(response, 401, { error: "unauthorized" });
        controller.credentialChecks += 1;
        return sendJson(response, 200, {
          id: "e2e-account-1",
          username: "contentos_e2e",
          display_name: "Content OS E2E",
        });
      }

      if (request.method === "POST" && path === "/api/v1/statuses") {
        if (!authed) return sendJson(response, 401, { error: "unauthorized" });
        const idempotencyKey = request.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
          return sendJson(response, 400, {
            error: "the e2e stub requires an Idempotency-Key header",
          });
        }

        if (publishMode === "reject") {
          controller.publishRequests.push({
            idempotencyKey,
            postId: null,
            replayed: false,
            mode: publishMode,
          });
          return sendJson(response, 422, { error: "e2e stub rejected the status" });
        }

        if (publishMode === "rate-limit") {
          controller.publishRequests.push({
            idempotencyKey,
            postId: null,
            replayed: false,
            mode: publishMode,
          });
          return sendJson(response, 429, { error: "e2e stub rate limit" });
        }

        const raw = await readBody(request);
        const form = new URLSearchParams(raw);
        const body = form.get("status") ?? "";

        const existingId = byIdempotencyKey.get(idempotencyKey);
        if (existingId) {
          controller.publishRequests.push({
            idempotencyKey,
            postId: existingId,
            replayed: true,
            mode: publishMode,
          });
          const existing = statuses.get(existingId)!;
          return sendJson(response, 200, {
            id: existing.postId,
            url: `${baseUrl}/@contentos_e2e/${existing.postId}`,
            created_at: existing.createdAt,
          });
        }

        const postId = `e2e-post-${nextPostNumber}`;
        nextPostNumber += 1;
        const requestId = `e2e-request-${nextRequestNumber}`;
        nextRequestNumber += 1;
        const counts =
          metricsFor.get(postId) ?? defaultMetrics ?? null;
        const record: MastodonStubStatus = {
          postId,
          body,
          idempotencyKey,
          createdAt: new Date().toISOString(),
          counts,
          requestId,
        };
        statuses.set(postId, record);
        byIdempotencyKey.set(idempotencyKey, postId);
        controller.publishRequests.push({
          idempotencyKey,
          postId,
          replayed: false,
          mode: publishMode,
        });

        if (publishMode === "abort-after-record") {
          request.socket.destroy();
          return;
        }

        return sendJson(
          response,
          200,
          {
            id: postId,
            url: `${baseUrl}/@contentos_e2e/${postId}`,
            created_at: record.createdAt,
          },
          { "x-request-id": requestId },
        );
      }

      const statusMatch = /^\/api\/v1\/statuses\/([^/]+)$/.exec(path);
      if (request.method === "GET" && statusMatch) {
        if (!authed) return sendJson(response, 401, { error: "unauthorized" });
        controller.metricReads += 1;
        const record = statuses.get(decodeURIComponent(statusMatch[1]!));
        if (!record) return sendJson(response, 404, { error: "not found" });
        const payload: Record<string, unknown> = {
          id: record.postId,
          url: `${baseUrl}/@contentos_e2e/${record.postId}`,
          created_at: record.createdAt,
        };
        const counts =
          metricsFor.get(record.postId) ?? defaultMetrics ?? record.counts;
        if (counts) {
          if (counts.favourites !== undefined) {
            payload["favourites_count"] = counts.favourites;
          }
          if (counts.reblogs !== undefined) {
            payload["reblogs_count"] = counts.reblogs;
          }
          if (counts.replies !== undefined) {
            payload["replies_count"] = counts.replies;
          }
        }
        return sendJson(response, 200, payload);
      }

      sendJson(response, 404, { error: "not found" });
    })().catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "stub failure" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `The e2e Mastodon stub cannot bind port ${port}; another process is using it.`,
          ),
        );
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", resolve);
  });
  server.unref();

  return controller;
}

type GlobalWithStub = typeof globalThis & {
  __contentOsMastodonStub?: Promise<MastodonStubController>;
};

export function ensureMastodonStub(): Promise<MastodonStubController> {
  const globalObject = globalThis as GlobalWithStub;
  if (!globalObject.__contentOsMastodonStub) {
    const port = Number(
      process.env["PUBLISHING_MASTODON_STUB_PORT"] ?? "4319",
    );
    globalObject.__contentOsMastodonStub = startOnPort(port);
  }
  return globalObject.__contentOsMastodonStub;
}
