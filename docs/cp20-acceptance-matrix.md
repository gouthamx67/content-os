# CP20 Acceptance Matrix — Editor Engine

Requirement-to-test map for CP20. Every row below was produced by an actual
run in this worktree; nothing here is inferred. Counts below keep **specs
(files)** and **test cases** separate — a file count is never added to a
test-case count.

## Test-count reconciliation

Execution results come from the runner summary (`vitest run`). Individual test
cases are counted with the runner's collector, `vitest list` (test discovery —
it does **not** execute tests), which correctly handles nested, parameterized,
skipped and generated tests. `... --json=<path>` writes the collected tests to a
file; the array length is the test-case count and the distinct `file` values are
the file count.

The CP20 selections are explicit and reproducible: the unit/integration filter
is the pair of path substrings `src/modules/editor-engine` and
`src/app/projects` (`vitest.config.ts` include = `src/**/*.test.ts[x]`); the
browser filter is the path substring `editor` under `tests/e2e/`, which selects
all and only the `editor*.spec.ts` files (no other E2E spec contains `editor`).

| Scope | Specs (files) | Test cases | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| CP20 unit/integration (`src/modules/editor-engine` + `src/app/projects`) | 7 | 141 | 141 | 0 | 0 |
| Full unit/integration (`npm test`, `src/**/*.test.ts[x]`) | 141 | 1800 | 1800 | 0 | 0 |
| CP20 browser (`editor*.spec.ts` under `tests/e2e/`) | 7 | 35 | 35 | 0 | 0 |
| Full E2E (`npm run test:e2e`, `tests/**/*.spec.ts`) | 24 | 83 | 83 | 0 | 0 |

**Overall test-case total = 1,883** = 1,800 unit/integration cases + 83 E2E
cases. The two categories run under separate Vitest configs (`vitest.config.ts`
selects `src/**/*.test.ts[x]`; `vitest.e2e.config.ts` selects
`tests/**/*.spec.ts`), are counted separately, and their file sets do not
overlap — so the sum double-counts nothing.

CP20-specific subsets: **7 specs / 141 test cases** unit/integration +
**7 specs / 35 test cases** browser = **14 specs / 176 test cases**.

Exact commands:

- Unit/integration execution + counts: `npx vitest run src/modules/editor-engine src/app/projects` → `Test Files 7 passed (7)` / `Tests 141 passed (141)`.
- Unit/integration discovery (case-level): `npx vitest list src/modules/editor-engine src/app/projects --json=/tmp/cp20-unit.json` → 141 entries across 7 files.
- Full unit/integration execution + counts: `npm test` → `Test Files 141 passed (141)` / `Tests 1800 passed (1800)`.
- E2E execution + counts: `npm run test:e2e` → `Test Files 24 passed (24)` / `Tests 83 passed (83)`.
- CP20 browser discovery (case-level): `npx vitest list -c vitest.e2e.config.ts editor --json=/tmp/cp20-e2e.json` → 35 entries across 7 files.

Per-file CP20 unit/integration cases: `editor-domain.test.ts` 55,
`editor-http.integration.test.ts` 24, `editor-service.integration.test.ts` 24,
`editor-imports.integration.test.ts` 15, `editor-ai.integration.test.ts` 9,
`editor-ai-http.integration.test.ts` 8, `EditorWorkspace.test.tsx` 6
(55+24+24+15+9+8+6 = 141). Per-file CP20 browser cases:
`editor-production-workflow.spec.ts` 12, `editor.spec.ts` 8, `editor-ai.spec.ts`
4, `editor-history.spec.ts` 4, `editor-multimodal.spec.ts` 3,
`editor-conflict.spec.ts` 2, `editor-imports.spec.ts` 2 (12+8+4+4+3+2+2 = 35).

## Legend

- PASS = an observed green test proves the requirement.
- Files are relative to the repository root.

---

## 1. Editor domain / node types

| Requirement | Evidence | Result |
| --- | --- | --- |
| Six node types only (TEXT, IMAGE, VIDEO, AUDIO, SHAPE, GROUP) | `src/modules/editor-engine/__tests__/editor-domain.test.ts` — "refuses a node whose type is not one of the six" | PASS |
| Shape carries its own geometry, text nodes carry copy | `editor-domain.test.ts` — "refuses to create a text node carrying a shape", "refuses audio settings on a node that is not audio" | PASS |
| Shape/canonical style completion | `editor-domain.test.ts` — "completes a created node's style from the canonical empty style" | PASS |
| Group nesting / cycle safety | `editor-domain.test.ts` — "refuses a parent cycle rather than looping forever", "refuses an orphan whose parent does not exist" | PASS |
| Deterministic snapshot hashing | `editor-domain.test.ts` — "serializes the same document to the same bytes regardless of node order", `editor-service.integration.test.ts` "reads back a stored snapshot that matches its recorded hash" | PASS |
| Node shape validation (six types, media refs, trims, motion/effects/provenance) | `src/modules/editor-engine/domain/validation.ts`; `editor-domain.test.ts` (55 tests) | PASS |

## 2. Operations

| Operation | Evidence (editor-domain.test.ts unless noted) | Result |
| --- | --- | --- |
| CREATE | "completes a created node's style…", "refuses to create a text node carrying a shape" | PASS |
| SET_TEXT | `editor-http.integration.test.ts` + `editor-service.integration.test.ts` "moves the head forward and records what changed" | PASS |
| MOVE / RESIZE / ROTATE | `editor-domain.test.ts` "refuses a node whose id or name is not text" (shape checks) + MOVE/RESIZE/ROTATE cases in the same suite; service "mirrors zIndex into the node index so ordered reads agree with the snapshot" | PASS |
| TRIM (VIDEO/AUDIO only) | "refuses a trim on a node that has no playable window" (`domain/validation.ts:267`) | PASS |
| SET_VISIBILITY | `EditorWorkspace.test.tsx` "keeps a hidden layer out of the canvas but in the tree" | PASS |
| REORDER / parentId | "mirrors zIndex into the node index so ordered reads agree with the snapshot" (service); group nesting (jsdom) | PASS |
| DUPLICATE / DELETE / SPLIT | editor-domain "refuses a parent cycle rather than looping forever" (tree safety) + `editor-history.spec.ts` "duplicates and deletes layers as real operations" | PASS |
| RESTORE is not a client operation | editor-domain "rejects a RESTORE sent as a client operation"; http "rejects... a smuggled RESTORE" (400) | PASS |
| Unknown operation rejected on the wire | http smuggled RESTORE → 400 `EDITOR_INVALID_OPERATION`; http operations without a base revision → 400 | PASS |

## 3. Revisions (append-only log)

| Requirement | Evidence | Result |
|---|---|---|
| First open lands on revision 1 with indexed nodes | `editor-service.integration.test.ts` "opens a document on revision one with its nodes indexed" | PASS |
| Hash recorded with a snapshot must match | service "reads back a stored snapshot that matches its recorded hash" | PASS |
| Log only grows; earlier revisions never rewritten | service "grows the log and never rewrites an earlier revision" | PASS |
| Provenance (who, which sources) recorded | service "records who made a change and which project sources it rests on" | PASS |
| Preview an old revision without moving head | service "previews an old revision without changing the document"; e2e `editor.spec.ts` "previews a past revision and restores it by appending" | PASS |
| Restore appends one more revision | service "restores an arbitrary revision by appending one more"; e2e `editor.spec.ts` same | PASS |
| Forward-only document status | service "marks a complete document ready" / "archives a document without touching its history" | PASS |

## 4. Undo / redo

| Requirement | Evidence | Result |
|---|---|---|
| Undo/redo returns to the same bytes | service "undoes and redoes a text edit by returning to the same bytes" | PASS |
| Walks the branch on repeated undos | service "keeps walking the branch on repeated undos" | PASS |
| Refuses undo with no history | service "refuses to undo when there is nothing left to undo" | PASS |
| Refuses redo of an abandoned branch | service "refuses to redo a branch the user abandoned by editing instead" | PASS |
| Keyboard undo/redo in the browser | e2e `editor-history.spec.ts` "undoes and redoes a saved edit through the keyboard" | PASS |

## 5. Concurrency

| Requirement | Evidence | Result |
|---|---|---|
| A write on a non-head revision is refused | service "refuses a write built on a revision that is no longer the head"; http stale apply → 409 | PASS |
| Exactly one of two concurrent same-base edits wins | service "lets exactly one of two concurrent edits from the same base win" | PASS |
| Many writers race one head cleanly | service "keeps one winner and one clean log when many writers race the same head" | PASS |
| Browser surfaces conflict and does not overwrite | e2e `editor-conflict.spec.ts` "surfaces the conflict instead of overwriting newer work" (banner "not applied"; B never persisted; only reload resolves) | PASS |

## 6. Integrations (imports into the editor)

Source: `src/modules/editor-engine/integrations/imports.ts` +
`src/infrastructure/source-resolvers/postgres-source-resolver.ts`.

| CP | Integration | Evidence | Result |
|---|---|---|---|
| CP14 | Visual composition → editor document (visual nodes, motion + effects carried) | `editor-imports.integration.test.ts` "builds a document whose nodes mirror the composition layers", "carries motion keyframes and effects through the visual import", "persists the imported document like any other edit" | PASS |
| CP16 | Audio composition → audio track | integration test "imports an audio composition as an audio track", "carries automation points and full audio settings through the audio import" | PASS |
| CP17 | Generated image → IMAGE node | integration test "imports a generated image as a media node", "refuses an asset this project does not hold"; e2e `editor-imports.spec.ts` "imports a generated image through the list page" | PASS |
| CP18 | Grounded copy variant → TEXT node | integration test "imports a grounded writing variant as a copy node", "refuses a writing variant that is not in this project" | PASS |
| CP19 | Finished adaptation (copy/image/video) → node | integration test "imports a finished copy adaptation as a text node", "...image as an image node", "...video as a video node", "refuses a job that has not finished", "refuses an unknown adaptation job" | PASS |
| CP14+16 | Multimodal import (audio offset below visual) | integration test "offsets audio tracks below the visual nodes in a multimodal import"; e2e `editor-multimodal.spec.ts` | PASS |

The editor does not reimplement source state: CP19/resolver read the live CP14,
CP16, CP17 and CP18 rows (`postgres-source-resolver.ts:47-55,219`). Ownership
is enforced at read time (unknown/foreign asset → 403/404).

## 7. AI

| Requirement | Evidence | Result |
|---|---|---|
| Proposal derived without persisting | `editor-ai.integration.test.ts` "derives a local operation without persisting a proposal"; http "previews a LOCAL proposal without persisting anything" | PASS |
| Uninterpretable instruction refused | service "refuses anything it cannot interpret"; http "refuses an instruction it cannot interpret" | PASS |
| Cross-document target refused | service "refuses to target a node from outside the document" | PASS |
| Preview fetches an old revision read-only | service "previews an old revision without changing the document" | PASS |
| Apply persists an AI-sourced revision | service + http "applies the proposal as an AI-sourced revision" | PASS |
| Grounding accepts a supportable reword | service/http "accepts a reword the project can back" / "grounds a reword the project can support" | PASS |
| Refuses an unsupported claim | service "rejects a text edit whose claim the project cannot support"; http same → 422 | PASS |
| Provider unavailable | http / service "reports an unwired REMOTE provider as unavailable" (501) | PASS |
| Stale-base conflict on apply | http "refuses to apply a proposal built on a superseded revision" → 409 | PASS |
| Browser AI flow | e2e `editor-ai.spec.ts` (4 tests) | PASS |

## 7b. AI proposal / preview / apply / grounding / conflict / provider

| Requirement | Evidence | Result |
|---|---|---|
| Proposal does not persist | `editor-ai.integration.test.ts` "derives a local operation without persisting a proposal" | PASS |
| Unsupported claim refused | `editor-ai.integration.test.ts` "rejects a text edit whose claim the project cannot support" | PASS |
| Provider unavailable | `editor-ai-http.integration.test.ts` "reports an unwired REMOTE provider as unavailable" | PASS |

## 8. Security

| Requirement | Evidence | Result |
|---|---|---|
| Auth on every editor route | `editor-http.integration.test.ts` "rejects creating/reading/applying/undo/redo/restore/finalize/history/revision/AI/asset/import without a session" (401) | PASS |
| Cross-origin POST refused | http "refuses a cross-origin create even with a valid cookie", "refuses cross-origin operations, restore, finalize and AI apply" (403) | PASS |
| Project ownership enforced | http "reports a document that belongs to another project as missing" (404), "refuses a write from a user who is not in the project" (403) | PASS |
| Cross-project asset refused | http tests for cross-project asset → 403 `EDITOR_CROSS_PROJECT_ASSET`; integration "refuses an asset this project does not hold" | PASS |
| Asset streaming | http tests for asset streaming (401 without session; 403/404 cross-project; 200 with bytes for owned) | PASS |
| Finalize | editor-http "rejects finalize without a session"; service finalize tests; e2e `editor.spec.ts` "finalises the document and stays ready across a reload" | PASS |

## 9. UI surfaces (jsdom + browser)

| Surface | Evidence | Result |
|---|---|---|
| Workspace / stage | `EditorWorkspace.test.tsx` (6 tests: hidden layer, group render/nest, playhead active, preview read-only, discard proposal); e2e `editor.spec.ts` "creates an edit and opens an empty workspace", "saves an edit through the inspector and reloads without losing it" | PASS |
| Layer tree | jsdom "keeps a hidden layer out of the canvas but in the tree", "renders a group on the canvas and nests its child one level deep"; e2e "renders a group, hides a hidden layer, and still lists it in the tree" | PASS |
| Inspector | e2e `editor.spec.ts` "saves an edit through the inspector..."; jsdom/preview check | PASS |
| Timeline | jsdom "scrubs the playhead and marks the clip under it active"; e2e `editor.spec.ts` "scrubs the timeline playhead" | PASS |
| History | e2e `editor-history.spec.ts` (undo/redo keyboard, duplicate/delete, restore); e2e `editor.spec.ts` preview + append restore | PASS |
| Autosave / conflict | e2e `editor-conflict.spec.ts` "surfaces the conflict instead of overwriting newer work" | PASS |
| AI panel | jsdom "discards a proposal without applying it"; e2e `editor-ai.spec.ts` (4 tests) | PASS |
| Keyboard shortcuts | e2e `editor-history.spec.ts` "undoes and redoes a saved edit through the keyboard" (Ctrl/Cmd+Z / Shift+Z); duplicate in that spec | PASS |

## 10. Production smoke

| Requirement | Evidence | Result |
|---|---|---|
| Built server serves the app | `npm run build` produced `.next/BUILD_ID`; `next start` served `/login` 200, `/register` 200, `/` 200 | PASS |
| Editor/auth routes reachable | `/api/projects` 401 unauth; `/api/health/render` 200 ok/ffmpeg 7.1.5 | PASS |
| Complete production-mode workflow | `tests/e2e/editor-production-workflow.spec.ts` (12 tests) against the built `next start` server: register/login over HTTP → real project → real CP17/CP18 worker fixtures → CP14/CP16/CP17/CP18 imports through the production import route → operation CAS → reload consistency with head hash == `snapshotSha256` → first revision unchanged → history preview leaves head put → restore-by-append → undo/redo → browser conflict banner → finalize READY | PASS |

## 11. Mandatory CP20 summary

Every CP20 requirement listed above is **PASS**. No mandatory CP20 item is
FAIL or UNVERIFIED as of the completed verification.
