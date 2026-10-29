// Public API projection. Internal services retain paths/assets for conversion,
// but HTTP clients only need identifiers, metadata and API-relative URLs.
const privateKeys = new Set(['filePath','previewDirectory','pptxPath','pdfPath','siteDirectory','slidesDirectory','directory','zipPath','cacheRoot','base64','imageLayoutPlanned']);
export function publicGenerationResult(value,options={}) {
    const presentation=options.presentation||value?.outputType==='presentation'||!!(value?.slides&&value?.imageCoveragePlan);
    if(value instanceof Date) return value.toISOString();
    if(Array.isArray(value)) return value.map(child=>publicGenerationResult(child,{presentation}));
    if(value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([key,child])=>!privateKeys.has(key) && !(presentation&&['diagnostics','failedRequests','imageFailures','imageDiagnostics','stack'].includes(key)) && !(key==='files'&&!Array.isArray(child)) && !(key==='data' && typeof child==='string' && /^(?:data:)?image\//.test(child)))
        .map(([key,child])=>[key,publicGenerationResult(child,{presentation})]));
    return value;
}
export function compactOptionalContext(value) {
    if(Array.isArray(value)) return value.map(compactOptionalContext).filter(v=>v!==undefined);
    if(value && typeof value==='object'){
        const entries=Object.entries(value).map(([k,v])=>[k,compactOptionalContext(v)]).filter(([,v])=>v!==undefined);
        return entries.length?Object.fromEntries(entries):undefined;
    }
    return value === '' || value == null ? undefined : value;
}
