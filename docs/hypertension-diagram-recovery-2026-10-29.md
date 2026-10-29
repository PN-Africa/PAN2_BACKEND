# Hypertension presentation validation repair

Request: `2c8c51e7-d0b4-4f68-8f7a-1277a3cb928f`.

## Evidence and cause

The supplied request was accepted and planned as twelve slides. The failure was not caused by the prompt's length, spelling, slide-count parsing or an Anthropic HTTP rejection. The backend spent 98.735 seconds before returning HTTP 502. Outline generation alone took 60.144 seconds. Content generation then failed before PPTX/PDF/PNG rendering began.

Slide 8 had three unsuccessful content attempts. Its first two failures had no actionable field in the supplied sanitized log; they regenerated the whole slide. The last attempt had a complete JSON draft but failed actual diagram geometry: node 0 label guidance was 18 characters; three descriptions had 40-character guidance. There was no remaining content attempt to repair these newly exposed fields. Slide 11 also demonstrated sequentially exposed problems: a body-field repair succeeded, followed by diagram-layout failures.

The existing layout-budget helper was only used in tests, not production slide drafting. The existing late layout-recovery service ran after content generation, so it could not rescue an otherwise usable diagram rejected inside the earlier content retry loop. Exhaustion discarded that draft before the later recovery stage could see it.

The original model responses are not in the attachment. Tests reproduce the same ordering with intentionally invalid topology on early attempts and a structurally valid, over-dense diagram on the last attempt; this does **not** establish that topology was the exact cause of the original early failures.

## Changes

- `Service/aiService.mjs`: connect renderer-derived budget guidance for text-visual and relationship slides, and opt those slide types into diagram recovery after ordinary content attempts are exhausted.
- `Service/ai/generateJsonWithRetry.mjs`: add an optional private recovery callback. It receives a draft only when completed JSON passes the original strict schema and text-safety checks and all reported errors can be addressed as bounded text fields. The callback result must pass the same schema, safety and caller validation again. No draft is attached to a public error. Failed-attempt logs now include sanitized field paths/character budgets rather than only the first field.
- `Service/ai/diagramContentRecovery.mjs`: restrict recovery to node/edge text-fit errors in a complete native diagram. Reuse the existing layout-repair service and actual geometry validation, including the planned photo composition where applicable. Clone the draft; preserve topology, IDs and unrelated content. No placeholder, clipping, font shrinking, photo removal or validation bypass is introduced.

The ordinary maximum remains three whole-slide attempts. An affected diagram may make **up to two additional field-only calls**, logged separately as `visual-layout-repair`, subject to the existing global provider capacity and generation deadline. Successful normal slides incur no additional calls. Invalid schemas, safety blocks, permanent provider errors, unrelated semantic failures and unsuccessful repairs continue to fail visibly. This is bounded recovery, not a guarantee that every possible response can be repaired.

Existing numeric/qualification protections and subsequent presentation quality review remain enabled. No medical-content quality guarantee is inferred from mocked tests. No paid provider calls, environment-file edits, production deployment, commit or push were performed.

## Verification

- `tests/regression/diagram-content-recovery.test.mjs`: six tests cover reproduction of the reported 18/40-character failure, successful field-only recovery, strict-schema/permanent-error exclusion, rejection of unrelated fields and invalid repair output, numeric/qualification preservation, and a complete twelve-slide Claude-protocol mock with quality review. The final diagram passes real renderer geometry.
- Existing repair-transaction, late-layout-repair and presentation-content-budget suites passed before the native audit.
- `tests/hypertensionRecoveryAudit.mjs`: real HTTP endpoint, native PPTX/PDF/PNG creation and download checks with mocked Claude and controlled cover-image bytes. It returned HTTP **201**, persisted **completed**, generated **12 slides and 12 previews**, and all **14 downloads** returned HTTP 200. Native audit duration was about **28.6 seconds** including downloads; this is **not** a live-provider speed measurement or a reproduction of the exact original content.
- The audit used three ordinary attempts for slide 8 and one successful field-only recovery call; total mocked AI calls were 17 including outline, all content attempts and final quality review. The test slide's PNG was visually inspected for text fit and overlap.
- Full regression suite: **750 passed, zero failures or skips**, 628.813 seconds. This includes presentation, webpage, document, provider-race, isolation and export coverage.

Raw audit evidence: `generated/hypertension-validation-repair/regression.log`, `focused-existing.log`, `native.log`, and `native/report.json`. Full regression results are in `generated/hypertension-validation-repair/full-regression.log`.

New test support: `tests/fixtures/hypertensionRecovery.mjs`. The fixture is mechanical regression data with controlled imagery, not a clinically reviewed presentation for distribution.

Exact pre-edit copies of the two existing production modules are preserved in `generated/hypertension-validation-repair/before/`. Rollback should restore only those files and remove the new recovery-module import/call through that restoration; leave unrelated uncommitted work intact.

## Remaining latency and release limits

The supplied trace now confirms real AI/provider waiting as a significant contributor: the outline alone consumed about 61% of the failed request's elapsed time. Local mocked timings cannot establish production speed. The recovery step can add bounded latency/cost on exceptional slides, while avoiding regeneration of valid slide content. Production has not been changed; the code still needs the normal review/release process and a subsequent real-provider verification after authorization.
