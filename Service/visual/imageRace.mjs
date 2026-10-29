import {randomUUID} from 'node:crypto';
import {performanceRequestId} from '../performance.mjs';

// Start every contender in the same microtask turn. A fulfilled acquisition is
// not a winner until its asynchronous validation also succeeds.
export async function raceImages(providers,requirement,{validate,signal=requirement.signal,timeoutMs=30000,logger=entry=>console.info('[IMAGE_RACE]',JSON.stringify(entry)),cleanup=async()=>{}}={}){
 const dispose=cleanup,disposed=new WeakSet();cleanup=async(asset,provider)=>{if(!asset||typeof asset!=='object'||disposed.has(asset))return;disposed.add(asset);await dispose(asset,provider);};
 const started=performance.now(),raceId=randomUUID(),requestId=performanceRequestId()||requirement.requestId||raceId;
 let settled=false,pending=providers.length,firstImageMs,winner;
 const controllers=providers.map(()=>new AbortController()),timers=new Set(),finished=new Set();
 const log=(provider,entry)=>{try{logger({requestId,raceId,outputType:requirement.generationType||requirement.outputType,requirementId:requirement.requirementId,slideNumber:requirement.slideNumber,sectionId:requirement.sectionId,provider,...entry});}catch{}};
 let resolveRace;const result=new Promise(resolve=>{resolveRace=resolve;});
 const end=(reason)=>{if(settled)return;settled=true;for(const timer of timers)clearTimeout(timer);signal?.removeEventListener('abort',abort);for(const [i,c] of controllers.entries())if(providers[i].id!==winner){c.abort();if(!finished.has(i))log(providers[i].id,{status:'cancelled',reason,totalMs:performance.now()-started,mayStillBeBilled:['generation','vision-stock'].includes(providers[i].kind)});}resolveRace(null);};
 const abort=()=>end('REQUEST_CANCELLED');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return result;}
 if(!pending){end('NO_PROVIDERS');return result;}
 for(const [i,provider] of providers.entries()){
  Promise.resolve().then(async()=>{
   if(settled||controllers[i].signal.aborted){finished.add(i);pending--;return;}
   const requestStarted=performance.now();let asset,responseMs,validationMs=0,validationStartedAt,timer;
   controllers[i].signal.addEventListener('abort',()=>{if(asset)Promise.resolve(cleanup(asset,provider)).catch(()=>{});},{once:true});
   log(provider.id,{status:'started',requestStartTime:new Date().toISOString(),startOffsetMs:requestStarted-started,mayStillBeBilled:['generation','vision-stock'].includes(provider.kind)});
   try{
    const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controllers[i].abort();reject(Object.assign(new Error('Image race contender expired'),{code:'PROVIDER_TIMEOUT'}));},Math.max(1,timeoutMs));timers.add(timer);});
    const work=Promise.resolve().then(async()=>{
     controllers[i].signal.throwIfAborted();
     asset=await provider.acquire({...requirement,signal:controllers[i].signal});responseMs=performance.now()-requestStarted;
     if(!asset)throw Object.assign(new Error('Empty image response'),{code:'NO_ELIGIBLE_IMAGE'});
     asset={...asset};
     asset={...asset};
     firstImageMs??=performance.now()-started;
     if(controllers[i].signal.aborted)throw Object.assign(new Error('Cancelled'),{code:'IMAGE_RACE_CANCELLED'});
     const validationStarted=performance.now();validationStartedAt=validationStarted;
     try{if(await validate(asset,provider,{signal:controllers[i].signal})===false)throw Object.assign(new Error('Candidate rejected'),{code:'IMAGE_VALIDATION_REJECTED'});}finally{validationMs=performance.now()-validationStarted;}
     return asset;
    });
    // An ignored abort may complete later. Dispose its private temporary output,
    // never remove content-addressed shared caches or the selected asset.
    work.then(late=>{if(controllers[i].signal.aborted&&late)Promise.resolve(cleanup(late,provider)).catch(()=>{});},()=>{if(controllers[i].signal.aborted&&asset)Promise.resolve(cleanup(asset,provider)).catch(()=>{});});
    asset=await Promise.race([work,expired]);
    if(!asset)throw Object.assign(new Error('Empty image response'),{code:'NO_ELIGIBLE_IMAGE'});
    firstImageMs??=performance.now()-started;
    if(settled){await cleanup(asset,provider);log(provider.id,{status:'discarded',responseMs,validationMs,totalMs:performance.now()-started,winningProvider:winner});return;}
    settled=true;winner=provider.id;finished.add(i);signal?.removeEventListener('abort',abort);for(const timer of timers)clearTimeout(timer);
    const totalMs=performance.now()-started;
    log(provider.id,{status:'winner',responseMs,validationMs,timeToFirstImageMs:firstImageMs,timeToFirstValidImageMs:totalMs,totalSelectionMs:totalMs,winningProvider:winner});
    for(const [j,c] of controllers.entries())if(j!==i){c.abort();if(!finished.has(j))log(providers[j].id,{status:'cancelled',reason:'VALID_WINNER_SELECTED',totalMs,winningProvider:winner,mayStillBeBilled:['generation','vision-stock'].includes(providers[j].kind)});}
    resolveRace({...asset,raceWinner:winner});
   }catch(error){if(asset)await Promise.resolve(cleanup(asset,provider)).catch(()=>{});log(provider.id,{status:settled?'discarded':'rejected',reason:/^[A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:'IMAGE_PROVIDER_FAILED',responseMs:responseMs??performance.now()-requestStarted,validationMs:validationMs|| (validationStartedAt?performance.now()-validationStartedAt:0),totalMs:performance.now()-started,winningProvider:winner});}
   finally{clearTimeout(timer);timers.delete(timer);finished.add(i);if(--pending===0&&!settled)end('ALL_PROVIDERS_FAILED');}
  }).catch(()=>{if(--pending===0&&!settled)end('ALL_PROVIDERS_FAILED');});
 }
 return result;
}
