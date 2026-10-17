# CP23 Acceptance Matrix — Publishing, Analytics & Optimization Engine

Requirement-to-test map for CP23. Every row below was produced by an actual run
in this worktree; nothing here is inferred. Counts keep **specs (files)** and
**test cases** separate — a file count is never added to a case count.

CP23 is additive: it reuses CP1–CP22 (auth, project authorization, same-origin
guard, grounding, revision checks, writing documents, campaign deliverables,
the worker/health pattern, and the provider boundary). It introduces no second
project/user/workspace/content/asset/campaign/localization/editor/provider
system, no second AI SDK, and no parallel job runner.

## Test-count reconciliation

Counts come from the runner summary (`vitest run`); case-level counts come from
`vitest list --json` (discovery, no execution). The array length is the case
count and distinct `file` values are the file count.

| Scope | Specs (files) | Test cases | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| CP23 unit/integration (`src/modules/publishing-engine`) | 7 | 55 | 55 | 0 | 0 |
| Full unit/integration (`npm test`, `src/**/*.test.ts[x]`) | 157 | 1956 | 1956 | 0 | 0 |
| CP23 browser (`publishing.spec.ts` + `analytics.spec.ts`) | 2 | 8 | 8 | 0 | 0 |
| Full E2E (`npm run test:e2e`, `tests/**/*.spec.ts`) | 28 | 98 | 98 | 0 | 0 |

**Overall test-case total = 2,054** = 1,956 unit/integration cases + 98 E2E
cases. The two categories run under separate Vitest configs (`vitest.config.ts`
selects `src/**/*.test.ts[x]`; `vitest.e2e.config.ts` selects
`tests/**/*.spec.ts`) and their file sets do not overlap.

CP23-specific subsets: **7 specs / 55 cases** unit/integration + **2 specs / 8
cases** browser = **9 specs / 63 test cases**.

Per-file CP23 unit/integration cases: `lifecycle.test.ts` 5,
`secrets.test.ts` 10, `metrics.test.ts` 8, `source-resolver.test.ts` 7,
`mastodon-provider.test.ts` 14, `publishing-worker.test.ts` 6,
`publishing-integration.test.ts` 5 (5+10+8+7+14+6+5 = 55). CP23 browser cases:
`publishing.spec.ts` 5, `analytics.spec.ts` 3.

Exact commands:

- CP23 unit execution: `npx vitest run src/modules/publishing-engine` → `Test Files 7 passed (7)` / `Tests 55 passed (55)`.
- CP23 case-level discovery: `npx vitest list src/modules/publishing-engine --json=/tmp/opencode/cp23-unit.json` → 55 entries across 7 files.
- Full unit/integration: `npm test` → `Test Files 157 passed (157)` / `Tests 1956 passed (1956)`.
- Full E2E: `npm run test:e2e` → `Test Files 28 passed (28)` / `Tests 98 passed (98)`.

## Honesty of the evidence

What each evidence class actually proves:

| Evidence class | What ran | What it does **not** claim |
|---|---|---|
| Production smoke (no provider env) | Real built server on the dev DB; providers `[]`, `cryptoProblem` reported, connect refused with `PUBLISHING_SECRETS_UNAVAILABLE`, empty analytics states render | No live vendor publication or metric was attempted; this is the honest unavailable path |
| CP23 browser specs | Real Chromium, real Next server, real publishing worker, real Postgres, real HTTP against a clearly-labeled stub Mastodon (`tests/e2e/support/mastodon-stub.ts`) used as `PUBLISHING_MASTODON_BASE_URL` | Not a live vendor account; the stub is a test fixture, never a production mock |
| Provider contract tests (`mastodon-provider.test.ts`) | The real `MastodonPublishingProvider` against an injected `fetchImpl`: OAuth exchange, credential check, status POST with `Idempotency-Key`, 422/429/5xx/timeout classification, metric reads | No network boundary; classification logic only |
| DB integration (`publishing-integration.test.ts`) | Real Postgres on `content_os_test`: create/validate/queue claim, duplicate snapshot skip, cross-project isolation, insufficient-evidence refusal | No provider HTTP for the success path; the dead-port dispatch proves the AMBIGUOUS classification |
| Unit tests | Pure domain: lifecycle, metrics, secrets, resolver | Nothing about runtime wiring; that is what the other classes cover |

No requirement row below claims LIVE vendor confirmation, because no live
credentials exist in this environment.

## Requirement map

Legend: **PASS** = implemented and covered by a cited executed test or observed
command; **UNVERIFIED** = implemented but not executable in this environment.

### Provider connection

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| P1 | Start connection via signed OAuth state; redirect derived from the request origin, never client input | `publishing-service.ts` `startConnection`; `src/app/api/projects/[id]/publishing/connections/route.ts`; `OAuthStateSigner` | `secrets.test.ts` sign/verify/tamper; `publishing.spec.ts` connect flow drives the real redirect chain (`tokenExchanges === 1`) | PASS |
| P2 | Complete connection only from the callback; state verified before token exchange | `publishing-service.ts` `completeConnection`; `oauth/callback/route.ts` checks query state == cookie state | `publishing.spec.ts` connect produces a `CONNECTED` row only after the real callback | PASS |
| P3 | Credentials sealed at rest (AES-256-GCM v1 envelope), never plaintext | `secrets.ts` `PublishingSecretBox`; sealed in `completeConnection` | `secrets.test.ts` round-trip, tamper rejection, malformed rejection; integration test stores only ciphertext | PASS |
| P4 | Verify connection against the provider's own credential check | `verifyConnection` + provider `verifyCredential` | `publishing.spec.ts` (`credentialChecks >= 1`); `mastodon-provider.test.ts` verify mapping | PASS |
| P5 | Disconnect revokes local credential; one account per provider enforced | `disconnectConnection`; `CONNECTION_ALREADY_CONNECTED` guard | integration test connection creation + cross-project read; UI `connection-disconnect` flow in `publishing.spec.ts` | PASS |
| P6 | Missing secrets/provider reported honestly, never a fake success | `loadPublishingCrypto`; catalog `cryptoProblem`; `PUBLISHING_SECRETS_UNAVAILABLE` | Production smoke: `providers []`, `cryptoProblem "PUBLISHING_SECRET_KEY is not configured"`, connect → 503 `PUBLISHING_SECRETS_UNAVAILABLE`; `secrets.test.ts` missing/invalid key cases | PASS |

### Publication lifecycle

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| L1 | Create draft only from a resolvable, approved source | `source-resolver.ts`; `createPublication` | integration test create + `SOURCE_NOT_FOUND` refusal; `source-resolver.test.ts` campaign not approved / not READY / ambiguous links | PASS |
| L2 | Validate re-resolves the source, refreshes the hash, blocks on grounding errors | `validatePublication`; `validation.ts` | `publishing.spec.ts` validate → READY with `SOURCE_GROUNDING_NOT_EVALUATED` warning; `source-resolver.test.ts` UNSUPPORTED/REVIEW error finding; `lifecycle.test.ts` | PASS |
| L3 | Publish only after validation; `QUEUED` is not `PUBLISHED` | `queuePublication`/`publishPublication` transition READY→QUEUED; only dispatch success sets PUBLISHED | `publishing.spec.ts` test 1 observes QUEUED before the worker's confirmed PUBLISHED; test 4 holds QUEUED with the worker stopped | PASS |
| L4 | External URL/post id recorded only from the provider's own response | `dispatchClaimed` maps `result.externalPostId/Url`; stub echoes its own ids | `publishing.spec.ts` asserts `externalPostId === "e2e-post-…"` returned by the stub; no fabricated ids anywhere | PASS |
| L5 | Schedule with future-only instant and IANA timezone | `schedulePublication`, `isFutureInstant`, `isValidTimeZone` | `lifecycle.test.ts`; UI schedule flow in the workspace (`publication-schedule*` testids) | PASS |
| L6 | Cancel/retry/reconcile follow the declared status graph | `cancelPublication`, `retryPublication`, `reconcilePublication`; `lifecycle.ts` | `lifecycle.test.ts` cancellable set; `publishing.spec.ts` retry FAILED→PUBLISHED and reconcile AMBIGUOUS→PUBLISHED | PASS |
| L7 | A source edited after validation turns the publication STALE before any provider call | `dispatchClaimed` hash re-check → `STALE` / `SOURCE_UNRESOLVED` | `publishing.spec.ts` stale test (worker stopped, document edited, worker restarted, zero stub requests) | PASS |
| L8 | PARTIALLY_PUBLISHED semantics | Not applicable: v1 publishes to exactly one destination per publication | Single-connection model in `Publication`; recorded here as the documented non-goal | PASS (N/A) |

### Worker, attempts and evidence

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| W1 | Durable queue in Postgres, claimed with `FOR UPDATE SKIP LOCKED` | `claimPlan` in `postgres-publishing-repository.ts` | integration test concurrent double claim: exactly one winner; `publishing-worker.test.ts` claim ordering | PASS |
| W2 | Every provider attempt recorded before the status moves | `recordAttempt` then `moveFromPublishing`; UI attempts list | `publishing.spec.ts` attempts show `SUCCEEDED · request e2e-request-1`, `FAILED`, `AMBIGUOUS` rows | PASS |
| W3 | Failure classification: AUTH / PERMANENT / RATE_LIMITED / TRANSIENT / AMBIGUOUS | `providers/mastodon.ts` + `publishing-service.ts` code map | `mastodon-provider.test.ts` 422/429/503/timeout/401 cases; `publishing.spec.ts` rejection and ambiguous cases; integration test dead-port dispatch → AMBIGUOUS | PASS |
| W4 | Idempotency key stable per publication; reconcile reuses it | `Publication.idempotencyKey`; `publish({idempotencyKey})` | `publishing.spec.ts` reconcile: two stub requests, same key, second `replayed=true`, same post id, no duplicate | PASS |
| W5 | Worker health mirrors the CP15 pattern; crashes are visible | `PublishingWorker` + `RenderWorkerHealth` | `publishing-worker.test.ts` tick/count/failed/abort cases | PASS |
| W6 | Credential/authorization failure marks the connection `AUTH_REQUIRED` | `dispatchClaimed`/`collectClaimed` AUTH branch | `publishing-worker.test.ts` analytics failure counting; provider AUTH mapping test | PASS |

### Analytics

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| A1 | Metrics are provider readings only, with provenance | `analytics-service.ts` `collectClaimed`; `providers/mastodon.ts` `fetchMetrics` | `publishing.spec.ts` UI shows `PROVIDER_API · collected …`; `mastodon-provider.test.ts` reading shape | PASS |
| A2 | History is append-only; duplicate `(publication, key, collectedAt)` skipped | `createSnapshots` pre-check + unique race handling | integration test: 2 stored, duplicate → 0, later timestamp → 1, latest-per-key reduction | PASS |
| A3 | Missing metrics render as unavailable, never zero | overview builds metric views from stored snapshots only | `publishing.spec.ts`/`analytics.spec.ts`: row D has no `favourites` cell, shows the engagement-unavailable copy; DB holds only `reblogs` | PASS |
| A4 | Engagement derived with an explicit formula, unavailable when partial | `metrics.ts` `deriveEngagement`; `analytics-engagement` copy includes formula | `metrics.test.ts`; `analytics.spec.ts` asserts `Engagement 15` text and unavailable copy on the partial post | PASS |
| A5 | Refresh is an explicit request the worker fulfils; failures surface, no hot loop | `refresh` sets `analyticsRequestedAt`; `collectClaimed` clears it on completion/failure and records `analyticsErrorCode` | `analytics.spec.ts` beforeAll collection; `publishing-worker.test.ts` failure counting | PASS |
| A6 | Invalid provider readings are rejected, nothing stored | finite/integer/≥0 validation before `createSnapshots` | `mastodon-provider.test.ts` negative/fractional → PERMANENT; service validation path | PASS |

### Optimization

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| O1 | Minimum sample of 3 complete-engagement posts or an honest refusal | `generate`; `OPTIMIZATION_INSUFFICIENT_EVIDENCE` with counts | integration test fresh project → 409 with `sampleSize 0`; production smoke → 409 same code | PASS |
| O2 | Deterministic rules (outlier ≥2× median gap ≥3; 2h window ≥1.5× median) | `domain/metrics.ts` `suggestRecommendations` | `metrics.test.ts` observed 15 / baseline 2, timing `utc-14`, confidence bands | PASS |
| O3 | Every recommendation carries evidence referencing stored measurements | `evidenceFingerprint`, `provenanceOf`, evidence items | `analytics.spec.ts` evidence contains `observed 15`, `sample 3`, the source publication id | PASS |
| O4 | Accept creates a draft only — never publishes | `accept` creates DRAFT clone with `recommendationId`/`originPublicationId` | `analytics.spec.ts` asserts DRAFT + stub status count unchanged; integration test clone assertions | PASS |
| O5 | Dismiss persists; revival only on materially changed evidence | dedupe by `dedupeKey` + `evidenceFingerprint` | `analytics.spec.ts` dismissed stays DISMISSED, regeneration reports `0 new, 0 revived` | PASS |
| O6 | No arbitrary/opaque generation: recommendations are rule outputs, not LLM prose | rule-derived titles/explanations with explicit limitations | `metrics.test.ts`; `analytics.spec.ts` categories `PERFORMANCE_OUTLIER`/`TIMING_WINDOW` | PASS |

### API, authorization, UI and security

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| S1 | Auth required; cross-project reads/writes return 404 (no existence leak) | `authorizeProject` + `requirePublication(projectId, id)` | `publishing.spec.ts` cross-project detail/validate 404, foreign connection list empty, foreign create 404; integration test same | PASS |
| S2 | POST routes enforce same-origin | `isSameOrigin` on connection start and state-changing routes | Production smoke: cross-origin POST → 403 `Cross-origin request`; same-origin POST proceeds | PASS |
| S3 | No secrets/logs leak tokens, ciphertext, or provider payloads | errors sanitized (`providerError` messages bounded), sealed envelope never returned | `secrets.test.ts` ciphertext contains no plaintext; UI/API payloads expose no credential fields | PASS |
| S4 | Workspace UI exposes the full lifecycle with testids | `PublishingWorkspace.tsx`, `AnalyticsDashboard.tsx` | `publishing.spec.ts` + `analytics.spec.ts` drive `publication-*`, `connection-*`, `analytics-*`, `recommendation-*` testids in a real browser | PASS |
| S5 | No `localStorage`/session storage as canonical state | all state is Postgres-backed; UI holds only transient view state | E2E flows survive full page reloads (`publishing.spec.ts` reload before failure/retry) | PASS |
| S6 | No `any`, placeholder handlers, or fabricated success | strict TypeScript; ESLint clean | `npx tsc --noEmit` clean; `npx eslint . --no-cache` 0 errors | PASS |

### Contract and migration

| # | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| D1 | Contract-first Prisma; exactly one additive migration | 5 models / 7 enums appended in `contract.prisma`; `migrations/app/20261017T1632_add_publishing_engine` (37 additive ops) | `npx prisma contract emit`; migration plan/apply output reviewed | PASS |
| D2 | Dev DB matches contract | `content_os` | `npx prisma db verify` → `ok:true`, storageHash `338846283391f49bc3968302c8edac2643e21a5d80ccf4cfebf4f68af5b1306e` | PASS |
| D3 | Test DB matches contract independently | `content_os_test` | `DATABASE_URL=…content_os_test npx prisma db verify` → `ok:true`, same contract/marker hashes | PASS |

## Verification gates (all observed green)

| Gate | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | clean (no output) |
| Lint | `npx eslint . --no-cache` | 0 errors; 2 pre-existing `<img>` warnings in CP17 image-generation UI, untouched by CP23 |
| Unit/integration | `npm test` | `Test Files 157 passed (157)` / `Tests 1956 passed (1956)` |
| Build | `npm run build` | succeeded; `/projects/[id]/publishing` and `/projects/[id]/analytics` listed |
| DB (dev) | `DATABASE_URL=…content_os npx prisma db verify` | `ok:true`; contract == marker (`338846283391…` / `3916f444…`) |
| DB (test) | `DATABASE_URL=…content_os_test npx prisma db verify` | `ok:true`; contract == marker |
| Browser E2E | `npm run test:e2e` | `Test Files 28 passed (28)` / `Tests 98 passed (98)` |
| Whitespace | `git diff --check` | clean |

## Production smoke (observed, honest unavailable path)

Built server on the dev DB with `PUBLISHING_*` unset:

- `GET /api/projects/{id}/publishing/providers` → `{providers: [], cryptoProblem: "PUBLISHING_SECRET_KEY is not configured"}`
- `POST …/publishing/connections` → `503` `PUBLISHING_SECRETS_UNAVAILABLE` (no fake connection)
- `GET …/publishing/publications` → `{publications: []}`; `GET …/analytics` → `{publications: [], totals:{publishedCount:0, measuredCount:0, engagement:null}}`
- `POST …/optimization/recommendations` → `409` `OPTIMIZATION_INSUFFICIENT_EVIDENCE` ("Only 0 published post(s)…")
- `/projects/{id}/publishing` renders the secrets warning and the "No publishing provider is configured" copy; `/projects/{id}/analytics` renders its empty state
- Cross-origin POST → `403 Cross-origin request`; same-origin POSTs proceed as above

No live vendor publication, metric read, or URL was claimed. Live vendor
against a real Mastodon instance remains UNVERIFIED (no credentials in this
environment); the real protocol surface is exercised over HTTP against the
clearly-labeled stub in E2E and against an injected `fetchImpl` in the contract
tests.

## Known limitations (documented, not defects)

- One destination per publication; `PARTIALLY_PUBLISHED` is intentionally absent.
- The analyzer is rule-based by design; recommendations never invent prose and
  carry explicit limitations.
- No live vendor credentials exist in this environment; the report below marks
  live-provider verification as UNVERIFIED rather than passing it.
