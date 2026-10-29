# Slide-level recovery and relationship-label repair

Follow-up: [fact-preservation repair](fallback-fact-preservation-2026-10-29.md) supersedes the original single-call fallback bound with one fallback plus one optional body-only correction. The maximum remains two converted slides per request.

## Cause

The supplied evidence for `e46031e8-f07b-4ee7-b03c-20376ee5075c` matches a renderer defect, not a one-character schema requirement. The generic relationship layout drew `source name → target name: relationship label` in one text box. On overflow it subtracted the full endpoint-name prefix from the character estimate and clamped the remainder using `Math.max(1, ...)`. Long endpoint names therefore produced a one-character repair instruction for a meaningful 17–20-character relationship. Structural length validation could accept an arbitrary letter; semantic review correctly rejected the resulting relationship.

The renderer now gives numbered endpoint references and relationship text separate boxes, with a numbered node list. Full node names and meaningful relationship labels remain visible. Their geometry is checked separately. This changes the affected supported layout, not every text limit. Single-letter substitutions for previously meaningful relationship labels are also rejected during repair, even when they satisfy the length constraint. Existing whole-slide quality review remains responsible for semantic correctness beyond these deterministic guards.

The 20- and 40-character diagram-description limits are intentional geometry-dependent guidance, not competing global defaults. The audit reproduced 40 with a two-node labeled diagram, planned photo, short prose and caption; it reproduced 20 with a three-node flowchart, a planned photo, longer prose and caption. Available width, rows, caption/prose height and edge legends affect usable space. Actual word wrapping still must pass. `canonicalRepairField` maps these renderer paths to the original node/edge strings; regression tests cover both capacities and those mappings.

## Recovery flow

The existing mechanisms were extended: `generateJsonWithRetry`, the existing layout-text repair service, `repairPresentationValidation` and `reviewAndRepairPresentation`. There is no independent provider retry engine.

1. Keep ordinary drafting and field-only repairs. A shared request-local budget controls subsequent operations.
2. Use actionable private review messages and repair instructions for the affected slide. The generic public diagnostic is not used as the only repair instruction.
3. If targeted repair fails, makes no meaningful change, or fails its re-review, use the reserved fallback operation to regenerate **only that slide** as the existing `focused-explanation` / `textContent` component, with at most one correction through the existing field-repair mechanism.
4. Supply the original objective, prior content, source and specific review findings. Explain each supported relationship in words; preserve essential explanations, values, units and qualifications. A numerical fact cannot disappear or change units without specific FACTUAL feedback identifying that fact as incorrect/unsupported. Such justified changes still require semantic review.
5. Validate the replacement against its own strict schema, source guards and actual layout. Preserve slide number, title, order and photo assets. Only that slide's component is changed; a stale diagram vector for that same converted slide is removed and recorded so it cannot contradict the replacement. Unaffected design units/assets remain unchanged.
6. Independently review replacements before publishing. Re-review receives unchanged slides as read-only deck context, plus prior replaced content and raw actionable findings. It checks contradictions, broken references, supported relationships and essential information. Final deterministic validation does not launch another unreviewed repair pass.

Successful slides are not regenerated. On initial-generation failure, completed independent drafts are checkpointed after in-flight work drains, including successful drafts after a failed index. Existing job partial checkpoints remain available; a partial draft is not presented as a finished artifact.

Resumed slides already marked as converted cannot spend another fallback attempt. Their existing conversion markers reserve those slots, and they must undergo semantic review even if an internal caller disabled ordinary review. This prevents a resumed conversion from bypassing the review gate.

Cover and section-divider conversion is deliberately excluded: the fallback must not replace the required photographic cover or break section semantics. Invalid provider configuration, safety refusals and permanent provider failures do not initiate fallback calls.

## Explicit budget

Default limits, request-scoped and shared across structural validation and quality review:

| Operation | Per slide | Per request |
|---|---:|---:|
| Ordinary drafting, including existing retry/field-patch attempts | Up to 3 calls | Up to 3 × requested slide count |
| Existing terminal layout-text recovery | One operation, up to 2 calls | Four operations, up to 8 calls |
| Targeted post-draft correction | One operation; up to 2 calls if both metadata and content need correction, otherwise 1 | Four operations by default, bounded by existing quality-repair setting |
| Reserved simple-slide fallback | **Up to two calls** | **Four calls / two slides** |
| Semantic review | Initial, targeted-repair re-review, fallback re-review | Three review rounds by default, each using the existing maximum of 2 attempts |

The existing configurable maximum of two ordinary quality rounds can permit one additional review round. Provider capacity limits and the overall generation deadline still apply. Ordinary repair cannot spend the two reserved fallback slots. Quality repairs use one content-generation attempt; a fallback may use one additional correction through the same existing retry engine, capped at two calls. Outer validation/review loops cannot multiply an inner three-attempt generation loop. A fallback can still consume extra latency and token cost; these limits are safety/reliability bounds, not a speed guarantee. No new model, paid provider or hosting service was introduced.

`slideRecovery` / `contentFallback` record converted slide numbers, source and target types, reason codes, any stale-vector replacement and budget usage. Existing quality repair history records `targeted` versus `fallback`. Raw review findings remain internal; existing private opt-in review audit storage is preserved.

## Blocking versus warnings

The previous end-of-budget CLARITY downgrade was removed. Unresolved FACTUAL, CLARITY, COVERAGE, DEPTH, invalid structure and unreadable output remain blocking. They are not exported merely because repair attempts ran out.

The explicit minor-style warning policy requires `severity=warning`, a REPETITION/CONCLUSION/METADATA code, a stated minor stylistic/wording/optional preference and no reported missing, unclear, incorrect, contradictory, unsupported or misleading content. IMAGE/LAYOUT findings still go to the existing mandatory downstream gates; deferral does not approve missing content or assets.

Meaning preservation guards now cover recognized numerical values/units and qualifications as well as meaningful relationship labels. Visible native diagram labels/descriptions/edges can count as review evidence; private visual search/descriptive instructions cannot. Model review is not a certified factual or medical audit. If meaningful preservation cannot be demonstrated through the checks and review, generation retains controlled failure behavior and does not publish an invalid artifact.

## Verification

- Full regression run: **757 passed, zero failures/skips**, 490.443 seconds.
- Additional focused runs after the final evidence/numerical/design safeguards passed: **33 tests**, **46 tests**, and **24 tests**; the final accepted semantic/recovery run passed **38 tests**, including resumed-slide review/budget enforcement. Counts overlap; they are not additive totals.
- New regression coverage includes the one-character origin; rejection of meaningless repairs and unit changes; reserved-budget limits; targeted repair that passes structure but fails meaning; successful one-/two-slide fallback; unchanged successful content/assets; exact count/order; blocked factual/clarity replacements; numerical preservation; native diagram evidence; and updating only a converted slide's design component/vector.
- Native HTTP audit with mocked Claude and controlled media: **HTTP 201**, persisted `completed`, exactly **12 slides**, **12 PNGs**, valid PPTX and PDF, and **14 successful download requests**. Slides **8 and 11** were converted. A separate relationship slide retained all four complete node names and all four meaningful edge labels in the PPTX XML. Its PNG and a converted-slide PNG were visually inspected for overlap/clipping.
- The final native fixture made one outline call, 16 ordinary content calls (including failed attempts), two single-call fallbacks and one review: **20 mocked AI calls**, with no whole-deck regeneration. About 24.4 seconds including real exports/downloads is a mocked-provider fixture result, not live generation latency.

Evidence: `generated/slide-recovery-reserve/full-regression.log`, `final-focused.log`, `final-semantic.log`, `final-budget-design.log`, `accepted-focused.log`, `diagram-budgets.json`, `native-final.log` and `native/report.json`.

The exact complete live payload/responses for `e46031e8-...` were not supplied, so a literal live replay was not performed. The failure arithmetic and recovery behaviors were reproduced with controlled fixtures. No paid live generation or production deployment was performed. Native test imagery/content are mechanical fixtures, not a clinically reviewed presentation.

## Files changed

Production:

- `renderer/presentation/professionalLayouts.mjs`
- `Service/ai/fieldRepair.mjs`
- `Service/visual/layoutRecovery.mjs`
- `Service/ai/diagramContentRecovery.mjs`
- `Service/ai/presentationRepairBudget.mjs` (new)
- `Service/ai/presentationQuality.mjs`
- `Service/ai/presentationValidation.mjs`
- `Service/aiService.mjs`

Tests/audits:

- `tests/regression/slide-recovery-reserve.test.mjs` (new)
- `tests/regression/stakeholder-quality.test.mjs` (updated read-only context expectation)
- `tests/regression/testing-issues.test.mjs` (updated required CLARITY blocking policy)
- `tests/fixtures/slideFallback.mjs` (new)
- `tests/slideRecoveryReserveAudit.mjs` (new)
- `tests/diagramBudgetAudit.mjs` (new)

Configured text/image providers, model identifiers, endpoints, success/download contracts and native PPTX/PDF/PNG tooling remain intact. The intentional behavioral change is that unresolved substantive CLARITY defects now fail rather than being silently converted to review warnings. Recovery records are additive metadata. No new environment variables or dependencies are required. No `.env` edit, commit, push, merge or deployment was made.

Exact pre-edit copies of existing production targets are under `generated/slide-recovery-reserve/before/`. Restore only those targets for rollback; preserve unrelated uncommitted work. The new budget-module import disappears when the original callers are restored.
