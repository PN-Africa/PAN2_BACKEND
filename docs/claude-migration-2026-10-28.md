# Ledify backend migration and performance verification — 28 October 2026

The backend now selects Anthropic and the exact `claude-opus-5-5` identifier by default. The official Messages SDK supplies structured content for presentations, webpages and documents. Google generation is retained only behind explicit rollback switches. A separate Black Forest Labs FLUX.2 pro image adapter is prepared and tested with mocked transport, but remains disabled.

**This is not a declaration of a fully operational production migration.** The user requested mocked tests for this phase. No live Anthropic account verification or live replacement image generation was performed. No changes were pushed or deployed. Local environment values were not edited. An existing user-added Agent SDK dependency and the user's subsequent checkpoint commit were preserved.

## Audit of the previous Google integration

| Area | Previous integration | Replacement / retained behavior |
|---|---|---|
| Shared text client | `Service/aiService.mjs`, static Google SDK client | Lazy `Service/ai/textProvider.mjs`, official `@anthropic-ai/sdk` 1.3.0 |
| Presentation outline, individual slides, metadata repairs, speaker notes | Stage-specific Gemini model selections in `aiService.mjs` | Central `textModel(stage)`; same configured Claude model at every stage |
| Presentation quality and targeted repair | `Service/ai/presentationQuality.mjs` | Claude review; original schema, semantic and layout validators retained |
| Webpage plan and content | `Service/ai/webpageGeneration.mjs` | Claude planning and content through the same adapter |
| Document outline, sections and review | `Service/document/documentGeneration.mjs` | Claude; authorized assets retained; generated illustrations use the prepared dedicated adapter |
| Diagram planning | `Service/visual/diagramPlanner.mjs` | Claude structured diagram descriptions; editable rendering retained |
| Schema constants | Google `Type` import in shared schemas | Provider-neutral constants in `templates/shared/schemaTypes.mjs` |
| Presentation image generation | `imageProviders.mjs` → `googleImageService.mjs` | `imageGenerationService.mjs` → approved dedicated image provider |
| Webpage image generation | `Service/webpage/imageProviders.mjs`, Gemini image adapter | Generic generated-image provider and separate credentials |
| Google image transport | `Service/visual/googleImageService.mjs` | Retained for disabled rollback; no active default route reaches it |
| Google SDK dependency | `@google/genai` | Retained temporarily for explicit rollback; not the default provider |
| Retries, authentication and errors | Existing Gemini-shaped transport responses | Anthropic response normalization into existing local validation, retry, diagnostics and usage contracts |
| Image retrieval, cache, files and exports | Stock providers, checksum caches, request bindings, native renderers | Retained with provider/account/review-policy cache scoping and mandatory cover verification |

Legacy Google-specific thinking settings remain applicable to rollback transport only; the Claude adapter does not transmit them to Anthropic. Old Google source names in provenance recognition and regression fixtures do not activate a Google provider. No separate Imagen call was found in the active paths; image generation previously used the Google image transport.

## Claude access and structured outputs

The public [Anthropic model catalog](https://platform.claude.com/docs/en/models/overview) lists `claude-opus-5-5`. Public documentation does not prove that the user's account can access it. The safe local configuration check reports that an Anthropic key is configured, the exact identifier is selected, and live verification has **not run**.

Before any production Messages call, the adapter retrieves that exact identifier through the [Models API](https://platform.claude.com/docs/en/api/models/retrieve). A missing model fails with `CLAUDE_MODEL_UNAVAILABLE`; no alternative model is selected. Successful checks are deduplicated and cached for five minutes. The requested identifier continues to be sent to Messages; an API-resolved version is recorded separately.

The SDK sends `output_config.format` with a JSON schema. Its official helper transforms grammar-unsupported restrictions into descriptions; Ledify still validates the **original complete schema locally**. Large schemas exceeding the provider's optional-field/union grammar limits use a private JSON-string envelope. The envelope is unwrapped internally and the original contract is validated before use; this mode does not provide a native grammar guarantee for the inner object. Local validation and bounded repair remain mandatory. This follows the constraints documented in [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

SDK automatic retries are disabled to avoid multiplying Ledify's bounded retries. Existing limits remain, with HTTP 529 overload added to transient handling and cooldowns. Token ceilings are configurable, medium effort is the default, and unsupported/truncated/refused output cannot become a successful result. Each request uses independent message content. Keys, raster payloads and source prompts are not printed by provider diagnostics.

## Dedicated image provider recommendation

| Consideration | Recommended: BFL FLUX.2 pro | Alternative evaluated: Stability AI |
|---|---|---|
| Integration | Prepared native Node HTTP adapter, pinned `flux-2-pro` endpoint | Public HTTP API; a second adapter would be needed |
| Fit | Vendor positions FLUX.2 pro for production photorealistic imagery; supports landscape output | Core emphasizes cost/speed; Ultra emphasizes detail |
| Public pricing | From $0.03 per output MP; resolution rounds upward to whole MP | Core $0.03/image; Ultra $0.08/image |
| Credentials | Separate BFL account/key, billing and explicit approval | Separate Stability account/key and billing |
| Latency / rate limits | Account limits and actual latency unverified | Account limits and actual latency unverified |
| Reliability / prompt adherence | Protocol and failure recovery mocked; live quality and subject adherence unverified | Not integrated or benchmarked |
| Commercial use | API commercial usage subject to BFL service terms | Requires review of the chosen account/service terms before activation |

Pricing sources: [BFL pricing explanation](https://help.bfl.ai/articles/7986977817-what-are-the-costs-associated-with-using-your-models), [Stability pricing](https://docs.stability.ai/pricing). BFL's [API terms](https://bfl.ai/legal/flux-api-service-terms) and [commercial API explanation](https://help.bfl.ai/articles/9272590838-self-serve-dev-license-overview-pricing) govern usage. These are published terms, not an account-specific licensing determination or comparative quality benchmark.

The prepared adapter requests approximately 1.8 MP, with dimensions rounded to multiples of 16. A **$0.06/image reservation estimate** allows for two billable MP at the published starting rate. This is a budget estimate, not a verified invoice. A $0.18 generation budget permits three such attempts; failures/retries consume reservations. Requests needing more images must use available authorized stock/user assets or an explicitly reviewed higher server budget. Essential images are not silently removed to meet this budget.

Activation requires separate approval, `AI_IMAGE_PROVIDER=bfl`, `AI_IMAGE_MODEL=flux-2-pro`, `AI_IMAGE_PROVIDER_APPROVED=true`, a separate `AI_IMAGE_API_KEY`, an approved estimated-cost budget, and the relevant presentation/webpage/document enable switch. The Anthropic key never authenticates BFL requests.

Implementation uses the [BFL asynchronous API workflow](https://help.bfl.ai/articles/8446125349-quickstart-guide): POST, validated provider polling URL, bounded polling, safe result download, raster decoding, checksum storage and contextual cache. It retains uncertain task receipts, including a pre-submission uncertainty record, to prevent immediate automatic duplicate purchases after a lost POST response. Uncertain records are retained for ten minutes; this is not a cross-instance or perpetual exactly-once billing guarantee. One global dedicated image slot limits provider pressure. Cache identities include model, account hash, scene and image-review policy.

Claude-authored scene descriptions and image plans supply generation prompts. Optional Claude vision review (`AI_IMAGE_SEMANTIC_REVIEW=true`) evaluates the actual raster against its requested subject; rejected scenes cannot be published as verified images. Tests mock this decision, so no live visual-recognition claim is made. Existing independent metadata, identity, rights and raster checks remain. Scientific diagrams continue to use editable structured rendering rather than fabricated photographic evidence.

Documents have a separate server-controlled illustration switch, at most two planned illustrations within the asset limit, Claude section-specific prompts, raster conversion to validated JPEG, and exact section/asset checks. Genuine-photo requirements are not satisfied by generated concepts. Missing generated assets cannot masquerade as embedded pictures.

## Presentation quality and mandatory cover

The first actual slide always receives a topic-related full-slide photo requirement, including defensive handling of a non-title first slide. Excluding slide 1 or requesting text-only supporting slides cannot suppress it. Acquisition starts after the validated outline, overlapping subsequent text work. Cached/prefetched assets must match the final deck context.

The image is embedded across the full slide, with a dark translucent lower panel for readable fixed-size typography. Export checks inspect actual first-slide picture geometry and embedded bytes. PNG validation checks the visible photo region. A missing cover fails before publishing a cover-free deck. A missing required supporting image produces an incomplete result and available draft artifacts, not successful completion. Exact slide count, native content, diagrams and export validation remain enforced.

Regression coverage includes automotive, fashion, space and property topics; 1/3/10/12-slide decks; a non-title first slide; cover exclusions; removed media and swapped request bindings. Topic-specific photo selections exist only in test fixtures, not production cover logic.

## Actual performance findings and scope

The earlier supplied Render logs show successful 12-slide requests around 247–249 seconds. One had 144.6 seconds of additional image waiting after 40.9 seconds of content, followed by about 32.9 seconds of PDF and 23.7 seconds of PNG conversion. Per-image and AI totals overlap; summing them would overstate wall time. Reported client disconnects and SIGTERM are separate delivery/lifecycle evidence, not proof that changing model providers fixes infrastructure.

Before these changes, a local fresh Google/stock-only ten-slide baseline took **77.69 seconds observed / 76.96 seconds profiled**. Outline generation consumed 40.19 seconds including a retry; content overall 59.93 seconds. PDF conversion took 11.43 seconds and PNG 3.44 seconds. There were 16 text attempts, four retries, and parent RSS peaked at 181.6 MB. **The stock image stage was incomplete and lacked the cover, so this is diagnostic evidence, not a quality-passing speed baseline.** A two-user baseline wave took 77.98 seconds and also had incomplete imagery. No further live Google calls were used for this migration phase.

PNG encoding was independently compared on the same saved ten-page PDF at the same 144 DPI. Direct Poppler PNG took 4.355/4.599 seconds; Poppler PPM plus sharp PNG took 1.413/1.678 seconds. Mean **4.477 → 1.546 seconds, 65.5% faster**, with identical decoded pixel hashes on every page. The lossless PNGs increased from 1,331,789 to 2,049,738 bytes (53.9%). Temporary RGB pages add roughly 62 MB for ten standard widescreen pages and are removed after use. `LEDIFY_PNG_ENCODING=poppler` restores the previous path.

The controlled native audit compares reference settings (four slide slots, direct Poppler PNG) with optimized settings (six slide slots, PPM/sharp PNG). Both use the same validated ten-slide content, all three matching photographs, mocked Messages responses with 100 ms delay, real HTTP/jobs, actual LibreOffice/Poppler exports and a local database stub. It verifies ten PPTX slides, ten PNGs, PDF bytes, first-cover composition, photo preview checks, unchanged artifact hashes and disjoint image sets across concurrent requests. It is **not a measurement of live Claude/BFL latency or Render throughput**. Single-user observed duration fell **46.122 → 26.416 seconds**; the two-user wave fell **85.938 → 57.216 seconds**. See [the detailed performance results](claude-performance-results-2026-10-28.md) for stages, resources, trade-offs and reproduction.

Additional optimizations: bounded parallel schema repairs (two), six slide workers under the existing global text cap, earlier cover acquisition, reduced redundant warm-cache decoding, and unchanged single-slot native conversion. Quality review stays enabled in production. Controlled fixtures disable semantic review to hold content constant; actual quality/schema/render validation runs.

## Resource and operational limits

Defaults remain two generation jobs, six global text calls, bounded stock retrieval, one dedicated image call and one native render. Queue waiting is measured. Request-scoped directories, independent content objects, byte checksums and placement/context bindings prevent cross-request image substitution. Content checkpoints permit resumed generation without restarting completed AI stages.

New metrics separate model verification, schema validation, image download/processing, job storage and response projection from text/provider and native rendering time. Linux cgroup v2 memory, CPU quota/throttling and I/O observations include native children when available. Windows explicitly reports container observations unavailable. Parent RSS/CPU are process-wide during concurrency and cannot be added across requests. No current production Render CPU, memory, disk or OOM measurement has been obtained in this mock-only phase.

Use the existing hosting and approved providers. Render needs the configured Anthropic secret, required LibreOffice/Poppler/fonts and durable storage for jobs/artifacts/cache. Keep the existing generation/AI/render caps until measurements on the actual instance justify changing them. Single-process capacity does not enforce an account-wide cap across multiple Render replicas; distributed queue/billing coordination would be needed before horizontal scaling. No paid hosting change was made.

## Verification and rollout gates

See the final test/performance results below. Mock tests cover exact model lookup before Messages, no substitution/fallback, unsupported access, structured output and envelope validation, bounded repairs, usage accounting, native request isolation, separate image credentials, BFL poll/download/cache, lost-receipt protection, vision rejection and document embedding. These tests do not establish actual provider account access or live image-generation success.

Before a production rollout: authorize and perform read-only exact-model verification, approve/configure the image provider and budget, generate and inspect actual provider images, then run comparable single/concurrent live tests on the current Render instance. Verify the first-cover photo in PPTX, PDF and PNG, and measure actual latency/resources/cost. Only then deploy a verified revision. The 60-second target remains an objective; provider latency and instance capacity may prevent it.

Safe local configuration check: `node scripts/verifyAiConfiguration.mjs`. It makes no provider requests. The explicit `--verify-model` option calls the account Models API and was not executed in this phase.

## Costs and rollback

[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) lists Opus 5.5 at $4/input MTok and $20/output MTok; five-minute cache writes $5/MTok and cache reads $0.20/MTok. For illustration only, 40,000 input plus 8,000 output tokens cost about $0.32, excluding image tokens, cache variation and retries. Three image attempts reserved at $0.06 add $0.18. Real usage varies and no live new-provider invoice was measured. Ledify records reported input/output/cache tokens and estimates the configured Opus costs, including malformed-response attempts. No prompt caching is asserted to be active merely because cache usage can be recorded.

Default rollback is off. To explicitly restore old Google text generation, an operator must set **both** `AI_TEXT_PROVIDER=google-rollback` and `AI_ALLOW_GOOGLE_ROLLBACK=true`, with the legacy key/model configuration. Google images additionally require `AI_IMAGE_PROVIDER=google-rollback`, explicit provider approval, `GOOGLE_IMAGE_MODEL`, the legacy key, image enable flags and estimated budgets. No Claude/BFL failure changes these switches automatically. Restore `AI_TEXT_PROVIDER=anthropic` and `AI_IMAGE_PROVIDER=disabled` to leave rollback. An operator can alternatively restore a previously verified production revision; do not automatically deploy the unverified checkpoint.

## Final test results

| Verification | Result | Evidence |
|---|---|---|
| Broad regression suite (`npm test`) | **521 passed, 0 failed**, 397.96 seconds | `generated/claude-migration-full-final.log` |
| Focused provider and full document/presentation/webpage adapter tests after final transport hardening | **18 passed, 0 failed**; overlaps the broad suite | `generated/migration-provider-final.log` |
| Mandatory-cover and initial adapter integration set | **17 passed, 0 failed** | `generated/claude-cover-integration.log` |
| Image cost reservation / retry / concept delivery set | **24 passed, 0 failed** | `generated/migration-image-budget.log` |
| Real native export audit | All four reference/optimized, single/two-user runs passed | `generated/migration-native/*/report.json` |
| PNG pixel equivalence | Identical decoded pixels on all ten pages | `generated/png-encoding-benchmark/report.json` |
| Working-tree whitespace check | Passed (`git diff --check`) | Local command |
| Live account / new image-provider generation | **Not run**, per mock-only instruction | Safe configuration check only |

The broad run began before the last small authentication/cancellation hardening and two additional document assertions. The focused 18-test run validates those final changes; the counts overlap and must not be added as distinct tests. The native audit uses mocked provider timing and actual export processes. No test result above establishes production model access, actual FLUX image quality, or Render performance. No deployment was performed.

## Modified files

The implementation spans `Service/aiService.mjs`; `Service/ai/{textProvider,generateJsonWithRetry,presentationPrompts,presentationQuality,presentationValidation,providerCapacity,webpageGeneration}.mjs`; `Service/document/{documentGeneration,documentIllustrations}.mjs`; `Service/{generateService,generationJobs,performance,runtimeResources}.mjs`; `Service/visual/{assetBinding,diagramPlanner,generatedImageReview,imageArtDirection,imageGenerationService,imagePolicy,imageProviders,presentationImageAssets,presentationPrefetch,presentationVisuals}.mjs`; `Service/webpage/{imagePipeline,imageProviders,imageReview,imageStrategy,providerCache}.mjs`; `controller/generateController.mjs`; `renderer/converters/{pdfToImages,ppmPng}.mjs`; `renderer/presentation/{photoCompositions,renderedOutputValidation}.mjs`; `templates/shared/{contextSchema,schemaTypes}.mjs`; `config/ai.env.example`; `scripts/verifyAiConfiguration.mjs`; package manifest/lock; and related fixture/regression/audit files. The codebase checkpoint created during testing contains part of these changes; remaining edits are local. Endpoints and frontend files were not changed.
