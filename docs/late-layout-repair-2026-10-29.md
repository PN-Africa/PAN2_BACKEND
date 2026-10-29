# Late presentation layout repair — 29 October 2026

The failure reported for request `1fcd40b4-19ba-4eab-b5b6-847a229488fb` exposed a gap in the late visual-resolution recovery path. The earlier repair-transaction work did not cover this path sufficiently.

## Evidence and cause

The supplied log shows all nine slide bodies and the content quality review completed. Slide 4's four descriptions were repaired to 34/35/33/33 characters under the planned composition's 40-character guidance. Its optional supporting image search then returned no eligible image; generated-image fallback was disabled. The resulting native diagram composition had different geometry and reported a 29-character fitting target for node 1.

The late `visual-layout-repair` call was logged as completed, but its validator checked JSON, character limits and numerical/qualification preservation only. Actual word wrapping was checked afterward, outside `generateJsonWithRetry`. A replacement could therefore pass the repair call and still fail the slide. The per-slide recovery budget then prevented another independent call; final validation returned HTTP 500 after approximately 80.79 seconds.

The historical late replacement text was not logged, so its exact typography cannot be reconstructed. A controlled four-node regression reproduces the same failure field and 29-character target. In that fixture, a 29-character string passes the old character validator but requires too many rendered lines. This proves that the numeric target alone is insufficient; increasing it would not fix the physical overflow.

A second independently reproduced defect affected state consistency: `textTarget` modified the resolved diagram snapshot while leaving its matching canonical content unchanged. Removing the resolved visual later could restore the old overlong description.

## Changes

- `Service/visual/layoutRecovery.mjs`: the late repair's validation callback now constructs a private candidate slide and runs the actual renderer's geometry/wrapping checks **inside** the existing two-attempt AI operation. Geometry rejection supplies alias-specific, more concise retry guidance before a success is logged. Numerical and qualification preservation checks remain active. Invalid candidates never mutate approved content.
- The same module mirrors a repaired diagram field into matching canonical content and `visualPlan` snapshots only when the node identity (or edge endpoints) and original value agree. Independent catalog/source diagrams are not overwritten. Cloning preserves request isolation.
- `Service/visual/presentationVisuals.mjs`: forwards the final-layout validation callback through its existing repair-budget wrapper. Without this propagation, the ordinary generation pipeline would still miss the new geometry check. The per-slide/deck budgets remain bounded.
- Late AI logs now include the slide number.

No font sizes, physical fit checks, diagram content requirements, image providers, API routes or paid-service settings were relaxed or changed. No text is truncated. Genuine unresolved layouts remain failures after bounded recovery.

## Verification

Full regression suite: **713 passed, 0 failed, 0 skipped**, in 247.141 seconds (`generated/late-layout-full-regression.log`). `git diff --check` passed; `.env` remains unchanged.

`tests/regression/late-layout-repair.test.mjs` covers the 29-character wrapping failure, geometry rejection and retry through the mocked Anthropic Messages adapter, canonical/resolved agreement, source immutability, bounded exhaustion, and protection of unrelated diagram nodes. Before the fix, the new regression cases failed on the missing retry and stale canonical description.

`tests/lateLayoutAudit.mjs` exercises the actual Express text endpoint using the supplied short prompt verbatim, including its unfinished quote. It uses a reconstructed nine-slide fixture with a 35-character slide-4 description that fits the planned photo layout but fails the image-free native layout. Image retrieval is deliberately unavailable for that supporting image; the mandatory cover has a local licensed fixture photograph.

The first mocked late reply meets the 29-character schema but fails wrapping; the second fits. The completed run verifies HTTP 201, nine slides, matching canonical/resolved text, the corrected description in actual PPTX XML, PDF/PNG signatures, and successful PPTX/PDF/all-nine-PNG downloads. The slide-4 PNG was visually inspected.

Local audit duration: **14.852 seconds**, with **13 mocked AI calls**, including two late repair attempts (one geometry rejection, one success). Native PDF conversion accounted for about 10.18 seconds. These figures are local mocked-provider measurements, not evidence of live Claude speed or a production timing improvement. No billable calls were made.

Artifacts and structured evidence: `generated/late-layout-1fcd40b4/report.json`, `diagnostics.json`, `result.pptx`, `result.pdf`, `result.png`. Before-change reproduction: `generated/late-layout-before.log`.

## Deployment boundary

Changes are local to this backend checkout. No production deployment, credentials update or image-provider activation was performed. The local server must load the updated modules before retesting; no further prompt edits are required for this repair. Previous uncommitted work is preserved.
