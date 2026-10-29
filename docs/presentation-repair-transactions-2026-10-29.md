# Presentation repair transactions and diagram contracts

29 October 2026. Presentation pipeline and shared dependencies only. No deployment, push, real environment edit or billable provider call.

## Verified diagnosis

The supplied request `99271344-74dd-43de-90c9-3352b3198344` identifies two 33-character node descriptions against a 32-character schema constraint. Its repair failures at `$.f0` and `$.f1`, with `repairMerged=false`, establish rejection before the old batch merge. They do **not**, by themselves, prove wrong aliases, wrong response types or the precise replacement lengths: the actual two repair replies were not supplied. The reconstructed descriptions in the tests are explicitly fixtures, not recovered historical text.

The source and deterministic tests establish these causes:

1. **All-or-nothing repair validation.** `generateJsonWithRetry` parsed the entire replacement object against the strict patch schema before calling `apply`. A bad `f0` discarded a good `f1`. A subsequent reply could fix `f0` but invalidate `f1`, exhausting attempts while having supplied usable corrections across the replies. The before-change retention test failed because the next request still contained both aliases; a separate strict-parser test reproduces the alternating `$.f0`/`$.f1` rejections.
2. **Length constraints are not guaranteed by the native grammar.** The installed Anthropic SDK converts unsupported length keywords into descriptions. The Messages protocol regression verifies that `maxLength` is absent from the sent native field schema while its instruction remains in the description. Correct JSON shape can therefore contain an overlength string. Local validation remains necessary; the configured model was not replaced.
3. **The image-diagram limit of 32 was a fixed planning budget.** It came from `presentationContentBudget.mjs`, not a universal measurement of every diagram node. Actual space varies with photo placement, node/edge count, captions and prose. Both reconstructed 33-character descriptions fit the tested real photo-and-diagram composition at the existing font sizes. Rejecting them solely because of that old constant incurred unnecessary repair work.
4. **Renderer aliases and source paths differed.** Native fitting errors used `visual.diagram.nodes[...]`, while the canonical JSON string resides at `visualContent.visual.diagram.nodes[...]`. Previously, mixed schema/render errors could make the scalar planner unable to locate the string and fall back to a larger request.
5. **Display ordering could identify the wrong field.** Labeled-edge filtering used a filtered index instead of the original edge index. Relationship star/chain layouts likewise reported display positions for reordered nodes/links, and some root/edge labels used noncanonical field names. Correcting a different valid string cannot fix the actual overflow.
6. **Diagram validation stopped early.** Native node/edge fitting did not participate in the ordinary slide error collector, so multiple density defects were not consistently visible in one repair plan. In addition, generated numbering/relationship prefixes were not always deducted from the replacement string's budget.

## Repair transaction changes

`fieldRepairPlan` now provides separate whole-reply shape parsing, individual value assessment, alias mapping and private-draft merging. The provider still receives a strict object schema with required aliases and each field's actual replacement constraints.

- Completed, unblocked JSON replies must have the expected root object and no unexpected keys. Arrays, alternate wrappers, truncated responses and blocked replies do not modify the draft.
- Each supplied replacement is normalized with NFC and redundant-space trimming, then checked independently for its expected string type, length, nonempty content and text-safety rules. No meaningful text is truncated.
- Valid siblings are staged in a cloned complete draft even when another replacement fails. Invalid values are not merged. A staged draft is **not** an approved slide and is not published or sent to the renderer until the complete original schema, content, grounding and layout validators pass.
- The next request is built from remaining violations. Alias names stay stable: a remaining `f1` is not silently renamed to `value` or `f0`. The original one-field `{value: ...}` form remains available when the operation began as a scalar repair. Scalar-to-batch transitions allocate unique aliases.
- Rejected values produce safe per-field feedback describing type, empty/unsafe text or overlength. A later request asks for a more concise target below the hard maximum. Malformed-wrapper recovery explicitly changes its formatting instructions; truncation retains the bounded token-recovery behavior.
- An unchanged validated patch still stops with `NO_REPAIR_PROGRESS`. The existing overall three-attempt bound is unchanged. Permanent provider failures are not made retryable.
- Logs distinguish accepted/rejected replacements and staged progress. They include aliases, canonical paths, reasons, lengths and hashes; they exclude raw original/replacement prose. Validation timing now includes repair parsing and assessment, including failed patch replies.

The final API never treats partial repair progress as successful content. Exhaustion still reports unresolved canonical fields without returning an invalid artifact. No endpoint or frontend response state was changed.

## Shared constraints and accurate layout paths

`diagramLimits.mjs` now supplies the semantic ceilings already used by the renderer: labels 54 characters, descriptions 90 and edge labels 32. The canonical diagram schema uses those same values. This does not increase the renderer's existing semantic limits or change allowed graph sizes.

Fixed image-diagram string limits were replaced by those shared bounds plus explicit layout guidance. The drafting probe invokes the actual renderer for a bounded four-node reference composition and records its preferred text budgets. For the tested photo composition, the description guidance is approximately 40 characters; the semantic ceiling remains 90. A shorter actual node configuration can accept a 33-character or otherwise readable description without an unnecessary rewrite. A more crowded actual configuration must still pass real wrapping and geometry checks and can require a tighter targeted repair. The reference planning target is not a guarantee that every graph of that count or string length fits.

Diagram fit checks now collect all actionable node/edge errors. `canonicalRepairField` resolves renderer aliases, nested diagram/relationship paths and table-cell aliases to actual strings; duplicate schema/render findings take the tighter applicable budget. Original node/edge indexes are preserved through filtering, star layouts and chain traversal. Generated display prefixes are deducted when reporting the source string's fitting budget.

Typography, diagram connectivity checks, safe SVG handling, photo binding, required cover enforcement, actual word wrapping, box geometry, contrast, package validation and preview checks remain in place. Complex visuals were not flattened into plain text. Existing timeline/comparison/card/roadmap/caption repairs use the same transaction machinery. Explicit cover title/subtitle metadata remains protected from incidental body-field shortening; it retains the existing coordinated metadata/layout path.

## Tests and native artifact proof

Final full regression run: **708 passed, 0 failed, 0 skipped**, in 250.635 seconds (`generated/repair-transaction-verified.log`). `git diff --check` also passed. Tests used mocked AI; no live provider charges were incurred.

New regression cases cover the exact two-33-character/32-maximum scenario; alternating strict parser failures; valid sibling retention; `f0`/`f1` mapping through the real mocked Anthropic adapter; malformed types/wrappers; normalization; scalar-to-batch transitions; canonical geometry paths; all-node error collection; filtered-edge indexing; reordered relationship indexing; protected cover metadata; and generic roadmap, card, timeline, comparison, caption and heading paths. Existing truncation, no-progress, retry exhaustion, quality review, required-image, export and isolation suites remain active.

`tests/repairTransactionAudit.mjs` uses the exact short request text from the attachment, including its unfinished quote. It verifies two reconstructed nine-slide cases (the supplied failure describes one failing slide and eight completed bodies):

| Case | Result | Local audit duration | Mock AI calls |
|---|---|---:|---:|
| New coordinated schema/layout, both 33-character descriptions preserved | Passed | 17.260 s | 11 |
| Strict legacy-32 transaction, corrected descriptions rendered | Passed | 20.632 s | 11 pipeline calls, plus the separately exercised 3-call repair transaction |

The strict-32 transaction proves that a hard 32-character contract is still enforced and can be repaired without losing its valid sibling. The new normal composition proves that readable 33-character text is no longer rejected solely by the obsolete fixed image budget. The strict fixture's extra transaction is a separate regression exercise, not a claim about normal production call counts.

Both cases traverse Express, the real generation service and mocked Claude Messages transport, then actual PPTX construction, LibreOffice PDF conversion and PNG rendering. The audit checks nine slide XML entries, every final node label/description in slide 2 XML, PDF/PNG signatures, all PNG download routes and HTTP PPTX/PDF downloads. The PNGs were visually inspected. Cover and supporting photographs remain embedded, and diagram elements remain editable native elements.

Evidence: `generated/repair-99271344/report.json`, `strict-32-repair-log.json`, [unchanged readable descriptions](../generated/repair-99271344/adapted-slide2.png), [repaired descriptions](../generated/repair-99271344/repaired-slide2.png), [complete fixture deck](../generated/repair-99271344/adapted-contact.png). The URL/file pipelines and previous caption/layout failures are exercised by the existing broader suites; these two new native audits focus on the reported text endpoint.

## Performance and limits

The coordinated nine-slide mock case required one outline, nine bodies and one quality review, with no description retry. The strict repair case retained a valid sibling and requested only the unresolved alias rather than regenerating a complete slide. This is a tested call-pattern improvement and artifact-delivery result, not a measured live speed/cost comparison with the supplied 65.3 seconds, 49,225 tokens or $0.3297. Mock token/cost fields are synthetic; native timings include local export/download/screenshot work and exclude real provider latency, live search and MongoDB availability.

The actual historical `f0`/`f1` replacements and the earlier slide-1 quality-review bodies remain unavailable. New diagnostics make future type/length failures explicit. Real Claude output behavior, provider latency/account access and production font/resource behavior still need a separately approved live integration run. No billable test was attempted. Image-provider configuration was not activated or changed.

These tested changes are local to this checkout. They must be deployed before they can affect Render; no production revision was assumed or modified. Genuine semantic, unsafe-input, corrupt-artifact and unrenderable-layout failures remain failures, with bounded recovery rather than an unconditional success promise.

## Files changed in this task

- `Service/ai/fieldRepair.mjs`: canonical path resolution, stable aliases, normalization, per-value assessment and partial staging.
- `Service/ai/generateJsonWithRetry.mjs`: retained corrections, remaining-field retries, repair feedback/diagnostics and complete validation timing.
- `Service/ai/presentationContentBudget.mjs`, `presentationLayoutBudget.mjs`: shared diagram bounds and distinct renderer-derived planning targets.
- `renderer/presentation/contentFit.mjs`: shared character-budget estimate aligned with wrapping tolerance.
- `renderer/presentation/professionalLayouts.mjs`, `photoCompositions.mjs`: native-diagram collector/probe plumbing; correct relationship source indexes and generated-prefix budgets.
- `renderer/presentation/visuals/nativeDiagram.mjs`, `svgGraphics.mjs`, new `diagramLimits.mjs`: all-field fit collection, original edge indexes and shared semantic bounds.
- `templates/presentation/visualSchemas.mjs`: canonical diagram schema aligned with renderer ceilings.
- New `tests/regression/repair-transaction.test.mjs`, `tests/repairTransactionAudit.mjs`; updated `content-contract-repair.test.mjs` and `presentation-content-budget.test.mjs`; this report.

Earlier uncommitted work is preserved. No unrelated webpage/document generation design, credentials, provider selection, deployment configuration or API route was changed.
