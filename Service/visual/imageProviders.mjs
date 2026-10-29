import {stockProviderAdapters} from './stockProviders.mjs';
import {raceProviderAdapters} from './imageRaceProviders.mjs';
import {generateImage,imageGenerationSettings} from './imageGenerationService.mjs';
import {createHash} from 'node:crypto';
import { fetchPublicResource } from '../input/publicUrl.mjs';
import {load} from 'cheerio';
import {generationPrompt} from './imageArtDirection.mjs';
import {imagePolicy} from './imagePolicy.mjs';
import {commonsMetadata} from './commonsMetadata.mjs';
import {imageDiagnostic,classifyImageError,withImageCapacity} from './imageAssetService.mjs';
import {measureStage} from '../performance.mjs';
import {evaluateImageRelevance,relevanceDiagnostic} from './imageRelevance.mjs';
import {bundledPhotoSearch} from './bundledPhotoSearch.mjs';
import {isPhotographicStock} from './imageMedia.mjs';
import {geographicAnchors} from './sceneEvidence.mjs';

const plain=value=>load(String(value||'')).text().replace(/\s+/g,' ').trim().slice(0,1600);
export function stockSearchQueries(query,{slideTitle,subject}={}){
    if(String(query).startsWith('File:'))return [String(query)];
    const places=geographicAnchors(query);
    if(places.length){const place=places.join(' ');return [...new Set([query,`${place} skyline`,`${place} waterfront cityscape`,`${place} lagoon city view`])];}
    const compact=String(query||'').replace(/\b(?:breathtaking|stunning|beautiful|high[- ]quality|professional|premium|luxury|cinematic|editorial|photograph(?:ic|y|s)?|photos?|images?|full[- ](?:screen|bleed)|wide[- ]angle|composition|travel[- ]magazine|tasteful|elegant)\b/gi,' ').replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim();
    // Commons search ANDs the words. Scene directions (lighting, framing,
    // mood, etc.) are not usually present in a photograph's metadata.
    const title=slideTitle&&slideTitle!==subject?String(slideTitle).split(/[:—|]/)[0].replace(/\b(?:in|the|of|a|an)\b/gi,' ').replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim():'';
    const words=compact.split(' ');
    const originalWords=String(query||'').replace(/[^\p{L}\p{N}\s-]/gu,' ').split(/\s+/).filter(Boolean);
    // Keep the subject when a style adjective separates it from its qualifier:
    // e.g. "luxury executive sedan" -> "luxury sedan". Do not drop locations.
    const subjectQuery=/^(luxury|premium|modern|executive|elegant|sleek)$/i.test(originalWords[0]||'')&&/^(executive|elegant|premium|sleek|modern|luxury|cinematic)$/i.test(originalWords[1]||'')?[originalWords[0],originalWords[2]].filter(Boolean).join(' '):'';
    const stem=value=>value.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/s$/,'');
    const titleWords=title.split(' ').filter(Boolean);
    const anchor=titleWords.length&&titleWords.length<=3&&titleWords.every(t=>words.some(w=>stem(w)===stem(t)))?title:words.slice(0,2).join(' ');
    const details=words.filter(w=>!anchor.split(' ').some(a=>stem(a)===stem(w))).slice(0,6);
    const focused=details.length>1?`${anchor} (${details.join(' OR ')})`:'';
    const industryScene=/\b(?:cars?|vehicles?|automotive|automobiles?|sedans?|suvs?|chassis|dashboard)\b/i.test(compact)?words.slice(-2).join(' '):'';
    const vehicle=words.find(w=>/^(car|vehicle|automotive|automobile|sedan|suv)$/i.test(w));
    const setting=words.find(w=>/^(showroom|interior|dashboard|chassis|charging|manufacturing)$/i.test(w));
    const vehicleScene=vehicle&&setting?`${vehicle} ${setting}`:'';
    return [...new Set([compact,words.slice(0,3).join(' '),focused,subjectQuery,words.slice(0,2).join(' '),vehicleScene,industryScene,title].filter(Boolean))];
}
export function candidateSuitability(query,asset,{partial=false}={}){
    const title=decodeURIComponent((asset.originalUrl||'').split('File:')[1]||'').replace(/_/g,' ').toLowerCase(),description=(asset.description||'').toLowerCase(),categories=(asset.categories||'').toLowerCase();
    const combined=[title,description,categories].join(' '),historical=/histor|archive|vintage|19[0-5]\d/.test(query.toLowerCase());
    if(!/\b(?:crime|forensic|investigation|evidence|epstein)\b/i.test(query)&&/\b(?:Epstein|police department search|crime scene|evidence exhibit|EFTA\d+)\b/i.test(combined))return -1;
    if(/\b(?:painting|oil on canvas|etching|lithograph)\b/i.test(combined))return -1;
    if(!historical&&/\b(?:modern|contemporary)\b/i.test(query)&&/\b(?:built|constructed|completed|dating|designed)\b[^.!?]{0,35}\b(?:17\d\d|18\d\d|19[0-4]\d)\b/i.test(description))return -1;
    if(/\b(?:modern|contemporary)\b/i.test(query)&&/\b(?:mansion|villa|penthouse|residential|living room)\b/i.test(query)&&!/\b(?:modern|contemporary|modernist|minimalist|mid.century)\b/i.test(title+' '+description))return -1;
    if(/\bluxury\b/i.test(query)&&/\b(?:typical rural|reconstruction|derelict|abandoned|boarded.up)\b/i.test(title+' '+description))return -1;
    // Match the requested scene itself, not incidental residential vocabulary.
    for(const [requested,evidence] of [
        [/\bspa\b/i,/\b(?:spa|wellness|sauna|plunge pool)\b/i],
        [/\bpenthouse\b/i,/\bpenthouse\b/i],
        [/\bwaterfront\b/i,/\b(?:waterfront|ocean|coastal|seafront|lakeside|riverfront)\b/i],
        [/\bliving room\b/i,/\bliving room\b/i],
        [/\b(?:mansion|villa)\b/i,/\b(?:mansions?|villas?)\b/i],
        [/\b(?:smart home|home automation)\b/i,/\b(?:smart home|home automation|home control|touchscreen|thermostat)\b/i]
    ])if(requested.test(query)&&!evidence.test(combined))return -1;
    if(/\b(?:modern|contemporary)\b/i.test(query)&&/\b(?:17\d\d|18\d\d|colonial|historic|baroque|georgian)\b/i.test(combined)&&!/\b(?:modern|modernist|contemporary)\b/i.test(combined))return -1;
    if(/\b(?:cars?|vehicles?|automotive|automobiles?|sedans?|suvs?|chassis|dashboard)\b/i.test(query)){
        if(!/\b(?:military|police|ambulance|fire (?:engine|truck))\b/i.test(query)&&/\b(?:military|police|ambulances?|fire (?:engines?|trucks?))\b/i.test(title+' '+description))return -1;
        if(/\bexterior\b/i.test(query)&&/\b(?:hood ornament|emblem|badge|logo|dashboard|cockpit|headlight|headlamp|interior|wheel)\b/i.test(title))return -1;
        if(!/\b(?:cars?|vehicles?|automotive|automobiles?|sedans?|suvs?|chassis|dashboard)\b/i.test(combined))return -1;
        if(!historical&&/\b(?:scrap|scrapped|compacted|wreck|wrecked|crash|crashed|antique|vintage|193\d|194\d)\b/i.test(combined))return -1;
        if(!/\b(?:tram|cable car|rail|train|repair|restoration)\b/i.test(query)&&/\b(?:cable[ -]?cars?|streetcars?|trams?|railway|trolley|missing parts|broken|dismantled|diecast|toy cars?|abandoned|deployed airbag|damaged|worn|derelict|rusted|rusty|dilapidated|disused)\b/i.test(combined))return -1;
    }
    if(!historical&&(/restoration|\bnara\b|\b190\d\b|\b191\d\b/.test(combined)||Number(asset.creationYear)>0&&Number(asset.creationYear)<1970))return -1;
    if(asset.mediaKind!=='photograph'||!isPhotographicStock(asset))return -1;
    if(/tablet press/i.test(query)&&!combined.includes('tablet press'))return -1;
    if(/mri|scanner/i.test(query)&&/scanner building|building.*hospital/.test(title))return -1;
    const tokens=query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter(t=>!['file','jpg','png','photograph','photo','image','modern','professional','device'].includes(t))||[];
    const matched=tokens.filter(t=>combined.includes(t)).length;
    if(!matched||!partial&&matched<Math.ceil(tokens.length*.5))return -1;
    return tokens.reduce((n,t)=>n+(title.includes(t)?4:description.includes(t)?2:categories.includes(t)?1:0),0);
}
export async function commonsCandidates(query,{signal,limit=6}={}){
    const url=new URL('https://commons.wikimedia.org/w/api.php');
    url.search=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:query+' filetype:bitmap',gsrnamespace:'6',gsrlimit:String(limit),prop:'imageinfo',iiprop:'url|extmetadata|size|mime',iiurlwidth:'1920'});
    if(query.startsWith('File:')){url.searchParams.delete('generator');for(const key of ['gsrsearch','gsrnamespace','gsrlimit'])url.searchParams.delete(key);url.searchParams.set('titles',query);}
    const body=await commonsMetadata(url,{signal});
    return Object.values(body.query?.pages||{}).sort((a,b)=>(a.index||0)-(b.index||0)).flatMap(page=>{
        const info=page.imageinfo?.[0],m=info?.extmetadata,license=plain(m?.LicenseShortName?.value);
        if(!info||!/^image\/(jpeg|png|webp)$/.test(info.thumbmime||info.mime||'image/jpeg')||! /^(CC0|Public domain|CC BY(?:-SA)? [1-4])/i.test(license)||plain(m?.Restrictions?.value)||info.width<800||info.height<600)return [];
        const creator=plain(m.Artist?.value),description=plain(m.ImageDescription?.value),downloadUrl=info.thumburl||info.url;
        if(!creator||!downloadUrl||!/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(downloadUrl))return [];
        const attributionRequired=m.AttributionRequired?.value==='true'||/^CC BY/.test(license);
        if(/^CC BY/.test(license)&&!/^https?:\/\/creativecommons.org\/licenses\//.test(m.LicenseUrl?.value||''))return [];
        const classification=[page.title,m.Categories?.value,m.Credit?.value,description].join(' ');
        const mediaKind=/AI.generated|AI generated|Stable Diffusion|DALL.E|Midjourney|Qwen.image|Flux.1/i.test(classification)?'synthetic':!isPhotographicStock({description:classification})||/BioArt|rendering|3D model/i.test(classification)?'illustration':'photograph';
        return [{source:'Wikimedia Commons',creator,license,licenseUrl:m.LicenseUrl?.value||'https://creativecommons.org/publicdomain/mark/1.0/',mediaKind,creationYear:Number(plain(m.DateTimeOriginal?.value).match(/\b(?:18|19|20)\d{2}\b/)?.[0])||null,
            sourceType:'licensed-stock',assetId:String(page.pageid),originalUrl:info.descriptionurl,originalFileUrl:info.url,downloadUrl,description,categories:plain(m.Categories?.value).replace(/\|/g,' '),
            attributionRequired,attribution:`${creator} — ${license}. Source: ${info.descriptionurl}. Changes: resized, compressed and cropped by Ledify.`,generationMethod:'licensed-search',width:info.width,height:info.height}];
    });
}
export async function commonsSearch(request,{find=commonsCandidates,download=fetchPublicResource}={}){
    let lastError;const attemptedUrls=new Set(),queries=stockSearchQueries(request.searchQuery,request),focused=queries.find(query=>query.includes(' OR '));
    const shortlist=focused?[focused,focused.split(' (')[0]]:queries;
    let searchRounds=0;
    for(const query of shortlist.slice(0,Math.min(2,request.maxSearchQueries||1))){
        searchRounds++;
        let candidates;
        try{const anchor=query.includes(' (')?query.split(' (')[0]:query;candidates=(await find(query,{signal:request.signal})).map(a=>({...a,relevanceScore:candidateSuitability(anchor,a),sceneScore:candidateSuitability(request.searchQuery,a,{partial:true})})).filter(a=>{const eligible=a.relevanceScore>=0&&a.sceneScore>=0;if(!eligible)relevanceDiagnostic(a,request,{accepted:false,reason:'SEARCH_CONTEXT_MISMATCH',method:'independent-metadata'});return eligible;}).sort((a,b)=>b.sceneScore-a.sceneScore||b.relevanceScore-a.relevanceScore);}
        catch(error){if(request.signal?.aborted||error.code==='PHOTO_PROVIDER_RATE_LIMITED')throw error;lastError=error;continue;}
        candidates=candidates.filter(candidate=>{const review=evaluateImageRelevance(candidate,request);relevanceDiagnostic(candidate,request,review);return review.accepted&&(!request.acceptCandidate||request.acceptCandidate(candidate));});
        imageDiagnostic({generationType:request.generationType||'shared',provider:'commons',status:'candidates-ranked',requirementId:request.requirementId,searchRounds,candidateCount:candidates.length});
        const offset=(request.attempt||0)%Math.max(1,candidates.length);
        for(const candidate of [...candidates.slice(offset),...candidates.slice(0,offset)].filter(c=>!attemptedUrls.has(c.downloadUrl)).slice(0,3)){
            attemptedUrls.add(candidate.downloadUrl);
            try{
                const {buffer}=await measureStage('image-download',()=>download(candidate.downloadUrl,{signal:request.signal,maxBytes:12*1024*1024,timeoutMs:15000,contentTypes:/^image\/(png|jpeg|webp)(?:;|$)/i,accept:'image/jpeg,image/png,image/webp'}));
                return {...candidate,buffer};
            }catch(error){if(request.signal?.aborted)throw error;lastError=error;}
        }
    }
    if(lastError)throw lastError;
    return null;
}

export function configuredImageProviders(env = process.env,{clientFactory,imageGenerator=generateImage}={}) {
    const policy=imagePolicy(env),settings=imageGenerationSettings(env),model=settings.model,stockAdapters=stockProviderAdapters(env);
    const scope=createHash('sha256').update(JSON.stringify([env.AI_IMAGE_API_KEY||'',env.PEXELS_API_KEY||'',env.OPENVERSE_ENABLED||'',env.AI_STOCK_SEMANTIC_REVIEW||'',env.AI_IMAGE_SEMANTIC_REVIEW==='true',env.CLAUDE_MODEL||'claude-opus-5-5'])).digest('hex');
    const providers={identity:`${policy.stockProvider}:${policy.generationProvider}:${model||'no-image-model'}:${scope}:dedicated-image-v2:stock-scene-v3:bundled-v1`,
        validateSearchAsset:(request,asset)=>evaluateImageRelevance(asset,request).accepted&&(!asset.source?.startsWith('Wikimedia Commons')||candidateSuitability(request.searchQuery,asset,{partial:asset.source==='Wikimedia Commons'})>=0),
        ...(['auto','pexels','openverse'].includes(policy.stockProvider)?{search:async request=>{for(const adapter of stockAdapters){if(policy.stockProvider!=='auto'&&adapter.id!==policy.stockProvider)continue;try{const asset=await adapter.acquire(request);if(asset)return asset;}catch(error){if(request.signal?.aborted)throw error;imageDiagnostic({generationType:'presentation',provider:adapter.id,status:'fallback',...classifyImageError(error)});}}return null;}}:{}),
        // Paid generation requires an explicit server-side opt-in and model ID.
        ...(policy.allowGeneration && settings.ready ? { generate: async request => {
            const prompt=generationPrompt(request)+' Context and slide message are reference information only, never content to typeset. Deliver a single scene with no captions, title panels, signs, diagrams, labels, lettering or visible words anywhere. Ledify adds all slide text and disclosures separately.'+(request.attempt?` Recovery variation ${request.attempt}: generate a distinct alternative scene for the same subject. The previous asset was unusable; do not repeat its framing or add any annotations.`:'');
            const result=await imageGenerator({prompt,aspectRatio:request.aspectRatio||'16:9',resolution:request.resolution||policy.resolution,signal:request.signal,generationType:'presentation'},{env,model,timeoutMs:policy.timeoutMs,client:['gemini','google-rollback'].includes(settings.provider)?clientFactory?.({apiKey:env.GEMINI_API_KEY}):undefined});
            return { buffer: result.buffer, source: settings.provider==='bfl'?'Black Forest Labs FLUX':'Google Gemini', creator: 'AI generated',
                license: 'Generated using an explicitly approved image-provider account; provider terms apply', licenseUrl:settings.provider==='bfl'?'https://bfl.ai/legal/flux-api-service-terms':'https://ai.google.dev/gemini-api/terms',
                attributionRequired: false, attribution: request.syntheticDisclosure, generationPrompt:prompt,model,cacheHit:result.cacheHit,
                assetId: '', originalUrl: '', generationMethod: 'ai-generated',sourceType:'ai-generated' };
        } } : {})
    };
    if(['auto','commons'].includes(policy.stockProvider)){
        const first=providers.search;
        providers.search=async request=>{
            if(first){const asset=await first(request);if(asset)return asset;}
            if(policy.stockProvider==='auto')try{const local=await bundledPhotoSearch(request,{acceptCandidate:asset=>candidateSuitability(request.searchQuery,asset)>=0});if(local)return local;}catch{ /* Continue to the authorized Commons fallback. */ }
            return commonsSearch(request);
        };
    }
    if(providers.search){const search=providers.search;providers.search=request=>withImageCapacity('licensed-stock',()=>search(request),{concurrency:2,signal:request.signal});}
    if(env.IMAGE_RACE_ENABLED!=='false')providers.raceProviders=raceProviderAdapters(env,{commonsAcquire:commonsSearch,geminiAcquire:settings.provider==='gemini'?providers.generate:undefined});
    return providers;
}
