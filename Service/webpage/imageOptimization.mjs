import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {storageRoot} from '../storageRoot.mjs';

let processing=0;const waiting=[],pending=new Map();
const capacity=process.env.LEDIFY_WEBPAGE_IMAGE_WORKERS==='2'?2:1;
async function acquire(){
    if(processing<capacity){processing++;return;}
    if(waiting.length>=8)throw new Error('Image processing queue is full');
    await new Promise((resolve,reject)=>{
        const entry={resolve,reject};entry.timer=setTimeout(()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);reject(new Error('Image processing queue timed out'));},5000);waiting.push(entry);
    });
}
function release(){const next=waiting.shift();if(next){clearTimeout(next.timer);next.resolve();}else processing--;}

export async function optimizeWebsiteImage(buffer,{cacheRoot=process.env.LEDIFY_WEBPAGE_ASSET_CACHE || storageRoot('webpage-image-cache'),timeoutMs=12000}={}){
    if(!Buffer.isBuffer(buffer)||buffer.length>12*1024*1024)throw new Error('Invalid image byte budget');
    const root=path.resolve(cacheRoot),digest=createHash('sha256').update(buffer).digest('hex');
    // Share deterministic work, never mutable buffers or differing timeout policies.
    const key=JSON.stringify([root,digest,timeoutMs]);
    let task=pending.get(key);
    if(!task){
        task=optimizeImage(buffer,{cacheRoot:root,timeoutMs});pending.set(key,task);
    }
    try{
        const result=await task;
        return {...result,variants:result.variants.map(variant=>({...variant,buffer:Buffer.from(variant.buffer)}))};
    }finally{if(pending.get(key)===task)pending.delete(key);}
}

async function optimizeImage(buffer,{cacheRoot,timeoutMs}){
    const id=createHash('sha256').update('webp-v1').update(buffer).digest('hex').slice(0,24),root=path.resolve(cacheRoot),metadataPath=path.join(root,id+'.json');
    try{
        const metadata=JSON.parse(await fs.readFile(metadataPath,'utf8'));
        if(!Array.isArray(metadata)||metadata.length>3)throw new Error('Invalid cached image');
        const variants=[];
        for(const variant of metadata){
            if(!Number.isInteger(variant.width)||variant.width<100||variant.width>1600||!Number.isInteger(variant.height)||variant.height<1||variant.height>1600)throw new Error('Invalid cache dimensions');
            const bytes=await fs.readFile(path.join(root,`${id}-${variant.width}.webp`));
            if(bytes.length>1024*1024||bytes.toString('ascii',8,12)!=='WEBP')throw new Error('Invalid cached raster');
            variants.push({...variant,buffer:bytes});
        }
        if(variants.length)return {id,variants,cacheHit:true};
    }catch{}
    await acquire();
    try{
        const variants=await new Promise((resolve,reject)=>{
            const worker=fork(fileURLToPath(new URL('./imageOptimizationWorker.mjs',import.meta.url)),[],{execArgv:[],serialization:'advanced',windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
            let result,failure,settled=false;
            const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
            const timer=setTimeout(()=>{worker.kill();finish(new Error('Image processing timed out'));},timeoutMs);
            worker.on('message',message=>{if(message.error)failure=new Error(message.error);else result=message.variants;});
            worker.on('error',()=>finish(new Error('Image processing worker unavailable')));
            worker.on('exit',code=>finish(failure||code!==0||!result?.length?failure||new Error('Image processing failed'):null,result));
            worker.send({buffer},error=>{if(error)finish(new Error('Image processing worker unavailable'));});
        });
        await fs.mkdir(root,{recursive:true});
        for(const variant of variants)await fs.writeFile(path.join(root,`${id}-${variant.width}.webp`),variant.buffer);
        await fs.writeFile(metadataPath,JSON.stringify(variants.map(({width,height})=>({width,height}))));
        return {id,variants,cacheHit:false};
    }finally{release();}
}
