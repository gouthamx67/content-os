# CP21 Acceptance Matrix — Campaign Engine / Launch Kit

Requirement-to-test map for CP21. Every row below was produced by an actual
run in this worktree; nothing here is inferred. Counts keep **specs (files)**
and **test cases** separate — a file count is never added to a case count.

## Test-count reconciliation

Counts come from the runner summary (`vitest run`); case-level counts come from
`vitest list --json` (discovery, no execution), which handles nested and
generated tests. The array length is the case count and distinct `file` values
are the file count.

| Scope | Specs (files) | Test cases | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| CP21 unit/integration (`src/modules/campaign-engine`) | 2 | 40 | 40 | 0 | 0 |
| Full unit/integration (`npm test`, `src/**/*.test.ts[x]`) | 143 | 1840 | 1840 | 0 | 0 |
| CP21 browser (`campaign.spec.ts` under `tests/e2e/`) | 1 | 3 | 3 | 0 | 0 |
| Full E2E (`npm run test:e2e`, `tests/**/*.spec.ts`) | 25 | 86 | 86 | 0 | 0 |

**Overall test-case total = 1,926** = 1,840 unit/integration cases + 86 E2E
cases. The two categories run under separate Vitest configs (`vitest.config.ts`
selects `src/**/*.test.ts[x]`; `vitest.e2e.config.ts` selects
`tests/**/*.spec.ts`) and their file sets do not overlap.

CP21-specific subsets: **2 specs / 40 cases** unit/integration + **1 spec / 3
cases** browser = **3 specs / 43 test cases**.

Exact commands:

- CP21 unit execution: `npx vitest run src/modules/campaign-engine` → `Test Files 2 passed (2)` / `Tests 40 passed (40)`.
- CP21 case-level discovery: `npx vitest list src/modules/campaign-engine --json=/tmp/cp21-unit.json` → 40 entries across 2 files.
- Full unit/integration: `npm test` → `Test Files 143 passed (143)` / `Tests 1840 passed (1840)`.
- Full E2E: `npm run test:e2e` → `Test Files 25 passed (25)` / `Tests 86 passed (86)`.

Per-file CP21 unit/integration cases: `campaign-domain.test.ts` 30,
`campaign-http.integration.test.ts` 10 (30+10 = 40). CP21 browser cases:
`campaign.spec.ts` 3.

## Verification gates (all observed green)

| Gate | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | clean (no output) |
| Lint | `npx eslint src/modules/campaign-engine "src/app/projects/[id]/campaigns" …` | clean |
| Build | `npm run build` | succeeded; campaign routes listed |
| DB (dev) | `DATABASE_URL=…content_os npx prisma db verify` | `ok:true`, storageHash `f81a20f6460f2f5144…` |
| Build/tests dev+test DB | `DATABASE_URL=…content_os_test npx prisma db verify` | `ok:true`, marker matches contract |
| Whitespace | `git diff --check` | clean |

## Legend

- PASS = an observed green test proves the requirement.
- Files are relative to the repository root.

## 1. Campaign domain, strategy, deliverables

| Requirement | Evidence | Result |
|---|---|---|
| Deterministic canonical serialization | `campaign-domain.test.ts` "hashes the same value the same way regardless of key order", "refuses to repair a stored value that is not an object" | PASS |
| Channel/platform/content-type resolution | domain "rejects an unknown platform", "rejects a platform the project does not plan around", "rejects a channel the platform does not carry", "rejects a content type that cannot publish to the platform", "resolves a default content type when only a channel is given", "treats an empty project platform list as registry-wide" | PASS |
| Brief validation | domain "requires every headline field", "defaults an empty brief and validates the launch window", "limits the number of deliverables" | PASS |
| Deterministic plan materialisation | domain "materialises a deterministic plan with resolvable formats"; `campaign-http.integration.test.ts` full lifecycle test | PASS |

## 2. AI / proposal boundary

| Requirement | Evidence | Result |
|---|---|---|
| Proposal derived without persisting | `campaign-http.integration.test.ts` "previews a proposal without persisting it" | PASS |
| A proposal that invents grounding is refused | domain "refuses an AI proposal that cites no grounding source" | PASS |
| Materialised plan's formats are validated | domain "rejects an unknown platform" + planner coverage | PASS |

## 3. Lifecycle + approval

| Requirement | Evidence | Result |
|---|---|---|
| Only documented transitions are allowed | domain "allows only the documented transitions", "returns the resulting status or refuses" | PASS |
| Material change invalidates an approval | domain "knows which changes invalidate an approval"; http "drops the approval when the campaign is edited" (→ `PLANNED`, `approvalHash` null) | PASS |
| Review is gated by readiness | http "refuses review while a blocking finding remains" (409 `CAMPAIGN_NOT_READY`) | PASS |
| Full lifecycle over HTTP | http "creates, plans, reviews, approves, assembles and exports a campaign" | PASS |
| Return to planning from review | http "returns an in-review campaign to planning" | PASS |

## 4. Scheduling + sequencing

| Requirement | Evidence | Result |
|---|---|---|
| Times parsed and kept inside the window | domain "parses only finite instants", "keeps a scheduled time inside the window" | PASS |
| Ordering puts scheduled before unscheduled | domain "orders scheduled deliverables before unscheduled ones" | PASS |
| Same-platform same-instant double post is flagged | domain "flags a same-platform same-instant double post" | PASS |

## 5. Readiness validator

| Requirement | Evidence | Result |
|---|---|---|
| Stable codes, severity, entity, remediation | `domain/readiness.ts`; domain "is ready when strategy, plan, grounding and deliverables line up" | PASS |
| Blocks missing strategy/plan | domain "blocks a campaign with no strategy or plan" | PASS |
| Blocks a marker-blocked deliverable | domain "blocks a deliverable marked blocked" | PASS |
| Blocks cross-project artifact links | domain "blocks a link to an artifact from another project"; http "refuses a link to another project's writing document" (403 `CAMPAIGN_CROSS_PROJECT_ARTIFACT`) | PASS |
| Warns (not blocks) for unscheduled | domain "warns rather than blocks for an unscheduled deliverable" | PASS |

## 6. Launch Kit assembly + export

| Requirement | Evidence | Result |
|---|---|---|
| Deterministic kit hash independent of assembly time | domain "hashes the same kit the same way regardless of assembly time" | PASS |
| Hash changes on material change | domain "changes the hash when the campaign materially changes" | PASS |
| Export carries no filesystem paths or secrets | domain "refuses to export a kit carrying a filesystem path or a secret" | PASS |
| Export is schema-tagged canonical JSON | domain "exports a schema-tagged document"; e2e "exports the assembled kit as canonical, non-leaking JSON" (schema `content-os.campaign-launch-kit`, version 1) | PASS |
| Export before assembly is refused | http lifecycle test (409 `CAMPAIGN_LAUNCH_KIT_NOT_ASSEMBLED`); e2e same guard | PASS |

## 7. Concurrency / conflicts

| Requirement | Evidence | Result |
|---|---|---|
| Stale revision → structured conflict | `campaign-http.integration.test.ts` "reports a stale revision as a conflict" (409 `CAMPAIGN_REVISION_CONFLICT`) | PASS |

## 8. Security

| Requirement | Evidence | Result |
|---|---|---|
| Auth required on campaign routes | http "rejects creating a campaign without a session" (401) | PASS |
| Cross-origin POST refused | http "refuses a cross-origin create even with a valid cookie" (403) | PASS |
| Project ownership enforced | http "hides a campaign that belongs to a project the caller is not in" / non-member reads as `[403,404]` | PASS |

## 9. UI surfaces (browser)

| Surface | Evidence | Result |
|---|---|---|
| Campaign list + create form | e2e `campaign.spec.ts` create flow (`campaign-name` → detail page) | PASS |
| Lifecycle controls + status | e2e "plans, reviews, approves and assembles a campaign in the browser" (status `DRAFT`→`PLANNED`→`IN_REVIEW`→`APPROVED`, export enabled after assemble) | PASS |
| Deliverables + readiness panels | e2e final assertions on `deliverable-row` and `readiness-check` | PASS |
| Export link | e2e "exports the assembled kit as canonical, non-leaking JSON" | PASS |

## 10. Migration / schema

| Requirement | Evidence | Result |
|---|---|---|
| Campaign schema is contract-verified on both DBs | `prisma db verify` on `content_os` and `content_os_test` → marker `f81a20f6460f…`, "Database marker and schema match contract" | PASS |

## 11. Verification gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS (clean) |
| `npx eslint` (campaign module, routes, UI) | PASS (clean) |
| `npm test` | PASS (143 files / 1840 cases) |
| `npm run build` | PASS |
| `npx prisma db verify` (dev + test) | PASS (both) |
| `npm run test:e2e` | PASS (25 files / 86 cases) |

## 12. Mandatory CP21 summary

Every CP21 requirement listed above is **PASS**. No mandatory CP21 item is
FAIL or UNVERIFIED as of the completed verification.
