# Ledify 2.0 engineering record — 28 October 2026

## 1. Scope and implementation status

This is an incremental backend implementation in the existing Express application. Existing presentation, webpage and document schemas and renderers remain authoritative. No frontend, production deployment, paid provider activation or hosting change was made. Provider tests use mocked Anthropic Messages responses. This is not a claim that arbitrary requests can never fail.

## 2. Audited execution map

`controller/generateController.mjs` validates/extracts prompt, URL or uploaded content and admits synchronous generation or a durable job. `Service/generateService.mjs` coordinates content, design, assets, rendering and delivery. `Service/aiService.mjs` dispatches presentation generation; `Service/ai/webpageGeneration.mjs` and `Service/document/documentGeneration.mjs` specialize the other outputs. `Service/ai/textProvider.mjs` owns Anthropic transport and exact configured model verification. Presentation layout/theme/renderer services feed native PPTX, LibreOffice PDF and Poppler PNG converters. Webpage services emit safe HTML/CSS/JS and a verified downloadable archive. Document services emit Word and HTML, with PDF handled by the existing export path. `generationJobs.mjs` persists content/checkpoints and binds output to individual requests.

## 3. Problems addressed

Design intent previously depended heavily on inferred industry profiles. Planning and content were coupled to renderer-specific objects without an explicit design boundary. Visible content could be invalidated by later composition choices. Optional visual review needed an explicit budget and truthful not-run status. Native conversion children and temporary browser QA files needed lifecycle ownership. Previous always-required cover guidance also conflicted with the new whole-deck image-free exception.

## 4. Architecture boundary

Normalized input → AI content/design plan → versioned specification → validation → component compilation → licensed/generated asset resolution → native rendering → deterministic inspection → optional bounded visual review/repair → public delivery.

Logical stages do not each add an AI request. Design planning is included in the existing presentation outline, webpage planning or document outline call. Every original local content validator remains active.

## 5. Normalized input

`Service/input/generationInput.mjs` records input kind, request identity, explicit instructions, context/count hints and constraints. External webpages and uploaded text are marked as untrusted source data. The central Anthropic system instruction reinforces that source text cannot override application or explicit user instructions. This is an instruction boundary, not a claim of immunity to every prompt injection.

## 6. Versioned specification

`Service/design/designSchema.mjs` defines version `2.0`. The wrapper contains artifact type, request ID, stable content IDs and SHA-256 fingerprints, separate design units, theme, asset requirements and provenance. Canonical bodies remain in `generatedContent`; the wrapper does not duplicate them.

Example design unit: `{ "contentId":"slide-3", "component":"comparison-two-column", "purpose":"Compare the supplied alternatives" }`. Component IDs must exist in the registry; this example is a registered comparison layout. `componentCatalog()` provides exact IDs.

An AI plan is validated and labeled `ai-directed`. Saved or injected content without the optional new plan gets an explicit `legacy-adapter` provenance. It is never falsely described as AI-designed.

## 7. Component registry

`componentRegistry.mjs` wraps actual presentation layouts with supported canonical slide types, geometry, minimum text sizes and renderer capabilities. Web components include editorial, grid, bento, showcase, timeline, list and image/text compositions. Document components include prose, reference and report. AI selects from supported components rather than executing arbitrary code or assigning a fixed template by industry.

## 8. Validation and content preservation

`specification.mjs` checks unit references, uniqueness, literal colors, contrast and component compatibility. Compilation changes layout intent and verifies content fingerprints. Compatible fallback does not delete or shorten content. Unsupported photo-bearing repair is refused rather than silently dropping a picture. Exact requested slide count is checked before compilation, including resumed saved content.

## 9. Presentation integration

AI component intent reaches `presentationLayoutService.mjs`; validated AI colors and font families reach the existing renderer after token construction. Explicit caller preferences take precedence and must still be readable. Semantic heading/body sizes remain consistent. Existing geometry determines actual spacing: arbitrary AI spacing is advisory and recorded in `presentationDesignTrace`, not falsely claimed as a free-form canvas implementation.

## 10. Webpage integration

The existing planner can return `artifactDesign`. Its colors, font pair and section composition reach safe HTML/CSS. Source-specific creative direction is retained instead of being overwritten by an inferred industry profile. Asset requirements are planned before acquisition, including artifact-level hero references. Required missing pictures produce recoverable incomplete output with downloadable drafts. Browser not-run or capacity-skipped status is reported honestly.

## 11. Document integration

The outline can return design units and a font/color/spacing plan. Actual Word paragraph styles and HTML preview classes implement prose/reference/report choices. Word uses white paper and validated ink contrast; arbitrary colored page canvases are rejected. The HTML preview is not a page-accurate Word pagination guarantee. Existing section generation and approved illustration placement remain active.

## 12. Cover and visual policy

A topic-relevant full-slide background is required on slide 1 unless the user explicitly requests the whole presentation image-free/text-only. Excluding only supporting-slide photos retains the cover requirement. Native charts and precise diagrams cannot be replaced with decorative photos or unverified generated scientific imagery. A required photo remains missing until an eligible photo is supplied.

## 13. SVG and diagrams

`safeSvg.mjs` permits a small declarative SVG vocabulary with literal geometry/colors and bounded nodes, path length, dimensions and bytes. Scripts, resource URLs, entities, style and foreign objects are rejected. SVG is rasterized through Sharp and bound to its own supporting slide. This feature currently applies to supporting presentation concepts only; it is not an arbitrary SVG engine for all artifacts. Native diagram nodes have semantic connector ports, and ornamental node underlines were removed. Geometry is still bounded rather than scientifically verified.

## 14. Render, inspect and repair

`quality.mjs` orchestrates rendering, inspection, rejection cleanup and at most one component repair. Package, content-fit, image binding and existing pixel checks remain essential. Optional `LEDIFY_VISUAL_REVIEW=true` samples at most two complex presentation slides using actual PNG bytes; it does not review every slide repeatedly. Selective vision is mocked in tests, not live verified. A persistent substantive failure blocks approval. Incomplete native conversion retains drafts and an explicit export failure.

## 15. Isolation, concurrency and lifecycle

Generation defaults remain bounded: 2 admitted generations, 6 text calls, 1 native renderer and bounded stock work. Requests have separate job/artifact directories and checksum bindings. Shared source caching does not share mutable caller metadata; `cloneSharedAsset` copies mutable structures and buffers while immutable strings can be reused. `renderProcesses.mjs` tracks owned conversion processes. SIGTERM/SIGINT stop readiness/admission, drain for a bounded period, terminate owned children and bound database disconnect. This is not a full Windows process-group guarantee for every native grandchild. Browser QA temporary directories are removed unless an explicit diagnostic retention flag is set.

## 16. Controlled performance evidence

Four local HTTP/durable-job runs used comparable fixed 10-slide content, three matching authorized photographs, mocked Claude at 100 ms per call, real PPTX/LibreOffice/PDF/PNG, and stubbed MongoDB operations. Both architecture modes used six slide workers and fast PNG encoding. Reference uses `legacy`; optimized uses `2.0`. Themes differ, so these are not pixel-identical whole-deck experiments or an isolated causal estimate for design compilation.

| Case | Reference observed total | 2.0 observed total | Parent RSS peak reference / 2.0 | Parent CPU reference / 2.0 |
|---|---:|---:|---:|---:|
| One user | 32.686 s | 28.362 s | 219.3 / 201.4 MB | 10.156 / 11.063 s |
| Two users, wall time to both | 58.956 s | 45.645 s | 220.7 / 209.6 MB | 19.484 / 14.688 s |

Observed reductions were 13.2% and 22.6% in these runs; conversion variability is substantial. Every request made 11 mocked Messages calls and one mocked model lookup, with no retries; the harness deliberately holds semantic quality review out of both modes to keep content fixed. Production still performs semantic review. One-user 2.0 stage examples: content 0.462 s (mock), design validation 0.0029 s, compilation 0.0012 s, PPTX 0.260 s, package validation 0.654 s, PDF 18.538 s, PNG 2.457 s, PNG validation 1.569 s and photo validation 0.399 s. Parent-only metrics exclude native child CPU/memory. Health p95 was 13.5/16.2 ms single and 11.4/12.1 ms concurrent. Windows cannot provide Render cgroup data; Linux instrumentation is present but not measured here.

These are historical measurements, not a stable speed claim. Later verification measured 33.267 s single and 67.572 s concurrent; the earlier reductions did not repeat. `generated/design-native/optimized-{1,2}/report.json` now contains those later reruns. See [the reliability follow-up](generation-reliability-2026-10-28.md) for conditions and complete latest results. None of these mocked-provider measurements establishes a cure for a 147-second live Render request. Earlier separately measured PNG encoder improvements are documented in `claude-performance-results-2026-10-28.md`.

## 17. Verification and practical limits

Representative mocked Messages tests cover aviation, healthcare, research/manufacturing, business and conservation presentations; fashion, automotive, restaurant, corporate, education and portfolio webpages; and academic/business/technical Word documents. Presentation representative fixtures explicitly request image-free decks; separate native ten-slide audits retain three real photos and full cover imagery. Actual browser QA passed fashion, restaurant, business and education at 360/768/1440 px, with screenshots/reports under `generated/v2-browser`. Browser tests use image-free fixtures and do not certify real provider imagery. Core tests cover unsafe SVG rejection, actual SVG embedding, compatible fallback, content fingerprints, sampled PNG vision transport, owned-directory cleanup and graceful shutdown. See the reliability follow-up report for the final broad regression count and subsequent provider changes.

## 18. API, configuration, deployment and rollback

Existing routes and response fields remain. Optional `engineVersion`, `designSpecification`, `designQuality` and `outcome` are additive. New explicit design/visual failures use HTTP 422; unavailable native export uses HTTP 503. Available drafts remain linked. Existing job terminal states are retained for polling compatibility; `outcome.state` consistently distinguishes complete, warning, incomplete and failed results across the result, job and request record.

`config/ai.env.example` documents `LEDIFY_DESIGN_ENGINE=2.0`, `LEDIFY_VISUAL_REVIEW=false`, `LEDIFY_RETAIN_QA_ARTIFACTS=false`. Setting the engine to `legacy` bypasses the new design boundary without reverting unrelated reliability fixes. Keep visual review disabled until its live cost/latency is accepted. Do not enable the separately approved BFL provider merely to deploy design changes. Deploy manually only after reviewing the working tree and running staging smoke tests. Persist artifact/job storage as already required by durable jobs; an ephemeral filesystem cannot guarantee restart survival. No deployment or push occurred.

## 19. Remaining work and next verification

Live exact-model Messages/vision access, BFL generation, new stock accounts, Render resource/load measurements and subjective customer-quality acceptance remain unverified. The component registry expands existing capabilities rather than completing an unlimited design canvas. Spatial scientific accuracy, releases/trademarks and license metadata need appropriate independent review. Next staging checks should use the same representative prompts with authorized real sources, measure cold/warm and two-user runs, inspect every exported format and record actual provider/queue/conversion durations before setting a production SLA. Sixty seconds remains an objective, not a guarantee.
