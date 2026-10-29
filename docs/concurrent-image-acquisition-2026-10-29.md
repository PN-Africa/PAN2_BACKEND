# Concurrent image acquisition — 29 October 2026

## Implemented behavior

The default image acquisition path for presentations and webpages now uses the same first-valid-result coordinator. Following the additional Pixabay request, it has **five contenders**: Wikimedia Commons, Unsplash, Lorem Picsum, Gemini and Pixabay. The user confirmed that Picsum may participate in production after actual visual verification.

All five handlers start in the same microtask turn for each external image requirement. There is no provider-priority delay or sequential provider fallback in this default path. Credentials, server spending caps and genuine content restrictions still apply; an unavailable/ineligible provider records a rejection instead of causing the whole race to fail. Explicit caller-owned images retain their existing direct-input path.

An HTTP response alone does not win. The selected image must pass provenance/licensing checks, semantic relevance or verified pixel review, decoded integrity, dimensions and placement checks. Presentation contenders are also cropped/compressed and checked in memory before selection. Only the winner is committed to presentation storage. Webpage winners enter the existing responsive-image optimization, attribution, binding and packaging path.

The coordinator returns as soon as a candidate has passed validation. Failures do not end another contender's work. The race deadline includes asynchronous validation, and caller cancellation and winner selection abort unfinished work. Late results are disregarded and cleanup callbacks run once. Timers/listeners are removed and late rejections are handled. Shared source caches are retained intentionally; race-exclusive losers are not committed as presentation files. Existing all-provider-outage fallbacks and essential-asset completeness checks remain active.

The old acquisition path remains accessible only through the explicit `IMAGE_RACE_ENABLED=false` rollback setting. The retained legacy fallback tests select that mode; separate new tests verify the default concurrent behavior.

## Provider details and setup

| Provider | Acquisition and acceptance | Required setup |
|---|---|---|
| Commons | Existing bounded semantic search, permitted licenses, creator/credit, image decoding and scene checks | No API key |
| Unsplash | Official search, preserved CDN `ixid`, photographer/profile referral attribution, download tracking and relevance checks | `UNSPLASH_ACCESS_KEY`; documented permission for bundled exports, confirmed through `UNSPLASH_BUNDLED_EXPORT_APPROVED=true` |
| Picsum | Random image plus source metadata; corroborated free Unsplash source/license; actual Claude pixel review tied to the requirement hash and exact image checksum | Configured Claude access; bounded `IMAGE_RACE_MAX_VISION_REVIEWS` (default 4 per adapter set) |
| Gemini | Existing approved Gemini adapter; full slide/section brief; preferred model `gemini-nano-banana-2.1` | `AI_IMAGE_PROVIDER=gemini`, `AI_IMAGE_PROVIDER_APPROVED=true`, `GEMINI_API_KEY`, per-output enable flags and positive spending limits |
| Pixabay | Official keyed semantic photo search; safe-search; metadata cached for 24 hours; locally downloaded/bundled assets, source/license/creator and relevance checks | `PIXABAY_API_KEY`; optional cache directory and bounded request rate |

Google's [current official image-generation documentation](https://ai.google.dev/gemini-api/docs/image-generation) lists `gemini-nano-banana-2.1`. The existing adapter's Interactions format/model regressions remain active. Account-specific live model access was not verified by making a billable request.

Unsplash's [API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines) require hotlinking, attribution and download tracking. Ledify creates embedded PPTX assets and bundled website copies, so the adapter does **not** claim that ordinary API credentials authorize these exports. Without confirmed permission it can query but cannot win a bundled-output race. The confirmation flag represents an operator's documented permission, not permission created by Ledify. CDN URLs and referral credit are preserved for an authorized integration.

Picsum's [official site](https://picsum.photos/) identifies its images as sourced from Unsplash. Its software MIT license is not treated as an image license. The adapter corroborates source licensing and rejects unknown/paid sources, missing verification, mismatches and unverified named-location/object requirements. Random imagery cannot win merely because the requested topic was copied into metadata. Picsum's visual-review operation uses one AI attempt per inspection, rather than multiplying paid schema retries.

Pixabay's [API documentation](https://pixabay.com/api/docs/) requires 24-hour request caching and downloaded local storage for permanent use. The adapter caches bounded search metadata on disk, shares identical in-flight queries safely, applies a per-account local rate ceiling (default 90/minute, never above 100), and emits no permanent Pixabay hotlink. It retains source credit and the [Content License](https://pixabay.com/service/license-summary/). Images are incorporated in designed documents/pages, rather than offered as standalone stock downloads. Brand, personality and misleading-use restrictions still apply; a general content license is not a model/property release.

### Current local configuration

Only presence/boolean settings were inspected; secrets were not printed. The local Gemini and Unsplash keys are present, but **Pixabay's key is missing**. The selected image provider is currently `disabled`, approval is false, and the webpage estimated-cost ceiling is not positive. These conditions were not silently overridden. To use Gemini in real races, the operator must enable the approved provider and set an accepted positive per-request cost ceiling, in addition to the existing per-output flags. Unsplash export permission must also be confirmed before bundled use. No `.env` changes were made.

## Cost, capacity and logging

Each eligible Gemini contender reserves its cost budget at launch, even if another source later wins. Existing Google generation concurrency limits remain active; a queued invocation may begin later under load, but it is never delayed to favor a stock provider. Presentation normalization has a separate bounded two-worker capacity pool, and outer per-output image concurrency remains bounded.

Gemini submissions and Picsum vision inspections can incur charges even after cancellation. Logs explicitly flag this possibility. Budgets are not refunded on a lost race, and SDK cancellation is not represented as a billing reversal.

`[IMAGE_RACE]` entries include request/race IDs, output type, placement identifiers, provider, start timestamp/offset, provider response time, validation duration, status/rejection code, winner, first-image time, first-valid-image time and selection latency. Cancelled operations are recorded immediately; actual late response metrics are recorded when observable. Logs omit credentials, URLs containing keys, prompts, raw provider errors and private user text.

## Measured tests

The full regression suite passed **734 tests, 0 failed, 0 skipped** in 297.369 seconds (`generated/image-race-verified.log`). The final focused concurrency/adapter checks passed all **18 tests**, including the immediate-cancellation guard and late-rejection handling (`generated/image-race-final-guards.log`). `git diff --check` passed; `.env` remains unchanged.

`tests/imageRaceBenchmark.mjs` ran **21 mocked scenarios/runs** (seven scenarios, three repetitions), including every provider winning, a fast rejected Picsum response, and all providers failing. Average selection latencies on this Windows host were:

| Mock scenario | Mean selection latency | Result in three runs |
|---|---:|---|
| Commons fastest valid | 32.63 ms | Commons won all |
| Unsplash fastest valid | 31.24 ms | Unsplash won all |
| Picsum fastest valid | 30.52 ms | Picsum won all |
| Gemini fastest valid | 32.10 ms | Gemini won all |
| Pixabay fastest valid | 26.58 ms | Pixabay won all |
| Fast Picsum rejected | 32.16 ms | Unsplash won all |
| All rejected | 78.41 ms | No image selected |

These are deliberately scheduled mocks with timer/validation overhead, **not live provider speed rankings**. There is no evidence here that any provider is consistently fastest in production. Detailed per-provider timings and cancellation outcomes are saved in `generated/image-race-benchmark/report.json`.

`tests/regression/image-race.test.mjs` verifies simultaneous startup, all five winners, rejected/failed contenders, validation latency, stalled validation deadlines, external abort, handled late rejection, once-only cleanup, raw-byte checks, licensing, Picsum actual-image review/binding, Unsplash tracking/referrals/export restrictions, Pixabay search/cache/key isolation, generation budgets and both output pipelines.

`tests/imageRaceNativeAudit.mjs` also passed the actual Express endpoint with mocked image providers and real output construction:

- Ten-slide presentation: HTTP 201; Commons, Pixabay and Gemini winners; PPTX and PDF verified; all ten PNG routes verified. Local duration **25.386 seconds**.
- Webpage: HTTP 201; Pixabay hero; preview works; HTTP-served image bytes exactly match the downloaded ZIP. Local duration **2.059 seconds**.

Those durations include native processing and mocked provider delays; they exclude live AI/search latency. Evidence: `generated/image-race-native/report.json`, `race-log.json`, `presentation.pptx`, `presentation.pdf`, `presentation.png`, `webpage.zip`. No paid live API tests or benchmarks were run.

## Files changed

- New `Service/visual/imageRace.mjs`: first-valid coordinator, deadlines, cancellation, cleanup and metrics.
- New `Service/visual/imageRaceProviders.mjs`: normalized five-provider adapters and shared acceptance gate.
- New `Service/visual/pixabayProvider.mjs`: API search, 24h caching, rate limit and licensing/provenance normalization.
- `Service/visual/imageProviders.mjs`, `Service/webpage/imageProviders.mjs`: default concurrent contender configuration.
- `Service/visual/presentationImageAssets.mjs`: in-memory contender normalization, winner-only storage, scoped duplicate checks and cancellation.
- `Service/webpage/imagePipeline.mjs`, `imageReview.mjs`: shared race integration, responsive packaging, verified Picsum acceptance, safe credit referral parameters and processing fallback.
- `Service/visual/generatedImageReview.mjs`: optional attempt bound used by Picsum; existing default unchanged.
- `config/ai.env.example`: keys, export permission, cache/vision limits and cost/cancellation notes.
- New race regression, benchmark and native audit scripts; legacy acquisition fixtures explicitly select rollback mode; this report.

Existing API response envelopes, downloads, presentation repair mechanisms and graceful optional-image recovery remain intact. No deployment or GitHub push occurred.
