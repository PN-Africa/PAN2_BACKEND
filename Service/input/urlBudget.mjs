import {sourceError} from './urlContent.mjs';
import {AiGenerationError} from '../ai/responseValidation.mjs';
import {performanceRequestId} from '../performance.mjs';
export function urlSourceByteLimit(env=process.env){const n=Number(env.LEDIFY_URL_MAX_MB||10);if(!Number.isInteger(n)||n<1||n>20)throw sourceError('URL_SOURCE_CONFIGURATION_ERROR','LEDIFY_URL_MAX_MB must be an integer from 1 to 20.');return n*1024*1024;}
export function urlSettings(env=process.env){
 const number=(key,fallback,max=120000)=>{const n=Number(env[key]||fallback);if(!Number.isInteger(n)||n<100||n>max)throw sourceError('URL_SOURCE_CONFIGURATION_ERROR',`${key} must be an integer from 100 to ${max}.`);return n;};
 return {totalMs:number('URL_EXTRACTION_TOTAL_MS',35000),retrievalMs:number('URL_RETRIEVAL_MS',12000),directMs:number('URL_DIRECT_MS',8000),apiMs:number('URL_SOURCE_API_MS',8000),webFetchMs:number('URL_WEB_FETCH_MS',8000),understandingMs:number('URL_UNDERSTANDING_MS',30000)};
}
export async function withinUrlBudget(deadline,phase,invoke,parentSignal,errors={}){
 const timeout=errors.timeout||(()=>sourceError('SOURCE_URL_TIMEOUT','URL extraction time budget was exhausted.',{failurePhase:phase}));
 const cancelled=errors.cancelled||(()=>sourceError('SOURCE_URL_CANCELLED','URL extraction was cancelled.'));
 const remaining=deadline-Date.now();if(remaining<=0)throw timeout();
 const controller=new AbortController();let timer,abort;
 try{return await Promise.race([Promise.resolve().then(()=>invoke(controller.signal)),new Promise((_,reject)=>{
  const cancel=error=>{controller.abort(error);reject(error);};
  timer=setTimeout(()=>cancel(timeout()),remaining);
  abort=()=>cancel(cancelled());parentSignal?.addEventListener('abort',abort,{once:true});if(parentSignal?.aborted)abort();
 })]);}finally{clearTimeout(timer);parentSignal?.removeEventListener('abort',abort);controller.abort();}
}
export function withinUnderstandingBudget(deadline,invoke,parentSignal,model){
 const details={stage:'url-content-understanding',requestId:performanceRequestId(),model};
 return withinUrlBudget(deadline,'understanding',invoke,parentSignal,{timeout:()=>new AiGenerationError('AI_PROVIDER_TIMEOUT','AI content understanding exceeded its available time budget.',{...details,providerReason:'PROVIDER_TIMEOUT'}),cancelled:()=>new AiGenerationError('AI_REQUEST_CANCELLED','AI content understanding was cancelled.',{...details,providerReason:'REQUEST_CANCELLED'})});
}
