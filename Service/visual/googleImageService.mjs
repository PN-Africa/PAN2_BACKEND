import {GoogleGenAI} from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateImageBytes,storeImageAsset,atomicImageJson,withImageCapacity,imageDiagnostic,classifyImageError,shareImageWork} from './imageAssetService.mjs';
import {storageRoot} from '../storageRoot.mjs';
import {generationSignal,measureStage,reservePerformanceBudget} from '../performance.mjs';
import {reviewGeneratedImage} from './generatedImageReview.mjs';

const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const failure=(code,message)=>Object.assign(new Error(message),{code,stage:'image-generation'});
export const googleImageModel=(env=process.env,legacyName)=>env[legacyName]||env.GOOGLE_IMAGE_MODEL||'';

async function validate(buffer){
    return validateImageBytes(buffer,{minWidth:512,minHeight:512,requireVariance:true});
}

// Callers own per-output budgets and bounded retries. One invocation makes at
// most one paid request; the SDK must not silently multiply those attempts.
export async function generateGoogleImage(request,options={}){
    const env=options.env||process.env,model=options.model||env.GOOGLE_IMAGE_MODEL;
    if(!model||!env.GEMINI_API_KEY)throw failure('IMAGE_NOT_CONFIGURED','Configure an accessible Google image model and the existing Gemini API key');
    const prompt=String(request.prompt||'').trim();
    if(!prompt||prompt.length>16000)throw failure('IMAGE_BRIEF_INVALID','Image brief is empty or too long');
    const aspectRatio=request.aspectRatio||'16:9';
    const resolution=request.resolution||env.GOOGLE_IMAGE_RESOLUTION||'1K';
    if(!['1K','2K','4K'].includes(resolution))throw failure('IMAGE_BRIEF_INVALID','Image resolution must be 1K, 2K or 4K');
    if(!['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'].includes(aspectRatio))throw failure('IMAGE_BRIEF_INVALID','Unsupported image aspect ratio');
    // Flash 2.5 Image has fixed output size; newer image models accept imageSize.
    const interactions=['gemini-nano-banana-2.1','gemini-3-pro-image'].includes(model);
    const imageConfig={aspectRatio,...(!/gemini-2\.5-flash-image/.test(model)?{imageSize:resolution}:{})};
    const id=digest(JSON.stringify({version:4,account:digest(env.GEMINI_API_KEY),model,prompt,imageConfig,semanticReview:env.AI_IMAGE_SEMANTIC_REVIEW==='true',reviewModel:env.CLAUDE_MODEL||'claude-opus-5-5'}));
    const cache=options.cache??!options.client;
    const root=path.resolve(options.cacheRoot||env.GOOGLE_IMAGE_CACHE_DIR||storageRoot('google-image-cache'));
    if(cache)try{
        const meta=JSON.parse(await fs.readFile(path.join(root,id+'.json'),'utf8'));
        if(meta.requestHash!==id)throw new Error('Generated image cache context mismatch');
        if(!/^[a-f0-9]{64}\.(?:png|jpeg|webp)$/.test(meta.assetFile||''))throw new Error('Invalid cached path');
        if(!Number.isFinite(meta.createdAt)||Date.now()-meta.createdAt>7*86400000)throw new Error('Expired');
        const buffer=await fs.readFile(path.join(root,meta.assetFile));
        if(digest(buffer)!==meta.sha256)throw new Error('Cache checksum mismatch');
        await validate(buffer);
        const filePath=path.join(root,meta.assetFile);
        imageDiagnostic({generationType:request.generationType||'shared',provider:'google',model,status:'resolved',cacheHit:true,storage:'verified',validation:'passed'},options.logger);
        return {...meta,filePath,buffer,cacheHit:true};
    }catch{}
    const key=cache?id:randomUUID();
    return shareImageWork('google:'+root+':'+key,async sharedSignal=>{
        const timeoutMs=Math.min(60000,Math.max(1000,Number(options.timeoutMs)||30000));
        const queueSignal=AbortSignal.any([sharedSignal,AbortSignal.timeout(timeoutMs)]);
        const concurrency=Math.min(3,Math.max(1,Number(env.GOOGLE_IMAGE_CONCURRENCY)||1));
        return withImageCapacity('google-image',async()=>{
        const controller=new AbortController(),signal=AbortSignal.any([sharedSignal,controller.signal,queueSignal]);
        const started=performance.now();let timer;
        try{
            const client=options.client||new GoogleGenAI({apiKey:env.GEMINI_API_KEY});
            const call=()=>interactions?client.interactions.create({model,input:prompt,store:false,response_format:{type:'image',aspect_ratio:aspectRatio,image_size:resolution}},{signal,timeout:timeoutMs,maxRetries:0}):client.models.generateContent({model,contents:prompt,config:{responseModalities:['TEXT','IMAGE'],imageConfig,abortSignal:signal,httpOptions:{timeout:timeoutMs,retryOptions:{attempts:1}}}});
            const result=await measureStage('gemini-image-generation',()=>Promise.race([call(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('PROVIDER_TIMEOUT','Image provider timed out'));},timeoutMs);signal.addEventListener('abort',()=>reject(failure('PROVIDER_TIMEOUT','Image request cancelled')),{once:true});})]));
            if(result.promptFeedback?.blockReason||/SAFETY|BLOCKED|PROHIBITED/i.test(result.candidates?.[0]?.finishReason||''))throw failure('IMAGE_CONTENT_BLOCKED','Image content was blocked by the provider');
            const inline=interactions?{data:result.output_image?.data,mimeType:result.output_image?.mime_type}:result.candidates?.[0]?.content?.parts?.find(part=>/^image\/(png|jpeg|webp)$/.test(part.inlineData?.mimeType||''))?.inlineData;
            if(!inline?.data||!/^image\/(png|jpeg|webp)$/.test(inline.mimeType||'')||inline.data.length>16*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(inline.data))throw failure('IMAGE_EMPTY_RESPONSE','Google returned no usable image data');
            const buffer=Buffer.from(inline.data,'base64'),metadata=await validate(buffer);
            if(metadata.format!==inline.mimeType.slice(6))throw failure('IMAGE_INVALID_BYTES','Returned image MIME type does not match decoded bytes');
            const semanticReview=env.AI_IMAGE_SEMANTIC_REVIEW==='true'&&reservePerformanceBudget('generated-image-review',1)!==false?await reviewGeneratedImage({buffer,mimeType:inline.mimeType,prompt,signal},{env,client:options.textClient,logger:options.logger}):{status:'not-run'};
            const meta={provider:'gemini',assetType:'ai-generated',generated:true,model,resolution,aspectRatio,semanticReview,requestHash:id,sha256:digest(buffer),createdAt:Date.now(),mimeType:`image/${metadata.format}`,width:metadata.width,height:metadata.height};
            // Save a verified source even when caching is disabled for a live run.
            if(cache||!options.client){
                await fs.mkdir(root,{recursive:true});
                const stored=await storeImageAsset(buffer,{root,minWidth:512,minHeight:512});
                meta.filePath=stored.filePath;meta.assetFile=path.basename(stored.filePath);
                const {filePath,...cached}=meta;try{await atomicImageJson(path.join(root,id+'.json'),cached);}catch{meta.cacheStored=false;imageDiagnostic({generationType:request.generationType||'shared',provider:'google',model,status:'cache-unavailable',reasonCode:'IMAGE_CACHE_STORAGE_FAILED',storage:'source-saved',validation:'passed'},options.logger);}
            }
            imageDiagnostic({generationType:request.generationType||'shared',provider:'gemini',model,resolution,aspectRatio,status:'resolved',cacheHit:false,storage:meta.filePath?'saved':'memory-test',validation:'passed',elapsedMs:performance.now()-started,estimatedImageOutputCostUsd:({'gemini-nano-banana-2.1':{'1K':.0336,'2K':.0504,'4K':.113},'gemini-3-pro-image':{'1K':.134,'2K':.134,'4K':.24}})[model]?.[resolution],usageAvailable:!!(result.usage||result.usageMetadata)},options.logger);
            return {...meta,buffer,cacheHit:false};
        }catch(error){const info=classifyImageError(error);imageDiagnostic({generationType:request.generationType||'shared',provider:'google',model,status:'failed',...info,elapsedMs:performance.now()-started},options.logger);throw Object.assign(failure(info.reasonCode,'Image provider could not return a validated asset'),info,{cause:error,headers:error.headers||error.response?.headers,details:error.error?.details||error.details});}
        finally{clearTimeout(timer);controller.abort();}
        },{concurrency,signal:queueSignal});
    },{signal:request.signal&&generationSignal()?AbortSignal.any([request.signal,generationSignal()]):request.signal||generationSignal()});
}
