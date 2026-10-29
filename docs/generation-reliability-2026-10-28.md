# Generation reliability follow-up — 28 October 2026

## What was implemented

Backend code now simplifies the complex webpage planning contract sent to Anthropic, retains full local validation, logs safe provider diagnostics, shares stock adapters across presentations/webpages, checks scene and geographic evidence, preserves required-image failures as recoverable draft outcomes, reduces semantic-review payload bulk, and adds stage-level observability. The incremental design architecture is documented in [the architecture record](ledify-2-architecture-2026-10-28.md).

No frontend change, production deployment, push, paid provider activation or live AI request was made. The existing local key is configured; account access and production behavior were not exercised because the instruction remains mocked testing.

## Claude HTTP 400: evidence and fix

Confirmed from the supplied log: the exact model verification succeeded, webpage planning was rejected before token usage, HTTP 400 was permanent and only one attempt occurred. A successful presentation call and rejected webpage call use the same SDK, model, system instruction, user-message structure and `output_config.format`; their response schemas differ. There are no tools, citations or assistant-prefill settings in these requests. The rejected provider's actual error body was discarded by the old error projection, so its precise historical reason **cannot be recovered or honestly confirmed** from `REQUEST_REJECTED` alone.

The planner has optional, nested design branches. The old schema heuristic only counted optional fields and unions after SDK conversion. It did not consider combined complexity. Anthropic documents additional grammar limits below those counts, including a possible schema-compilation HTTP 400. That is a supported hypothesis, not proof of this incident. [Anthropic structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

`structuredOutputPlan()` now proactively sends a small `{payload:string}` schema for compound optional/design contracts, including webpage planning. The complete original schema is supplied privately to the model and remains mandatory in the existing local parser, schema validation and bounded content repair. Other simple calls retain native schemas. The model stays `claude-opus-5-5`. Malformed local schemas, empty input and invalid stage token budgets fail before sending a Messages request. No retry was added for HTTP 400. This changes transport grammar, not the public result schema or requested content.

Safe `[AI]` failures now include provider error type, a recognized configuration-only error message and a message fingerprint. Unknown prose is withheld because providers can echo private input. Recognized examples include schema compilation, invalid output configuration, authentication, overload and token-limit errors. Raw prompts, credentials and arbitrary provider prose are not logged. The next authorized live attempt can distinguish this hypothesis from another unsupported request parameter; this report does not claim that mocked tests reproduce Anthropic's internal compiler.

## Eight seconds versus approximately fifty seconds

The supplied backend total was 7.743 seconds: source extraction 5.506 seconds, model verification 0.865 seconds and content 1.703 seconds (verification is nested in content, so do not sum every metric). The provider call was approximately 1.563 seconds with zero generated tokens. This request does not explain a fifty-second browser wait. Queueing outside that measured scope, client timers/retries, another request, connection establishment or a cold start are possibilities, not established causes. `[GENERATION_DELIVERY]`, `[GENERATION_STAGE]`, `[AI]` and `[PERF]` use request IDs; compare the exact browser network request and response timestamps with the same ID. No frontend timer was changed.

## Image providers: current official documentation reviewed

| Provider | Search/authentication and limits | Rights and delivery implications | Decision |
|---|---|---|---|
| Pexels | REST search; query/orientation/size; API key; default 200/hour and 20,000/month. Broad curated photography. New key issuance is currently paused. | Its license expressly includes websites, presentations and templates. API guidelines require prominent Pexels links and photographer credit when possible. No stock-platform replication, unaltered resale or implied endorsement. | First configured candidate for existing key holders; shared adapter implemented. |
| Unsplash | Search API and JavaScript client; registered access key; demo 50/hour; public deployment needs production approval. Strong editorial photography. | API requires hotlinked URLs, credit and download-event tracking. Offline PPTX and self-contained ZIP assets do not naturally satisfy that default delivery model. | Not activated or adapted without a compatible permission arrangement. |
| Pixabay | Key-based REST search with categories/media filters; default 100/60 seconds; search responses must be cached 24 hours. Mixed photographs/illustrations. | Download used images to the server; permanent hotlinking prohibited. No standalone redistribution; recognizable brands/people have additional restrictions. Automated mass queries are restricted. | Evaluated, not activated. A compliant persistent search cache and a clearer workflow review would precede implementation. |
| Openverse | Open image index; anonymous access or OAuth bearer token; rate-limit tiers/remaining capacity exposed in headers. Broad cultural/technical coverage, variable quality. | Each underlying work has its own license. The index does not verify ownership or permissions. Metadata alone is not a license warranty. | Optional adapter implemented; only CC0/public-domain/CC BY/CC BY-SA records with required provenance; noncommercial, no-derivatives and unknown licenses rejected. Selected source-page license link must corroborate the indexed license. |

Sources: [Pexels API](https://www.pexels.com/api/), [API guidelines](https://www.pexels.com/api/documentation/), [Pexels license](https://www.pexels.com/license/), [Pexels terms](https://www.pexels.com/terms-of-service/); [Unsplash documentation](https://unsplash.com/documentation), [API terms](https://unsplash.com/api-terms), [rate-limit approval](https://help.unsplash.com/en/articles/3887917-when-should-i-apply-for-a-higher-rate-limit); [Pixabay API](https://pixabay.com/api/docs/), [content terms](https://pixabay.com/service/terms/); [Openverse API](https://api.openverse.org/v1/), [terms](https://docs.openverse.org/terms_of_service.html), [JavaScript client](https://docs.openverse.org/packages/js/api_client/index.html).

These are operational integration conclusions, not assurances about releases, trademarks or every indexed work. No provider uptime guarantee or comparative live search-quality measurement was available. All integrate through Node fetch without another paid dependency. Existing authorized curated imagery and Commons remain bounded fallbacks; Commons item licenses/provenance still apply.

## Shared search and relevance changes

`Service/visual/stockProviders.mjs` supplies provider-independent search/acquire adapters, normalized IDs, description, creator, source URL, license URL, dimensions and attribution. Presentation and webpage generators consume the same adapters. Search bodies, timeouts, candidate count, downloads and bytes are bounded. Metadata checks and aspect-ratio ranking occur before downloading; at most two selected candidates are downloaded. Pexels uses a suitably sized rendition rather than the original full-resolution file. Existing validated-byte processing, hashing, request binding, duplicate prevention and storage remain downstream.

The reported failures were reproduced from their supplied descriptions:

- Lagos: every geographic query alternative retains Lagos; metadata lacking Lagos is rejected. The bounded alternatives include Lagos skyline and Lagos waterfront/city views. This fixes unsafe broadening, but does not guarantee a licensed source has an eligible image. No live reproduction established why the original account received no eligible result.
- Marble samples: kitchen intent now requires kitchen-scene evidence and requested premium-finish evidence; store displays, samples and swatches are rejected.
- Agent sign: key-handover intent requires keys and a handing/receiving/exchange action. An estate-agent sign cannot pass on an industry keyword alone.
- Existing photographic-media, subject, identity, exclusion, resolution, duplicate and binding checks remain. Metadata is evidence about a description, not actual scene recognition. Geographic anchors currently include common named cities plus an explicit target location; arbitrary place extraction is not a completed worldwide geocoder.

`AI_STOCK_SEMANTIC_REVIEW=true` optionally sends actual raster bytes for at most one selected ambiguous villa/kitchen/handover candidate per request-scoped adapter set. Deterministic rejection happens first. A negative review or exhausted review budget cannot masquerade as a vision pass. This is mocked only and disabled by default; it can increase latency and text-model cost. It cannot certify a location from appearance. Commons retains its deterministic path; selective vision currently applies to the new shared stock adapters.

Licensing credits are distinct from technical labels such as “AI-generated illustration.” Required source credits now appear in a compact PPTX footer so they survive PDF/PNG conversion; complete details remain in notes/metadata. Webpage Pexels source links remain visible in the footer. The original exact slide count is retained; no credit slide is appended.

## Completion lifecycle and API compatibility

Content can complete, an image can remain unresolved, and native renderers can still produce a usable draft. Rendered artifacts therefore do not establish that every required visual was supplied. A genuinely required missing image still produces `IMAGE_REQUIREMENTS_UNMET`, HTTP 422 and `result.status=incomplete`; draft PPTX/PDF/PNG or webpage links remain available. Existing asset retries/fallbacks and job content checkpoints allow asset/export recovery without regenerating valid content. A conversion failure is classified separately with HTTP 503. Optional missing imagery remains a warning where product rules allow it.

An additive `outcome` object is applied consistently to result, persisted request record and terminal job: `complete`, `completed_with_warnings`, `incomplete` or `failed`, plus recoverability and artifact availability. Existing polling states remain `completed`/`failed` for compatibility; `failed` with `outcome.state=incomplete` means recoverable unmet requirements, not that no draft exists. This explicit compatibility mapping is preferable to silently changing frontend terminal-state handling. Existing routes and download tokens remain unchanged.

## Performance findings and measurements

The actual pipeline already overlaps early images with content and runs bounded independent slide workers. Outline is a dependency; final semantic review depends on content. Native rendering is bounded to avoid overwhelming memory. Final PDF/PNG validation remains necessary. The supplied 147.25-second production run has no complete matching stage trace here; assigning the difference entirely to Claude would be unsupported.

Changes in this follow-up avoid original-size Pexels downloads, bound metadata/download work, reuse request-scoped adapters and omit design SVGs/asset receipts/layout metadata from the semantic-review request while retaining all canonical slide content and diagram edges. On the ten-slide fixture, the serialized deck portion of that review falls from 7,480 to 3,629 characters (51.5%). This measures request size, **not** actual Claude latency or token billing. Readability limits were not loosened to suppress content-fit errors. Semantic review remains enabled in production.

| Local native audit | Historical reference | Earlier 2.0 run | Latest verification |
|---|---:|---:|---:|
| One ten-slide request, observed wall time | 32.686 s | 28.362 s | 33.267 s |
| Two ten-slide requests, wall time to both | 58.956 s | 45.645 s | 67.572 s |

All use fixed mocked AI latency, actual exports and three retained photographs per request; no live provider timing. Latest runs verify the final export changes. Small mocked test jobs also ran during portions of latest verification, so it is not an isolated performance experiment. These observations show considerable local conversion variability and **do not establish a repeatable total-time improvement from the latest changes**. Historical reference/2.0 measurements are described in the architecture record. Reports at `generated/design-native/optimized-{1,2}/report.json` now contain the latest reruns; historical numbers were recorded before those files were replaced.

Latest one-user stages: PDF 21.114 s, PNG 5.258 s, additional image phase 1.553 s, design validation 0.0036 s. Latest two-user requests: PDF 23.017/21.888 s, PNG 6.816/3.142 s; one request waited 33.125 s for native rendering. Parent peak RSS was 200.9 MB single / 214.6 MB concurrent; parent CPU 11.188/22.906 s; health p95 16.1/17.8 ms. Native child resources are excluded. Linux/Render cgroup instrumentation exists but Windows cannot supply those measurements. The 60-second objective remains unproven with real provider latency and real concurrent production load.

## Logging and diagnostics

Stage start/completed/failed events include request ID, stage and elapsed time; AI events include output type, provider/model, usage, schema mode, validation and attempt count. Image events distinguish empty search, download/provider failure, selection and validation. Native conversion outcomes and total CPU/RSS/event-loop/container diagnostics remain. New search/ranking/license/download stage metrics expose costs previously hidden inside one image step. Timings may overlap or nest; summed stage times are not wall time. Keys, source text, raw image bytes and signed asset URLs are not logged by the new diagnostics.

## Verification record

- Focused Claude/migration/pipeline/relevance run: **38 passed**, including permanent HTTP 400 classification/no retry, provider timeout retries, invalid local schema rejection, unchanged exact model, matching/rejected scenes, license checks, Openverse source corroboration, bounded stock vision, HTTP webpage preview and ZIP.
- Export-credit and request-isolation rerun: **39 passed**. It includes exact embedded media bytes and 2/5/10/20 mixed concurrent jobs.
- Actual browser audit: **4 categories × 3 widths passed**, no repair required; image-free fixtures, mocked planning.
- Native ten-slide single/concurrent reruns: passed actual PPTX/PDF/all ten PNG downloads, three photos, cover image, checksum isolation and immutable artifacts after concurrent generation.
- An intermediate full suite had 563/566 pass: two empty-credit-hyperlink failures were fixed; the isolated mixed-job failure passed its focused rerun.
- Final complete regression run: **569 passed, zero failed**, 442.702 seconds, `generated/reliability-full-final.log`. After the final request-wide stock-vision budget and transport/logging hardening, **71 focused tests passed, zero failed**, `generated/reliability-last-targeted.log`. This includes the added concurrent budget-isolation test. These runs overlap; do not add their counts as distinct tests.

Mocked tests do not assert that an actual Anthropic compiler accepted the request or that an actual stock search returned each requested scene. Live provider tests, actual MongoDB latency, the exact supplied twelve-slide response replay and Render load tests remain unexecuted. Existing broad tests cover exact requested counts including twelve, URL/file extraction, required-image recovery, image-heavy output and cross-request isolation. Document image delivery retains its existing uploaded/explicitly approved generated-illustration path; automatic stock search was not newly added to Word generation.

## Files changed for this follow-up

Production: `Service/ai/textProvider.mjs`, `Service/ai/providerDiagnostic.mjs` (new), `Service/ai/generateJsonWithRetry.mjs`, `Service/ai/presentationQuality.mjs`, `Service/ai/presentationPrompts.mjs`, `Service/visual/stockProviders.mjs` (new), `Service/visual/sceneEvidence.mjs` (new), `Service/visual/imageProviders.mjs`, `Service/visual/imageRelevance.mjs`, `Service/visual/generatedImageReview.mjs`, `Service/webpage/imageProviders.mjs`, `Service/generationOutcome.mjs` (new), `Service/generateService.mjs`, `Service/generationJobs.mjs`, `Service/performance.mjs`, `controller/generateController.mjs`, `model/generateModel.mjs`, `renderer/presentation/pptxRenderer.mjs`, `config/ai.env.example`.

Tests/docs: `tests/regression/provider-scene-reliability.test.mjs` (new), `tests/regression/webpage-concept-delivery.test.mjs` (name correction), `tests/v2BrowserAudit.mjs` (new), this report and `docs/ledify-2-architecture-2026-10-28.md`. Other uncommitted files include the prior architecture/migration work and are not all new edits from this follow-up.

## Setup, rollout and remaining limitations

Use the existing secure `ANTHROPIC_API_KEY`, `AI_TEXT_PROVIDER=anthropic`, `CLAUDE_MODEL=claude-opus-5-5`. Add an existing `PEXELS_API_KEY` to prefer Pexels with `PRESENTATION_STOCK_PROVIDER=auto`. Set `OPENVERSE_ENABLED=true` only when opting into that adapter; an optional `OPENVERSE_ACCESS_TOKEN` raises the applicable authenticated tier and must be renewed externally. `AI_STOCK_SEMANTIC_REVIEW=false` is the safe default for cost/latency. Existing generated-image provider remains disabled; no key was invented. The real `.env` was not edited.

Review changes and final tests, then deploy manually to staging. Exercise one real webpage and matching 10/12-slide prompts with authorized credentials, capture the newly sanitized provider errors if any, inspect every format, and measure cold/warm/two-user Render cases. No automatic production change occurred. Broad geographic/scene understanding, legal releases, provider availability and live Claude acceptance cannot be guaranteed by metadata rules or mocks. Revert the focused stock/transport edits independently if needed; `LEDIFY_DESIGN_ENGINE=legacy` only rolls back the new design compiler boundary, not every reliability change.
