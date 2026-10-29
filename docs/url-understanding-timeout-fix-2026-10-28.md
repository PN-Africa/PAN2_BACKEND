# URL understanding timeout fix — 28 October 2026

This report supersedes the timeout/understanding behavior described in the earlier URL intelligence report. It addresses the latest failure after successful Wikipedia retrieval. The working retrieval adapters, decompression, parsing and SSRF protections were not rewritten.

## Confirmed cause

`urlSourceService` wrapped Claude understanding in `withinUrlBudget(min(URL preparation deadline, now + URL_UNDERSTANDING_MS))`. The default understanding limit was 20,000 ms. That local timer aborted the provider request and raced its result. The Anthropic Messages SDK timeout was 90 seconds, so the repeatable 20.010/20.016 second termination was caused by Ledify's local AbortController budget, rather than Wikipedia or the SDK's 90-second setting.

The same wrapper manufactured `SOURCE_URL_TIMEOUT` for understanding and retrieval. Its outer race could finish the performance profile before the provider attempt's completion logger ran; accounting happened only at completion, explaining the misleading zero AI calls. Provider-capacity waiting and cooldowns also did not honor cancellation.

This identifies the local termination mechanism. It does not establish whether an uncancelled live Claude request would have completed shortly afterward, or whether Render also had an independent network problem. Live Anthropic calls remain unapproved and were not made. The exact configured model, `claude-opus-5-5`, is unchanged.

## Request size and construction

The prior retrieved Wikipedia article contained 126,928 normalized characters: roughly 31,732 source tokens using the deliberately approximate characters/4 estimate, before instructions and schema. The optional understanding request previously sent the entire article and allowed 4,096 output tokens.

The optional analysis now receives a bounded evidence index, default 24,000 characters. Selection uses heading locations when available, otherwise distributed source windows, and reserves an ending excerpt. Partial coverage is explicitly flagged; it is not represented as an exhaustive summary. **The complete validated normalized source and references remain available to downstream generation.** No factual content is removed from that source to shorten this optional call.

A regression fixture containing **139,579 source characters** selected **23,958 characters** (82.8% fewer source characters). Its actual logged user prompt was 25,553 characters; estimated total input, including schema and system prompt, was 6,982 tokens. The sanitized native schema was 1,945 characters, the unchanged system prompt 427 characters, and the output cap 3,072 tokens. These are measured fixture payload sizes, not live token usage or Claude latency. Exact quotations are still checked against the source; invalid analysis is discarded.

`[URL_UNDERSTANDING_PAYLOAD]` records counts, estimated tokens, schema mode, model and available timeout, without logging source text. Anthropic Messages retains the existing structured-output adapter, model and `maxRetries: 0`. Its request timeout now accepts the remaining stage budget, capped at the existing 90 seconds. A post-verification abort guard prevents a late Models API result from starting a cancelled Messages request.

## Deadlines and cleanup

| Setting | Default | Scope |
| --- | ---: | --- |
| `URL_RETRIEVAL_MS` | 12,000 ms | Existing URL retrieval budget; unchanged |
| `URL_UNDERSTANDING_MS` | 30,000 ms | Optional understanding cap, also limited by remaining URL preparation time |
| `URL_EXTRACTION_TOTAL_MS` | 35,000 ms | Shared retrieval plus understanding preparation budget |
| `LEDIFY_GENERATION_TIMEOUT_MS` | 600,000 ms | Overall processing budget, starting at the profiled handler/direct call or worker execution |
| `URL_UNDERSTANDING_MAX_CHARACTERS` | 24,000 | Optional analysis evidence bound; full source preserved |
| `URL_UNDERSTANDING_REQUIRED` | `false` | Opt into failing when understanding is unavailable |

The 30-second understanding cap is a configurable allowance, not a measured live latency recommendation. For example, seven seconds of retrieval leaves at most 28 seconds within the default 35-second preparation budget. Existing explicit deployment settings take precedence.

The overall budget is separate from the preparation budget and covers subsequent pipeline stages. AI calls and their capacity/cooldown/retry waits receive its abort signal. Generation admission removes cancelled waiters. Local operations without cancellation support, including an already running renderer, finish their current bounded operation; stage checkpoints then reject expiry before subsequent work. This is cooperative cancellation, **not a guarantee that every OS process is killed exactly at the deadline**. Input admission before the handler and durable-job time before worker execution are separate queue times. Failed HTTP generation records are persisted as failed, including AI timeouts, instead of remaining processing.

The default overall ten-minute allowance preserves room for existing heavy exports; it is not a speed objective. Models verification already has its own 15-second limit. Cancellation prevents its late result from dispatching paid generation, but cannot guarantee an already accepted remote request is unbilled.

## Recovery and public errors

Optional understanding makes one attempt. With at least 150 characters of validated source, timeout, transient connection/capacity failures, or invalid optional structured output can bypass understanding. Downstream existing planners receive the complete source and a `URL_UNDERSTANDING_BYPASSED` warning. There is no manufactured analysis: `content` is null and `understandingPerformed` false. Successful artifacts carry `completed_with_warnings`; their database record remains completed and the outcome reflects warnings.

Permanent provider errors, invalid/inaccessible sources, explicit insufficient-source findings, parent cancellation, and required-understanding mode do not use this bypass. HTTP 400 provider requests are not retried. A persistent provider outage can also prevent downstream generation; bypassing the optional call is not offline generation.

Required understanding timeout returns HTTP 504 with `AI_PROVIDER_TIMEOUT`, `url-content-understanding`, request ID, model and `PROVIDER_TIMEOUT`, rather than blaming the source website. Overall expiry returns HTTP 504 with `GENERATION_TIMEOUT`, stage `generation` and request ID. Existing provider HTTP/connection classification remains distinct. Terminal logs include sanitized exception class/code and cause class/code; arbitrary provider prose, prompts, secrets and network details are withheld.

## Metrics

Attempts are counted before queueing/invocation and completed exactly once. `[PERF].ai` and its stage entries now include `calls`, `completedCalls`, `failedCalls`, `inFlightCalls`, retries, elapsed/queue/provider/validation durations and returned usage. In-flight snapshots include pending elapsed time. Failed calls without returned usage increment `usageUnknownCalls`: zero returned tokens must not be interpreted as zero billing. Cancelled waiters never dispatch later; ignored transport results cannot enter validation or generation after cancellation.

## Verification

The dedicated recovery suite covers bounded large/small sources; successful understanding; typed local/SDK timeouts; nested connection causes; permanent HTTP 400 with no retry or bypass; malformed analysis; source-preserving recovery; safe diagnostics; started/in-flight/failed metrics; cancelled queues; late verification; strict HTTP timeout; overall deadline cancellation; and real HTTP webpage planning, rendering, persistence and ZIP download after bypass. Shared model verification is tested with two concurrent requests: the first expires, the second succeeds, one verification and one Messages call occur. Its bounded shared lookup is not invalidated by one caller's deadline. The final targeted run covering recovery, Anthropic migration and performance pipelines passed **42/42**; recovery alone passed **20 tests** in that run.

The first full suite run passed 611/612; the remaining new fixture incorrectly expected trailing whitespace that existing normalization intentionally removes. Correcting the fixture made all 15 then-current recovery tests pass. Five additional overall-deadline/isolation tests subsequently passed.

The final broad run completed **616/617 in 459.280 seconds** (`generated/url-understanding-full-final.log`). The sole failure was the existing `2 simultaneous mixed jobs keep inputs, tokens and failures isolated with two active workers` test: it observed one failed job where zero were expected, following a failed `job-storage` stage. Its whole isolation suite immediately reran **22/22 passed** (`generated/understanding-isolation-regression.log`), including 2, 5, 10 and 20 simultaneous jobs. The intermittent broad-run failure's underlying storage exception was not captured by that test; its exact cause remains unconfirmed. This is not reported as a green full suite. After the final aborted-provider duration accounting adjustment, the focused recovery/Anthropic/performance run again passed **42/42** (`generated/understanding-final-targeted.log`).

The controlled native export audit (`node tests/urlGenerationAudit.mjs --understanding-failure`) passed all three types using mocked source/AI and an injected connection failure:

| Output | Measured duration | Verified |
| --- | ---: | --- |
| Presentation | 24.663 s | Ten slides, three fixture photos, PPTX, PDF, all ten PNG previews |
| Webpage | 0.566 s | Preview, site and ZIP download |
| Document | 20.080 s | DOCX, preview and native PDF download |

Results: `generated/url-generation-audit-fallback/report.json`. Native LibreOffice/export work was real; source retrieval, model responses and database fixtures were mocked. Semantic AI review was disabled in these controlled export fixtures. These timings demonstrate recovery and export integrity; they are **not a before/after live Claude speed comparison**. The user's failing baseline was 25.276–27.070 seconds with no artifact; a directly comparable live post-fix measurement remains outstanding. The preceding URL task already verified real Wikipedia retrieval in 7.144 seconds; this task did not rework or repeat that network test.

## Files changed for this fix

- `Service/input/urlUnderstanding.mjs`: bounded evidence, payload diagnostics, optional recovery and propagated warnings.
- `Service/input/sourceEvidenceSelection.mjs` (new): source-preserving evidence selection.
- `Service/input/urlBudget.mjs`: specialized understanding errors and configurable allowance.
- `Service/ai/cancellation.mjs` (new): cancellable promise wrapper and cleanup.
- `Service/ai/generateJsonWithRetry.mjs`: started-attempt metrics, cancellation, timeout classification and sanitized diagnostics.
- `Service/ai/providerCapacity.mjs`: cancellable queue, cooldown and invocation.
- `Service/ai/providerDiagnostic.mjs`: safe exception/cause identifiers.
- `Service/ai/textProvider.mjs`: unchanged exported system prompt, bounded stage timeout, post-verification abort guard.
- `Service/performance.mjs`: attempt lifecycle, pending snapshots, overall deadline and stage checkpoints.
- `Service/generationCapacity.mjs`: deadline-aware admission and guaranteed slot release.
- `Service/generateService.mjs`: source warnings and consistent completed outcome.
- `controller/generateController.mjs`: overall signal, typed timeout HTTP responses/logs, failed-record persistence.
- `config/ai.env.example`: documented settings; real `.env` unchanged.
- `tests/regression/url-understanding-recovery.test.mjs` (new): regression coverage.
- `tests/urlGenerationAudit.mjs`: controlled recovery/export mode.
- This report.

Other existing uncommitted migration, rendering, image and URL changes predate this focused fix and are preserved.

## Deployment and remaining verification

No deployment, push, provider change, paid service or real `.env` edit was performed. An operator can review the example settings before staging; the existing routes and request bodies are unchanged. Keep `URL_UNDERSTANDING_REQUIRED=false` to allow warned recovery, or enable strict mode if the product requires a separate understanding result. Strict mode now returns the correct AI error.

After authorized deployment, inspect `[URL_UNDERSTANDING_PAYLOAD]`, `[AI]`, `[URL_UNDERSTANDING_RECOVERY]`, `[GENERATION]` and `[PERF]` for a single request ID. Real Anthropic latency, account-specific structured-output access and Render network behavior require a separately authorized live run. Full source remains available downstream, so this change reduces optional understanding payload rather than claiming to eliminate all long-context generation latency.
