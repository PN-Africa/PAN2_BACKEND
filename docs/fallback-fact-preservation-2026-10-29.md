# Fallback fact-preservation repair

Request investigated: `29a94238-3437-4937-9ec1-7d09bb645419`.

The supplied trace identifies slide 9's roadmap fallback as the failing stage. It does not contain the rejected draft, replacement text or missing value, so it cannot establish which exact fact triggered that particular request. No matching private review audit was found locally. The following defects were reproduced in the code and fixed; the exact paid live request was not replayed.

## Defects

The previous guard I added extracted numbers from `JSON.stringify(prior.content)`. This treated content and structural metadata alike. For example, the old matcher extracted `1` from an ID such as `phase-1`. It could also read `2030 goals` as the value `2030g`, because `g` was accepted as a unit prefix without a word boundary. Formatting differences such as `25.0 mm Hg` versus `25 mmHg` could cause false mismatches.

The fallback prompt asked generally to retain facts but did not show the exact protected-fact list used by validation. A genuine omission therefore caused an immediate failure after the single fallback call, without giving the existing field-repair mechanism an actionable body correction.

## Changes

- `Service/ai/numericFacts.mjs` (new): project visible content before extracting facts. Exclude IDs, edge endpoints, step numbers and visual search instructions. Recognize phase/step ordinal labels separately; preserve dates and timeline labels, including short historical years. Carry source field paths and nearby visible context for each protected fact.
- Normalize common equivalent decimal/grouped-number notation, signs, percentages and recognized unit spellings. Unit boundaries prevent ordinary words such as “goals” or “growth” from becoming grams. This does not automatically convert quantities between different units or certify all possible mathematical/linguistic equivalences.
- `Service/aiService.mjs`: supply the explicit fact ledger and source context to fallback generation. On a genuine omission, report actionable requirements for `textContent.body` and allow one correction through `generateJsonWithRetry` / `fieldRepairPlan`.
- `Service/ai/fieldRepair.mjs`: merge only the repaired body into the existing draft, preserving its heading. New numeric additions or corrections are allowed only when the server provides the authoritative source-fact list. This permits fixing an incorrect attempted fallback unit, while ordinary unauthorized unit/value changes remain rejected. The corrected body must contain every required missing fact; unrelated numerical additions are rejected.
- `Service/ai/generateJsonWithRetry.mjs`: add sanitized fact-preservation diagnostics to failed-attempt logs: expected/missing counts, source field paths and value hashes. No raw values, rejected text, source excerpts or credentials are added to logs or public errors.
- `Service/ai/presentationRepairBudget.mjs`: document the revised bound: **two converted slides per request**, each using **at most two provider calls**—the initial fallback and one existing repair attempt. Maximum fallback-call count is four. There is no new retry engine, whole-deck regeneration or unlimited loop.

Source-backed dates, values and units remain protected. A number can be waived only through the existing specific FACTUAL feedback identifying it as incorrect/unsupported. The replacement still passes schema, content, geometry and semantic review. If the bounded correction cannot preserve meaningful content, controlled failure remains mandatory.

## Verification

- Full regression run: **769 passed, zero failures/skips**, 390.039 seconds.
- Final focused run: **46 passed**, covering structural IDs/ordinals, preserved timeline dates, unit-prefix false matches, equivalent formatting, authorized correction of a wrong attempted unit, rejection of unauthorized changes, immutable headings, body-only repair, and continued failure after an unsuccessful correction. Counts overlap with the full suite and are not additive.
- Native HTTP/export audit with mocked Claude and controlled imagery: a twelve-slide fixture includes a roadmap on slide 9. Its initial fallback deliberately omits 2025, 2030, 2040 and 2050. One body-only patch restores them. The request returns **HTTP 201**, persists `completed`, retains **12 slides / 12 PNG previews**, and all **14 PPTX/PDF/PNG download requests return HTTP 200**.
- All four dates were checked in the actual slide-9 PPTX XML. Its PNG was visually inspected for legibility and clipping.
- The audit used 17 mocked provider calls overall, including two fallback-stage calls and one final review. About 22.9 seconds including native exports/downloads is a local mocked-provider result, not a production speed claim.

New test/audit support:

- `tests/regression/fallback-fact-preservation.test.mjs`
- `tests/fixtures/roadmapFactFallback.mjs`
- `tests/fallbackFactRecoveryAudit.mjs`
- `tests/fixtures/slideFallback.mjs` now supports the bounded body-repair response in existing recovery fixtures.

Evidence is in `generated/fallback-fact-repair/focused.log`, `final-focused.log`, `full-regression.log`, `native.log` and `native/report.json`. Initial native-audit setup was adjusted because the first draft already fit and did not exercise fallback; the accepted audit deliberately forces the layout failure before testing fact restoration.

Models, configured image/text providers, endpoints, existing quality gates and PPTX/PDF/PNG tooling remain unchanged. No paid live tests, `.env` edits, commits, pushes or deployments were performed. The exact missing fact in the supplied live failure remains unknown; future failures now include sanitized source-field diagnostics rather than only a generic body error. Unusual notation not covered by the conservative normalizer can still require explicit preservation; semantic review is not a certified factual or medical audit.

Pre-edit copies of the existing fact guard, field-repair helper and budget module are retained under `generated/fallback-fact-repair/before/`. Preserve unrelated uncommitted work when reviewing or rolling back.
