import {stockProviderAdapters} from '../visual/stockProviders.mjs';
import {raceProviderAdapters} from '../visual/imageRaceProviders.mjs';
import {fetchPublicResource} from '../input/publicUrl.mjs';
import {generateImage,imageGenerationSettings} from '../visual/imageGenerationService.mjs';
import {imagePolicy} from './imageStrategy.mjs';
import {createHash} from 'node:crypto';
import {commonsSearch} from '../visual/imageProviders.mjs';
import {relevantSearchQuery,relevanceDiagnostic} from '../visual/imageRelevance.mjs';
import {reviewImageCandidate} from './imageReview.mjs';

export async function downloadWebsiteImage(url,options={}){
    if(new URL(url).protocol!=='https:')throw new Error('Image references must use HTTPS');
    try{return (await fetchPublicResource(url,{maxBytes:12*1024*1024,timeoutMs:12000,contentTypes:/^image\/(jpeg|png|webp)(?:;|$)/i,accept:'image/jpeg,image/png,image/webp',...options})).buffer;}catch(error){throw Object.assign(error,{imageOperation:'download'});}
}

async function boundedJson(response){
    if(!response.ok)throw Object.assign(new Error('Image search provider unavailable'),{status:response.status,headers:response.headers});
    let size=0;const chunks=[];
    for await(const chunk of response.body){size+=chunk.length;if(size>256*1024){await response.body.cancel?.().catch(()=>{});throw new Error('Image search response exceeds budget');}chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function websiteImageProviders(env=process.env,options={}){
    const policy=imagePolicy(env),settings=imageGenerationSettings(env),model=settings.model;
    const providers=[];
    for(const adapter of stockProviderAdapters(env,options))providers.push({...adapter,acquire:async request=>{const image=await adapter.acquire({...request,searchQuery:request.query||relevantSearchQuery(request),acceptCandidate:record=>reviewImageCandidate(record,request,{width:record.width,height:record.height}).accepted});return image?{...image,alt:image.description,illustrative:true}:null;}});
    if(env.WEBPAGE_ALLOW_IMAGE_GENERATION==='true'&&settings.ready)providers.push({id:'generated-image',kind:'generation',model,cacheScope:createHash('sha256').update(JSON.stringify([settings.provider,env.AI_IMAGE_API_KEY||env.GEMINI_API_KEY||'',env.AI_IMAGE_SEMANTIC_REVIEW==='true',env.CLAUDE_MODEL||'claude-opus-5-5'])).digest('hex'),acquire:async request=>{
        const prompt=`Create editorial concept imagery for a static website: ${request.query}. Style: ${request.style}. Placement: ${request.role}. Purpose: ${request.purpose||request.query}. Lighting: ${request.lighting||"natural"}. Palette and temperature: ${request.palette||request.temperature||"balanced"}. Composition and focal point: ${request.focalPoint||"clear focal subject with copy space"}. No text, logos, real company premises, identifiable customers or claims of clinical proof. Preserve the subject and allow room for surrounding website copy.`;
        const result=await (options.imageGenerator||generateImage)({prompt,aspectRatio:request.aspectRatio||'16:9',resolution:env.GOOGLE_IMAGE_RESOLUTION||'1K',signal:request.signal,generationType:'webpage'},{env,model,client:['gemini','google-rollback'].includes(settings.provider)?options.client:undefined,timeoutMs:policy.timeoutMs,cacheRoot:options.cacheRoot});
        return {buffer:result.buffer,model,cacheHit:result.cacheHit,alt:request.alt,creator:'AI generated',license:'Explicitly approved image provider terms apply',licenseUrl:settings.provider==='bfl'?'https://bfl.ai/legal/flux-api-service-terms':'https://ai.google.dev/gemini-api/terms',source:settings.provider==='bfl'?'Black Forest Labs FLUX':'Google Gemini',sourceType:'ai-generated',generationMethod:'ai-generated',synthetic:true,illustrative:true,role:request.role,caption:'AI-generated conceptual illustration; not an actual photograph of this organization.'};
    }});
    providers.push({id:'commons',acquire:async request=>{
        const image=await (options.commonsSearch||commonsSearch)({...request,searchQuery:relevantSearchQuery(request),maxSearchQueries:1,acceptCandidate:record=>reviewImageCandidate(record,request,{width:record.width,height:record.height}).accepted});
        return image?{...image,alt:image.description,sourceUrl:image.originalUrl,illustrative:true}:null;
    }});
    providers.sort((a,b)=>(a.id==='commons'?0:a.kind==='generation'?2:1)-(b.id==='commons'?0:b.kind==='generation'?2:1));
    if(env.IMAGE_RACE_ENABLED!=='false')providers.raceProviders=raceProviderAdapters(env,{...options,commonsAcquire:options.commonsSearch||commonsSearch,geminiAcquire:settings.provider==='gemini'?providers.find(p=>p.kind==='generation')?.acquire:undefined});
    return providers;
}
