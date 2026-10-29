# Safe optimization baseline — 2026-10-29

Recorded before production changes. Exact copies of optimization targets, SHA-256 manifest, Git status and the existing tracked diff are in `generated/safe-performance-2026-10-29/snapshot/`. Roll back only the changed target files from these copies; do not reset the checkout or apply the entire historical diff. Other uncommitted work is preserved.

## Method and limits

`node tests/safePerformanceAudit.mjs before units` measures three native runs per component. `node tests/safePerformanceAudit.mjs before` exercises real HTTP routes and downloads for presentation, webpage and document with text, URL and DOCX input. AI and stock services are deterministic local mocks; URL retrieval and database persistence are mocked, DOCX extraction and native rendering are real. The document fixture is a small 100-word technical guide, not a representative long report. Mock AI delays are 15 ms; production provider latency cannot be inferred. The reported 204.9-second production presentation has no corresponding raw stage profile here.

The first HTTP audit attempts exposed fixture setup errors (preview storage root and source/word-budget mismatch), not production regressions. Corrected cases resume against the same fixtures. Web caches can be warm; component image runs use distinct cold cache directories. Node CPU and sampled RSS exclude native child-process CPU/RSS on Windows. Three runs give only coarse percentiles, not production tail estimates.

## Observed baseline

Ten-slide presentation generation: 15.343 / 16.465 / 16.871 seconds for text / URL / DOCX. Each makes 12 mocked AI calls, including quality review. PDF conversion: 10.941 / 11.622 / 12.575 seconds (71–75% of generation); PNG conversion: 1.982 / 2.095 / 1.558 seconds (9–13%). Stages can overlap and their percentages must not be added blindly. PPTX construction, validation, image checks, filesystem work and PNG validation account for the remainder. All ten PNGs and both downloads are checked over HTTP. Optional-image warnings remain explicit.

Webpage generation: 0.559 / 0.281 / 1.580 seconds, two mocked AI calls each; cache state and native worker startup affect these small fixtures. Document text generation including real Writer PDF export: 11.579 seconds, three mocked AI calls; PDF export 11.315 seconds (98%). URL/file document cases use an explicit identical 100-word context budget.

Native components, three runs (milliseconds):

| Component | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| Ten-page PNG conversion | 2891 | 3498 | 2478 |
| Two identical concurrent cold image optimizations | 1604 | 2709 | 1799 |
| Ten validations of identical document PDF bytes | 338 | 41 | 37 |

Both concurrent image callers start a separate worker (two per run). PDF parsing has cold initialization overhead; even warm calls reparse unchanged bytes. Full raw CPU, RSS, stage timing, file sizes and hashes are saved in `before/units.json` and `before/pipelines.json` under the generated audit directory.

## Dependency and risk analysis

Slide content already uses bounded concurrency; quality review depends on complete content. Webpage content depends on its plan. Document sections already overlap within configured limits. Image acquisition already races eligible providers, including the newly added Pixabay adapter. Preserve these dependencies and policies.

1. Coalesce simultaneous optimization of identical image bytes with identical cache root and timeout. Preserve worker limits, codec settings, cache checks and independent caller-owned buffers. Expected saving: one worker's startup/encoding per duplicate pair; low risk if failures clear pending entries and callers cannot mutate one another's assets.
2. Encode independent Poppler pages in batches of at most two, with a 24 MiB raw-input batch cap. Preserve exact pixels, compression, DPI, page order, timeout and cleanup. Potential saving is limited to PNG encoding; memory and failure draining require verification. Keep only if measurements justify it.
3. Reuse successful document PDF validation metadata keyed by the complete byte digest, bounded to 32 entries/60 seconds. Never cache invalid files, text or artifact paths. Any byte mutation must cause revalidation. Potential saving: repeated parsing on download; first export still performs full validation.
4. Add peak in-flight AI call counts to existing performance reports. No request or model changes.

LibreOffice dominates the local native baseline. Raising render concurrency could overwhelm Render memory; persistent conversion services would be architectural work. Neither is justified by these measurements. Provider latency, throttling, cold starts and real MongoDB/network performance require an approved production-comparable measurement before a 60-second production claim can be made.
