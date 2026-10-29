# Presentation recovery and artifact delivery — 29 October 2026

## Result

A valid presentation that recovers from missing optional imagery now returns the existing successful HTTP 201 response, with `data.result.status: "completed"`, the existing preview/download fields, and `outcome.recovered: true`. Database and asynchronous job statuses remain `completed`. A recovered outcome does not override missing essential content, genuinely required assets, incomplete exports, or failed rendered-quality gates.

## Root cause

`planImageCoverage` previously promoted the AI planner's `visualRequirement.required: true` into a final essential image requirement. `generateService` then marked any unmet image requirement as `incomplete`. The controller correctly mapped that status to HTTP 422 `IMAGE_REQUIREMENTS_UNMET`; the underlying problem was treating planner-selected design enhancements as user requirements.

The pipeline already supported professional text/native-diagram fallbacks and preserved incomplete artifacts. This change uses those validated fallbacks instead of discarding the successful delivery state after optional-image outages.

## Changes

- `Service/visual/imageArtDirection.mjs`: classifies photographic requirements by origin. The mandatory first-slide cover, explicitly requested photographs (including per-slide/all-slide instructions), explicit required-image slide preferences, and supplied user assets remain essential. A planner's boolean alone no longer establishes an essential supporting photograph. Original photo briefs remain available for acquisition, but optional supporting requirements are marked optional consistently.
- `Service/visual/presentationVisuals.mjs`: validates the fallback slides before recording `visualResolution.status: "adapted"`. Keeps the original image target in `plannedTarget` and records adapted optional slides; the final target reflects the validated alternative design. Logs recovery with a request ID and affected slide numbers. Existing strict essential-asset checks remain active.
- `Service/generateService.mjs`: passes original user image instructions separately from inferred planning instructions; aligns the design specification's photographic asset flags with the final plan. Completed exports with recovered optional imagery, layout adaptations, or successfully recovered AI attempts receive `recovery.status: "completed_with_recovery"` internally and the compatible public `completed` status. Essential-image, diagram, export and design-quality failures still take precedence.
- `Service/generationOutcome.mjs`: adds `recovered: true` for these recovered results while retaining the established complete/incomplete states, artifact availability and recovery action for incomplete work.
- `Service/publicGenerationResult.mjs`: removes private presentation diagnostics, image-failure detail lists and stack traces from the public projection. Server-side image/AI/recovery logs remain available. Document/webpage diagnostic projection is unchanged.
- `Service/aiService.mjs`: preserves targeted metadata repair. A subtitle-only review repair requests and validates only that field, retaining the approved title and body. This fixes a mismatch exposed by the full regression suite; it does not suppress content or quality errors.

No endpoint names, response envelopes, preview IDs, download routes, model/provider choices or credential settings changed. No new frontend response parser is required: HTTP 201 plus the existing `completed` status is the normal success path.

## Verified outage scenario

Final full regression run: **716 passed, 0 failed, 0 skipped**, in 472.369 seconds (`generated/graceful-delivery-verified.log`). The focused recovery/essential-outage run passed all seven cases; the metadata/repair preservation run passed all 39 cases. `git diff --check` passed and `.env` is unchanged.

`tests/regression/presentation-recovery-delivery.test.mjs` reconstructs the requested case identified by `abbc625b-e6e6-440c-b55f-3d30e3e1fe0e`:

- Nine complete slides; five planned photographs with planner `required` flags.
- One licensed local cover photograph succeeds; four supporting searches return no image.
- Readable professional fallback layouts pass the existing renderer/quality checks.
- Actual PPTX, LibreOffice PDF and nine PNG previews are generated.
- Synchronous HTTP 201, public result `completed`, `outcome.state: "complete"`, `artifactsAvailable: true`, `recovered: true`.
- Saved record reports completion; asynchronous job reaches completion without a final error.
- PPTX, PDF and all nine PNG downloads return HTTP 200 with nonempty content.
- Final source requirements and design specification no longer call the four optional photographs essential.

The public response retains its actual nested structure (`data.result.preview.previewId`, `preview.slides`, `preview.downloads` and added absolute URL fields). It is not replaced by the illustrative flat response from the request. Evidence is saved at `generated/recovery-delivery-abbc625b/report.json`.

`tests/regression/presentation-image-outages.test.mjs` now explicitly instructs “Every slide must include an authentic photograph” in its essential-image outage fixture. It verifies that text, URL, combined and uploaded inputs still return incomplete outcomes with available file links, and async jobs do not falsely report success. Mandatory-cover tests also remain active.

Additional tests cover provenance, scoped explicit slide instructions, inferred instruction isolation, recovered outcome projection, and removal of private presentation diagnostics. Existing schema-repair, density, caption, quality, package corruption, export and image-isolation gates remain active.

The rendered fallback slide was also visually inspected: the complete process, readable typography and native connectors remain present without the unavailable optional photograph.

## Limits and deployment

Tests use mocked/unavailable image providers and controlled content; no billable AI calls were made. A local native export test verifies delivery, not live-provider speed or image availability. The original incident's literal deck and image briefs were not supplied; the scenario is a controlled reconstruction of its stated counts and failure conditions.

Warnings still describe available fallbacks; technical acquisition and repaired-AI failures remain in backend logs. A recoverable partial presentation remains clearly incomplete when an essential requirement cannot be met. The existing controller/job behavior retains its safe files and links; no unconditional success override was added.

All changes are local. No production deployment, push or `.env` edit occurred.
