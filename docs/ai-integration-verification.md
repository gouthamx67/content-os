# AI Integration & Verification

This pass wires real model inference into every feature that already had a seam
for it, proves each boundary with tests, and reports exactly what was observed
versus not. Nothing here changes CP05–CP24 acceptance behavior: deterministic
services stay deterministic, model output is still validated against project
context, and nothing is persisted without the approvals the checkpoints define.

Status vocabulary used in `docs/ai-integration-matrix.md`:

- **LIVE** — a real external model call was made and observed in this workspace.
- **CONTRACT** — the seam is wired through the full service path and proven
  against a local model stub (real HTTP, real container, real database); no
  external call was observed.
- **DETERMINISTIC** — intentionally rule-based; model inference is not part of
  the design and no seam exists to enable.
- **DISABLED** — the seam is implemented and wired, but gated off by
  environment in this deployment; enabling is one env var plus an endpoint.
- **FAIL (observed)** — live attempt made and rejected by the provider (for
  example, billing).

## Runtime design

One transport serves all chat-completion seams: `src/lib/llm-chat.ts` posts to
`{baseUrl}/chat/completions` with a bounded body read (`src/lib/llm-http.ts`,
redirects refused, response size capped) and a failover chain of at most four
endpoints (`MAX_ENDPOINTS = 4`). Failover moves to the next endpoint only on
retryable conditions: network errors, timeouts, 401/403, 408, 429, 5xx,
unreadable or oversized bodies, and empty completions. Any other 4xx, schema or
grounding failure is final — the chain never launders a wrong answer into a
different provider's answer. Errors are sanitized to a host label plus reason;
no bodies, headers, prompts or keys appear in errors or logs.

Fallback slots are environment-driven and domain-configurable, with the
unnumbered names for slot 1 and `_2` / `_3` suffixes for the later slots:

| Domain | Primary | Fallbacks | Inherits from |
|---|---|---|---|
| Writing (CP18) | `WRITING_LLM_*` | `WRITING_LLM_FALLBACK[_2/_3]_*` | — |
| Localization (CP22) | `LOCALIZATION_LLM_*` | `LOCALIZATION_LLM_FALLBACK[_2/_3]_*` | `WRITING_LLM_FALLBACK*` per slot |
| AI interpretation seams | `CONTENT_OS_AI_*` | `CONTENT_OS_AI_FALLBACK[_2/_3]_*` | `WRITING_LLM_*` / `WRITING_LLM_FALLBACK*` |
| Image | `IMAGE_LLM_*` | — | — |

Gating: the interpretation seams compose into the container only when
`CONTENT_OS_AI_INTERPRETATION=1` (browser: `CONTENT_OS_AI_BROWSER=1`) **and** an
AI endpoint is configured. A gate without an endpoint logs
`startup.ai_gate_without_provider` and is ignored; `src/lib/server-config.ts`
fails startup validation outright for that combination. Endpoint validation
covers every prefix: `http(s)` URL shape, positive integer timeout, and
`BASE_URL`/`MODEL` pair completeness (half a pair is a startup issue).

`GET /api/health` capabilities now report each provider honestly, including
fallback counts (with inheritance), for example in this workspace:

```json
"writingProvider":      { "available": true,  "detail": "configured with 3 fallback endpoint(s)" },
"localizationProvider": { "available": true,  "detail": "configured with 3 fallback endpoint(s)" },
"aiProvider":           { "available": true,  "detail": "configured with 3 fallback endpoint(s)" },
"aiInterpretation":     { "available": false, "detail": "disabled (set CONTENT_OS_AI_INTERPRETATION=1 to enable)" }
```

## Capability matrix (summary)

| Feature | Seam | Status in this workspace |
|---|---|---|
| Content intent (CP06/09) | `AiContentIntentInterpreter` | DISABLED (seam wired; interpretation only asked when rules cannot fill) |
| Intelligence interpretation | `AiIntelligenceInterpretationProvider` | DISABLED |
| Brand interpretation | `AiBrandInterpretationProvider` | DISABLED |
| Creative direction (CP10) | `AiCreativeDirector` + deterministic fallback | **LIVE** (real model call observed) |
| Storyboard planning (CP11) | `AiStoryboardPlanner` + deterministic fallback | DISABLED |
| Recommendations (CP12/23) | `AiContentRecommendationRefiner` + deterministic | DISABLED |
| Writing / rewriting (CP18) | `REMOTE_LLM` provider + fallback chain | **LIVE** |
| Editor AI (CP20) | remote seam to `providers.ai` | DISABLED (UI contract covered by existing E2E) |
| Localization (CP22) | `remote-llm` provider + fallback chain | **LIVE** |
| Image generation (CP17) | `REMOTE_IMAGE` provider (real adapter) | **FAIL (observed)** — provider returned HTTP 429 (account billing) |
| Browser planning | `AiBrowserPlanner` | DISABLED |
| Platform adaptation (CP19) | none | DETERMINISTIC |
| Campaign strategy (CP21) | none | DETERMINISTIC |
| Publishing analytics optimization (CP23) | none | DETERMINISTIC |
| Legacy generation service | inference through `AIProvider` port | wired; with no endpoint it records an honest failed job ("AI provider is not configured") |

## Live evidence

`npm run ai:smoke` — one bounded request per configured feature, no retries
beyond the configured failover chain, keys read from `.env` and never printed.
Result on 2026-10-19 (this workspace's chain: OpenAI → Groq → NVIDIA →
OpenRouter):

```
[PASS] Writing engine (REMOTE_LLM provider)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 2600 ms
    2 candidate(s), 2 passed grounding validation (Northwind Analytics: Schedule Exports, Align Delivery)

[PASS] Localization engine (remote-llm provider)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 2041 ms
    2/2 segments translated (Actualizaciones de entrega de envío programadas.)

[PASS] Creative direction (AI interpretation seam)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 5010 ms
    3 validated direction(s) (Morning Chase to Calm)

[FAIL] Image generation (REMOTE_IMAGE provider)
    endpoint: —
    model: —
    duration: 495 ms
    Remote image provider (api.openai.com) request failed (HTTP 429)

Summary: 3 passed, 1 failed, 0 unverified (10149 ms)
```

Reading the transcript honestly: the primary OpenAI endpoint is out of quota,
so writing and localization each performed a **real failover** — the observed
model is Groq's `openai/gpt-oss-120b`, and the request paths reached Groq's
public API. The creative-direction request ran through the same in-container
`AiCreativeDirector` the gated seam uses. The image request reached OpenAI and
was rejected for billing before any generation — the adapter's error mapping
and sanitization are what the fixture tests pin down; no image was produced.

## Per-feature verification (tests)

| Boundary | Test file | What it proves |
|---|---|---|
| Shared transport | `src/lib/llm-chat.test.ts` (17) | failover matrix, no failover on 400, timeout failover, abort, 4-endpoint cap, sanitized errors, empty-chain refusal |
| Writing chain | `src/modules/writing-engine/providers/remote-llm-provider.test.ts` (13) | env slots 1–3, strict JSON parse, variant caps, fence tolerance, failover vs schema failure, sanitized all-fail |
| Writing full path | `src/modules/writing-engine/__tests__/writing-remote-provider.integration.test.ts` (2) | container + DB + two stub servers: primary 500 → fallback 200 → job SUCCEEDED, provider recorded, 1 call each, grounded prompt, variants persisted |
| Localization chain | `…/localization-remote-failover.test.ts` (6) + remote-provider tests | slot parsing, inheritance from writing chain, per-slot precedence, failover, non-retryable stop |
| AI seams | `src/core/services/creative-ai-interpretation.integration.test.ts` (2) | gate + endpoint → model direction stored and reported (`ai-creative-director`, model `stub-ai-1`); invalid model output → deterministic fallback recorded (`fallbackFrom`), prompt contents asserted |
| AI provider | `src/infrastructure/ai/remote-ai-provider.test.ts` (8) | config precedence, inheritance, chain, usage mapping, model override, failover, sanitized errors |
| Unconfigured boundary | `src/infrastructure/ai/unconfigured-ai-provider.ts` | explicit actionable error instead of a silent mock |
| Image | `src/modules/image-generation/__tests__/remote-image-provider.test.ts` (12) | config, preserved 503 hole, deterministic prompt, sharp normalization to exact dims/format, `verifyGeneratedImage` pass, transparent-PNG gate, b64/URL handling, non-https refusal, sanitized HTTP failure |
| Startup config | `src/lib/server-config.test.ts` (22) | endpoint validation incl. `IMAGE_LLM`, incomplete pairs, gate contract, honest capability details with fallback counts |

Counts in this workspace's final runs: unit `npm test` **2074 passed / 169
files**; browser `npm run test:e2e` **98 passed / 4 failed / 102** where the 4
failures are the pre-existing React-dev-eval console-error assertions in
audio/video/capture/motion specs (identical set before this pass).

## Enabling the gated seams

```bash
# already configured in .env for writing/localization/image
CONTENT_OS_AI_BASE_URL=https://api.openai.com/v1   # or any OpenAI-compatible endpoint
CONTENT_OS_AI_MODEL=gpt-4o-mini
CONTENT_OS_AI_API_KEY=…
CONTENT_OS_AI_INTERPRETATION=1                     # compose AI interpreters/directors/planners
CONTENT_OS_AI_BROWSER=1                            # compose the AI browser planner (implies responsibility review)
```

With the gate off, every seam falls back to the deterministic implementation it
replaced — behavior is exactly the pre-pass checkpoints.

## Security notes

- Provider keys live only in the gitignored `.env`; they are never read into
  client bundles, logs, error messages, test artifacts or reports. The smoke
  script and error sanitizer reduce failures to a host label plus reason.
- Base URLs come only from operator environment; no request parameter can
  redirect an inference call. Image downloads accept `https` URLs only.
- The keys used for this pass were pasted in chat during setup and should be
  rotated before this tree is shared.

## Not verified (stated plainly)

- No live image was generated: the configured OpenAI account is out of quota
  (429 observed above). The adapter is proven against fixtures, not against a
  vendor.
- The gated seams (intent, intelligence, brand, storyboard, recommendations,
  editor AI, browser planner) were not live-run; they share the proven
  transport and `providers.ai`, and the creative seam proves the gate +
  container composition end to end against a stub endpoint.
- CI (GitHub Actions) could not be executed from this environment; the workflow
  file is part of the CP24 deliverables.
