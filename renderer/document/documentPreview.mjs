import { documentStyle, validateDocumentAssets } from './docxRenderer.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function safeUrl(value) {
    try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;} catch {return null;}
}

// Render canonical blocks directly: model text is always escaped, never interpreted as HTML.
export async function renderDocumentPreview(document,context={}) {
    const style=documentStyle(document,context),assets=await validateDocumentAssets(document.assets||[]),references=document.references||[];
    const citations=block=>(block.referenceIds||[]).map(id=>{
        const index=references.findIndex(reference=>reference.id===id);
        return index<0?'':` <span class="citation">${escape(references[index].citationText||`[${index+1}]`)}</span>`;
    }).join('');
    function blockHtml(block) {
        const cite=citations(block);
        switch(block.type) {
            case 'paragraph': return `<p>${escape(block.text)}${cite}</p>`;
            case 'heading': {const level=block.level===3?4:3;return `<h${level}>${escape(block.text)}</h${level}>`;}
            case 'list': {const tag=block.ordered?'ol':'ul';return `<${tag}>${block.items.map(item=>`<li>${escape(item)}</li>`).join('')}</${tag}>${cite}`;}
            case 'table': return `<div class="table-wrap"><table>${block.caption?`<caption>${escape(block.caption)}</caption>`:''}<thead><tr>${block.columns.map(cell=>`<th scope="col">${escape(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row=>`<tr>${row.cells.map(cell=>`<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${cite}`;
            case 'code': return `<pre><code>${escape(block.text)}</code></pre>`;
            case 'quote': return `<blockquote>${escape(block.text)}${cite}</blockquote>`;
            case 'caption': return `<p class="caption">${escape(block.text)}</p>`;
            case 'image': {
                const asset=assets.find(asset=>asset.id===block.assetId);
                if(!asset)throw Object.assign(new Error('Missing document preview image.'),{code:'INVALID_DOCUMENT_IMAGE'});
                const mime=Buffer.from(asset.base64,'base64')[0]===137?'image/png':'image/jpeg';
                return `<figure><img src="data:${mime};base64,${escape(asset.base64)}" alt="${escape(asset.alt)}">${block.caption||asset.attribution?`<figcaption>${escape(block.caption)}${asset.attribution?` <span>${escape(asset.attribution)}</span>`:''}${cite}</figcaption>`:cite}</figure>`;
            }
            case 'pageBreak': return '<hr class="page-break" aria-label="Page break">';
            case 'sectionBreak': return `<hr class="page-break" aria-label="${block.orientation==='landscape'?'Landscape':'Portrait'} section">`;
            default: throw Object.assign(new Error('Unsupported document preview block.'),{code:'DOCUMENT_ARTIFACT_INVALID'});
        }
    }
    const body=document.sections.map(section=>`<section class="${['prose','reference','report'].includes(section.designComponent)?section.designComponent:'prose'}">${/letter/i.test(document.documentType)?'':`<h2>${escape(section.heading)}</h2>`}${section.blocks.map(blockHtml).join('')}</section>`).join('');
    const bibliography=references.length?`<section><h2>References</h2><ol>${references.map(reference=>{const url=safeUrl(reference.url);return `<li>${escape(reference.formattedText||reference.title)}${url?` <a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(reference.url)}</a>`:''}</li>`;}).join('')}</ol></section>`:'';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(document.title)} — Ledify preview</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf0f4;color:#202631;font-family:Arial,sans-serif}.toolbar{padding:16px 24px;background:#fff;border-bottom:1px solid #d8dde5;display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:14px}.toolbar p{margin:0;flex:1}.toolbar a{color:#1746a2;font-weight:bold}main{max-width:${style.paper==='Letter'?'8.5in':'8.27in'};margin:28px auto;padding:${style.margin/1440}in;background:white;box-shadow:0 2px 12px #0001;font-family:'${style.font}',serif;font-size:${style.size}pt;line-height:${Math.max(style.lineSpacing,1.25)}}h1,h2,h3,h4{line-height:1.25;break-after:avoid}h1{font-size:${/letter/i.test(document.documentType)?'12':'24'}pt}h2{font-size:16pt;margin-top:1.5em}h3{font-size:13pt}h4{font-size:12pt}p,li,td,th,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}p{margin:0 0 .8em}.reference p{margin-bottom:.5em}.report p{margin-bottom:1.1em}table{border-collapse:collapse;width:100%;font-size:10pt}th,td{border:1px solid #d9d9d9;padding:8px;text-align:left;vertical-align:top}th{background:#e8eff7}tbody tr:nth-child(even){background:#f7f9fb}.table-wrap{overflow-x:auto;margin:1em 0}caption,.caption,figcaption{font-size:.9em;color:#505a68}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:12px;font-size:9.5pt}blockquote{border-left:3px solid #ccd5e0;padding-left:16px;margin-left:0}img{max-width:100%;height:auto;max-height:420px;object-fit:contain}figure{margin:1em 0}.page-break{border:0;border-top:1px dashed #ccd5e0;margin:24px 0}.subtitle{color:#505a68}.citation{font-size:.9em}@media(max-width:700px){main{margin:12px;padding:24px}}@media print{body{background:white}.toolbar{display:none}main{margin:0;padding:0;max-width:none;box-shadow:none}.page-break{break-after:page;border:0}}
</style></head><body><nav class="toolbar" aria-label="Document preview"><p>Document preview · Word pagination may differ.</p><a href="download">Download Word (.docx)</a><a href="pdf">Download PDF (.pdf)</a></nav><main><h1>${escape(document.title)}</h1>${document.subtitle&&!style.simple?`<p class="subtitle">${escape(document.subtitle)}</p>`:''}${body}${bibliography}</main></body></html>`;
}
