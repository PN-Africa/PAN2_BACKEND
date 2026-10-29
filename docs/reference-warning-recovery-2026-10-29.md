# Presentation reference-warning recovery

## Finding

Request `cbf3a727-1aac-4bc3-aeb0-2c2e12863d50` exhausted a targeted repair and a slide fallback on slide 2 while the remaining issue was classified `REFERENCE`, severity `warning`. The gate excluded only a narrow list of minor style warnings from blocking errors. Consequently every reference warning consumed the same budget as a substantive defect and could reject the entire deck.

The supplied terminal output contains sanitized descriptions and assessment hashes, not the original reviewer message or evidence. It cannot establish whether that particular reference was valid, optional, or fabricated. This fix classifies the actual internal review reasons instead of inferring those facts from the public error string.

## Changes in this patch

- `Service/ai/referenceReviewPolicy.mjs`: explicit reference warning policy. Optional verification limitations and further-reading recommendations may accompany a completed artifact. A warning does not certify the reference. Actual citation defects, missing evidence for concrete claims, reference errors, and explicitly requested missing citations remain blocking. Unclassified concerns remain blocking.
- `Service/ai/presentationQuality.mjs`: apply the same warning policy before repair selection and at the final gate. The review prompt distinguishes actual defects from inability to externally verify optional sources. Safe diagnostics retain warning issues and add blocking issues and reference decision reason codes, without logging raw user content.
- `tests/regression/reference-warning-recovery.test.mjs`: warning delivery without repair, citation defects and required citations, bounded blocking recovery, mixed-slide isolation, preserved count/order/assets, and deterministic unsupported-claim protection.
- `tests/referenceWarningAudit.mjs`: controlled end-to-end HTTP and native artifact check.

No new retry loops, provider/model changes, rendering changes, API field changes, environment settings, deployment, or paid provider calls.

## Verification

Focused recovery/quality tests: **47 passed**, zero failures. After the final policy refinement, all five reference-policy regressions passed again.

Native audit (`generated/reference-warning-recovery/native/report.json`): HTTP **201**, `completed_with_warnings`, exactly **10 slides**, **10 PNG previews**, PPTX/PDF and all ten preview URLs fetched successfully (**12 downloads**). PPTX ZIP contains ten slide XML files and embedded images. One quality review, no repairs, twelve mocked AI calls. About **20.62 seconds** locally, including actual file conversion; this is not a live-provider latency measurement.

The existing database polling status remains `completed` for API compatibility; its persisted `outcome.state` and the returned result both report `completed_with_warnings`. The content review warning is retained in the response.

Full regression suite: **776 passed**, zero failures or skips, **332.02 seconds**. Results are recorded in `generated/reference-warning-recovery/full-regression.log`.

## Limits

The review remains an AI-assisted semantic check, not a citation database or external fact-verification service. Specific factual, clarity, coverage, citation, schema, rendering and required-image defects can still return controlled failures. The original request was not replayed against a paid live model, and production has not been modified. Existing optional private quality-audit files can retain the detailed internal reasons where configured; they should not be published as generic terminal diagnostics.
