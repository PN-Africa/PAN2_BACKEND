# Slide fallback allocation and targeted repair

## Confirmed failure

The additional log confirms the exact cause for request `f0a3dc60-5eab-4481-9e9c-a6316a00b4ea`:

1. Quality review identified slide 5 DEPTH, slide 3 CLARITY, slide 10 CONCLUSION and slide 7 CLARITY issues. The optional reference limitation was correctly retained as non-blocking.
2. Slides 3, 7 and 5 each received one targeted generation response that exceeded a field length limit: respectively a 56-character card description, a 15-character diagram edge label, and 40-character node descriptions.
3. Targeted generation allowed only one call, so its existing field-only repair mechanism had no remaining attempt to correct those lengths.
4. Slides 3 and 7 completed fallback first. The entire deck shared just two fallback slots. Slide 5 was consequently refused its **first** fallback, causing the reported error. Its own reserve had not been spent.

This is confirmed pool starvation, not evidence that slide 5's fallback was generated and rejected. The supplied terminal trace is sanitized and does not include the exact generated explanations or detailed reviewer feedback. The regression matches its stages, slide IDs, errors and completion order using controlled content.

Backend time was 112.08 seconds, including a 49.38-second outline and a 23.73-second quality review. The failure happened before native presentation conversion; image sourcing had succeeded for the relevant photo slots.

## Changes

- `Service/ai/presentationRepairBudget.mjs`: allocate one fallback reserve per eligible content slide for actual decks, bounded by the validated maximum of 12 total slides. A ten-slide deck with one cover has nine possible fallback reserves, at most two calls each. A slide may claim its reserve only once. Structural preflight and semantic review now have separate bounded counters, so preflight cannot consume the later semantic slot. Budget availability exposes safe reason codes. Standalone legacy callers that do not supply a slide list retain their two-slot default.
- `Service/aiService.mjs`: supply the actual eligible slide list; allow one field-only correction after an invalid targeted response through the existing `generateJsonWithRetry` mechanism; preserve the recovery text budget in subsequent repairs of converted slides; report why fallback is unavailable. No new retry engine or provider change.
- `Service/ai/presentationQuality.mjs`: process every pending fallback slide within the same review round instead of slicing the queue to two slides. Fallback-only rounds use two workers; mixed targeted rounds retain existing bounded concurrency and provider capacity. Errors retain repair history, reserve state and a specific recovery reason.
- `controller/generateController.mjs`: add sanitized budget and recovery-reason fields to quality failure diagnostics and responses. Existing status codes and error codes remain compatible.
- Tests: `tests/fixtures/fallbackAllocation.mjs`, `tests/regression/fallback-allocation.test.mjs`, `tests/fallbackAllocationAudit.mjs`; update the existing slide-recovery call ceiling to account for the newly available field-only correction.

## Bounds and trade-offs

Ordinary semantic repair remains one operation per slide, up to four request-wide by default, with at most two calls for each content operation. Structural preflight is separately capped at four operations, at most three calls when metadata plus content repair are needed. Native layout recovery remains capped at four operations/two calls each. Fallback remains one conversion per eligible slide, at most two calls each, with no whole-deck regeneration.

The maximum total recovery allowance is larger for decks with more than two problem slides. Such requests can use more provider calls and time instead of being refused solely because other slides recovered first. Small field repairs can avoid conversion altogether. Existing provider capacity, request deadlines, cancellation and generation admission remain in force. No paid service or model was added.

## Verification

Regression cases cover the old three-versus-two allocation failure, request isolation, one claim per slide, separate structural/semantic reserves, three simultaneous pending fallbacks, bounded fallback concurrency, field-only correction, the 547-character converted-photo text budget during subsequent repairs, unchanged successful slide content/order, and factual errors that remain blocked with diagnostics.

The focused recovery/contract run passed **51 tests**, with zero failures or skips. The final seven allocation-specific cases also passed independently. Logs: `generated/fallback-allocation/final-focused.log`, `generated/fallback-allocation/reproduction.log`, and `generated/fallback-allocation/full-regression.log` for the full suite.

Full regression run: **786 passed**, zero failures or skips, **548.10 seconds**. The seventh allocation-specific case was added after that file had run in the full suite and passed in the final focused run above.

Native audit (`generated/fallback-allocation/native/report.json`): HTTP **201**, completed API/database status, exactly **10 slides**, **10 PNG previews**, and all **12 download endpoints** succeeding. Fallback completion order was **3, 7, 5**; slide 5 was no longer starved. One outline, two quality reviews, three field-only repair calls and three successful conversions. PPTX XML contains all ten slides, the required cover picture, and the replacement explanations on slides 3, 5 and 7. About **24.84 seconds** locally, with real PPTX/LibreOffice/PDF/PNG processing and mocked provider latency; this is not a live-provider speed measurement.

## Remaining verification

Claude transport and image sources were mocked/local. The original request was not replayed against a paid live model. Production was not deployed; the running backend must load the updated sources. Genuine factual, coverage, readability, schema and required-asset failures remain publication blockers, with bounded attempts and explicit diagnostics.
