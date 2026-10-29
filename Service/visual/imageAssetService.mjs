import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
import {performanceReport} from '../performance.mjs';
import {storageRoot} from '../storageRoot.mjs';

const pools=new Map(),saving=new Map(),shared=new Map();
// Shared provider work deduplicates I/O, never caller-owned mutable results.
export function cloneSharedAsset(value,seen=new Map()){
    if(Buffer.isBuffer(value))return Buffer.from(value);
    if(!value||typeof value!=='object')return value;
    if(seen.has(value))return seen.get(value);
    const result=Array.isArray(value)?[]:{};seen.set(value,result);
    for(const [key,child] of Object.entries(value))result[key]=cloneSharedAsset(child,seen);
    return result;
}
async function replaceFile(temp,file){for(let attempt=0;;attempt++){try{await fs.rename(temp,file);return;}catch(error){if(attempt>=10||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await new Promise(r=>setTimeout(r,Math.min(250,10*2**attempt)));}}}
export const imageError=(code,message)=>Object.assign(new Error(message),{code,stage:'image-generation'});
export function shareImageWork(key,invoke,{signal}={}) {
    if(signal?.aborted)return Promise.reject(imageError('IMAGE_CANCELLED','Image request was cancelled'));
    let entry=shared.get(key);
    if(!entry||entry.controller.signal.aborted){
        entry={controller:new AbortController(),consumers:0,settled:false};shared.set(key,entry);
        entry.promise=Promise.resolve().then(()=>invoke(entry.controller.signal)).finally(()=>{entry.settled=true;if(shared.get(key)===entry)shared.delete(key);});
        entry.promise.catch(()=>{});
    }
    entry.consumers++;
    return new Promise((resolve,reject)=>{
        let released=false;
        const release=()=>{if(released)return;released=true;signal?.removeEventListener('abort',abort);if(--entry.consumers===0&&!entry.settled)entry.controller.abort();};
        const abort=()=>{release();reject(imageError('IMAGE_CANCELLED','Image request was cancelled'));};
        signal?.addEventListener('abort',abort,{once:true});
        entry.promise.then(value=>{if(!released){release();try{resolve(cloneSharedAsset(value));}catch(error){reject(error);}}},error=>{if(!released){release();reject(error);}});
    });
}
export function classifyImageError(error={}) {
    const status=Number(error.providerStatus||error.status||error.statusCode||error.error?.code),code=String(error.code||''),message=String(error.message||'');
    let reasonCode=code;
    if(status===402||status===429&&/billing (?:is )?(?:disabled|not enabled)|insufficient (?:credits|balance)|payment required|daily quota (?:exceeded|exhausted)|limit\s*[:=]\s*0\b/i.test(message))reasonCode='IMAGE_BILLING_UNAVAILABLE';
    else if(error.imageOperation==='download'&&[401,403,404,410].includes(status))reasonCode='IMAGE_DOWNLOAD_UNAVAILABLE';
    else if(status===401||/API_KEY_INVALID|API key not valid|API key expired/i.test(message))reasonCode='IMAGE_INVALID_CREDENTIALS';
    else if(status===403)reasonCode='IMAGE_ACCESS_DENIED';
    else if(status===404)reasonCode='IMAGE_MODEL_UNAVAILABLE';
    else if(status===429||/RATE_LIMITED/.test(code))reasonCode='PROVIDER_RATE_LIMITED';
    else if([408,500,502,503,504].includes(status))reasonCode='PROVIDER_UNAVAILABLE';
    else if(status===400)reasonCode='IMAGE_REQUEST_REJECTED';
    else if(/timeout|timed out|abort/i.test(code+' '+error.name+' '+message))reasonCode='PROVIDER_TIMEOUT';
    else if(/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(code+' '+message+' '+error.cause?.code))reasonCode='PROVIDER_NETWORK_ERROR';
    else if(/authentic photography/i.test(message))reasonCode='AUTHENTIC_PHOTO_REQUIRED';
    else if(!/^(?:IMAGE_|PROVIDER_|PHOTO_)/.test(code))reasonCode='IMAGE_PROVIDER_OR_VALIDATION_FAILED';
    return {reasonCode,retryable:['PROVIDER_RATE_LIMITED','PROVIDER_TIMEOUT','PROVIDER_NETWORK_ERROR','PROVIDER_UNAVAILABLE'].includes(reasonCode),...(status>=400&&status<=599?{providerStatus:status}:{})};
}
export function imageRetryDelay(error,attempt,{random=Math.random}={}) {
    const headers=error?.headers||error?.response?.headers;
    const hint=headers?.get?.('retry-after')??headers?.['retry-after'];
    const detail=(error?.error?.details||error?.details||[]).find?.(d=>typeof d.retryDelay==='string')?.retryDelay;
    const minimum=hint!=null?(/^\d+(?:\.\d+)?$/.test(String(hint))?Number(hint)*1000:Date.parse(hint)-Date.now()):detail&&/^\d+(?:\.\d+)?s$/.test(detail)?parseFloat(detail)*1000:0;
    return Math.min(60000,Math.max(Number.isFinite(minimum)?minimum:0,Math.min(4000,250*2**attempt)+Math.floor(random()*200)));
}
export async function imageBackoff(error,attempt,{signal,remainingMs=Infinity,sleep}={}) {
    const delay=imageRetryDelay(error,attempt);if(delay>=remainingMs||signal?.aborted)return false;
    if(sleep){await sleep(delay);return !signal?.aborted;}
    await new Promise(resolve=>{
        let timer;const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};
        timer=setTimeout(finish,delay);signal?.addEventListener('abort',finish,{once:true});
    });return !signal?.aborted;
}
export function imageDiagnostic(entry,logger=value=>console.info('[IMAGE_ASSET]',JSON.stringify(value))) {
    const safe={requestId:performanceReport()?.requestId||entry.requestId||randomUUID(),...Object.fromEntries(Object.entries(entry).filter(([key])=>['generationType','provider','model','slideNumber','target','status','attempt','retryCount','reasonCode','providerStatus','elapsedMs','storage','validation','cacheHit','requested','succeeded','failed','requiredMissing','requirementId','searchRounds','candidateCount','resolution','aspectRatio','estimatedImageOutputCostUsd','usageAvailable'].includes(key)))};
    logger(safe);return safe;
}
export async function validateImageBytes(buffer,{minWidth=100,minHeight=100,requireVariance=false}={}) {
    if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>12*1024*1024)throw imageError('IMAGE_INVALID','Invalid image byte budget');
    try{
        const metadata=await sharp(buffer,{limitInputPixels:32_000_000,failOn:'error'}).metadata();
        if(!['jpeg','png','webp'].includes(metadata.format)||metadata.pages>1||metadata.width<minWidth||metadata.height<minHeight)throw new Error('Invalid format/dimensions');
        if(requireVariance){
            const stats=await sharp(buffer,{limitInputPixels:32_000_000,failOn:'error'}).stats();
            if(!stats.channels.slice(0,3).some(channel=>channel.stdev>1))throw new Error('Blank generated image');
        }else{
            // Decode to verify the raster, without computing unused per-pixel
            // statistics for every responsive size and cache/export read.
            await sharp(buffer,{limitInputPixels:32_000_000,failOn:'error'}).resize(1,1).raw().toBuffer();
        }
        return metadata;
    }catch{throw imageError('IMAGE_INVALID','Image data could not be decoded and validated');}
}
export async function atomicImageJson(file,value) {
    const temp=file+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temp,JSON.stringify(value));await replaceFile(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}
}
export async function storeImageAsset(buffer,{root=process.env.LEDIFY_IMAGE_ASSET_ROOT||storageRoot('image-sources'),...validation}={}) {
    const metadata=await validateImageBytes(buffer,validation),id=createHash('sha256').update(buffer).digest('hex');
    const filePath=path.join(path.resolve(root),id+'.'+metadata.format),key=filePath;
    if(saving.has(key))return saving.get(key);
    const task=(async()=>{
        await fs.mkdir(path.dirname(filePath),{recursive:true});
        let valid=false;try{valid=createHash('sha256').update(await fs.readFile(filePath)).digest('hex')===id;}catch{}
        if(!valid){const temp=filePath+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,buffer);await replaceFile(temp,filePath);}finally{await fs.unlink(temp).catch(()=>{});}}
        return {id,sha256:id,filePath,mimeType:`image/${metadata.format}`,format:metadata.format,width:metadata.width,height:metadata.height,bytes:buffer.length};
    })();saving.set(key,task);
    try{return await task;}catch{throw imageError('IMAGE_STORAGE_FAILED','Validated image could not be saved');}finally{saving.delete(key);}
}
export async function withImageCapacity(provider,invoke,{concurrency=2,signal}={}) {
    const pool=pools.get(provider)||{active:0,waiting:[]};pools.set(provider,pool);
    if(signal?.aborted)throw imageError('PROVIDER_TIMEOUT','Image request was cancelled');
    if(pool.active>=concurrency){
        if(pool.waiting.length>=32)throw imageError('IMAGE_CAPACITY_BUSY','Image queue capacity is occupied');
        await new Promise((resolve,reject)=>{
            const entry={resolve:()=>{signal?.removeEventListener('abort',abort);resolve();}};
            const abort=()=>{const i=pool.waiting.indexOf(entry);if(i<0)return;pool.waiting.splice(i,1);reject(imageError('PROVIDER_TIMEOUT','Image request expired while queued'));};
            pool.waiting.push(entry);signal?.addEventListener('abort',abort,{once:true});
        });
    }else pool.active++;
    try{signal?.throwIfAborted();return await invoke();}finally{const next=pool.waiting.shift();if(next)next.resolve();else pool.active--;}
}
