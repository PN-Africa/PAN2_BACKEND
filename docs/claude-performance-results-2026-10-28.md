# Controlled backend performance results — 28 October 2026

These measurements use **mocked Claude Messages responses**, a 100 ms delay per text call, local HTTP/durable jobs, actual LibreOffice PDF conversion and actual Poppler PNG previews. Each request contains exactly ten slides and three relevant authorized photographs. Both configurations use identical content and images. Reference settings use four slide slots and direct Poppler PNG; optimized settings use six slide slots and PPM/sharp PNG. This isolates backend changes; it is **not** a live Gemini-versus-Claude or BFL speed comparison.

| Measurement | Reference | Optimized | Observed change |
|---|---:|---:|---:|
| One-user observed end-to-end | 46.122 s | 26.416 s | 42.7% less wall time |
| One-user job duration | 45.065 s | 25.466 s | 43.5% less |
| Two-user wave, all outputs checked | 85.938 s | 57.216 s | 33.4% less wall time |
| Two-user individual job durations, submission order | 85.209 / 39.755 s | 56.254 / 24.154 s | Both completed |
| One-user parent RSS peak | 200.6 MB | 198.1 MB | Similar |
| Two-user parent RSS peak | 285.8 MB | 221.9 MB | Lower in this sample |
| One-user parent CPU time | 9.500 s | 9.328 s | Similar; excludes child CPU |
| Two-user parent CPU time | 18.922 s | 18.781 s | Similar; excludes child CPU |
| One-user health response p95 | 6.25 ms | 10.52 ms | Responsive in both runs |
| Two-user health response p95 | 6.51 ms | 12.71 ms | Responsive in both runs |

One run per configuration/user count was recorded after an initial harness smoke run. Native initialization and OS scheduling vary; these are controlled observations, not statistical latency guarantees or production capacity claims. MB means decimal megabytes. Process-wide memory and CPU under concurrent requests cannot be attributed exclusively to one request.

## Stage breakdown

| Stage | One user, reference | One user, optimized |
|---|---:|---:|
| Content wall time, mocked text | 0.572 s | 0.417 s |
| Pure presentation schema/layout validation, included above | 0.018 s | 0.018 s |
| Additional image waiting after content | 1.711 s | 1.336 s |
| Image normalization, aggregate overlapping work | 2.735 s | 2.271 s |
| Native render queue | <0.001 s | <0.001 s |
| PPTX generation | 0.130 s | 0.162 s |
| PPTX validation | 0.316 s | 0.334 s |
| LibreOffice PDF conversion | 15.960 s | 17.985 s |
| PDF-to-PNG | 24.021 s | 3.417 s |
| PNG validation | 1.705 s | 1.194 s |
| Photo-region validation | 0.441 s | 0.448 s |
| Durable job storage, aggregate | 0.605 s | 0.472 s |
| Public response projection | 0.007 s | 0.005 s |

Stages overlap or contain other stages; do not sum every row. Image generation/download latency was not measured in this audit because identical local photographs were supplied. MongoDB was stubbed, so these results do not estimate production database latency. The job duration includes storage and native work; observed duration additionally includes admission, polling, artifact downloads and integrity checks.

For two users, optimized PDF conversion took 15.413 and 24.880 seconds, and PNG conversion 3.617 and 3.497 seconds. One request waited 21.434 seconds for the shared native slot. Reference PNG conversion took 17.089 and 24.747 seconds; the other request waited 36.604 seconds for the native slot. Native work stays bounded at one to avoid overwhelming the instance. **PDF conversion and queued native work remain substantial bottlenecks.** No extra LibreOffice conversion or essential photograph was removed to obtain the gain.

Each request used eleven mocked text calls: one outline and ten slides, with zero retries. Each fixture client made one mocked Models API check. Production semantic quality review remains enabled; fixed fixture content disabled the model review to keep the comparison identical. The real schema, layout, image, PPTX and preview validators ran. Eleven mocked text calls are not a prediction of production request counts, thinking tokens or billable usage.

## Quality and isolation checks

All four runs passed these checks:

- Exactly ten actual PPTX slide XML parts and ten PNG previews, with a downloadable PDF.
- All three requested photographs retained and image validation passed.
- Required full-slide first-cover composition, embedded picture and native photo-region validation.
- PPTX/PDF/PNG routes returned actual files with valid signatures.
- Every downloaded artifact retained its hash after concurrent requests completed.
- Concurrent renewable-energy and automotive requests had disjoint source-image checksums.
- Health requests remained responsive throughout generation.

The optimized renewable cover was visually inspected: the relevant full-slide wind-farm photograph remains visible, and title/subtitle/supporting text have a readable dark overlay. New regression tests additionally inspect exact full-slide picture geometry, detect removed media, and reject swapped request bindings for automotive, fashion, space and residential decks.

## Evidence and reproduction

Harness: `tests/migrationNativeAudit.mjs`. Fixture definitions: `tests/fixtures/tenSlideClaude.mjs`, `tests/fixtures/anthropicTransport.mjs`.

Run each configuration in a fresh process, sequentially, without competing native tests:

```powershell
node tests/migrationNativeAudit.mjs reference 1
node tests/migrationNativeAudit.mjs optimized 1
node tests/migrationNativeAudit.mjs reference 2
node tests/migrationNativeAudit.mjs optimized 2
```

Detailed reports are saved under `generated/migration-native/{reference,optimized}-{1,2}/report.json`; logs use the corresponding `generated/migration-native-*.log` names. These generated files are local test artifacts and are not committed. They contain no API keys; artifact capability URLs are not included in this report.

The separate identical-pixel PNG comparison is reproducible with `tests/pngEncodingBenchmark.mjs`. Its saved report is `generated/png-encoding-benchmark/report.json`: mean 4.477 → 1.546 seconds, 65.5% less, with exactly matching decoded pixel hashes. Its PDF differs from the photo-heavy native fixture, explaining the different absolute PNG times. Lossless PNG size increases and temporary RGB disk use are documented in the migration report.

## Outstanding live verification

Live Claude account access, actual BFL output, actual provider latency/rate limits and Render cgroup measurements remain unverified under the user's mock-only instruction. No new-provider live generation cost was incurred by these tests. The migration's production rollout remains gated on live verification and separate image-provider approval. See [the migration audit](claude-migration-2026-10-28.md) for configuration, prices, limitations and rollback.
