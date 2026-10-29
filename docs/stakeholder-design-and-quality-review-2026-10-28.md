# Stakeholder design and presentation review engineering report

28 October 2026. Backend changes only; no deployment or live paid generation.

## Findings and evidence

The requested historical ID `841792e1-a475-4d0c-a715-79414cfba061` has no matching saved review payload in the local generated output, services, tests or documentation. The attachment supplies timings and a final error, not the three actual reviewer responses. Consequently the exact slide-1 criterion and whether each historical repair changed it cannot be recovered. It would be incorrect to identify a missing photo as that criterion: the previous content-review schema did not include IMAGE or LAYOUT. Its final blocking path concerned factual errors, missing requested coverage, or unsupported absolute claims.

The code did establish avoidable work: two hardcoded repair rounds allowed three complete-deck reviews; a prose regex could trigger metadata repair, followed by content regeneration regardless of the defect; unchanged repairs had no stopping rule. Successful provider calls meant valid reviewer JSON, not that the presentation passed review. The supplied 55.6-second outline latency cannot be attributed to a particular provider condition without its detailed provider timing and response.

Monotonous visuals had separate causes: weak near-white webpage tints, uniform presentation surfaces, unrendered gradient intent, and renderer preparation discarding already resolved theme tokens. Fixing the latter preserves topic-specific palettes instead of resetting them to registered defaults.

## Implemented behavior

- Content review separates metadata, content, image and layout concerns. Image/layout findings go to the existing asset/render gates; inadequate content coverage still blocks even if a reviewer misclassifies it as visual.
- The default repair budget is one round, at most four affected slides. Explicit configuration permits at most two rounds and twelve repaired slides. Independent repairs retain bounded concurrency. A no-op stops before another paid review; a repeated issue does not trigger repeated repairs.
- Metadata-only repairs request only the relevant title/subtitle fields and preserve generated body content. Semantic content corrections still regenerate the affected slide. Schema-fit retries for a known string field request only a concise scalar replacement, restore the original slide, then run all original validators. Redundant whitespace is normalized; facts are never silently truncated.
- Re-review sends changed slide bodies and retains approved unchanged coverage. The first review still sees the whole deck. The review output cap is 4,096 tokens; permanent provider errors retain existing no-retry behavior.
- Structured diagnostics record safe issue codes, categories, targets, repair attempts, changed/unchanged status and stopping reason. Unresolved substantive quality failures return HTTP 422 with the existing `PRESENTATION_QUALITY_FAILED` code and safe details. This deliberate status change replaces the previous generic server failure.
- Background jobs privately save actual review responses. Synchronous review storage is opt-in. Terminal/API errors do not expose arbitrary reviewer prose or source excerpts.
- A shared color utility derives neutral, dark, highlight and gradient roles from each project palette, with contrast-aware foregrounds. Automatic topical defaults cover the six tested subjects; caller-selected designs remain authoritative.
- Presentation treatments follow content purpose: evidence tables, comparisons, processes, dividers, summaries and covers receive appropriate surfaces. Explicit per-slide and uniform choices are supported. Locally generated gradient PNGs export consistently through PPTX, LibreOffice PDF and PNG. They add no AI calls. Whole-deck image-free instructions omit decorative raster backgrounds; exclusions scoped to supporting slides do not suppress the cover treatment.
- The first-slide real image remains embedded full-slide. Its lower text panel can use the coherent gradient. This change does not replace required imagery with a gradient.
- Webpage sections use semantic dark, light, accent and gradient backgrounds. Explicit global/per-section choices are preserved. Existing hero layouts, responsive grids, image licensing, authenticity and relevance gates remain active.

## Image fallback configuration

The existing Commons-to-Gemini adapter remains subject to credentials, enable flags, authenticity rules and per-request budgets. Skipped generation now logs an explicit configuration reason. The local configuration verifier reports image generation **disabled**, text provider Anthropic, exact requested model `claude-opus-5-5`, and no live account verification. Render configuration is unknown. No `.env` value was changed and no Gemini request was purchased in this work. See `config/ai.env.example` and the earlier [image adapter report](webpage-design-and-gemini-images-2026-10-28.md) for activation variables.

## Verification and performance

Final full regression: **657/657 passed**, zero skipped, 417.028 seconds (`generated/stakeholder-full-regression-serial.log`). The focused new quality suite passed **20/20**. An earlier overlapping audit/regression run had one isolation-test deadline failure (656/657); its isolated rerun passed 22/22, and the final complete run without the export audit passed every test. No test deadline or production limit was relaxed to obtain the pass. `git diff --check` passed; the real `.env` remains unchanged.

Deterministic tests cover valid review, metadata/content routing, missing images, targeted successful repairs, no-op/repeated defects, coverage preservation, explicit preferences, safe HTTP diagnostics, private audit storage, and the reported process/timeline/comparison field limits. A protocol-level Claude mock confirms ten slide-content calls remain ten after a subtitle-only repair: one outline, ten content calls, two reviews and one metadata call (14 total). A no-op blocking defect uses one review and one repair, then stops. Existing provider/preview/isolation tests remain in the full suite.

Six authored ten-slide fixtures were exported through the actual PPTX renderer, LibreOffice PDF conversion and ten PNG previews each. All retained exactly ten slides and an embedded cover. Contact sheets were inspected. Resolved foreground/background contrast is checked, with rendered pixel samples for non-photo solid surfaces. These controlled sparse fixtures isolate rendering and do not prove arbitrary live model output quality.

| Topic | Uniform baseline, seconds | Semantic surfaces, seconds |
|---|---:|---:|
| AI | 27.164 | 27.162 |
| Luxury property | 27.463 | 29.012 |
| Healthcare | 28.434 | 31.088 |
| Education | 38.223 | 25.175 |
| Startup | 31.307 | 29.564 |
| Business strategy | 26.426 | 32.339 |

These are local native-export fixture timings, excluding AI, remote image search and database/network delivery. The baseline uses the same content with uniform surfaces; it is not a replay of the historical failed request. The final rendering run overlapped regression activity, so this table is visual-export cost evidence, not a controlled claim of speed improvement. Final native PDF conversion took 17.1–26.3 seconds and PNG conversion 3.2–5.6 seconds; PPTX construction took 0.16–0.32 seconds. Stage, CPU and memory reports are in the JSON evidence. No valid live comparison against the supplied 167 seconds or $0.8255 is available under mocked-only authorization.

Observed Node peak RSS across the final six export fixtures was 131–181 MiB. This excludes LibreOffice child-process memory and does not establish Render capacity or production memory consumption.

Webpage QA passed all 30 topic/viewport checks (six subjects at 1440, 1024, 768, 390 and 320 pixels), including actual browser image loading, overflow and accessibility checks. Local HTML rendering took 63–213 ms, excluding browser loading and AI. The report is `generated/webpage-overhaul/stakeholder/report.json`.

Prompt caching was investigated against [Anthropic's official documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). It supports repeated eligible prefixes, but cache creation, minimum length and concurrent availability matter. Changing slide/schema payloads and a short shared system prefix do not establish a useful cache hit. No caching settings were added without a measured eligible shared prefix; existing cache-read/write accounting remains. Caching does not remove response generation latency or replace precise repair.

## Visual evidence

- Presentations: `generated/stakeholder-presentations/baseline/` and `after/`, each containing `{topic}-contact.png`, cover and closing screenshots, exports and `report.json`.
- Example: [uniform property](../generated/stakeholder-presentations/baseline/property-contact.png) → [semantic property](../generated/stakeholder-presentations/after/property-contact.png).
- Webpages: earlier `generated/webpage-overhaul/media/` screenshots and new `generated/webpage-overhaul/stakeholder/` screenshots. The first five topics have earlier screenshots; strategy is a new sample, not a historical before capture.
- Example: [property mobile](../generated/webpage-overhaul/stakeholder/property/390.png).

## Files changed for this work

Quality: `Service/ai/presentationQuality.mjs`, `qualityIssues.mjs` (new), `fieldRepair.mjs` (new), `generateJsonWithRetry.mjs`, `Service/aiService.mjs`, `Service/generationJobs.mjs`, `controller/generateController.mjs`.

Design: `Service/design/colorSystem.mjs` (new), `designSchema.mjs`, `specification.mjs`, `quality.mjs`, `Service/presentationThemeService.mjs`, `presentationRendererService.mjs`, `renderer/presentation/backgrounds.mjs` (new), `pptxRenderer.mjs`, `professionalLayouts.mjs`, `photoCompositions.mjs`, `Service/webpage/visualTokens.mjs`, `creativeDirection.mjs`, `renderer/webpage/creativeStyles.mjs`, `templates/webpage/webpageSchema.mjs`, `Service/ai/presentationPrompts.mjs`, `webpageGeneration.mjs`.

Diagnostics/configuration: `Service/visual/imagePolicy.mjs`, `presentationImageAssets.mjs`, `config/ai.env.example`.

Verification: `tests/regression/stakeholder-quality.test.mjs` (new), `presentation-quality.test.mjs`, `tests/fixtures/stakeholderCases.mjs` (new), `tests/stakeholderPresentationAudit.mjs` (new), `tests/webpageOverhaulAudit.mjs`, this report. Earlier uncommitted work is preserved separately in the working tree.

## Deployment and limitations

No push/deployment was performed. Keep LibreOffice, fonts and image tooling installed. Optional settings: `PRESENTATION_QUALITY_MAX_REPAIR_ROUNDS=1`, `PRESENTATION_QUALITY_MAX_REPAIRED_SLIDES=4`, and a private `PRESENTATION_QUALITY_AUDIT_DIR` outside public assets. Saved reviews can contain user content: restrict access and apply retention. Future private review payloads make exact semantic rejection traceable. Real provider latency, generated-image quality, production concurrency and end-to-end cost still require an authorized live run; local fixture checks cannot guarantee every future prompt.
