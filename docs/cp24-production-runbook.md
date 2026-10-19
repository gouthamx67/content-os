# CP24 Production Runbook

CP24 hardens Content OS for production by enforcing same-origin/auth boundaries, bounded I/O, honest feature disclosure, worker lease recovery, and operational tooling (backup/restore, cleanup, load test). All CP24 changes are uncommitted.

## Architecture & Principles
- Contract-first Prisma; migrations are additive only. Forbidden: `prisma generate`, `migrate dev`, `db push`, `db pull`. Allowed: `contract emit`, `migration plan`, `db migrate`, `db verify`, `migrate status/resolve`.
- No faked success: provider availability/publication success/metrics/worker health are never fabricated. Live external ops run only when authorized credentials exist.
- App Router conventions; `[id]` project routes preserved. Same-origin enforced on protected routes.
- Error semantics: `wrapHttpError` preserves `HttpError` status/message; fallback < 500 echoes `error.message`; default 500 returns generic "Request failed". `sanitizeError` redacts messages to ≤500 chars.

## Security
- **Same-origin**: `isSameOrigin` treats missing `Origin` as same-origin (integration tests pass). Enforced on 16 protected project subroutes and auth mutating flows (`login`, `register`, `logout` return 403 on cross-origin).
- **Auth routes**: `authLogin` (key `clientIdentity|email`), `authRegister` (same keying), `logout` clears session via `buildClearSessionCookie()` and validates same-origin.
- **Timing**: `auth-service.login` uses a module-level cached dummy scrypt hash (`dummyPasswordHash()` of `"content-os-timing-equalizer"`) so unknown-user path performs equal work as valid-user path.
- **Body limits**: all JSON endpoints use `parseJsonBody` (6MB max, 8192 chunk limit). `request.json()` was fully removed (15 route conversions).
- **LLM fetch hardening**: `llmFetch` (4MB response cap via `LLM_RESPONSE_MAX_BYTES`), `redirect: "error"`, bounded JSON read (`readBoundedJson`); remote providers return 502 on unreadable/over-limit rather than echoing internals.
- **CSP**: headers() only, no nonce/proxy. Directives: `default-src 'self'`, `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` only in dev), `style-src 'self' 'unsafe-inline'`, `img-src 'self' blob: data:`, `media-src 'self' blob: data:`, `font-src 'self' data:`, `connect-src 'self'`, `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. `unsafe-inline` required for RSC/React style attributes. Nonce-based CSP is a documented follow-up.
- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP, `Permissions-Policy` allows `camera/microphone/display-capture=(self)`, `geolocation=()`; `Strict-Transport-Security` added only when `CONTENT_OS_ENABLE_HSTS === "1"`.
- **Rate limiting**: fixed-window via `rate_limit_event` insert-then-count. Responses: 429 with code `RATE_LIMITED` and `Retry-After`. Identity = user id / normalized email / IP only when `CONTENT_OS_TRUST_PROXY === "1"`. Fail-open on store error with `rate_limit.store_failed` warn.
- **Secrets**: no secrets/tokens/DB creds/personal data in logs or reports; `sanitizeError` and `logEvent` write redacted JSON lines.

## Reliability & Worker Leases
- **Lease model**: `claimNext` sets `leaseExpiresAt = now+5min` (conceptually). `renewLease` updates while RUNNING (returns boolean; fails for non-RUNNING). `markSucceeded/Failed/Cancelled` clear lease and guard terminal writes (boolean return; second attempt returns false).
- **Reclaim**: `reclaimExpiredLeases(now)` — CANCEL_REQUESTED + expired → CANCELLED; RUNNING + expired → QUEUED with `errorCode = WORKER_LEASE_EXPIRED` and resets `progressPct=0`, `startedAt=null`. Publishing reclaim mirrors this (`reclaimStalePublishing`).
- **Heartbeat**: `worker_heartbeat` per worker kind; liveness: `ACTIVE` if RUNNING + lastTickAt fresh, `STALE` if RUNNING but old, else `OFFLINE`. Reported by `/api/health` (and render/audio health detail).
- **Shutdown**: first SIGINT/SIGTERM → graceful drain; second → `process.exit(130)`.
- **Publishers**: publication becomes `AMBIGUOUS` on stale PUBLISHING (`PUBLISHER_OUTCOME_UNKNOWN`) and reconciliation uses idempotency key (never blind republish).

## Observability & Health
- `/api/health`: readiness is real DB probe (`SELECT 1`); 503 if unreachable. Returns `workers` (from heartbeat table), `capabilities` (config-only). Rate-limited via healthProbe.
- `/api/health/render`: probes FFmpeg capabilities (cached 5min) with timeouts; returns sanitized booleans + render worker liveness; logs on error.
- `/api/health/audio`: probes FFmpeg presence via `getFfmpegVersion` with timeouts; sanitized booleans + audio worker liveness.

## Performance
- **Analytics**: `listAttempts` capped to 200; `createSnapshots` relies on unique constraint (drops pre-SELECT); `listSnapshots` takes newest-1000 and reverses to ascending; `latestSnapshotPoints` uses `SELECT DISTINCT ON ("publicationId","metricKey") … ORDER BY … "collectedAt" DESC` with in-memory filter to requested IDs.
- **Variants**: `enqueueVariants` throws `IMAGE_VARIANT_LIMIT_EXCEEDED` (400) when `specs.length > 8` (`IMAGE_GENERATION_LIMITS.maxVariants`).

## Data Recovery
- **Backup**: `scripts/backup.sh [output-dir]` creates custom-format `pg_dump -Fc` of DB, tar of `CONTENT_OS_STORAGE_PATH` (default `.content-os`), and sha256 manifest. Fails if `DATABASE_URL` missing or `pg_dump` absent.
- **Restore drill**: `scripts/restore-drill.sh [backup-dir] [timestamp]` recreates scratch DB `content_os_restore_drill` (via `psql` DROP/CREATE to avoid transaction issues), restores dump, verifies ≥10 tables and `user` non-negative count, and checks storage tar readability. Does not touch live DB.
- **Cleanup**: `scripts/cleanup.ts` dry-run by default (`--apply` to perform). Prunes `rate_limit_event` older than `--rate-retention-hours` (default 24) and `worker_heartbeat` with `lastTickAt` older than `--heartbeat-retention-days` (default 14). Trade-off documented.

## Deployment & CI
- CI (`.github/workflows/ci.yml`): build-and-test (Postgres 16 on 5433, `contract emit`, `db migrate`, `db verify` on test DB, `tsc --noEmit`, `eslint`, `npm test`, `npm run build`); e2e (FFmpeg + Chromium, applies migrations, runs `npm run test:e2e`). GitHub execution not performed here (reported honestly as UNVERIFIED).
- Production build via `next start`; e2e harness uses production build with optional autostart; `restartServer` only restarts servers it started.
- `npm run load:test` (≤500 requests, concurrency ≤16) measures p50/p95/p99 and exit codes non-zero on failures or budget exceeded.

## Known Trade-offs
- **Input-storage I/O inside DB tx**: per-storage-key advisory lock makes `deleteInput` atomic with `countByStorageKey === 0` (deletes storage inside lock). Moving `put` outside would reintroduce dangling-key races. **Do not refactor.** Monitor `pg_stat_activity`; puts bounded by input size limits. Documented in CP24 notes.
- **CSP nonce**: headers-only CSP currently requires `unsafe-inline` for RSC/React style attributes; nonce-based CSP is a follow-up task.
- **HSTS**: opt-in only via `CONTENT_OS_ENABLE_HSTS === "1"` (local HTTP development never sends it).
- **eval warnings in dev builds**: React development may emit eval warnings; CSP includes `unsafe-eval` in development only; production has no `unsafe-eval`.

## Verification Commands
```bash
npx tsc --noEmit
npx eslint . --no-cache
npm test
npm run build
npx prisma db verify  # dev
DATABASE_URL=postgresql://contentos:contentos@localhost:5433/content_os_test npx prisma db verify  # test
npm run test:e2e  # or targeted smoke
git diff --check
git status --short
```

## Operational Scripts
- `npm run backup [dir]`
- `npm run restore:drill [dir] [stamp]`
- `npm run cleanup [--apply] [--rate-retention-hours N] [--heartbeat-retention-days M]`
- `npm run load:test [--base URL] [--requests N] [--concurrency C]`
