# Safe performance optimization: results, 29 October 2026

The retained changes remove duplicate image processing and repeated PDF parsing. They preserve the tested outputs. **A substantial production generation-speed improvement and the 60-second production objective have not been established.** No paid AI tests, environment-file edits, commits, pushes or deployments were performed.

## Baseline and measurement limitations

The user reported a 204.9-second production presentation. There is no matching raw stage trace in this workspace, so it cannot be compared causally with a local mocked-provider benchmark. The pre-edit investigation is in `docs/safe-performance-baseline-2026-10-29.md`.

Measurements use real Express HTTP routes, DOCX extraction, PPTX/DOCX creation, LibreOffice exports, Poppler PNG previews, ZIP packaging and downloads. Claude, image providers, URL retrieval and MongoDB are mocked. Each ten-slide presentation has the same content and requested imagery, each webpage the same pharmaceutical fixture, and each document the same 100-word technical fixture. All three input methods are exercised. Synthetic token counts and estimated provider costs in raw profiles are fixture data, not actual usage or spending.

Three samples per output are text/URL/file cases, not an adequate production latency distribution. p90 and p95 are the largest of three observations using nearest rank. Warm-cache state and host conditions vary. Node CPU and sampled RSS do not measure native child-process CPU/RSS on Windows. Render CPU, memory, disk, network, cold starts and real database latency remain unmeasured here.

## Production changes retained

| File | Change and protection |
|---|---|
| `Service/webpage/imageOptimization.mjs` | Coalesce simultaneous transformations of identical complete image bytes with identical cache root and timeout. Preserve existing worker/queue limits, codec quality, responsive dimensions and validation. Clone each caller's returned buffers and metadata; remove failed pending operations so subsequent calls can retry. |
| `Service/document/documentPdfService.mjs` | Cache only successful PDF validation summaries for 60 seconds, at most 32 entries, keyed by SHA-256 of every byte. No document text, file paths or buffers retained. Changed bytes are parsed again, invalid files are never cached, and summaries returned to callers are independent. |
| `Service/performance.mjs` | Add `peakInFlightCalls` to active AI/stage accounting. No concurrency or request behavior change. |

An experimental two-page PNG encoder was **reverted**: its three-sample median gain was only about 1.8%, inconsistent with host variation. `renderer/converters/pdfToImages.mjs` is byte-for-byte identical to its pre-edit snapshot. No render concurrency increase was retained.

Models, prompts, schemas, token limits, quality review, repair, relevance/licensing/watermark checks, first-valid provider racing (including Pixabay), render resolution, required visuals and downloads were preserved. There are no new environment variables, dependencies or API requirements. Existing performance reports only gain additive peak-concurrency metadata. No frontend code changed.

## Measured component results

Later machine conditions differed from the initial baseline. A test-only Node module hook loads the exact original source bytes from the snapshot without changing the checkout. The following comparison uses that original-code control under the later conditions and the isolated optimized component run. Each row has three runs; each image run starts from its own cold cache directory.

| Workload | Original p50 / p90 / p95 | Optimized p50 / p90 / p95 | Interpretation |
|---|---:|---:|---|
| Two simultaneous identical image transformations | 2460 / 2465 / 2465 ms | 1115 / 1281 / 1281 ms | **54.7% lower median**, one worker instead of two in every run. Responsive image bytes match exactly. |
| Ten successive validations of identical PDF bytes | 46.98 / 194.87 / 194.87 ms | 0.704 / 431.36 / 431.36 ms | **98.5% lower median** from warm reuse; first cold batch was slower. This does not accelerate first-time conversion or parser initialization. |
| Ten-page PDF-to-PNG conversion | 4126 / 4201 / 4201 ms | 4505 / 5022 / 5022 ms | No encoder change retained and no speed improvement claimed. Files and decoded pixels match exactly. |

The earlier pre-edit image median was 1799 ms (two workers); the later original-code control was 2460 ms. This drift illustrates why absolute timing changes cannot automatically be attributed to code changes.

## End-to-end measurements

| Equivalent fixture group | Initial baseline p50 / p90 / p95 | Final optimized p50 / p90 / p95 |
|---|---:|---:|
| Ten-slide presentation | 16.465 / 16.871 / 16.871 s | 26.731 / 27.914 / 27.914 s |
| Webpage | 0.559 / 1.580 / 1.580 s | 0.522 / 1.717 / 1.717 s |
| 100-word document with PDF export | 9.638 / 11.579 / 11.579 s | 16.996 / 17.333 / 17.333 s |

These results **do not demonstrate a broad end-to-end improvement**. Presentation median was 62.4% slower and document median 76.3% slower in the later run; the webpage median was 6.7% lower with a worse maximum. A separate original-code control reproduced the later slowdown:

| Text-input fixture, one control observation | Original source under later conditions | Optimized source |
|---|---:|---:|
| Presentation | 26.570 s | 25.573 s |
| Webpage, cold image processing | 3.886 s | 1.717 s |
| Document including PDF | 17.362 s | 17.333 s |

This supports host/cache variation rather than a presentation-rendering regression. One observation cannot establish causal end-to-end percentage improvements. No Render or production speedup is claimed.

## Bottlenecks and concurrency

Representative final text-input presentation stages (25.573 s total HTTP generation):

| Stage | Duration | Share of total |
|---|---:|---:|
| Mocked content planning, slide generation and quality review, wall time | 0.236 s | 0.9% |
| Image acquisition/processing | 1.012 s | 4.0% |
| PPTX rendering | 0.221 s | 0.9% |
| PPTX validation | 0.366 s | 1.4% |
| LibreOffice PDF conversion | 18.455 s | 72.2% |
| PDF-to-PNG conversion | 3.330 s | 13.0% |
| PNG validation | 1.442 s | 5.6% |
| Photo validation | 0.346 s | 1.4% |

Schema validation took 39 ms across two calls, layout validation 4.7 ms across 12 calls, and design/layout compilation about 11 ms. The original-code control spent 19.237 s in PDF conversion and 3.595 s in PNG conversion. These native stages dominate both implementations. Nested/overlapping stage durations must not be summed as disjoint contributions.

Outline generation, ten content calls and review were all retained: **12 mocked AI calls per presentation**, two per webpage, three per document, unchanged across all nine cases. Slide-content peak concurrency was six; review followed content. Sequential webpage planning/content and document outline/content dependencies remain intact. The selected image still passes the complete race and asset validation path. Real provider latency/retries cannot be inferred from the 15-ms mocks.

For the final cold webpage, images took 1.061 s (61.8%), content 81 ms, and packaging 413 ms. The document's PDF stage took 17.077 s (98.5%); DOCX rendering 117 ms, validation 20 ms and content 97 ms. Mocked database and response-preparation costs were small; raw outer HTTP profiles preserve their separate timings. Downloads were checked after generation and are excluded from `generationMs`, but included in each benchmark's encompassing elapsed time.

## Correctness, isolation and resources

- Full existing regression command: `npm test` — **743 passed, zero failures/skips**, 493.544 s. Focused new tests: **4/4 passed**, including successful-byte reuse, corrupt-file rejection, changed-byte revalidation, expiry/eviction, different cache roots/timeouts, duplicate concurrent callers, independent mutable results and retry after failure.
- Both accepted nine-case HTTP matrices passed with successful PPTX/PDF/all ten PNG downloads, webpage preview/ZIP and document preview/Word/PDF downloads. The deliberately incomplete fictional business facts remain explicit webpage warnings in both versions. Initial harness failures were corrected fixture/storage configuration, not accepted benchmark observations.
- Exact content/media fingerprints match for all three presentation cases; **all ten real presentation PNG files per case also match the baseline**. The separate ten-page raster benchmark matched 30 PNG file hashes and decoded-pixel hashes. Webpage ZIP contents (normalizing artifact UUIDs only), responsive image bytes and DOCX body text match.
- Existing request-isolation, provider-race, job-queue and concurrent performance tests passed. The new image test verifies simultaneous consumers. A live concurrent-user Render throughput benchmark was not run; capacity was deliberately not raised on the basis of local mocks.
- Maximum sampled Node RSS across presentation cases: 219.6 MiB initially vs 215.8 MiB finally; webpage 172.9 vs 172.8 MiB; document 180.4 vs 181.0 MiB. These are observations, not proof of lower total container memory. Native worker memory is excluded.
- Per-case Node CPU milliseconds, initial → final: presentation `[5484, 4781, 4547]` → `[6781, 6453, 5641]`; webpage `[672, 391, 359]` → `[687, 423, 343]`; document `[719, 1109, 547]` → `[1188, 625, 468]`. Host variation remains substantial. The bounded metadata cache retains no document content, and image processing removes one duplicate native worker per identical concurrent pair.

## Reproduction, evidence and rollback

New test/audit files:

- `tests/safePerformanceAudit.mjs` — component and HTTP benchmarks, no `.env` loading or real provider calls.
- `tests/safePerformanceComparison.mjs` — exact output checks and percentile/resource summary.
- `tests/fixtures/safePerformanceBaselineHook.mjs` — original-code control, without editing workspace modules.
- `tests/regression/safe-performance.test.mjs` — regression coverage.

Run each benchmark sequentially with no other test process running. Use a fresh phase name to avoid mixing cache/artifact state. Commands used for the accepted final run:

```powershell
node tests/safePerformanceAudit.mjs after-final units
node tests/safePerformanceAudit.mjs after-final
node --import ./tests/fixtures/safePerformanceBaselineHook.mjs tests/safePerformanceAudit.mjs control-current text-only
node --import ./tests/fixtures/safePerformanceBaselineHook.mjs tests/safePerformanceAudit.mjs control-current units
node tests/safePerformanceComparison.mjs after-final
node --test tests/regression/safe-performance.test.mjs
npm test
```

Raw evidence: `generated/safe-performance-2026-10-29/{before,after-final,control-current}/`, `comparison-final.json`, `generated/safe-performance-full-regression.log` and `generated/safe-performance-focused.log`. The earlier overlapping after-run and rejected PNG experiment are retained separately and excluded from final benefit claims. The raw harness's historical `cpuMs` property actually contains `process.cpuUsage` microseconds; the comparison converts these to milliseconds.

Rollback: restore only the three production files listed above from their exact copies under `generated/safe-performance-2026-10-29/snapshot/`; verify against `manifest.json`. Do not reset Git or overwrite unrelated uncommitted work. The snapshot also preserves the original status and tracked diff. Audit files and generated artifacts can remain for review.

## Remaining work before a production latency claim

The sub-60-second local mocked fixtures do not establish the production objective. A production-comparable stage trace with actual provider timings is required to explain the reported 204.9 seconds. Safely reducing larger delays may depend on provider throttling, queue contention, Render resource limits or cold starts. A persistent LibreOffice service, different hosting, more rendering workers or altered AI workflows would require separate evaluation and approval; they were not introduced. The current change set should be reviewed and deployed through the normal release process, followed by real stage monitoring. No production deployment was modified automatically.
