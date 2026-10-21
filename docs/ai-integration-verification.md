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
| Image | `IMAGE_LLM_*` (gpt-image-1) | AI Horde (`IMAGE_HORDE_*`), Pollinations (`IMAGE_POLLINATIONS_*`) | — |

Gating: the interpretation seams compose into the container only when
`CONTENT_OS_AI_INTERPRETATION=1` (browser: `CONTENT_OS_AI_BROWSER=1`) **and** an
AI endpoint is configured. A gate without an endpoint logs
`startup.ai_gate_without_provider` and is ignored; `src/lib/server-config.ts`
fails startup validation outright for that combination. Endpoint validation
covers every prefix: `http(s)` URL shape, positive integer timeout, and
`BASE_URL`/`MODEL` pair completeness (half a pair is a startup issue).

Image generation does not use the chat transport. It has its own failover
chain (`src/modules/image-generation/providers/image-provider-chain.ts`) that
tries configured links in order: `IMAGE_LLM_*` → `IMAGE_HORDE_*` →
`IMAGE_POLLINATIONS_*`. Failover happens only on `ImageExecutionError`; a
cancelled request propagates immediately. AI Horde is an open-source,
community-run service (anonymous keys are accepted); Pollinations is keyless on
its legacy GET endpoint. With no link configured the boundary keeps its
explicit 503 hole instead of pretending to generate.

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
| Content intent (CP06/09) | `AiContentIntentInterpreter` | **LIVE** (gate-on smoke: video.product_demo on youtube, 30s) |
| Intelligence interpretation | `AiIntelligenceInterpretationProvider` | **LIVE** (gate-on smoke: 2 features, 1 workflow, 1 claim) |
| Brand interpretation | `AiBrandInterpretationProvider` | **LIVE** (gate-on smoke: 4 text fields, 4 voice signals, 5 terms) |
| Creative direction (CP10) | `AiCreativeDirector` + deterministic fallback | **LIVE** (real model call observed) |
| Storyboard planning (CP11) | `AiStoryboardPlanner` + deterministic fallback | **LIVE** (gate-on smoke: 3/3 scenes; NVIDIA fallback after Groq rate limit) |
| Recommendations (CP12/23) | `AiContentRecommendationRefiner` + deterministic | **LIVE** (gate-on smoke: 2/2 recommendations refined) |
| Writing / rewriting (CP18) | `REMOTE_LLM` provider + fallback chain | **LIVE** |
| Editor AI (CP20) | remote seam to `providers.ai` | DISABLED (UI contract covered by existing E2E; not live-run) |
| Localization (CP22) | `remote-llm` provider + fallback chain | **LIVE** |
| Image generation (CP17) | `REMOTE_IMAGE` provider chain: OpenAI → AI Horde → Pollinations | **LIVE** (AI Horde `stable_diffusion`, 512×512 PNG; OpenAI 429 then failover) |
| Browser planning | `AiBrowserPlanner` | DISABLED (not live-run) |
| Platform adaptation (CP19) | none | DETERMINISTIC |
| Campaign strategy (CP21) | none | DETERMINISTIC |
| Publishing analytics optimization (CP23) | none | DETERMINISTIC |
| Legacy generation service | inference through `AIProvider` port | wired; with no endpoint it records an honest failed job ("AI provider is not configured") |

## Live evidence

`npm run ai:smoke` — one bounded request per configured feature, no retries
beyond the configured failover chain, keys read from `.env` and never printed.
Result on 2026-10-20, with `CONTENT_OS_AI_INTERPRETATION=1` for the five gated
seam entries (text chain: OpenAI → Groq → NVIDIA → OpenRouter; image chain:
OpenAI → AI Horde → Pollinations):

```text
[PASS] Writing engine (REMOTE_LLM provider)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 1801 ms
    2 candidate(s), 2 passed grounding validation (Northwind Analytics: Scheduled Exports Keep Delivery Aligned)

[PASS] Localization engine (remote-llm provider)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 1342 ms
    2/2 segments translated (Actualizaciones de entrega de envíos programadas.)

[PASS] Creative direction (AI interpretation seam)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 4611 ms
    3 validated direction(s) (Morning Chase to Automated Update)

[PASS] Intent interpretation (AI seam)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 1843 ms
    video.product_demo on youtube, 30s (ai-content-intent)

[PASS] Brand interpretation (AI seam)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 3713 ms
    4 text field(s), 4 voice signal(s), 5 term(s)

[PASS] Intelligence interpretation (AI seam)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-120b
    duration: 5995 ms
    2 feature(s), 1 workflow(s), 1 claim(s)

[PASS] Recommendation refinement (AI seam)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: —
    duration: 7596 ms
    2/2 recommendation(s) refined (Highlight Automatic Delivery in LinkedIn Post)

[PASS] Storyboard planning (AI seam)
    endpoint: api.openai.com > api.groq.com > integrate.api.nvidia.com > openrouter.ai
    model: openai/gpt-oss-20b
    duration: 18330 ms
    3/3 scene(s), 3 named (HOOK)

[PASS] Image generation (REMOTE_IMAGE provider)
    endpoint: api.openai.com > aihorde.net > image.pollinations.ai
    model: stable_diffusion
    duration: 25526 ms
    335709 bytes, 512x512 png

Summary: 9 passed, 0 failed, 0 unverified (70759 ms)
```

Reading the transcript honestly: OpenAI is out of quota for chat and images
(direct probes return `429 no credits remaining`). Every passing text call
therefore performed a **real failover**; most landed on Groq's
`openai/gpt-oss-120b`, and storyboard landed on NVIDIA's
`openai/gpt-oss-20b` when Groq was rate-limited. The image entry reached OpenAI
first (429), then AI Horde generated a real 512×512 PNG with the open-source
`stable_diffusion` model. The seam entries ran with the interpretation gate on,
through the same interpreter classes the container composes.

### Image chain specifically

The chain joins only providers that are configured. It fails over only on
`ImageExecutionError` and propagates request errors and cancellation without
retrying elsewhere. AI Horde is a community-run open-source service (anonymous
key accepted; async submit → poll → download); Pollinations is keyless on its
legacy GET endpoint. The smoke above produced 335,709 bytes at 512×512 from
`stable_diffusion` in 25.5 s.

## User-POV verification (production build, real providers)

On 2026-10-20 a production server (`next start`,
`CONTENT_OS_AI_INTERPRETATION=1`) plus the writing and image workers was driven
through the public HTTP surface as a new user: register → create project → add
a text brief → analyze intelligence → analyze brand → generate writing
(`REMOTE_LLM`) → generate a `PRODUCT_HERO` image (`REMOTE_IMAGE`) → fetch the
asset stream. Observed:

```text
health: ok
registered: user=user_812a11d1-… workspace=workspace_91a68160-…
project: project_130fc0af-…
project page: 200 (62592 bytes)
input: added text brief
intelligence: aiApplied=true aiErrorCode=null status=COMPLETED
brand: analyzed (4367 byte response)
writing: job=wjob_d201d605-… document=wdoc_d9dd87b7-… variants=2 chars=310
image: job=igen_fd28ab3d-… asset=iasset_d9718865-… 1080x1080 image/png 255324 bytes magic=89504e47 http=200
POV RESULT: PASS
```

The document detail reported 2 grounded variants and 4 claims; one variant read:
"Northwind Analytics is the single source of truth for engineering teams that
need reliable scheduled exports. Its dashboard displays the next run time for
every export…". The fetched image was a real PNG (magic `89 50 4e 47`) served
from the authenticated asset endpoint. All POV rows were removed afterwards.

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
| Image (OpenAI-style) | `src/modules/image-generation/__tests__/remote-image-provider.test.ts` (12) | config, preserved 503 hole, deterministic prompt, sharp normalization to exact dims/format, `verifyGeneratedImage` pass, transparent-PNG gate, b64/URL handling, non-https refusal, sanitized HTTP failure |
| Image failover chain | `…/image-provider-chain.test.ts` (7) | configured-links-only order, failover only on execution errors, cancellation propagation, combined sanitized error, version marker |
| AI Horde | `…/ai-horde-image-provider.test.ts` (15) | anonymous key, async submit → poll → status → download, size rounding, timeout/cancel, sanitized failures, PNG normalization |
| Pollinations | `…/pollinations-image-provider.test.ts` (5) | env config, keyless legacy GET path/query, prompt from graph, PNG normalization, sanitized failure |
| Startup config | `src/lib/server-config.test.ts` (24) | endpoint validation incl. `IMAGE_LLM`, incomplete pairs, gate contract, honest capability details with fallback counts |

Counts in this workspace's final runs: unit `npm test` **2121 passed / 177
files**; browser `npm run test:e2e` **102 passed / 102** (29 files). The four
specs that previously failed on a React-dev eval console error now run against
a production server with a build-once global setup and process-group teardown,
so no server is orphaned between specs.

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

- Editor AI and the browser planner were not live-run: editor AI needs a real
  document, and the browser planner needs a live observation. Both stay gated
  off and are covered by E2E/stub contracts. Every other AI seam was live-run
  above.
- CI: the first GitHub Actions run (commit `679cd30`) failed inside `npm ci` on
  Node 20 / npm 10 with an arborist lockfile crash. The workflow now uses
  Node 24, `actions/checkout@v5`, `actions/setup-node@v5` and `ubuntu-24.04`;
  the exact CI commands (install, contract emit, migrate, verify, typecheck,
  lint, unit/integration, build) pass locally. The follow-up run on GitHub is
  the final confirmation.
