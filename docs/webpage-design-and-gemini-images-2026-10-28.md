# Webpage design and bounded Gemini image fallback — 28 October 2026

## Outcome and scope

The backend now asks Claude for a visual narrative by default, attempts purposeful hero/supporting imagery, and renders a topic-linked hero composition when media is unavailable. Commons resolution is bounded and eligible misses can use the shared Gemini image adapter. Claude remains the text/planning provider. Presentation, document and webpage outputs reuse the same image-generation boundary.

No live AI calls, deployment, push or real `.env` edits were performed. **The local configuration currently reports `AI_IMAGE_PROVIDER=disabled`.** Code integration is ready for operator configuration; this report does not claim Gemini is active on Render or that the current account has access to either model.

## Audit findings

The existing system already had seven hero layouts, nine composition IDs, nineteen section types, accessible color tokens, local image optimization, licensed catalogs, image bindings, responsive navigation and self-contained ZIP packaging. The primary problem was not absence of CSS or an image service:

- Generated imagery was disabled after the earlier provider migration. Google was reachable only through an explicit rollback branch.
- Webpage providers placed generated imagery before Commons. Commons could expand multiple queries, and presentation code explicitly requested three query variations.
- Some product hero plans did not create an image target. Supporting section images depended on image-oriented compositions or optional plans, so a technically valid source-derived article could receive none.
- The provider planning grammar intentionally omitted the nested image plan to avoid schema complexity. Existing deterministic compilation was not sufficient to compensate for terse plans.
- Missing media became text panels. Those were functional but visually repetitive, especially for educational material.
- Section relevance could pass on a broad computing/industry match even where the local explanation needed a more specific subject.
- Browser QA was optional; static validity alone did not establish visual completeness. An actual browser audit also found a pre-existing product-hero label contrast failure.

The working URL retrieval system was not rewritten. No extra Claude design call was added.

## Design changes

The existing planning call now explicitly requests `designBrief`, `designSpec` and `creativeDirection` for unstyled requests: a topic-specific hero, distinct supporting scenes, intentional typography/palette and varied compositions. Source grounding, unsupported-statistic restrictions and exact requested-label checks remain in place.

The deterministic design layer exposes `designDirection` with industry, style, typography and visual strategy. Existing palette and font selection still honors explicit caller preferences and applies readable color tokens. Default non-restrained direction can use a subtle gradient; intentionally restrained/plain designs remain supported. This is a reusable system, not an AI-topic-only stylesheet.

All non-text-only webpages receive a hero image target. Short legacy plans also receive up to two meaningful supporting scene targets. Abstract learning/workflow explanations are marked as concepts; they do not use unrelated real stock merely because it is tagged computing. Text-only requests still suppress image acquisition.

The renderer retains split, photographic/full-bleed, image-led, asymmetric, editorial, product and minimal heroes. When an asset cannot be resolved, it can render a connected topic map using actual section/item titles, descriptions and navigation. It does not fabricate statistics, screenshots or evidence, and it does not mark the missing photo as supplied. Image validation and warnings remain separate from the layout's ability to render a usable hero.

Existing grids, image/text splits, visual bands, galleries, editorial stories, FAQ, statistics, testimonials and calls to action are retained. Comparison sections now have a dedicated comparison-panel renderer, and timeline compositions render as ordered sequences even outside the `process` type. There are no new arbitrary AI-authored HTML or JavaScript execution paths.

Finishing CSS adds responsive topic-map layouts, coherent surfaces, restrained connectors, comfortable typography, comparison panels and touch-sized navigation. Section photographs have a 420-pixel height cap to prevent a large image from dominating the surrounding explanation. The product-hero label now uses its actual on-primary foreground rather than the page's dark body color.

`inspectDesignCompleteness` checks missing hero composition, empty visual containers, exact duplicate sections and excessive composition repetition. Its report explicitly distinguishes DOM completeness from browser checks and subjective aesthetics. Existing browser QA still performs a maximum of one targeted containment repair; no whole-page AI regeneration was added. Production QA now includes 320, 390, 768, 1024 and 1440-pixel widths.

## Image architecture and authenticity

For webpages the order is: caller-authorized assets/catalog → one focused Commons search → other explicitly configured stock adapters → eligible Gemini generation → reviewed local fallback. Concept-only scenes skip ordinary photographic stock. Supplied images keep priority. A per-request initial provider probe prevents parallel sections from repeating a permanent credential rejection before it has been classified.

Commons normally makes one focused query, retrieves at most six metadata candidates and attempts at most three eligible downloads. A caller can explicitly allow a second query, capped at two; location fallback must retain its geographic anchor. Presentation search retries remain bounded: a transient connection failure may retry once within the existing deadline, while empty/irrelevant results and timed-out searches move on. Transport-level rate-limit pacing remains intact.

Existing scene, geographic, licensing, photographic-media, object-identity, aspect, resolution and duplicate filters remain authoritative. Countertop samples and agent signs are rejected for kitchen and key-handover scenes. Default supporting scenes now additionally require independent section-word coverage. `WEBPAGE_IMAGE_SUBJECT_COVERAGE_MIN` defaults to 0.3: matched meaningful query terms divided by meaningful query terms. This is a deterministic lexical filter, **not a probability or visual-confidence score**.

Explicit authentic photography, exact labeled products and recognized nonconcept geographic anchors cannot silently use generated webpage images. Geographic recognition uses the existing bounded anchor vocabulary or an explicit location field; it is not a complete world gazetteer. Scientific/diagnostic restrictions in presentations remain intact. If imagery is unavailable, no unrelated replacement is inserted and required coverage remains incomplete. Generated provenance records model, source type, synthetic status and provider terms; technical labels are not overlaid on the image. Credits and licenses remain available in the footer/metadata.

Gemini uses the existing `GoogleGenAI` SDK. `gemini-nano-banana-2.1` and `gemini-3-pro-image` use `interactions.create`, with `response_format: {type:'image', aspect_ratio, image_size}`, `store:false`, cancellation, timeout and `maxRetries:0`. Returned `output_image.data` is base64-decoded and checked for MIME agreement, decoded raster integrity, dimensions, variance and byte budget. The legacy explicitly configured Google path remains available; no deprecated Imagen model was introduced.

Images are cached by account hash, model, prompt, ratio, resolution and optional review policy. Shared in-flight work returns separately owned buffers; request-scoped binding/packaging is retained. The same adapter is callable by presentation images and document concept illustrations. Document illustration planning remains concept-oriented; this work does not add a new general stock-photo document subsystem.

Optional `AI_IMAGE_SEMANTIC_REVIEW=true` enables Claude inspection of at most one Gemini result per profiled request. It is off in the example configuration to avoid mandatory vision calls. Metadata matching and generation intent cannot certify actual pixels or subjective aesthetics; this limitation is retained in asset review metadata.

## Models, pricing and account verification

Google's current [image generation documentation](https://ai.google.dev/gemini-api/docs/image-generation) lists both requested model identifiers and the Interactions format used here. The installed `@google/genai` types expose the required method, response fields, timeout and retry options. No package installation was necessary.

The published standard **image-output** estimates are $0.0336/1K, $0.0504/2K and $0.113/4K for Nano Banana 2.1; the premium model's image-output estimates are about $0.134/1K or 2K and $0.24/4K. Input and thinking/text charges are additional, so these are not complete per-request billing guarantees. See [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). Budget reservation cannot use a configured unit estimate below the known model/resolution image-output estimate. Operators should include a token-price margin in their configured estimate and enforce account spending limits separately.

Quotas are project/model/tier dependent and must be inspected in AI Studio; they are not a universal fixed RPM allowance. See [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). Documented availability is verified; account-specific model permission, quota, billing and real response latency remain unverified because live calls were not authorized.

The adapter does not use search grounding. Generated content remains subject to [Gemini API terms](https://ai.google.dev/gemini-api/terms), including usage restrictions, responsibility for returned content and applicable attribution. Google does not claim ownership of generated content; that is not a warranty of exclusivity or third-party rights. Existing stock assets retain their own source licenses.

## Configuration

Review `config/ai.env.example`. Required activation values, without exposing keys:

```dotenv
AI_TEXT_PROVIDER=anthropic
AI_IMAGE_PROVIDER=gemini
AI_IMAGE_PROVIDER_APPROVED=true
AI_IMAGE_MODEL=gemini-nano-banana-2.1
GEMINI_API_KEY=<server secret>
GOOGLE_IMAGE_RESOLUTION=1K
GOOGLE_IMAGE_CONCURRENCY=2
AI_IMAGE_ESTIMATED_UNIT_COST=0.06
AI_IMAGE_MAX_ESTIMATED_COST=0.18
PRESENTATION_ALLOW_IMAGE_GENERATION=true
WEBPAGE_ALLOW_IMAGE_GENERATION=true
DOCUMENT_ALLOW_IMAGE_GENERATION=true
WEBPAGE_IMAGE_MAX_GENERATED=2
WEBPAGE_IMAGE_RETRIES=0
WEBPAGE_IMAGE_TIMEOUT_MS=30000
WEBPAGE_IMAGE_TOTAL_MS=60000
WEBPAGE_IMAGE_SUBJECT_COVERAGE_MIN=0.3
AI_IMAGE_SEMANTIC_REVIEW=false
```

The operator can select the premium model explicitly and raise its unit estimate appropriately. Existing explicit `disabled` and per-output false switches remain respected. Request bodies cannot raise server spending caps. Paid attempt reservations include failed attempts; cache hits may conservatively reserve budget too. Actual remote billing on a timeout is unknown.

## Verification and measurements

- `gemini-webpage-overhaul.test.mjs`: 20 tests passed, including both model request formats, corruption/MIME rejection, cancellation, timeout, 429, deduplication without shared mutable buffers, price floors, stock acceptance, empty/irrelevant-stock fallback, protected authenticity/geography, spending/count limits, scene rejection, DOCX embedding and real HTTP preview/ZIP byte consistency.
- Focused image/Anthropic/presentation suites: 77/77 passed.
- Focused relevance/concept/website suites after the stricter section filter: 52/52 passed.
- Compatibility suites covering prior website behavior and durable jobs: 31/31 passed.
- `geminiArtifactAudit.mjs`: actual HTTP generation and downloads passed with three mocked Gemini calls, exactly ten PPTX slides, embedded media, PDF and all ten PNG previews; 28.275 seconds. Text and image providers were mocked; native conversions and artifacts were real.
- The URL recovery/export audit also passed all three output types: presentation 28.586 seconds, webpage 0.611 seconds, document 17.914 seconds. These are controlled provider-fixture timings, not live Claude/Gemini speed measurements.
- A controlled HTTP webpage with mocked planning and image fallback completed backend processing in approximately 1.006 seconds: image search 2.6 ms, generation adapter 25.3 ms, total image acquisition/optimization 613.9 ms, packaging 257.3 ms. The mock delays do not predict provider latency.

The first broad run exposed seven compatibility expectations affected by the intentional query/order/section-target changes plus one Windows `EPERM` atomic job-status rename. Query fairness was restored for bounded transient retries; explicit geography fallback is capped at two; tests now select a generation adapter by capability instead of its old array position and use a one-asset policy when testing hero-only priority. The affected suites reran successfully. The final broad run passed **635/635 in 459.566 seconds**, with no skips or cancellations (`generated/webpage-overhaul-full-final.log`). The latest focused Gemini suite, including subsequently added DOCX and rejected-stock cases, passed **20/20**. These are overlapping suites, not additive test counts. The previously intermittent Windows job-storage failure did not recur in the final run; no unrelated job-storage rewrite was made.

## Browser audit and screenshots

The release harness uses real headless Edge, local HTTP delivery, external-request blocking, image decoding, navigation/overflow checks and axe accessibility checks at five widths. All six after-change fixtures pass 30/30 no-media checks. All six licensed-media fixtures pass another 30/30, with a hero asset in each sample. These tests exercise renderer output; no AI was used to invent the fixture content or select arbitrary remote images.

Six different palettes were retained: midnight blue, champagne ivory, clinical teal, product green, plum ivory and scholar blue. A baseline captured before renderer changes had five failing startup checks due to the same label contrast issue at all widths. Same-content healthcare/startup/fashion/school comparisons are valid; the AI and property fixture content was subsequently corrected and should not be used for a strict pixel-only before/after claim.

- [Healthcare before](../generated/webpage-overhaul/before/healthcare/1440.png)
- [Healthcare after, no media available](../generated/webpage-overhaul/after/healthcare/1440.png)
- [Healthcare after, licensed imagery](../generated/webpage-overhaul/media/healthcare/1440.png)
- [AI with licensed imagery](../generated/webpage-overhaul/media/ai/1440.png)
- [Mobile property sample](../generated/webpage-overhaul/media/property/390.png)

These are regression fixtures, not a recreation of the user's exact saved Wikipedia output. Browser checks establish objective behavior and contrast; they do not certify award-winning aesthetics. Manual screenshot inspection caught a broad-subject image mismatch that automatic layout checks would not find; the section evidence filter and concept planning were tightened accordingly.

Controlled layout/rendering timings increased modestly under concurrent test load; for the unchanged healthcare fixture the initial baseline was 30 ms versus 84 ms in an after run. In the final licensed-media audit, selection, optimization, rendering and writes took 300–899 ms per fixture; all six retained a hero. Stricter evidence filtering omitted unsuitable supporting stock instead of filling placements with loosely related pictures. This work makes no untested claim of faster live end-to-end generation. Its latency benefit is a bounded decision: typically one Commons query, then an eligible generation attempt, rather than searching up to eight query variations.

## Files changed for this request

Production: `Service/ai/webpageGeneration.mjs`; `Service/webpageDesignService.mjs`; `Service/webpage/creativeDirection.mjs`; `Service/webpage/imageStrategy.mjs`; `Service/webpage/imageProviders.mjs`; `Service/webpage/imagePipeline.mjs`; `Service/webpage/imageReview.mjs`; `Service/webpage/designQuality.mjs` (new); `Service/webpage/qualityGate.mjs`; `Service/webpage/qualityWorker.mjs`; `Service/visual/imageGenerationService.mjs`; `Service/visual/googleImageService.mjs`; `Service/visual/imageProviders.mjs`; `Service/visual/imageAssetService.mjs`; `Service/visual/imagePolicy.mjs`; `Service/visual/presentationImageAssets.mjs`; `Service/document/documentIllustrations.mjs`; `renderer/webpage/components.mjs`; `renderer/webpage/designSystem.mjs`; `config/ai.env.example`.

Tests/tools: `tests/regression/gemini-webpage-overhaul.test.mjs` (new); `tests/webpageOverhaulAudit.mjs` (new); `tests/geminiArtifactAudit.mjs` (new); query/provider-priority compatibility expectations in `tests/regression/authentic-presentation-photos.test.mjs`, `tests/regression/presentation-speed.test.mjs`, `tests/regression/webpage-universal.test.mjs` and `tests/regression/website-production.test.mjs`; this report. Prior uncommitted work is preserved.

## Remaining limits

Activate and verify the selected model in a reviewed staging environment before production use. Live latency, image aesthetics, account access and Render throughput still need an authorized provider run. Authentic required assets can remain unresolved when no suitable source exists; layout fallback does not erase that requirement. DOM/metadata filters and a bounded optional vision review cannot prove every image is correct. Existing frontend API endpoints, preview controls and download contracts remain unchanged; the frontend was not modified.
