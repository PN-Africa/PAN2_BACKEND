import {AsyncLocalStorage} from 'node:async_hooks';
import {measureStage,generationSignal} from './performance.mjs';

export function createGenerationCapacity({concurrency=2,maxWaiting=32,waitMs=600000}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4||!Number.isInteger(maxWaiting)||maxWaiting<1||maxWaiting>128||!Number.isFinite(waitMs)||waitMs<1)throw new Error('Invalid generation capacity configuration');
 let active=0;const waiting=[];
 const busy=()=>Object.assign(new Error('Generation capacity is occupied. Retry shortly or use asynchronous admission.'),{code:'GENERATION_CAPACITY_BUSY',stage:'generation-admission'});
 const releaseOnce=()=>{let released=false;return ()=>{if(released)return;released=true;const next=waiting.shift();if(next){clearTimeout(next.timer);next.cleanup?.();next.resolve(releaseOnce());}else active--;};};
 return {stats:()=>({active,queued:waiting.length,concurrency,maxWaiting}),async acquire({signal}={}){
  if(signal?.aborted)throw signal.reason||busy();
  if(active<concurrency){active++;return releaseOnce();}
  if(waiting.length>=maxWaiting)throw busy();
  return new Promise((resolve,reject)=>{
   const entry={resolve};
   const cancel=()=>{const index=waiting.indexOf(entry);if(index<0)return;waiting.splice(index,1);clearTimeout(entry.timer);entry.cleanup();reject(signal?.aborted?signal.reason||busy():busy());};
   entry.cleanup=()=>signal?.removeEventListener('abort',cancel);
   entry.timer=setTimeout(cancel,waitMs);signal?.addEventListener('abort',cancel,{once:true});waiting.push(entry);
  });
 }};
}
const bounded=(value,fallback,min,max)=>Number.isInteger(Number(value))&&value!==''?Math.max(min,Math.min(max,Number(value))):fallback;
export const generationConcurrencySettings=(env=process.env)=>({concurrency:bounded(env.LEDIFY_GENERATION_CONCURRENCY,2,1,4),maxWaiting:bounded(env.LEDIFY_GENERATION_MAX_WAITING,32,1,128),waitMs:bounded(env.LEDIFY_GENERATION_WAIT_MS,600000,1000,1800000)});
export const generationCapacity=createGenerationCapacity(generationConcurrencySettings());
const admitted=new AsyncLocalStorage();
// Direct calls, synchronous HTTP and jobs share admission. Nested layers reuse
// their slot rather than waiting for themselves and deadlocking.
export async function withGenerationCapacity(invoke){
 if(admitted.getStore())return invoke();
 let release;
 try{await measureStage('generation-queue',async()=>{release=await generationCapacity.acquire({signal:generationSignal()});});return await admitted.run(true,invoke);}finally{release?.();}
}
