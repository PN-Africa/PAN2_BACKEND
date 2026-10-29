import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
import {imagePolicy,generationBudget} from './imagePolicy.mjs';
import {imageBrief} from './imageArtDirection.mjs';
import {PHOTO_FRAMES} from '../../renderer/presentation/photoCompositions.mjs';
import {imageSpecificationSchema} from '../../templates/presentation/visualSchemas.mjs';
import {validateSchema} from '../ai/responseValidation.mjs';
import {storeImageAsset,atomicImageJson,classifyImageError,imageBackoff,imageDiagnostic,validateImageBytes,withImageCapacity} from './imageAssetService.mjs';
import {evaluateImageRelevance,relevanceDiagnostic} from './imageRelevance.mjs';
import {bindImageAsset,assertImageBinding} from './assetBinding.mjs';
import {performanceRequestId,measureStage,generationSignal} from '../performance.mjs';
import {acquireRacingImage} from './imageRaceProviders.mjs';

export async function normalizePhoto(asset,brief,root,policy,{persist=true,reframeRequestId}={}){
    if(!asset?.source||!asset.creator||!asset.license||(asset.attributionRequired&&!asset.attribution))throw new Error('Incomplete image usage rights or provenance');
    if(!Buffer.isBuffer(asset.buffer)||asset.buffer.length>12*1024*1024)throw new Error('Image exceeds byte limit');
    if(reframeRequestId)assertImageBinding(asset,{requestId:reframeRequestId,target:brief,bytes:asset.buffer});
    const input=sharp(asset.buffer,{limitInputPixels:32000000,failOn:'error'}),meta=await input.metadata();
    if(!['jpeg','png','webp'].includes(meta.format)||meta.pages>1||!reframeRequestId&&(meta.width<800||meta.height<600))throw new Error('Unsupported, animated or insufficient-resolution image');
    const oriented=await input.rotate().flatten({background:'#'+String(brief.palette?.background||'FFFFFF').replace('#','')}).toBuffer(),dimensionsIn=await sharp(oriented).metadata();
    const sourceStats=await sharp(oriented).stats();
    if(sourceStats.channels.every(c=>c.stdev<2))throw new Error('Image is blank or visually uniform');
    const frame=PHOTO_FRAMES[brief.composition]||PHOTO_FRAMES['photo-editorial'],ratio=frame.w/frame.h;
    const cropW=Math.floor(Math.min(dimensionsIn.width,dimensionsIn.height*ratio)),cropH=Math.floor(cropW/ratio);
    const coordinate=v=>Number.isFinite(Number(v))?Math.max(0,Math.min(1,Number(v))):.5;
    const left=Math.round(Math.max(0,Math.min(dimensionsIn.width-cropW,coordinate(brief.focalPoint?.x)*dimensionsIn.width-cropW/2)));
    const top=Math.round(Math.max(0,Math.min(dimensionsIn.height-cropH,coordinate(brief.focalPoint?.y)*dimensionsIn.height-cropH/2)));
    if(cropW/frame.w<90||cropH/frame.h<90)throw new Error('Source resolution is insufficient after the requested crop');
    const buffer=await sharp(oriented).extract({left,top,width:cropW,height:cropH}).resize({width:2400,height:1800,fit:'inside',withoutEnlargement:true}).jpeg({quality:policy.quality,mozjpeg:true}).toBuffer();
    const dimensions=await sharp(buffer).metadata(),id=createHash('sha256').update(buffer).digest('hex');
    const stored=persist?await storeImageAsset(buffer,{root}):{},filePath=stored.filePath;
    const {buffer:unused,...metadata}=asset;
    return {...metadata,id,sourceChecksum:createHash('sha256').update(asset.buffer).digest('hex'),filePath,data:'image/jpeg;base64,'+buffer.toString('base64'),kind:'photo',role:'foreground',status:'resolved',
        sourceType:asset.sourceType||(asset.generationMethod==='ai-generated'?'ai-generated':'licensed-stock'),
        width:dimensions.width,height:dimensions.height,format:'jpeg',bytes:buffer.length,sourceDimensions:{width:meta.width,height:meta.height},
        altText:asset.generationMethod==='licensed-search'?(asset.description||brief.altText||brief.description):(brief.altText||brief.description),slideNumber:brief.slideNumber,visualPurpose:brief.purpose,imageDescription:brief.description,
        artDirection:brief,crop:{mode:'cover',focalPoint:brief.focalPoint,sourceRect:{left,top,width:cropW,height:cropH},targetAspectRatio:ratio},
        changes:'Resized, metadata stripped and JPEG compressed by Ledify; cropped to the slide frame.',
        synthetic:asset.generationMethod==='ai-generated',disclosure:asset.generationMethod==='ai-generated'?brief.syntheticDisclosure:undefined};
}

// One deck-scoped session: global provider concurrency, generation budget and duplicate detection.
export function createImageAssetSession({providers={},policy=imagePolicy(),root,external=true,userAssets=[],onDiagnostic}){
    const budget=generationBudget(policy),diagnostics=[],used=new Set(),usedSources=new Set(),disabled=new Set(),requestId=performanceRequestId()||randomUUID();let active=0;const waiting=[];
    const deadline=Date.now()+(policy.deadlineMs||45000);
    const record=entry=>{diagnostics.push(entry);onDiagnostic?.(entry);imageDiagnostic({generationType:'presentation',provider:entry.method||'planner',...entry});};
    const limited=async fn=>{if(active>=policy.concurrency)await new Promise(r=>waiting.push(r));else active++;try{return await fn();}finally{const next=waiting.shift();if(next)next();else active--;}};
    let selected=0,cancelled=false;const controllers=new Set();
    return {diagnostics,budget,requestId,
        cancel(){cancelled=true;for(const controller of controllers)controller.abort();},
        async reframe(asset,presentation,slide,theme,context){
            if(cancelled)return null;
            const brief=imageBrief(presentation,slide,theme,context);
            // Reuse only the exact verified image owned by this request/slot.
            // Context binding excludes composition but checks subject and query.
            assertImageBinding(asset,{requestId,target:brief});
            return limited(()=>measureStage('presentation-image-reframe',async()=>{
                const buffer=Buffer.from(asset.data.split('base64,')[1],'base64');
                // This is an already validated crop, not a new low-resolution
                // source. The target's 90 effective PPI floor still applies.
                const reframed=await normalizePhoto({...asset,buffer},brief,root,policy,{reframeRequestId:requestId});
                if(reframed.id!==asset.id&&used.has(reframed.id))throw new Error('Duplicate image in presentation');
                used.add(reframed.id);
                record({slideNumber:slide.slideNumber,method:'reframe',status:'resolved',storage:'saved',validation:'passed'});
                return bindImageAsset({...reframed,reframedFrom:asset.id},brief,requestId);
            }));
        },
        async resolve(presentation,slide,theme,context,directOverride){
            if(cancelled||!policy.enabled||selected>=policy.maxImages){record({slideNumber:slide.slideNumber,status:'skipped',reasonCode:cancelled?'CANCELLED':!policy.enabled?'IMAGES_DISABLED':'IMAGE_LIMIT_REACHED'});return null;}selected++;
            const brief=imageBrief(presentation,slide,theme,context);
            validateSchema(brief,imageSpecificationSchema,'imageSpecification',false);
            if(directOverride){brief.description=directOverride.description;brief.altText=directOverride.description;brief.composition=directOverride.composition||brief.composition;}
            if(cancelled||Date.now()>=deadline){record({slideNumber:slide.slideNumber,status:'skipped',reasonCode:cancelled?'CANCELLED':'DECK_DEADLINE_REACHED',reason:cancelled?'Deck image acquisition cancelled':'Deck image deadline reached'});return null;}
            const direct=directOverride||userAssets.find(a=>a.slideNumber===slide.slideNumber);
            if(!direct&&external&&providers.raceProviders){
                return limited(async()=>{
                    const controller=new AbortController();controllers.add(controller);let reservation;
                    try{
                        const signal=generationSignal()?AbortSignal.any([controller.signal,generationSignal()]):controller.signal;
                        const candidate=await acquireRacingImage(providers.raceProviders,{...brief,generationType:'presentation',requestId,signal},{reserveGeneration:()=>budget.reserve(),timeoutMs:Math.min(policy.timeoutMs,Math.max(1,deadline-Date.now())),logger:providers.raceLogger,validate:async(asset,provider,{signal})=>{
                            const sourceKey=createHash('sha256').update(asset.buffer).digest('hex');if(usedSources.has(sourceKey))throw Object.assign(new Error('Duplicate image'),{code:'IMAGE_DUPLICATE'});
                            const prepared=await withImageCapacity('race-photo-processing',()=>normalizePhoto(asset,brief,root,policy,{persist:false}),{concurrency:2,signal});if(used.has(prepared.id))throw Object.assign(new Error('Duplicate image'),{code:'IMAGE_DUPLICATE'});asset.racePrepared=prepared;
                            return true;
                        }});
                        if(!candidate)return null;
                        const asset=candidate.racePrepared,sourceKey=asset.sourceChecksum;
                        if(usedSources.has(sourceKey)||used.has(asset.id))return null;usedSources.add(sourceKey);reservation=sourceKey;used.add(asset.id);
                        const bytes=Buffer.from(asset.data.split('base64,')[1],'base64'),stored=await storeImageAsset(bytes,{root});
                        record({slideNumber:slide.slideNumber,method:candidate.raceWinner,status:'resolved',storage:'saved',validation:'passed'});
                        return bindImageAsset({...asset,filePath:stored.filePath,raceWinner:candidate.raceWinner},brief,requestId);
                    }catch(error){if(reservation)usedSources.delete(reservation);record({slideNumber:slide.slideNumber,method:'race',status:'failed',...classifyImageError(error)});return null;}
                    finally{controller.abort();controllers.delete(controller);}
                });
            }
            const preference=brief.authenticPhotoOnly?['search']:brief.conceptImage?['generate','search']:['search','generate'];
            const methods=direct?['user',...(external?preference:[])]:external?preference:[];
            if(!methods.some(method=>method==='user'||providers[method]))record({slideNumber:slide.slideNumber,status:'skipped',reasonCode:brief.authenticPhotoOnly?'AUTHENTIC_PHOTO_PROVIDER_UNAVAILABLE':'IMAGE_PROVIDER_UNAVAILABLE'});
            for(const method of methods){
                if(method!=='user'&&!providers[method]){if(method==='generate')record({slideNumber:slide.slideNumber,method,status:'skipped',reasonCode:policy.generationStatus||'IMAGE_PROVIDER_UNAVAILABLE'});continue;}
                // Exact scientific diagrams may never be replaced by synthetic pictures.
                if(method==='generate'&&(brief.kind==='diagram'||/precise anatomy|histolog|diagnostic (?:scan|image)|radiograph/i.test(brief.description)))continue;
                const identity=method==='user'?direct.assetId||'user':(providers.identity||'injected-provider')+(method==='search'?':licensed-search-v3':'');
                const cacheKey=createHash('sha256').update(JSON.stringify({version:4,brief,identity,method,quality:policy.quality})).digest('hex');
                const cachePath=path.join(root,cacheKey+'.json');
                if(method!=='user')try{
                    const meta=JSON.parse(await fs.readFile(cachePath,'utf8'));
                    if(meta.cacheKey!==cacheKey||!/^([a-f0-9]{64})$/.test(meta.id||''))throw new Error('Photograph cache context mismatch');
                    if(method==='search'&&(!evaluateImageRelevance(meta,brief).accepted||providers.validateSearchAsset&&!providers.validateSearchAsset(brief,meta)))throw new Error('Cached photograph does not match the requested subject');
                    if(brief.authenticPhotoOnly&&(meta.generationMethod==='ai-generated'||meta.synthetic||meta.mediaKind&&meta.mediaKind!=='photograph'))throw new Error('Cached asset is not an authentic photograph');
                    if(Date.now()-meta.cachedAt<policy.cacheDays*86400000){
                        const filePath=path.join(root,meta.id+'.jpeg'),buffer=await fs.readFile(filePath);
                        if(createHash('sha256').update(buffer).digest('hex')!==meta.id)throw new Error('Cache checksum failed');
                        await validateImageBytes(buffer);
                        if(!usedSources.has(meta.sourceChecksum)&&!used.has(meta.id)){used.add(meta.id);usedSources.add(meta.sourceChecksum);record({slideNumber:slide.slideNumber,method,status:'resolved',cacheHit:true,model:meta.model});return bindImageAsset({...meta,filePath,data:'image/jpeg;base64,'+buffer.toString('base64'),cacheHit:true},brief,requestId);}
                    }
                }catch{}
                for(let attempt=0;attempt<=(method==='search'?Math.min(1,policy.retries):policy.retries);attempt++){
                    if(cancelled||Date.now()>=deadline)break;
                    // A slot covers one attempt, not a slide's entire retry
                    // chain. Failed attempts rejoin behind waiting slides.
                    const outcome=await limited(async()=>{
                        if(disabled.has(method))return {stop:true};
                        if(cancelled||Date.now()>=deadline){record({slideNumber:slide.slideNumber,status:'skipped',reasonCode:cancelled?'CANCELLED':'DECK_DEADLINE_REACHED',reason:cancelled?'Deck image acquisition cancelled':'Deck image deadline reached'});return {stop:true};}
                            if(deadline-Date.now()<Math.min(1000,policy.timeoutMs/10)){record({slideNumber:slide.slideNumber,method,status:'skipped',reasonCode:'INSUFFICIENT_IMAGE_TIME'});return {stop:true};}
                        if(method==='generate'&&deadline-Date.now()<Math.min(10000,policy.timeoutMs/2)){record({slideNumber:slide.slideNumber,method,status:'skipped',reasonCode:'INSUFFICIENT_GENERATION_TIME'});return {stop:true};}
                        if(method==='generate'&&!budget.reserve()){record({slideNumber:slide.slideNumber,method,status:'skipped',reasonCode:'GENERATION_BUDGET_UNAVAILABLE'});return {stop:true};}
                        // One search attempt already includes alternate queries and
                        // candidates. Do not repeat that entire budget on timeout,
                        // including when only authentic photographs are allowed.
                        const searchTimeout=policy.stockSearchTimeoutMs||12000;
                        const attemptTimeout=method==='search'?Math.min(policy.timeoutMs,searchTimeout):policy.timeoutMs;
                        const controller=new AbortController(),started=Date.now();let timer,reservation;
                        controllers.add(controller);
                        try{
                            const candidate=method==='user'?direct:await Promise.race([
                                providers[method]({...brief,attempt,...(method==='search'?{maxSearchQueries:1}:{}),excludeAssetIds:[...used],excludeSourceChecksums:[...usedSources],signal:controller.signal,resolution:policy.resolution}),
                                new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Image provider timed out'));},Math.min(attemptTimeout,Math.max(1,deadline-Date.now())));})]);
                            if(!candidate){record({slideNumber:slide.slideNumber,method,status:'empty',reasonCode:'NO_ELIGIBLE_IMAGE',attempt:attempt+1});return {stop:true};}
                            if(brief.authenticPhotoOnly&&(candidate.generationMethod==='ai-generated'||candidate.synthetic||candidate.mediaKind&&candidate.mediaKind!=='photograph'))throw new Error('Authentic photography required; synthetic or non-photographic asset rejected');
                            if(method==='search'){
                                const review=evaluateImageRelevance(candidate,brief);relevanceDiagnostic(candidate,brief,review);
                                if(!review.accepted)throw Object.assign(new Error('Image metadata does not match the requested subject'),{code:'IMAGE_RELEVANCE_REJECTED'});
                            }
                            const sourceKey=Buffer.isBuffer(candidate.buffer)?createHash('sha256').update(candidate.buffer).digest('hex'):'';
                            if(usedSources.has(sourceKey))throw new Error('Duplicate image in presentation');
                            usedSources.add(sourceKey);reservation=sourceKey;
                            const asset=bindImageAsset(await measureStage('presentation-image-processing',()=>normalizePhoto(candidate,brief,root,policy)),brief,requestId);
                            if(used.has(asset.id))throw new Error('Duplicate image in presentation');
                            used.add(asset.id);usedSources.add(asset.sourceChecksum);
                            if(method!=='user'){const {data,filePath,binding,...meta}=asset;try{await atomicImageJson(cachePath,{...meta,cacheKey,cachedAt:Date.now()});}catch{record({slideNumber:slide.slideNumber,method,status:'cache-unavailable',reasonCode:'IMAGE_CACHE_STORAGE_FAILED'});}}
                            record({slideNumber:slide.slideNumber,method,status:'resolved',attempt:attempt+1,model:asset.model,storage:'saved',validation:'passed',elapsedMs:Date.now()-started});return {asset};
                        }catch(error){if(reservation)usedSources.delete(reservation);const info=classifyImageError(error);if(['IMAGE_INVALID_CREDENTIALS','IMAGE_ACCESS_DENIED','IMAGE_MODEL_UNAVAILABLE','IMAGE_REQUEST_REJECTED','IMAGE_BILLING_UNAVAILABLE'].includes(info.reasonCode))disabled.add(method);record({slideNumber:slide.slideNumber,method,status:'failed',attempt:attempt+1,...info,elapsedMs:Date.now()-started});return {stop:!info.retryable||error.code==='PHOTO_PROVIDER_RATE_LIMITED'||method==='search'&&info.reasonCode==='PROVIDER_TIMEOUT',retryError:error};}
                        finally{clearTimeout(timer);controller.abort();controllers.delete(controller);}
                    });
                    if(outcome.asset)return outcome.asset;
                    if(outcome.stop)break;
                    if(attempt<policy.retries&&!await imageBackoff(outcome.retryError,attempt,{remainingMs:deadline-Date.now()}))break;
                }
            }
            return null;
        }
    };
}
