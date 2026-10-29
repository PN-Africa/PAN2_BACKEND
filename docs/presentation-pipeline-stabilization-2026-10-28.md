# Presentation pipeline stabilization

28 October 2026. Backend changes only. No push, deployment, real environment activation or billable provider test.

## Actual pipeline and inspected boundaries

The existing Express routes feed `generateController` through input admission, JSON/multipart validation, text validation or URL/file extraction, context normalization and MongoDB request creation. `generateService` normalizes the source, obtains an outline/design plan, drafts bounded parallel slide bodies and runs structured, content, geometry and grounding checks. Image prefetch can overlap approved slide drafting. The presentation validation and semantic review stages repair affected slides before content is compiled into a design specification.

The remaining sequence is layout/theme preparation, safe SVG assets, final photo/diagram resolution, final layout validation, PPTX construction and package validation, LibreOffice PDF conversion, PNG conversion, image/preview checks, optional sampled visual review, public URL preparation and final persistence. The asynchronous route adds durable plan/body/content/review/artifact checkpoints and bounded workers. It preserves legacy polling states while exposing completion outcomes.

Inspected boundaries include `route/generateRoute.mjs`, `controller/generateController.mjs`, `presentationAssetsController.mjs`, `Service/generateService.mjs`, `generationJobs.mjs`, `aiService.mjs`, the AI validation/repair/review modules, `presentationLayoutService.mjs`, `presentationThemeService.mjs`, design specification/quality/SVG modules, presentation image policy/providers/art direction/resolution, professional/photo/native-diagram rendering, geometry/text fitting, preview/package/pixel validation and both native converters. The six requested generation/asset endpoints remain unchanged.

## Confirmed causes and evidence limits

Failures A–C were coordinated content-contract defects: first-error-only discovery, renderer-specific limits arriving after drafting, and patch responses overwriting the complete draft on failed retries. The previous [content-contract repair](presentation-content-contract-repair-2026-10-28.md) supplies aggregate string repairs, retained canonical drafts, renderer-derived drafting budgets and bounded truncated/malformed-response recovery. Those changes remain active and are covered by the full regression suite.

Failure D exposed repeated whole-deck reviews and incorrectly targeted slide repairs. The [review/design report](stakeholder-design-and-quality-review-2026-10-28.md) describes typed issues, bounded changed-slide review, no-progress detection and private reviewer-response storage. The actual three historical reviewer bodies for `841792e1-a475-4d0c-a715-79414cfba061` remain unavailable, so its exact factual/coverage criterion cannot be reconstructed.

Failure E identified a separate gap. `presentationVisuals` resolves assets after content approval, then performs a final dry render. Its `visual.caption` could be added from a diagram/catalog after the earlier check. The renderer gave it a fixed 0.65-inch box and threw before `renderInspectRepair` could run. Removing a resolved image did not necessarily solve the issue: the original declarative diagram/caption could still render. The supplied historical request `95077f0d-77f2-40dd-a5f9-8a5fc08bcd79` does not include the actual caption; a reproducible 135-character caption exercises the same boundary without inventing that historical text.

A second caption defect was found during inspection: photo-and-native-diagram compositions rendered diagram nodes but did not explicitly draw the meaningful caption. It is now retained. The first broad regression run caught a space regression in a four-node photo diagram after adding that band. Prose and short captions now reserve measured wrapping height at the existing font size, preserving the four-node composition; its original regression test passes.

The prior intermittent Windows job failures were also investigated. Repeated polling read `status.json` from disk while atomic replacements retried transient file locks. Exhausting that filesystem recovery could mark a generated result failed. A separate post-completion warning-write error could escape into the general job-failure path even after completed status had already been committed.

## Coordinated recovery architecture

- `visualLayout.mjs` defines a shared 18 pt caption contract, maximum band height, margins and geometry-derived schema budget. Captions receive enough wrapping height; the visual area adjusts within the slide. The diagram schema uses the same narrow-band capacity rather than an unrelated arbitrary caption length.
- A wider caption composition is available without dropping text or shrinking fonts. Photo diagrams retain a separate caption band beside the photo and reserve only the needed prose height.
- `recoverSlideLayout` runs at the actual asset/layout boundary. It first validates the completed composition, tries compatible deterministic layouts, and then optionally repairs identifiable invalid strings. It cannot replace native charts/diagrams with an incompatible photo-only layout, discard a mandatory cover or bypass unsafe SVG validation.
- If deterministic adaptation cannot work, the generator can request one targeted field-set repair for that slide. The deck allows at most three such operations, each with at most two provider attempts. Only selected strings are sent; media buffers/base64, unrelated body text and complete slides are excluded. Complete slides are revalidated before use.
- Numeric tokens and qualification categories are checked before merging. The prompt also requires preservation of meaning, names, units and limitations. These are conservative guards, not a proof of factual equivalence. No-op, malformed or still-unrenderable repairs remain failures. No invalid artifact is labeled successful.
- Recovery clones mutable content and diagram metadata before editing, so a cached/catalog asset or another request cannot acquire the repaired text accidentally. Required photos remain subject to the existing binding and preview checks.
- Successful targeted rewriting produces `LAYOUT_TEXT_REPAIRED` evidence; deterministic adaptation records `layoutRecovery`. Stage timings include `visual-layout-validation`; structured logs distinguish adapted, repaired, unresolved and failed outcomes without logging private text.
- Unresolved optional visuals retain useful content and warnings. Missing required conceptual diagrams without an applicable native structured alternative produce `visualValidation.status=incomplete`; the API returns `VISUAL_REQUIREMENTS_UNMET` with available draft artifacts. Required cover/image enforcement remains active.

This is an additional recovery boundary, not a bypass of the earlier schema, content, grounding, semantic, geometry or export validators. Critical text remains at the existing semantic sizes; overflow is not solved by making it unreadable.

## Job persistence stabilization

`atomicJobJson` snapshots JSON before writing, uses a unique temporary file and atomic replacement, and cleans up temporary files even after an interrupted write. It retries only transient `EPERM`/`EACCES`/`EBUSY` locks, with bounded delays and a roughly five-second rename-recovery budget (underlying I/O can take additional time). Permanent disk errors fail immediately. It never deletes the previous durable status or regenerates AI content to overcome a file lock.

Polling now parses independent copies of **committed** status snapshots. The cache is scoped to the queue root, limited to 64 entries/8 MiB, and populated only after successful disk replacement. Disk state is still used for initial/restart loading and evicted entries; token checking remains unchanged. This reduces repeated reader/scanner contention while preserving durable-first publication and caller isolation.

A failed attempt to persist a warning after completed status was already committed is logged; it cannot downgrade the available completed result. Actual generation/artifact failures still use the failure path. No test timeout was increased, and no filesystem error is treated as successful persistence.

## Image-provider findings

The current image service already supports configured stock adapters, Commons, approved generation, request-scoped binding/storage, licensing/media/scene/geography checks, bounded search expansion, budgets and concurrency. No eligible match can be the correct result when a source lacks the requested scene or licensing/metadata is insufficient. An unrelated picture is not substituted to satisfy a count. These guards were preserved rather than relaxed to make tests pass.

Local safe configuration inspection shows `AI_IMAGE_PROVIDER` unset (default `disabled`), approval not true, a Gemini key present, and the presentation generation flag true. A credential does not select or approve billable generation. Render configuration and live model/key availability are unverified. After explicit spending approval, the operator must select `AI_IMAGE_PROVIDER=gemini`, approve it, set the intended image model/key, allow presentation generation and provide positive bounded cost/count settings. See `config/ai.env.example`. The real `.env` was not changed, and no real image/text provider was called in this work.

## End-to-end and artifact verification

Final full regression: **689/689 passed**, zero skipped, **255.899 seconds**, in `generated/pipeline-stabilization-full-final.log`. All **13 new stabilization cases** passed, alongside the earlier content-contract, quality, provider, HTTP, isolation and export regressions. Focused caption/content-budget checks passed **15/15**. The first broad run passed 688/689 and identified the four-node photo-layout regression described above; it was corrected and the complete suite rerun. The final run had no background-job storage/isolation failures. `git diff --check` passed and the real `.env` remains unchanged.

`tests/pipelineStabilizationAudit.mjs` starts the actual Express app and uses the real generation service, Claude Messages adapter with deterministic mock responses, design/asset/layout pipeline, PPTX writer, LibreOffice and PNG converter. The URL source and MongoDB model are injected fixtures; the DOCX request uses a real uploaded DOCX fixture and extraction. This does not test live website retrieval, MongoDB availability or a provider account.

Three sequential requests passed:

| Input route | Total fixture/audit time | AI mock calls | Artifact checks |
|---|---:|---:|---|
| textPrompt | 15.531 s | 13 | PPTX, PDF, all 10 PNG downloads |
| urlPrompt | 14.797 s | 13 | PPTX, PDF, all 10 PNG downloads |
| file/DOCX | 14.157 s | 13 | PPTX, PDF, all 10 PNG downloads |

Each deck has exactly ten slides, a mandatory embedded cover, a six-event timeline, a three-way comparison and a qualified diagram caption over the previous 69-character limit. The URL case additionally combines the supporting photo, editable diagram and full caption on slide 5. The full caption is asserted in the actual slide XML and the PNGs were inspected for clipping/overlap. Downloads are checked over HTTP using ZIP slide counts, PDF/PNG signatures and content types. Every PNG route is exercised, not just the cover.

Two additional requests passed concurrently: URL **16.196 s**, text **32.769 s**. The text request spent **14.426 s** in the bounded render queue. Distinct request/preview IDs were asserted, and every deck's actual artifacts/downloads were verified. Controlled job tests separately cover 2/5/10/20 mixed simultaneous requests and token isolation.

The 13 mock calls comprise outline + ten bodies + one aggregate body repair + one semantic review. There was no late-caption AI repair in these native runs: deterministic geometry preserved it. Synthetic token/cost values from the mock are not real provider bills. The sequential run was warm; its time must not be presented as a measured improvement against historical live 75–167-second runs. Local LibreOffice remains the dominant native stage, and concurrency intentionally queues expensive native exports. Stage, CPU, event-loop and Node memory reports are saved; child-process memory is not included in Node RSS.

Visual evidence: [text slide 5](../generated/pipeline-stabilization/textPrompt-slide5.png), [photo/diagram slide 5](../generated/pipeline-stabilization/urlPrompt-slide5.png), [ten-slide contact sheet](../generated/pipeline-stabilization/textPrompt-contact.png). Machine evidence: `generated/pipeline-stabilization/report.json` and `generated/pipeline-stabilization-concurrent/report.json`.

## Performance and remaining limits

Existing bounded parallel drafting, prefetch reuse, aggregate repairs, changed-slide reviews, cost accounting, deadlines and native conversion queues remain intact. No additional AI call is made for a caption that fits an adapted layout. Optional source failures do not justify repeated irrelevant searches. No model/provider swap, paid service, speculative caching setting or conversion stage removal was introduced.

The earlier outline audit measured roughly 22k prompt characters and an 8,192-token ceiling, using the compatibility envelope required for its complex schema. That is not evidence that all tokens are generated, nor does it explain a particular live provider's 55–65-second latency. Live timing, provider throttling, true image availability/quality, production fonts/resources and actual billing remain unmeasured. A separately approved live integration test is still needed; local mocked output cannot guarantee arbitrary future model behavior or all aesthetic/factual judgments.

Permanent provider/configuration failures, unsafe inputs/SVG, corrupt artifacts, unavailable mandatory imagery and genuinely unrenderable content remain actionable failures. Optional warnings do not falsely claim that requested visuals or unavailable exports were supplied.

## Files modified in this task

- New: `renderer/presentation/visualLayout.mjs`, `Service/visual/layoutRecovery.mjs`, `Service/atomicJobJson.mjs`.
- Updated: `templates/presentation/visualSchemas.mjs`, `renderer/presentation/professionalLayouts.mjs`, `photoCompositions.mjs`, `Service/visual/presentationVisuals.mjs`, `Service/generateService.mjs`, `Service/incompleteFailure.mjs`, `Service/generationJobs.mjs`.
- Verification: new `tests/regression/pipeline-stabilization.test.mjs`, `tests/pipelineStabilizationAudit.mjs`, this report.

Earlier uncommitted work was preserved. Webpage/document behavior was not redesigned; shared job persistence and incomplete-error classification are exercised by the full suite. No Express route, frontend state name, MongoDB connection setting or deployment was changed.
