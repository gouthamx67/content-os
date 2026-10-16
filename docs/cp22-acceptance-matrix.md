# CP22 Acceptance Matrix — Localization Engine

Requirement-to-test map for CP22. Every row below was produced by an actual
run in this worktree; nothing here is inferred. Counts keep **specs (files)**
and **test cases** separate — a file count is never added to a case count.

CP22 is additive: it reuses CP1–CP21 (auth, project authorization, same-origin
guard, grounding, the provider-shaped AI boundary, and the writing/editor/
adaptation/campaign systems as localization *sources*). It introduces no second
AI SDK, no second registry, and no duplicate writing/adaptation/asset system.

## Test-count reconciliation

Counts come from the runner summary (`vitest run`); case-level counts come from
`vitest list --json` (discovery, no execution), which handles nested and
generated tests. The array length is the case count and distinct `file` values
are the file count.

| Scope | Specs (files) | Test cases | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| CP22 unit/integration (`src/modules/localization-engine`) | 7 | 61 | 61 | 0 | 0 |
| Full unit/integration (`npm test`, `src/**/*.test.ts[x]`) | 150 | 1901 | 1901 | 0 | 0 |
| CP22 browser (`localization.spec.ts` under `tests/e2e/`) | 1 | 4 | 4 | 0 | 0 |
| Full E2E (`npm run test:e2e`, `tests/**/*.spec.ts`) | 26 | 90 | 90 | 0 | 0 |

**Overall test-case total = 1,991** = 1,901 unit/integration cases + 90 E2E
cases. The two categories run under separate Vitest configs (`vitest.config.ts`
selects `src/**/*.test.ts[x]`; `vitest.e2e.config.ts` selects
`tests/**/*.spec.ts`) and their file sets do not overlap.

CP22-specific subsets: **7 specs / 61 cases** unit/integration + **1 spec / 4
cases** browser = **8 specs / 65 test cases**.

Per-file CP22 unit/integration cases: `localization-domain.test.ts` 31,
`localization-http.integration.test.ts` 7, `localization-imports.integration.test.ts`
5, `localization-security.integration.test.ts` 7,
`localization-export.integration.test.ts` 2, `localization-remote-provider.test.ts`
8, `localization-translation.integration.test.ts` 1 (31+7+5+7+2+8+1 = 61). CP22
browser cases: `localization.spec.ts` 4.

Exact commands:

- CP22 unit execution: `npx vitest run src/modules/localization-engine` → `Test Files 7 passed (7)` / `Tests 61 passed (61)`.
- CP22 case-level discovery: `npx vitest list src/modules/localization-engine --json=/tmp/cp22-unit.json` → 61 entries across 7 files.
- Full unit/integration: `npm test` → `Test Files 150 passed (150)` / `Tests 1901 passed (1901)`.
- Full E2E: `npm run test:e2e` → `Test Files 26 passed (26)` / `Tests 90 passed (90)`.

## Verification gates (all observed green)

| Gate | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | clean (no output) |
| Lint | `npx eslint src/modules/localization-engine "src/app/projects/[id]/localization" "src/app/api/projects/[id]/localization" src/infrastructure/container.ts src/infrastructure/services.ts tests/e2e/localization.spec.ts` | clean |
| Build | `npm run build` | succeeded; `/projects/[id]/localization` and `/projects/[id]/localization/[jobId]` listed |
| DB (dev) | `DATABASE_URL=…content_os npx prisma db verify` | `ok:true`, storageHash `b279fc3ac210c13e71f42c89be61f3ee6821b9dc10f6d5f3ab5a0ce51c38e31c` |
| DB (test) | `DATABASE_URL=…content_os_test npx prisma db verify` | `ok:true`, same marker; contract == marker |
| Whitespace | `git diff --check` | clean |

## Legend

- PASS = an observed green test proves the requirement.
- Files are relative to the repository root.

## 1. Locale configuration and canonicalization

| Requirement | Evidence | Result |
|---|---|---|
| Locale codes canonicalized (`pt-br` → `pt-BR`) | domain "canonicalizes case and region subtags"; http "configures locales and canonicalizes the code" | PASS |
| Invalid BCP-47 tags refused | domain "refuses a tag that is not BCP-47"; security "refuses an invalid locale" | PASS |
| Direction comes from trust data, never the language name | domain "resolves direction from the locale's trust data, not the language name" | PASS |
| A duplicate locale is refused | http "rejects a duplicate locale" | PASS |
| A job needs a configured target and a source locale | http "configures locales and canonicalizes the code"; security "refuses an invalid locale" | PASS |

## 2. Source extraction / imports

| Requirement | Evidence | Result |
|---|---|---|
| Writing document → headline + body segments | imports "reads a writing document into headline and body segments" | PASS |
| Editor document head revision → text nodes | imports "reads an editor document's head revision text nodes" | PASS |
| Text adaptation → segments; non-text refused | imports "reads a text adaptation job and refuses a non-text one" | PASS |
| Campaign brief fields → segments | imports "reads a campaign's brief fields" | PASS |
| Unknown source type refused | domain "extracts segments and refuses an unregistered source type"; security "refuses an unknown source type" | PASS |
| Missing source resolves to not-found | domain "treats a missing source as not found" | PASS |
| Extraction order does not change the source hash | domain "hashes drafts independently of order" | PASS |

## 3. Domain: placeholders, glossary, segment identity

| Requirement | Evidence | Result |
|---|---|---|
| Every placeholder family extracted and sorted | domain "extracts every token family in sorted order" | PASS |
| Missing/added placeholder tokens reported | domain "reports missing and added tokens" | PASS |
| A wrong-form pinned term is flagged | domain "flags a pinned term rendered in the wrong form" | PASS |
| A `doNotTranslate` term must survive verbatim | domain "requires a doNotTranslate term to survive verbatim" | PASS |
| Pinned terms applied to the segment that contains them | domain "pins the terms a source actually contains", "pins a doNotTranslate term to itself" | PASS |
| Missing target is validation's job, not glossary's | domain "does not flag a missing target (validation owns that)" | PASS |
| Segment id is stable and derived from path | domain "derives a stable id from the path and records placeholders" | PASS |

## 4. Provider boundary and hallucination guards

| Requirement | Evidence | Result |
|---|---|---|
| Provider output parsed only in the documented shape | domain "parses only the documented shape" | PASS |
| Provider must cover every segment exactly once | domain "requires exactly-once coverage" | PASS |
| Rules provider substitutes only non-pinned terms | domain "substitutes non-pinned glossary terms and leaves the rest" | PASS |
| An unknown provider name is refused, not silently defaulted | domain "refuses an unknown provider name"; security "refuses an unavailable provider by name" (503 `LOCALIZATION_PROVIDER_UNAVAILABLE`) | PASS |
| No second AI registry — the existing provider port is reused | `services/localization-provider.ts` and `services/remote-llm-provider.ts` both implement the module's `LocalizationProvider` port; registry is `createLocalizationProviderRegistry()` | PASS |
| The remote provider posts an OpenAI-compatible request and parses the model JSON | `localization-remote-provider.test.ts` "posts the prompt to the model endpoint" / "parses a fenced JSON reply" | PASS |
| A transport/HTTP failure is `LOCALIZATION_PROVIDER_UNAVAILABLE`, not a silent pass | `localization-remote-provider.test.ts` "maps a transport failure to a provider-unavailable error" | PASS |
| A malformed or under-covering reply is `LOCALIZATION_PROVIDER_INVALID_OUTPUT` | `localization-remote-provider.test.ts` "rejects a reply with no usable targets" | PASS |
| Config falls back to the writing-model environment when localization vars are absent | `localization-remote-provider.test.ts` config cases | PASS |

## 4.1 Real translation through the remote provider

The engine ships a second provider, `remote-llm`, that calls an
OpenAI-compatible `/chat/completions` endpoint to translate. When
`LOCALIZATION_LLM_*` (or the `WRITING_LLM_*` fallback) is unconfigured the
provider is not registered and the API answers `LOCALIZATION_PROVIDER_UNAVAILABLE`
(503) rather than pretending to translate. The evidence below runs the real
HTTP boundary — a local model endpoint that performs an English→Spanish
translation — through the same route handlers and database the app serves.

| Requirement | Evidence | Result |
|---|---|---|
| Real cross-language output, not identity substitution | `localization-translation.integration.test.ts` translates `Hello world.` / `Second paragraph.` into Spanish (`Hola mundo.`); every exported target text differs from its source | PASS |
| The translated text reaches the exported artifact unchanged | same test: after review → approve → apply → export, `artifact.targetLocale` is `es` and targets contain `Hola` / `mundo` | PASS |
| Provider and model are recorded as provenance | same test: `job.provider`/`snapshot.provider` = `remote-llm`, `providerModel` = `stub-mt-1`, and the exported artifact carries both | PASS |
| The glossary reaches the model and is honored | same test asserts the captured prompt contains `Hello => Hola` and the lane `en to es`; glossary validation still passes on the model's output | PASS |
| No model configured ⇒ an unavailable error, never a fake translation | `localization-remote-provider.test.ts` "returns null when no localization model is configured"; security "refuses an unavailable provider by name" | PASS |
| The remote-llm lifecycle also runs through the browser, not only route handlers | e2e "uses remote-llm provider and preserves source hash through the UI": the started server lists `remote-llm` in the provider select, and process → validate → approve → apply → preview run in the UI; the previewed artifact carries `remote-llm` / `stub-mt-1`, `targetLocale` `es`, and `Hola`/`mundo` targets that differ from their sources | PASS |
| Localizing never rewrites the source document | same e2e test: the writing document's `contentSha256` and content are byte-identical before and after the applied export | PASS |

## 5. Validation and readiness

| Requirement | Evidence | Result |
|---|---|---|
| Each class of problem is flagged with a code + severity | domain "flags each class of problem" | PASS |
| A glossary violation is an error | domain "flags a glossary violation as an error" | PASS |
| Duplicate segment ids are detected | domain "flags a duplicate segment id" | PASS |
| Blocking findings make a translation not ready | domain "marks a translation with blocking findings as not ready" | PASS |
| Warnings alone still count as ready | domain "is ready when the only findings are warnings" | PASS |
| Empty source is a readiness error | domain "flags an empty source as a readiness error" | PASS |
| Approval is refused while a blocker remains | http "surfaces a blocker and refuses approval until it is fixed" | PASS |

## 6. Lifecycle, versioning, immutability

| Requirement | Evidence | Result |
|---|---|---|
| Only mapped transitions are allowed | domain "allows only the mapped transitions" | PASS |
| Editability rules are explicit | domain "knows which states are editable" | PASS |
| Full lifecycle over HTTP | http "runs create → process → validate → approve → apply → export" | PASS |
| A stale expected revision is a structured conflict | http "refuses a stale revision with a structured conflict" | PASS |
| A job can be sent back for changes | http "sends a job back for changes" | PASS |
| Glossary is applied during processing | http "applies the glossary during processing" | PASS |
| Every act appends an immutable revision (never mutates the source) | http full-lifecycle test + `__tests__/helpers.ts` reads the source through the writing repository, never rewriting it | PASS |

## 7. Staleness on source change

| Requirement | Evidence | Result |
|---|---|---|
| A moved source revision marks the job stale | imports "marks a job stale when the writing document version moves" | PASS |
| HTTP validate reports staleness explicitly | e2e "marks a job stale when its source changes" (409/`stale:true`, status `STALE`) | PASS |

## 7b. Staleness end-to-end over the browser

| Requirement | Evidence | Result |
|---|---|---|
| Source change marks the job stale through the real server | `tests/e2e/localization.spec.ts` "marks a job stale when its source changes" | PASS |

## 7.1 Canonical serialization and translation memory

| Requirement | Evidence | Result |
|---|---|---|
| Equal values hash equal regardless of key order | domain "hashes equal values to the same digest regardless of key order" | PASS |
| A corrupt stored row is refused, not repaired | domain "refuses to repair a corrupt stored row" | PASS |
| Translation memory normalizes whitespace before hashing | domain "normalizes whitespace before hashing" | PASS |

## 7.2 Errors

| Requirement | Evidence | Result |
|---|---|---|
| Errors carry a stable code and an HTTP status | domain "carries a code and an HTTP status" | PASS |

## 8. Materialization and export

| Requirement | Evidence | Result |
|---|---|---|
| Artifact carries only text and hashes — never storage keys | domain "carries only text and hashes, never storage keys" | PASS |
| Export is refused before the job is applied | export "refuses to export before the job is applied" (409 `LOCALIZATION_NOT_APPROVED`); e2e "refuses export before apply and rejects cross-project access" | PASS |
| Export is deterministic once applied | export "exports a deterministic artifact once applied" | PASS |
| Artifact is previewed and downloadable in the UI | e2e "localizes, reviews, applies and previews an artifact through the UI" (contains `targetLocale`, `schemaVersion`, `targetHash`) | PASS |

## 9. HTTP API and access control

| Requirement | Evidence | Result |
|---|---|---|
| A session is required to read localization state | security "requires a session to list jobs" | PASS |
| Cross-origin writes are refused | security "refuses a cross-origin write" (403) | PASS |
| Another project's job is hidden (404, not leaked) | security "hides another project's job from a stranger"; e2e cross-project export → 404 | PASS |
| A cross-project source is refused instead of leaked | security "refuses a cross-project source instead of leaking it" | PASS |

## 10. Persistence and migrations

| Requirement | Evidence | Result |
|---|---|---|
| CP22 tables exist in the contract and both databases | `src/prisma/contract.prisma` (`ProjectLocale`, `LocaleGlossary`, `TranslationMemory`, `LocalizationJob`, `LocalizationRevision`); migration `migrations/app/20261013T1515_add_localization_engine/` | PASS |
| Dev and test DB markers match the contract | `prisma db verify` on both → `ok:true`, identical storageHash | PASS |
| No forbidden Prisma command was used | migration applied with `db update`/`db migrate`; `db verify` observed | PASS |

## 11. UI

| Requirement | Evidence | Result |
|---|---|---|
| Locale configuration via the UI | e2e "configures locales…" steps add source + target (`add-locale`) and see the canonical `pt-BR` | PASS |
| Job creation, processing, review, apply via the UI | e2e "localizes, reviews, applies and previews an artifact through the UI" (`create-localization` → `process-localization` → `approve-localization` → `apply-localization`) | PASS |
| Segments, findings, glossary, history, artifact panels render | `src/app/projects/[id]/localization/[jobId]/{SegmentReviewTable,LocalizationFindings,LocaleGlossaryPanel,LocalizationHistory,LocalizedArtifactPanel}.tsx` | PASS |
| The available providers are listed and selectable, and the chosen provider is used | `GET /api/projects/[id]/localization/providers` → `{ providers }`; `[jobId]/LocalizationWorkspace.tsx` provider `<select data-testid="localization-provider">` passes `provider` on process; e2e "uses remote-llm provider and preserves source hash through the UI" selects `remote-llm` and the exported artifact records it | PASS |

## 12. Honest capability limits

These rows state plainly what the engine does and does not do, so no reader
mistakes an unbuilt capability for a working one. Rows marked `UNVERIFIED` are
deliberate boundaries with no test claiming otherwise; the rest are proven.

| Capability | Why it is not claimed |
|---|---|
| `Intl.Segmenter`-based segmentation | Not used; sourcing splits by paragraph via the module's own `text` adapter. |
| Locale-correct plural/date/number formatting of target text | Direction is stored explicitly; number/date formatting is not performed on the localized body. |
| RTL layout mirroring in the editor | `direction` is captured and carried on the artifact, but no RTL layout engine is implemented. |
| Translation memory reuse ranking | `TranslationMemory` is stored and hashed, but no similarity/fuzzy-match lookup is exposed. |

Real cross-language translation is **not** a limit: the `remote-llm` provider
performs it and is proven in §4.1. It registers only when a model is
configured; with no model configured the API degrades to a 503 rather than a
fake result. The default `local-rules` provider remains substitution-only and
makes no translation claim.
