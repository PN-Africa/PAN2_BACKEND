# Presentation content-contract and repair reliability

28 October 2026. Backend implementation; mocked AI only. No paid calls, environment activation, push or deployment.

## Confirmed causes

The two supplied reports name requests `071f6a61-68ff-4474-8a59-92fc2e007be3` and `4f66514b-e44e-4cb0-830e-88c0e9cfa482`. They show changing failing timeline/comparison fields across three attempts. They do not contain the actual failed response bodies, so the exact private text and the historical `$.value` replacement cannot be reconstructed.

The code establishes these shared causes:

1. **First-error validation.** Schema validation and dry rendering stopped at their first overflow. A slide with several invalid fields needed successive discoveries. Fixing the first field did not make the other fields valid; the three-call limit could expire before all defects were visited.
2. **Different constraint sources.** Image-bearing slides had explicit pre-generation character budgets; ordinary timeline/comparison/card drafts largely relied on generic schemas and word guidance. Actual limits such as 10 or 17 characters were computed later from narrow text boxes, row count and the fixed semantic font scale. Those renderer-specific bounds were absent from the original drafting schema/prompt.
3. **Native schema is not the entire contract.** The installed Anthropic SDK moves unsupported length constraints into schema descriptions. Native structured output preserves types/shape but does not guarantee the local `maxLength` condition. A passing provider grammar can therefore fail local length or actual word-wrapping checks. A regression test verifies this behavior using the installed SDK.
4. **Patch-state corruption.** On an invalid scalar patch, the retry loop could save the patch object as its next draft and replace the original content failure with a `$.value` failure. The next repair could then lose the original nested path and revert to a complete-slide request. This is independent of the user's topic and prompt length.
5. **Inadequate repair budget.** Every scalar repair had a 768-token output cap. A length constraint is not natively enforced, and model output can also consume the cap; malformed, overlength and truncated patches need distinct handling. `$.value` identifies the patch field, not proof that the model returned the wrong type. Without the historical replacement, its precise violation is unknown.

The existing character estimator is a conservative wrapping guard, not a contractual maximum meaningful title length. Six events squeezed into the former three-column timeline rows could allow only one short title line. The three-way comparison likewise divided the slide into narrow columns. These were layout-capacity problems as well as repair problems.

## Changes

### Shared drafting and rendering constraints

`layoutContentSchema` probes the actual timeline, comparison or card component at its schema collection limit before drafting. It creates a fresh schema, records actual text-box geometry at the unchanged semantic font size, and adds conservative field-level budgets. `contentBudgetPrompt` already reads those schema limits, so the same values now reach Claude. No shared schema is mutated across concurrent requests.

For an ordinary six-event timeline, the current probe yields label **16**, title **41**, and description **66** characters. These values are geometry-derived for that composition, not global limits. Existing tighter image-specific limits remain applicable. Actual text still undergoes wrapping, structural, content, factual-grounding and export validation; character count cannot guarantee that wide glyphs or long unbreakable words fit.

Four-to-six-event timelines now use a two-column event grid with label/title headings and full-width descriptions. Three-way comparisons use grouped horizontal rows with a wider point column. Neither changes the requested number of events/items, removes content, shrinks fonts or weakens overflow checking. Photo timelines and comparisons expose leaf string paths instead of presenting a joined object/array as an unpatchable field. Timeline image compositions retain the photo alongside the technical content.

### Collect and repair all actionable violations

- Dry rendering collects all ordinary text-fit violations in a candidate. Layout selection retains the candidate with the fewest violations when none fits, rather than arbitrarily reporting the last candidate's first problem.
- Presentation schema parsing collects independent string-length violations. Where safe, runtime layout checks contribute additional field errors before repair. Structural/semantic validators can still stop early; this is not an exhaustive collector for malformed object graphs or every scientific issue.
- One repair object carries every identified invalid string. A single field retains `{value: "..."}`; multiple fields use server-mapped `f0`, `f1`, etc. The model cannot choose destination paths.
- Each replacement is checked against its own string schema before an atomic in-memory merge into a cloned complete draft. Unlisted fields, numbers, objects and arrays remain intact. Nested array-index string paths are supported; structural object/array/numeric coercion is deliberately not performed.
- Malformed, incorrectly wrapped, overlength and truncated repair responses are discarded. They do not overwrite the complete draft or the original field list. A later repair retains earlier successful corrections.
- Patch budgets are based on the requested fields, with a 1,536-token floor and 8,192-token ceiling. Following truncation, the next bounded attempt receives a larger allowance where the ceiling permits. The configured provider/model ceiling still applies. The overall three-attempt bound remains.
- An unchanged patch stops before another paid attempt, using `AI_RETRY_EXHAUSTED` and `NO_REPAIR_PROGRESS`. No loop is made unbounded.
- Whitespace normalization remains deterministic. No meaningful text is silently truncated or rewritten locally.

### Diagnostics and quality review

Logs record canonical fields, original/replacement lengths and hashes, merge outcome and final validation outcome. Raw user text and replacement prose are excluded. Exhaustion carries the canonical content field and full safe `{field,maxCharacters}` list instead of misleadingly exposing only `$.value`. Existing endpoint/status behavior remains; error details are additive.

The previous bounded quality-review fix remains active: typed metadata/content repair, changed-slide-only re-review, no-op detection, private actual review-response storage and meaningful failure diagnostics. Factual/coverage checks and mandatory-image/render gates remain enabled. These new length repairs do not bypass the semantic review stage.

## Gemini configuration

Safe local inspection established:

- `AI_IMAGE_PROVIDER` is **unset**, so the provider defaults to `disabled`.
- `AI_IMAGE_PROVIDER_APPROVED` is not true.
- `GEMINI_API_KEY` is present; its validity/model access was not tested.
- `PRESENTATION_ALLOW_IMAGE_GENERATION=true` is already set.

That explains the local `reasonCode: disabled` skip. A key plus the presentation flag does not select or authorize a billable provider. Render values remain unverified. No real `.env` was changed.

After explicit spending approval, configure the server's secret environment with `AI_IMAGE_PROVIDER=gemini`, `AI_IMAGE_PROVIDER_APPROVED=true`, an approved `AI_IMAGE_MODEL` (the adapter's configured default is `gemini-nano-banana-2.1`), and the private `GEMINI_API_KEY`. Keep `PRESENTATION_ALLOW_IMAGE_GENERATION=true`, a positive configured unit-cost estimate and a positive ceiling (`AI_IMAGE_ESTIMATED_UNIT_COST`/`AI_IMAGE_MAX_ESTIMATED_COST` or presentation-specific equivalents), and a bounded image count. See `config/ai.env.example`. Authentication/model availability still needs an authorized provider test. Do not post credentials in a chat or commit them.

## Tests and performance evidence

New deterministic regression coverage includes all invalid timeline descriptions together; multiple comparison points; four overlength card descriptions; renderer-derived budgets; nested string patches; string/object/array malformed wrappers; overlength replacements; truncation recovery; retained prior corrections; unchanged-repair stopping; fixed exhaustion; short and long prompts through the actual Claude protocol adapter; and Gemini's provider/approval/key/budget gates. Existing quality-review, concurrency, image and export suites also run.

Results: all **19 new cases** passed. The final combined contract, request-isolation and performance-pipeline rerun passed **51/51**, including 2/5/10/20 concurrent jobs. Both complete regression attempts passed **675/676**, with no presentation-contract failures. The first full run recorded a Windows `EPERM` during existing atomic job-status storage and failed the metadata-outage test; that test passed alone. The second full run failed an existing two-job isolation assertion because one job unexpectedly failed; its suppressed per-job error does not establish the exact cause. All 22 isolation cases and the full performance-pipeline file passed in the combined rerun. Logs: `generated/content-contract-full-regression.log`, `content-contract-full-final.log`, `content-contract-isolation-final.log`. This is an unresolved intermittent local job-storage/concurrency verification limitation, not a clean full-suite pass. No storage code or test timeout was changed to hide it. `git diff --check` passed, and the real `.env` is unchanged.

In the six-invalid-description fixture, the new path completes in **two calls**: initial slide plus one patch covering six fields. A first-error-only path needs at least six distinct field corrections and cannot complete within the existing initial-plus-two-repair budget. This is a measured mock call-count improvement, not a claimed production latency/cost reduction. Short and long protocol fixtures both completed exactly ten slides. Mock token usage is synthetic and is not a billing measurement.

The actual native export fixture includes ten slides, a six-event timeline, three-way comparison, four cards and an embedded cover image. PPTX package validation, PDF and ten PNG previews passed; the contact sheet was visually inspected. Total local fixture time was **20.057 seconds** including screenshot composition, excluding AI/network image search/database. Stage measurements: PPTX construction **0.117s**, package validation **0.172s**, LibreOffice PDF **13.928s**, PNG conversion **2.375s**, PNG validation **0.975s**, photo validation **0.143s**. Node peak RSS was approximately **143 MiB**, excluding child-process memory. Evidence: `generated/content-contract-native/report.json` and [contact sheet](../generated/content-contract-native/contact.png).

Outline investigation: the current planner already drafts metadata/design only, separate from parallel body generation. The controlled fixture captured **22,441 prompt characters**, a compatibility JSON envelope, **8,192** maximum output tokens and configured **medium** effort; the envelope's native wrapper schema is 200 characters. The full successful mock pipeline used **12 calls** (outline, ten bodies, one review). The full plan schema remains inside the envelope prompt to avoid the previous complex-native-schema rejection. The 8,192 setting is a ceiling, not a requirement to generate that many tokens. No evidence identifies whether the reported 55–65-second outline was dominated by input processing, reasoning, response size or provider load. No speculative model swap, design removal, caching setting or provider pricing change was introduced. Prompt caching and repeated-prefix limits are discussed in the [previous report](stakeholder-design-and-quality-review-2026-10-28.md).

Live end-to-end speed and cost against the reported 79/102.8 seconds remain unmeasured under mocked-only authorization. The changes remove verified avoidable repair work; they cannot guarantee every prompt or provider response succeeds.

## Files changed in this task

- `Service/ai/fieldRepair.mjs`: multi-field safe patch planning and sanitized value diagnostics.
- `Service/ai/generateJsonWithRetry.mjs`: canonical draft retention, aggregated validation, bounded patch tokens, no-progress stopping and safe exhaustion details.
- `Service/ai/responseValidation.mjs`: optional collection of string-length violations.
- `Service/ai/presentationLayoutBudget.mjs` (new): pre-generation geometry-derived schema budgets.
- `Service/aiService.mjs`: apply the layout-aware schema to slide drafting.
- `Service/presentationLayoutService.mjs`: choose the least-invalid candidate when repair is needed.
- `renderer/presentation/professionalLayouts.mjs`: aggregate dry-run violations, geometry instrumentation and timeline/comparison layouts.
- `renderer/presentation/photoCompositions.mjs`: individual comparison/timeline string boxes and diagnostics.
- `Service/visual/imageArtDirection.mjs`: consistent pre-content timeline technical-photo composition.
- `controller/generateController.mjs`: additive safe field-error and stop-reason response details.
- `tests/regression/content-contract-repair.test.mjs` (new), `tests/contentContractNativeAudit.mjs` (new), this report.

Earlier uncommitted work is preserved. Existing API routes, providers, downloads, persistence and deployment configuration remain in place.
