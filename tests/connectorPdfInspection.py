"""Inspect actual PDF line operators, independently of PNG rasterization."""
import json
from pathlib import Path
import pdfplumber

root = Path('generated/connector-artifacts')
results = []
for name, filename in [('before', root / 'before.pdf'), ('dark', root / 'final/dark.pdf'), ('light', root / 'final/light.pdf')]:
    with pdfplumber.open(filename) as pdf:
        page = pdf.pages[3]
        lines = [dict(x1=l['x0']/72, y1=l['top']/72, x2=l['x1']/72, y2=l['bottom']/72) for l in page.lines
                 if l['x0'] >= 6.44*72 and l['x1'] <= 12.62*72 and l['top'] >= 2.29*72 and l['bottom'] <= 6.22*72
                 # LibreOffice quantizes zero-size line extents by ~0.028 pt.
                 and (abs(l['x1']-l['x0']) < .1 or abs(l['bottom']-l['top']) < .1)]
        overlaps = 0
        for i, a in enumerate(lines):
            for b in lines[i+1:]:
                if abs(a['y2']-a['y1']) < .002 and abs(b['y2']-b['y1']) < .002 and abs(a['y1']-b['y1']) < .002:
                    overlaps += min(a['x2'], b['x2'])-max(a['x1'], b['x1']) > .002
                if abs(a['x2']-a['x1']) < .002 and abs(b['x2']-b['x1']) < .002 and abs(a['x1']-b['x1']) < .002:
                    overlaps += min(a['y2'], b['y2'])-max(a['y1'], b['y1']) > .002
        assert overlaps > 0 if name == 'before' else overlaps == 0
        results.append(dict(case=name, pages=len(pdf.pages), lineOperators=len(lines), overlappingPairs=int(overlaps)))
(root / 'final/pdf-vector-report.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results))
