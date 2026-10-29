# Presentation line-artifact repair — 29 October 2026

## Confirmed causes

Two defects were reproduced and corrected. The attachment did not include a specific affected user deck, so the investigation began with an existing generated artifact, `generated/late-layout-1fcd40b4/result.pptx`, and its matching PDF/PNG. A safe copy was kept under `generated/connector-artifacts/before.*` before producing new artifacts.

1. **Native connector geometry created overlapping strokes.** `nativeDiagram.mjs` placed independent connections on a fixed center spine and reused horizontal stubs. The four-node serpentine flow had five source PPTX line shapes, with two overlapping pairs. This produced the long central line and opposing nearby arrowheads seen in the existing preview. The shapes already exist in the original PPTX XML; this is not a PNG-only defect.
2. **SVG arrowheads disappeared during rasterization.** The renderer relied on `marker-end` for SVG arrowheads. The actual `@napi-rs/canvas` SVG-to-PNG path dropped those markers, leaving bare-ended line fragments. A controlled pixel probe outside the line stroke measured background RGBA `[248,245,239,255]` with the old marker approach and filled-arrowhead RGBA `[170,115,69,255]` with explicit geometry.

The SVG connector code also assumed fixed start/end sides and drew direct paths without checking intervening text. Both native and SVG output now use the same routing calculation.

## Changes

- New `renderer/presentation/visuals/connectorRouting.mjs`: bounded orthogonal routing through whitespace, with text rectangles and relationship labels as hard obstacles. Paths retain source/target identities and direction; overlap penalties give independent relationships separate routes. Ports prefer across-row or between-row flow, avoiding pointless detours. Collinear sections are compacted and zero-length segments omitted.
- `renderer/presentation/visuals/nativeDiagram.mjs`: replaces the fixed spine/stub calculations with routed segments, deduplicates shared port dots, and places one directional arrowhead on the terminal segment of each relationship. Stroke properties are explicit. Text, font sizes, density checks, labels, edge indexes and captions are retained. Invalid dry-run text still reaches the existing repair collector rather than being masked by routing errors.
- `renderer/presentation/visuals/svgGraphics.mjs`: uses the shared safe routes and explicit filled triangular arrowheads. Connector paths remain open with `fill="none"`; only the intentional arrowhead triangles close. Existing node accent rules and captions remain. This avoids dependence on unsupported SVG marker behavior.

No blanket line-removal pass or covering shapes were added. No chart axes, timeline rules, section accents, table borders, background treatments or typography were removed. Inspection did not establish default text/image outlines or gradient transparency as causes of the reproduced defect, so those working paths were not rewritten. The LibreOffice and PNG conversion code is unchanged.

## Format comparison

The original PPTX line coordinates were extracted directly from slide XML. PDF lines were independently read using `pdfplumber`, before rasterization; PNGs were then visually inspected. The PDF comparison allows for LibreOffice's approximately 0.028-point quantization of zero-height/width line extents.

| Case, diagram slide 4 | PPTX line segments | PPTX overlapping pairs | PDF line operators | PDF overlapping pairs |
|---|---:|---:|---:|---:|
| Existing reproduction | 5 | 2 | 5 | 2 |
| Corrected dark deck | 4 | 0 | 4 | 0 |
| Corrected light deck | 4 | 0 | 4 | 0 |

All **three logical relationships** remain, including the return across rows. Multiple segments form a single bent connection where needed. The lower segment count removes redundant geometry; it does not drop an edge.

The initial proposed routing passed geometric tests but left an unattractive U-shaped detour. Visual inspection caught this, and the final port-selection rule corrected it. The final exported screenshots, not that intermediate version, are the delivered evidence.

## Verification

Final full regression suite: **740 passed, 0 failed, 0 skipped**, in 279.849 seconds (`generated/connector-verified.log`). The focused renderer/repair suite also passed all 38 checks. `git diff --check` passed, and `.env` remains unchanged.

`tests/regression/connector-artifacts.test.mjs` verifies four-node flows, cycles, labeled branches, reverse directions, one arrowhead per edge, no overlapping segments in the regression graphs, no text intersections, in-bounds shapes, open SVG connector paths, retained node accents and actual visible arrowhead wings after rasterization. The native text-fit and transaction-repair regressions also passed after the routing change.

`tests/connectorArtifactAudit.mjs` generated **two ten-slide presentations**, with dark and light appearance settings, using controlled content and local licensed images. Together the matrix covers title/cover, content/image, comparison, diagram, section divider, key points, timeline, native chart, statistics/infographic and conclusion layouts, with dark/light/gradient surfaces. Both passed native PPTX validation, LibreOffice PDF conversion and all ten PNG preview checks. The native chart package and corrected diagram text were also verified. No AI calls were needed.

Final artifact-build times were **34.067 seconds** (dark) and **33.494 seconds** (light). These are local export-test durations, not live generation performance claims.

`tests/connectorPdfInspection.py` independently confirms the PDF vector counts above. `tests/connectorSvgAudit.mjs` reproduces the dropped-marker raster and verifies the explicit-arrow replacement using the actual SVG rasterizer. These scripts do not call paid providers.

Evidence:

- `generated/connector-artifacts/final/report.json`
- `generated/connector-artifacts/final/pdf-vector-report.json`
- `generated/connector-artifacts/final/svg-arrowhead-report.json`
- `generated/connector-artifacts/final/dark.pptx`, `dark.pdf`, `dark.png`, `dark-contact.png`
- `generated/connector-artifacts/final/light.pptx`, `light.pdf`, `light.png`, `light-contact.png`
- `generated/connector-artifacts/final/before-marker.png`, `after-explicit.png`

## Limits and deployment

This fixes the reproduced shared-renderer defects across topics and supported layouts; it is not a claim that every possible external image, chart or previously generated file is artifact-free. An unrelated reported artifact would need its source deck or image for a precise diagnosis. Microsoft PowerPoint's UI was not automated: original PPTX geometry/package checks and actual LibreOffice/PDF/PNG rendering supplied the format evidence.

The existing repair mechanisms, required cover imagery, image races and optional-image recovery are preserved. The change adds no credentials, paid calls or API contract changes. `.env` was not edited, and no production deployment or GitHub push occurred. Existing exported files are not rewritten automatically.
