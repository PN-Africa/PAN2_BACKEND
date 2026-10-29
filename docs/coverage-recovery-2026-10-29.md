# Presentation coverage recovery repair

## Evidence and cause

Request `993d87a3-23f3-4887-b745-31b3be3f4f90` is a different failure from the preceding optional-reference warning. Its final review reported substantive COVERAGE and CLARITY errors after slide 6's conversion to text.

The supplied log shows a fallback body of 291 characters rejected against a 280-character limit, followed by a length repair producing 236 characters. The final review then failed. The image race had already resolved slide 6's photo; image sourcing was not the reported failure. Total backend processing was 136.69 seconds, of which content consumed 136.40 seconds. Three quality reviews consumed 38.82 seconds in aggregate.

Code inspection found three recovery weaknesses:

1. An image-bearing text fallback inherited the ordinary image-caption body ceiling of 280 characters, despite being responsible for replacing the whole explanation. Its composition was chosen by the ordinary slide-number rule rather than its recovery requirements.
2. Recovery passed only the latest round's issue list. Once an initial coverage warning became a clarity warning, the fallback no longer received that original coverage feedback explicitly.
3. The new focused-explanation prompt still included the previous visualContent/diagram object under `Current slide`, alongside the contradictory instruction to preserve the same structure.

The sanitized log does not contain the exact original prose, reviewer evidence, or user prompt. It establishes the sequence and length pressure, but cannot prove exactly which explanation was lost. The regression uses a controlled analogous case, not an asserted replay of the unavailable text.

## Implementation

- `Service/aiService.mjs`: select the supported focused-explanation fallback and wide-text photo composition before drafting; remove stale content from the new canonical slide; pass original content, accumulated findings and explicit essential points separately. Preserve protected numerical facts from both the original reviewed content and the latest draft. Keep the existing attempt budget.
- `Service/ai/presentationQuality.mjs`: retain per-slide findings across rounds and send original content and mapped requirements to recovery. Re-review the changed slide with unchanged deck context, as before. No substantive errors are downgraded.
- `Service/ai/presentationContentBudget.mjs`: ordinary image body budget stays 280 characters. Only the focused-explanation recovery path uses a 547-character budget derived from the actual existing photo-technical text box; actual word wrapping remains validated.
- `renderer/presentation/photoCompositions.mjs`: export and share that existing text-box geometry; no font reduction or new renderer.
- `Service/visual/imageArtDirection.mjs`: select photo-technical for converted explanations; expose a subject identity distinct from crop/composition identity.
- `Service/visual/presentationPrefetch.mjs`: retain the subject identity of prefetched winners.
- `Service/visual/presentationVisuals.mjs`: reuse a winner only when the same request-local prefetch entry still matches the subject; reframe it when just the composition changes.
- `Service/visual/presentationImageAssets.mjs`: verify request, target and checksum bindings before reframing, preserve effective resolution and duplicate checks, and bind the resulting bytes again. An already validated cropped asset may be smaller than the original-source 800x600 floor; its new target still must meet 90 effective PPI. New sources retain the original minimum dimensions.
- Tests: `tests/fixtures/coverageRecovery.mjs`, `tests/regression/coverage-recovery.test.mjs`, `tests/coverageRecoveryAudit.mjs`.

## Verification

The focused run covering recovery, images, speed and safe performance passed **30 tests**. The four recovery regressions passed again after the final duplicate guard. The final full regression suite passed **780 tests**, with zero failures or skips, in **301.34 seconds**. Log: `generated/coverage-recovery/full-final.log`.

The controlled native audit exercises actual image prefetch with an injected local-photo provider and mocked Claude Messages transport. It returned HTTP **201**, completed status, exactly **10 slides**, PPTX, PDF and all **10 PNG previews**. All **12 download endpoints** succeeded. Slide 6 contains the complete longer explanation and an embedded photo in PPTX XML. Its PNG was visually inspected for readable text and image placement.

Three quality reviews, one targeted repair and one fallback were used, within the unchanged budget. Exactly two photo provider calls occurred: one for the cover and one for slide 6. The existing slide-6 image was reframed without a second provider call. Separate tests reject cross-request reuse and confirm changed subject identity does not qualify for reuse. Successful slides retain their original content and order.

The native audit took about **16.25 seconds** locally. This includes real LibreOffice/PDF/PNG work and mocked provider latency; it is not a live-provider speed claim. Machine-readable results: `generated/coverage-recovery/native/report.json`.

## Limits and deployment

Coverage, factual correctness, clarity, structure, readable layout and required assets still have publication gates. A replacement that remains substantively incomplete fails in a bounded, controlled way; this change does not promise that every provider response will succeed. No paid live generation was run, providers/models/API contracts were preserved, no environment changes are required, and production was not deployed. The running backend must load these local source changes before retesting.
