import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fetchPublicResource} from '../input/publicUrl.mjs';
import {storageRoot} from '../storageRoot.mjs';
import {measureStage} from '../performance.mjs';
import {reviewGeneratedImage} from './generatedImageReview.mjs';
import {atomicImageJson,storeImageAsset,validateImageBytes,withImageCapacity,shareImageWork,imageDiagnostic} from './imageAssetService.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message,extra={})=>Object.assign(new Error(message),{code,stage:'image-generation',...extra});
export function imageGenerationSettings(env=process.env){
 const provider=env.AI_IMAGE_PROVIDER||'disabled',model=env.AI_IMAGE_MODEL||'';
 if(provider==='disabled')return {provider,ready:false,reason:'disabled'};
 if(provider==='gemini')return {provider,model:model||env.GOOGLE_IMAGE_MODEL||'gemini-nano-banana-2.1',ready:env.AI_IMAGE_PROVIDER_APPROVED==='true'&&!!env.GEMINI_API_KEY,reason:env.AI_IMAGE_PROVIDER_APPROVED!=='true'?'approval-required':!env.GEMINI_API_KEY?'credentials-required':'configured'};
 if(provider==='google-rollback')return {provider,model:env.GOOGLE_IMAGE_MODEL||'',ready:env.AI_ALLOW_GOOGLE_ROLLBACK==='true'&&env.AI_IMAGE_PROVIDER_APPROVED==='true'&&!!env.GEMINI_API_KEY&&!!env.GOOGLE_IMAGE_MODEL,reason:'explicit-rollback-only'};
 if(provider!=='bfl')return {provider,model,ready:false,reason:'unsupported-provider'};
 return {provider,model,ready:env.AI_IMAGE_PROVIDER_APPROVED==='true'&&!!env.AI_IMAGE_API_KEY&&model==='flux-2-pro',reason:env.AI_IMAGE_PROVIDER_APPROVED!=='true'?'approval-required':!env.AI_IMAGE_API_KEY?'credentials-required':model!=='flux-2-pro'?'model-not-approved':'configured'};
}
// Published standard image-output estimates, 2026-10-28; not a billing quote.
// Never let a premium model silently reserve the cheaper model's unit amount.
export function imageGenerationEstimate(env=process.env,resolution='1K',configured=env.AI_IMAGE_ESTIMATED_UNIT_COST){
 const settings=imageGenerationSettings(env),amount=Math.max(0,Number(configured)||0);
 const floor=({'gemini-nano-banana-2.1':{'1K':.0336,'2K':.0504,'4K':.113},'gemini-3-pro-image':{'1K':.134,'2K':.134,'4K':.24}})[settings.model]?.[resolution]||0;
 return settings.provider==='gemini'?Math.max(amount,floor):amount;
}
export function imageDimensionsForRatio(ratio='16:9'){
 const [w,h]=String(ratio).split(':').map(Number);if(!w||!h||w/h<.4||w/h>2.6)throw fail('IMAGE_BRIEF_INVALID','Unsupported image aspect ratio');
 const scale=Math.sqrt(1800000/(w*h));return {width:Math.floor(w*scale/16)*16,height:Math.floor(h*scale/16)*16};
}
function pollingUrl(value){
 const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||!/^api(?:\.[a-z0-9-]+)?\.bfl\.ai$/.test(url.hostname)||url.pathname!=='/v1/get_result')throw fail('IMAGE_RESULT_URL_INVALID','The image provider returned an unsupported polling endpoint.');return url.href;
}
async function responseJson(response){
 if(!response.ok)throw fail('IMAGE_PROVIDER_HTTP_ERROR','The dedicated image provider rejected the request.',{status:response.status,headers:response.headers});
 let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw fail('IMAGE_PROVIDER_RESPONSE_INVALID','Image provider response exceeded its budget.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function generateImage(request,options={}){
 const env=options.env||process.env,settings=imageGenerationSettings(env);
 if(!settings.ready)throw fail('IMAGE_NOT_CONFIGURED','Configure an approved dedicated image provider, model and separate image API key.');
 if(['gemini','google-rollback'].includes(settings.provider)){const {generateGoogleImage}=await import('./googleImageService.mjs');return generateGoogleImage(request,{...options,model:settings.model});}
 const {model}=settings,prompt=String(request.prompt||'').trim();if(!prompt||prompt.length>12000)throw fail('IMAGE_BRIEF_INVALID','Image prompt must be nonempty and within its budget.');
 const dimensions=imageDimensionsForRatio(request.aspectRatio),id=hash(JSON.stringify({version:2,provider:'bfl',model,account:hash(env.AI_IMAGE_API_KEY),prompt,dimensions,semanticReview:env.AI_IMAGE_SEMANTIC_REVIEW==='true',reviewModel:env.CLAUDE_MODEL||'claude-opus-5-5'}));
 const root=path.resolve(options.cacheRoot||env.AI_IMAGE_CACHE_DIR||storageRoot('dedicated-image-cache'));await fs.mkdir(root,{recursive:true});
 try{const meta=JSON.parse(await fs.readFile(path.join(root,id+'.json'),'utf8'));if(meta.requestHash!==id||!/^[a-f0-9]{64}\.(png|jpeg|webp)$/.test(meta.assetFile)||Date.now()-meta.createdAt>7*86400000)throw new Error('Invalid cache');const buffer=await fs.readFile(path.join(root,meta.assetFile));if(hash(buffer)!==meta.sha256)throw new Error('Checksum mismatch');await validateImageBytes(buffer);return {...meta,buffer,cacheHit:true};}catch{}
 return shareImageWork('bfl:'+root+':'+id,signal=>withImageCapacity('dedicated-image',async()=>{
  const timeoutMs=options.timeoutMs||60000,controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();const timer=setTimeout(abort,timeoutMs),started=performance.now();let submitted=false;
  const fetcher=options.fetch||fetch,sleep=options.sleep||(ms=>new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){controller.signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);reject(fail('PROVIDER_TIMEOUT','Image request deadline exceeded.'));}if(controller.signal.aborted)cancel();else controller.signal.addEventListener('abort',cancel,{once:true});}));
  try{
   let task;try{const saved=JSON.parse(await fs.readFile(path.join(root,id+'.task.json'),'utf8'));if(saved.requestHash===id&&Date.now()-saved.createdAt<10*60000)task=saved;}catch{}
   if(!task){
    // Persist uncertainty BEFORE the paid POST: a lost response must never
    // trigger another automatic purchase for the same attempt.
    task={requestHash:id,createdAt:Date.now(),submissionUnconfirmed:true};
    await atomicImageJson(path.join(root,id+'.task.json'),task);submitted=true;
    const post=await fetcher('https://api.bfl.ai/v1/'+model,{method:'POST',headers:{'Content-Type':'application/json','x-key':env.AI_IMAGE_API_KEY},body:JSON.stringify({prompt,...dimensions,output_format:'png',disable_pup:true}),signal:controller.signal,redirect:'error'});
    // A confirmed non-success response has no accepted task; preserve its
    // actionable auth/rate-limit status. A missing response remains uncertain.
    if(!post.ok){await fs.unlink(path.join(root,id+'.task.json')).catch(()=>{});submitted=false;}
    const receipt=await responseJson(post);
    task={requestHash:id,polling_url:pollingUrl(receipt.polling_url),createdAt:task.createdAt};await atomicImageJson(path.join(root,id+'.task.json'),task);
   }
   submitted=true;if(!task.polling_url)throw fail('IMAGE_RESULT_UNAVAILABLE','The paid submission has no confirmed receipt. Review provider billing before retrying.');
   const poll=pollingUrl(task.polling_url);let result;
   for(let attempt=0;attempt<120;attempt++){
    result=await responseJson(await fetcher(poll,{signal:controller.signal,redirect:'error'}));
    if(result.status==='Ready')break;
    if(['Error','Failed','Request Moderated','Content Moderated'].includes(result.status))throw fail('IMAGE_REQUEST_REJECTED','The image task failed or was moderated.');
    await sleep(500);
   }
   if(result?.status!=='Ready'||!result.result?.sample)throw fail('IMAGE_RESULT_UNAVAILABLE','The submitted image task has no confirmed result.');
   const download=options.download||fetchPublicResource;
   const {buffer}=await measureStage('image-download',()=>download(result.result.sample,{signal:controller.signal,maxBytes:12*1024*1024,timeoutMs,contentTypes:/^image\/(png|jpeg|webp)(?:;|$)/i,accept:'image/png,image/jpeg,image/webp'}));
   const metadata=await validateImageBytes(buffer,{requireVariance:true});
   const semanticReview=await reviewGeneratedImage({buffer,mimeType:'image/'+metadata.format,prompt,signal:controller.signal},{env,client:options.textClient,logger:options.logger});
   const stored=await storeImageAsset(buffer,{root}),meta={provider:'bfl',model,requestHash:id,sha256:hash(buffer),assetFile:path.basename(stored.filePath),createdAt:Date.now(),width:metadata.width,height:metadata.height,mimeType:'image/'+metadata.format,semanticReview};await atomicImageJson(path.join(root,id+'.json'),meta);await fs.unlink(path.join(root,id+'.task.json')).catch(()=>{});
   imageDiagnostic({generationType:request.generationType,provider:'bfl',model,status:'resolved',elapsedMs:performance.now()-started,storage:'saved',validation:'passed'});return {...meta,buffer,cacheHit:false};
  }catch(error){if(submitted&&!['IMAGE_REQUEST_REJECTED','IMAGE_SEMANTIC_REJECTED'].includes(error.code))throw fail('IMAGE_RESULT_UNAVAILABLE','A task was submitted but its image was not confirmed. Its saved task can be resumed without automatic paid resubmission.');throw error;}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
 },{concurrency:1,signal}),{signal:request.signal});
}
