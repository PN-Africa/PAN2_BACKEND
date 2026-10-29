# URL retrieval and Claude content understanding — 28 October 2026

## 1. Root cause and reproduction

The supplied Render request timed out before any AI call. Its original aggregate log cannot identify a network phase. A local read-only reproduction of the same article established a body-download timeout: DNS 14 ms, TCP connection 1,194 ms, TLS ready 1,403 ms and response headers 1,933 ms; downloading had received 1,507,328 bytes when the overall deadline fired at **20,059 ms**. Connection/header timings are cumulative from request creation, not additive stages.

The old transport explicitly requested `Accept-Encoding: identity` and rejected compressed responses. Its one 20-second timer covered DNS, connection, headers and body. Thus a slow uncompressed download exhausted the deadline; parsing and Claude never started. This establishes the reproduced local failure, not a definitive reconstruction of Render's uninstrumented socket. A separate original-path local attempt succeeded in 11.583 seconds, showing that network variability matters. No proxy was configured in the inspected execution environment.

## 2. Implemented architecture

The production URL handler now uses `urlSourceService`:

1. Validate URL syntax and apply secure fetching rules.
2. Select a documented source API for supported Wikipedia article URLs; otherwise use direct HTTP.
3. Retry genuinely transient ordinary fetch failures at most once, within one retrieval deadline.
4. Consider explicitly enabled Claude native fetch only after compatible public-source failures; reserve time for it instead of allowing HTTP attempts to consume its budget.
5. Normalize actual retrieved content and metadata.
6. Make one bounded Claude understanding call, with the original full text retained.
7. Validate the evidence index and pass both raw source and structured context into the existing output generator.

The legacy `urlService()` remains a string-returning retrieval wrapper for existing callers. Controller and combined-input code accept both that older injected string contract and the richer internal object. User-facing endpoint bodies and routes remain unchanged. No new paid provider or model was introduced.

## 3. Secure direct HTTP transport

The native Node HTTP(S) transport still resolves every DNS answer, rejects any private/reserved result and pins the chosen validated address in the actual connection. Every redirect is checked again, with a maximum of three redirects. TLS hostname verification remains enabled. IPv4 is preferred when both families have validated public answers; arbitrary proxy agents are not introduced.

It now supports streaming gzip, deflate and Brotli decompression, bounding both compressed and decoded bytes. The URL source limit remains configurable from 1–20 MB, default 10 MB; readable text remains capped at 200,000 characters, with an explicit error rather than silent truncation. Declared HTTP or HTML-meta character encodings are decoded before parsing. Unsupported types and encodings fail explicitly. Caller aborts, phase timeouts, failed responses and abandoned redirects destroy owned requests/streams and clear timers. DNS lookup can be bounded from the caller's perspective; Node's underlying OS lookup itself is not cancellable.

Default transport caps are DNS 3 seconds, connection including TLS 4 seconds, headers 6 seconds and body inactivity 5 seconds, always bounded by the remaining total. TCP/TLS/headers/body diagnostics identify subsequent failures more precisely. Incoming request cancellation is propagated through extraction; durable jobs already accepted retain their existing independent lifecycle.

## 4. Wikipedia-specific extraction

The adapter uses MediaWiki's documented full-content route, `/w/rest.php/v1/page/{title}/html`, rather than a short summary endpoint. It applies to ordinary language-subdomain Wikipedia article URLs without query parameters or special namespaces. Revision URLs and other forms use the general path, avoiding substitution of a current article for a requested old revision. API route failures can fall back to the same public article HTML; access-denied responses are not bypassed.

The parser preserves substantive text, headings, article title, source URLs and available citation links while removing navigation, reference widgets and scripts. A normalized API redirect is mapped back to its article URL while retaining the originally requested URL separately. Oversized articles require a shorter authorized excerpt. Up to 100 heading labels and 24 reference links are indexed; the full readable text is still retained within its overall limit.

Requests use an identifying User-Agent with an application contact URL. Existing input admission bounds concurrent extraction to two requests. Long `Retry-After` responses do not trigger immediate retries or another same-host bypass. The optional public cache holds at most eight completed Wikipedia sources for up to 300 seconds, copies mutable metadata on each read, never caches Claude understanding, and is disabled by default.

References: [MediaWiki REST content API](https://www.mediawiki.org/wiki/API:REST_API/Reference), [Wikimedia access policy](https://www.mediawiki.org/wiki/Wikimedia_APIs/Access_policy), [rate-limit guidance](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits). TextExtracts was considered but not chosen for the new full-content adapter; its documentation notes stewardship limitations and alternative summary tooling.

## 5. Anthropic capability assessment

Official documentation includes `claude-opus-5-5` web-fetch examples. The installed SDK 1.3.0 exposes GA Messages tool/result types. Ledify implements basic `web_fetch_20250910`, with no beta header, search or dynamic code execution. Newer versions exist but are unnecessary here. The documented tool supports HTML/text/PDF, domain restrictions, usage/content limits and optional citations; failures can occur inside an HTTP 200 tool-result block. Standard token charges apply, without a separate web-fetch fee. Actual account permission remains unverified because live AI tests were not authorized. [Official web-fetch documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool).

The adapter is disabled by default. An operator must enable it and supply exact trusted public hostnames. It prevalidates and revalidates public destinations, rejects query-bearing/credential URLs, permits one fetch and caps included content at 32,000 tokens. Only a matching server-tool use and actual exact-URL text document result count as retrieval. Ordinary assistant prose, mismatched results, redirected URLs, PDF/base64 results, malformed data and tool errors are rejected. No fallback model is selected.

Ledify cannot pin every provider-side DNS/redirect hop. The allowlist, provider policies and strict returned-URL check are a distinct security boundary, not an assertion that Anthropic fetching is identical to Ledify's own transport. PDF URLs remain unsupported by this adapter; existing authorized PDF upload continues working. Native results carry a content-limit warning because the vendor can truncate content at its token limit. There is no web-search substitution and no source restriction/authentication bypass.

## 6. Claude understanding and source grounding

The versioned `sourceUnderstandingSchema` strictly validates required fields, types, enums, size bounds and unsupported properties. It indexes the main topic, selected source sections, concepts, factual categories, limitations and warnings. Summaries and factual evidence are **exact source quotations**, checked against the actual retrieved text. Concept terms must occur in the source; headings must match retrieved headings, title or Introduction. This prevents invented evidence from silently entering the analysis result. It does not establish that the publisher's claims are true or that a quotation cannot be interpreted incorrectly.

The prompt explicitly separates application instructions from quoted untrusted content. It requests a compact evidence index rather than another full rewrite. No tools, credentials or server capabilities are provided to this understanding call. The original complete normalized text remains the generator's input, so selecting a concise evidence index does not discard the remainder of the source. At most two schema/grounding attempts are allowed inside the same deadline; insufficient content fails with HTTP 422. Analysis is performed once per URL extraction and its validated context is reused across planning and content stages.

The internal result contains versioned source metadata, raw `text`, headings/references, and an `understanding` object with `source`, `content` and `quality`. The generator receives `context.sourceUnderstanding`, a source-grounded policy marking that no additional research occurred, and source references. Source commands never become `context.instructions`. Generated webpages receive a visible original-source link. Existing presentation/document reference mechanisms receive the same source metadata.

The separate webpage-planning HTTP 400 fix remains in place: compound design schemas use the existing simple transport envelope, followed by original local validation. Fixing retrieval is not presented as proof that every live Anthropic request will succeed.

## 7. Time budgets, retry and errors

| Setting | Default | Meaning |
|---|---:|---|
| `URL_EXTRACTION_TOTAL_MS` | 35,000 | Shared retrieval + understanding deadline |
| `URL_RETRIEVAL_MS` | 12,000 | Total retrieval/fallback budget |
| `URL_DIRECT_MS` | 8,000 | Upper bound for one direct attempt |
| `URL_SOURCE_API_MS` | 8,000 | Upper bound for an API attempt |
| `URL_WEB_FETCH_MS` | 8,000 | Upper bound for enabled native fallback; only remaining time is available |
| `URL_UNDERSTANDING_MS` | 20,000 | Upper bound for understanding; also subject to the overall deadline |
| `URL_PUBLIC_CACHE_SECONDS` | 0 | Optional public-Wikipedia-only cache, 0–300 seconds |

The original network timeout was not blindly raised. Retrieval is bounded to 12 seconds; the larger overall cap includes a newly requested AI understanding stage. With native fallback enabled, part of the retrieval budget is reserved for it. Caps are configurable server-side and should be calibrated against actual staging model latency. A fallback never starts with a fresh unrelated long deadline.

Transient resets, connection timeouts and selected 5xx/429 responses may receive one short jittered retry. Invalid/private URLs, access gates, permanent 4xx, unsupported types and size violations do not. API-route unavailability can use the same article HTML. Long rate-limit delays return promptly rather than sleeping past the deadline. Native fetch does not bypass 403/404/paywall/rate-limit failures. Permanent Anthropic request errors are not retried.

Existing errors such as `INVALID_SOURCE_URL`, `SOURCE_URL_TIMEOUT`, `SOURCE_URL_ACCESS_DENIED`, `SOURCE_URL_RATE_LIMITED`, content and size errors remain. `SOURCE_CONTENT_INSUFFICIENT` maps to HTTP 422; native-fetch unavailability/failure maps to HTTP 502. URL timeouts remain HTTP 504, oversize sources HTTP 413. No artifact is reported successful without reliable source content. Fine-grained logs include the existing request ID, methods, safe error codes and timings, never source bodies, credentials or raw private URLs.

## 8. Measured results

| Check | Result |
|---|---|
| Original uncompressed article path | Timed out at **20.059 s** during body download, after about 1.5 MB |
| Initial improved-path live attempt | Failed within **12.019 s**; API response/body delay followed by TLS delay on fallback |
| Additional read-only Action API probe | Connection timed out at **5.784 s**; not selected as the implementation's default |
| Final implemented Wikipedia API path | **Succeeded in 7.144 s**, returning **126,928 readable characters** |

The final successful fetch downloaded **323,655 compressed bytes**, decoded to **2,035,948 bytes**, with about **4.090 s** in body downloading and **0.830 s** after download in parsing/extraction/normalization. It used no Claude tokens. Earlier failures are retained in the record rather than hidden; this is not an SLA or a statistically controlled average. Render's network and live Claude processing were not measured here.

Evidence files: `generated/url-extraction-before.json`, `generated/url-extraction-after.json`, `generated/url-extraction-after-final.json`. The audit logs source sizes and phase timings, not article text. It remains a full-article extraction, not summary-only recovery.

## 9. Tests and full output verification

- Complete regression run: **597 passed, zero failures**, 433.392 seconds (`generated/url-intelligence-full-regression.log`).
- Targeted final transport/extraction run: **32 passed**, including final native text validation and canonical article handling (`generated/url-final-transport.log`).
- Understanding/combined-input acceptance: **34 passed** (`generated/url-final-acceptance.log`). Other overlapping focused runs passed; counts should not be added as unique tests.
- New coverage includes gzip/deflate/Brotli, decoded-size bombs, charset handling, DNS/TCP/TLS/header/body timing, cancellation, pinned DNS and redirect blocking, full Wikipedia API content, same-source fallback, permanent error/no-retry behavior, transient recovery, shared deadlines, actual versus fabricated native tool results, model capability rejection, insufficient content, invented evidence and concurrent isolation. Public-cache tests verify that mutable metadata is not shared.

The controlled URL output audit used fixture retrieval and mocked Anthropic Messages, with actual production HTTP routes and native exports. It passed a **ten-slide PPTX with three retained matching photos, PDF and all ten PNG downloads**; webpage viewer/site/ZIP; Word package, preview and native PDF download; and completed database-record status using an injected persistence stub. Each request used one understanding call. Durations were 23.653 seconds for the presentation, 0.684 seconds for the webpage and 18.650 seconds for the document including its on-demand PDF download. These are fixture timings, not live Wikipedia-to-Claude production benchmarks. The final webpage source-link audit passed separately in 0.482 seconds. Reports are under `generated/url-generation-audit/` and `generated/url-generation-audit-webpage/`.

No live Anthropic understanding/native fetch, actual MongoDB performance, authenticated publisher access or Render load test was run. Those require appropriate credentials, cost approval and staging access. Unsupported publisher markup, JavaScript-only pages, access restrictions, network failures and insufficient source content can still fail meaningfully.

## 10. Files changed for this task

- `Service/input/publicUrl.mjs`: secure transport phase budgets, compressed streams, decoding, cleanup and diagnostics.
- `Service/input/urlContent.mjs` (new): source normalization, HTML/Markdown headings, access-gate checks and citation metadata.
- `Service/input/urlBudget.mjs` (new): shared deadlines, cancellation and server settings.
- `Service/input/urlRetrieval.mjs` (new): API/direct/native orchestration, retry policy and optional bounded public cache.
- `Service/input/claudeUrlFetch.mjs` (new): restricted native tool-result validation.
- `Service/input/urlUnderstanding.mjs` (new): validated evidence contract, Claude analysis and generator context adapter.
- `Service/urlService.mjs`: compatible string wrapper and existing error normalization.
- `Service/ai/textProvider.mjs`: same-model native fetch method and usage/error diagnostics, isolated from structured generation.
- `controller/generateController.mjs`, `Service/input/combinedInput.mjs`: rich source integration without changing endpoint request bodies.
- `Service/input/admission.mjs`: cancellation signal propagation during input extraction.
- `Service/generateService.mjs`, `renderer/webpage/components.mjs`: visible original-source attribution for URL-generated webpages.
- `config/ai.env.example`: settings only; the real `.env` was not edited.
- `tests/regression/url-intelligence.test.mjs`, `tests/urlExtractionAudit.mjs`, `tests/urlGenerationAudit.mjs`: deterministic coverage, read-only network measurements and actual output audit.

Other uncommitted architecture/image migration changes predate this URL task and were preserved.

## 11. Configuration and limitations

The existing `ANTHROPIC_API_KEY` and exact `CLAUDE_MODEL=claude-opus-5-5` remain the text configuration. Native fetch stays off with `URL_CLAUDE_WEB_FETCH_ENABLED=false`; enabling it requires an explicit `URL_CLAUDE_WEB_FETCH_DOMAINS` list and a staged account/tool smoke test. `LEDIFY_SOURCE_USER_AGENT` can be changed to the operator's monitored contact. Public source caching stays off unless deliberately configured. No paid image provider, different model or hosting service was enabled.

Understanding adds a normal Anthropic call and token cost to URL input; it is not free and is not claimed to always reduce generation latency. The native fallback likewise consumes model tokens. Existing output validators and semantic/visual safeguards still apply. Grounded quotations cannot certify the source's truth or eliminate every later model error. Source licensing/attribution, accepted excerpts and cache freshness remain applicable.

## 12. Deployment

No commit, push or deployment was performed. Review the focused changes and settings, then deploy manually to staging. Verify the Wikipedia example, ordinary HTML/text, restricted sources, model/schema acceptance, live understanding latency and one native-tool call only if explicitly enabled. Inspect every requested export and record real provider usage and extraction timings. Keep native fetch and public caching disabled for the initial rollout unless their policies have been accepted. Preserve the existing durable artifact/job storage requirements. Do not claim the historical webpage 400 incident is resolved merely because source retrieval now succeeds.
