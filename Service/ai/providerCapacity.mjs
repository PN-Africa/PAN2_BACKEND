// All models share a bounded call budget; cooldowns are scoped by model.
import {abortable,abortReason} from './cancellation.mjs';
export function createAiCapacity({limit=6,maxWaiting=32,waitMs=90000,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!Number.isInteger(limit)||limit<1||limit>12||!Number.isInteger(maxWaiting)||maxWaiting<1||!Number.isFinite(waitMs)||waitMs<1)throw new Error('Invalid AI capacity configuration');
 let active=0;const waiting=[],cooldowns=new Map();
 const busy=()=>Object.assign(new Error('AI request capacity is occupied'),{code:'AI_PROVIDER_BUSY'});
 const release=()=>{const next=waiting.shift();if(next){clearTimeout(next.timer);next.cleanup?.();next.resolve();}else active--;};
 async function acquire(signal){
  if(signal?.aborted)throw abortReason(signal);
  if(active<limit){active++;return;}
  if(waiting.length>=maxWaiting)throw busy();
  await new Promise((resolve,reject)=>{let entry;const cancel=()=>{const index=waiting.indexOf(entry);if(index<0)return;waiting.splice(index,1);clearTimeout(entry.timer);entry.cleanup();reject(signal?.aborted?abortReason(signal):busy());};entry={resolve,timer:setTimeout(cancel,waitMs),cleanup:()=>signal?.removeEventListener('abort',cancel)};waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});
 }
 return {stats:()=>({active,queued:waiting.length,limit}),defer(error,scope=''){
  const status=Number(error.status||error.statusCode||error.providerStatus);if(![429,503,529].includes(status))return;
  const headers=error.headers||error.response?.headers,value=headers?.get?.('retry-after')??headers?.['retry-after'];
  const retryInfo=(error.details||error.error?.details||[]).find?.(detail=>typeof detail.retryDelay==='string')?.retryDelay;
  const hint=value==null?(retryInfo&&/^\d+(?:\.\d+)?s$/.test(retryInfo)?parseFloat(retryInfo)*1000:1000):/^\d+(?:\.\d+)?$/.test(String(value))?Number(value)*1000:Date.parse(value)-now();
  const delay=Math.min(300000,Math.max(1000,Number.isFinite(hint)?hint:1000));
  cooldowns.set(scope,Math.max(cooldowns.get(scope)||0,now()+delay));
 },async run(invoke,scope='',signal){
  const deadline=now()+waitMs;
  for(;;){
   if(signal?.aborted)throw abortReason(signal);
   const delay=(cooldowns.get(scope)||0)-now();if(delay>0){if(now()+delay>=deadline)throw busy();await abortable(()=>sleep(delay),signal);}
   await acquire(signal);
   if((cooldowns.get(scope)||0)>now()){release();continue;}
   try{return await abortable(invoke,signal);}finally{release();}
  }
 }};
}
const parsed=Number(process.env.LEDIFY_AI_CONCURRENCY);
const limit=Number.isInteger(parsed)&&parsed>0?Math.min(12,parsed):6;
const capacity=createAiCapacity({limit});
export const withAiCapacity=(invoke,{scope='',signal}={})=>capacity.run(invoke,scope,signal);
export const noteAiRateLimit=(error,scope)=>capacity.defer(error,scope);
