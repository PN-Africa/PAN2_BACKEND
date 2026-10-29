import {fetchPublicText,validatePublicUrl} from './publicUrl.mjs';
import {extractRetrievedContent,sourceError} from './urlContent.mjs';
import {withinUrlBudget,urlSettings} from './urlBudget.mjs';
import {measureStage,performanceRequestId} from '../performance.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const restricted=new Set(['SOURCE_URL_AUTH_REQUIRED','SOURCE_URL_PAYWALL','SOURCE_URL_ACCESS_DENIED','INVALID_SOURCE_URL','SOURCE_URL_TOO_LARGE','SOURCE_URL_TEXT_TOO_LARGE','SOURCE_URL_CANCELLED']);
const publicCache=new Map();
const copySource=source=>({...source,headings:[...source.headings],references:source.references.map(ref=>({...ref})),warnings:[...source.warnings]});
export function wikipediaSource(value){
 const url=validatePublicUrl(value);
 if(!/^[a-z][a-z0-9-]{0,20}\.wikipedia\.org$/.test(url.hostname)||url.port||url.search||!url.pathname.startsWith('/wiki/'))return null;
 let title;try{title=decodeURIComponent(url.pathname.slice(6));}catch{return null;}
 if(!title||title.includes(':'))return null;
 return {title:title.replace(/_/g,' '),url:`${url.origin}/w/rest.php/v1/page/${encodeURIComponent(title)}/html`};
}
export const transientSourceError=error=>[408,429,500,502,503,504].includes(error.status)||['SOURCE_URL_TIMEOUT','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','EPIPE'].includes(error.code);
export async function retrieveUrlSource(value,options={}){
 const settings=urlSettings(options.env),deadline=Math.min(options.deadline||Infinity,Date.now()+settings.retrievalMs),fetchText=options.fetchText||fetchPublicText;
 const httpDeadline=options.webFetch?deadline-Math.min(settings.webFetchMs,Math.floor((deadline-Date.now())/2)):deadline;
 const url=(await measureStage('url-validation',()=>validatePublicUrl(value))).href;
 const wiki=(options.wikipedia??!options.fetchText)?wikipediaSource(url):null;
 const cacheSeconds=Number((options.env||process.env).URL_PUBLIC_CACHE_SECONDS||0);
 if(!Number.isInteger(cacheSeconds)||cacheSeconds<0||cacheSeconds>300)throw sourceError('URL_SOURCE_CONFIGURATION_ERROR','URL_PUBLIC_CACHE_SECONDS must be an integer from 0 to 300.');
 if(wiki&&cacheSeconds){const cached=publicCache.get(url);if(cached&&Date.now()-cached.at<cacheSeconds*1000){const source=copySource(cached.source);source.warnings.push('PUBLIC_SOURCE_CACHE_HIT');return source;}}
 const plans=wiki?[{method:'source-api',url:wiki.url,ms:settings.apiMs},{method:'direct-http',url,ms:settings.directMs}]:[{method:'direct-http',url,ms:settings.directMs}];
 let last;
 for(const plan of plans){
  for(let attempt=0;attempt<2;attempt++){
   const end=Math.min(httpDeadline,Date.now()+plan.ms);if(end<=Date.now())break;
   try{
    const response=await measureStage(plan.method==='source-api'?'url-source-api':'url-direct-fetch',()=>withinUrlBudget(end,plan.method,signal=>fetchText(plan.url,{maxBytes:options.maxBytes||10*1024*1024,timeoutMs:Math.max(1,end-Date.now()),signal}),options.signal));
    // API path is a representation of the requested article, not a new source.
    let canonical=response.finalUrl||url;
    if(wiki&&plan.method==='source-api'){
     const api=new URL(response.finalUrl||wiki.url),requested=new URL(url),match=api.pathname.match(/^\/w\/rest\.php\/v1\/page\/(.+)\/html$/);
     if(api.origin!==requested.origin||!match)throw sourceError('INVALID_SOURCE_URL','The article API redirected outside its source representation.');
     canonical=api.origin+'/wiki/'+encodeURIComponent(decodeURIComponent(match[1]).replace(/ /g,'_')).replace(/%2F/gi,'/');
    }
    const source=await extractRetrievedContent({...response,finalUrl:canonical},url,plan.method);
    if(source.text.length<(options.minCharacters||0))throw sourceError('SOURCE_CONTENT_INSUFFICIENT','The source contains insufficient readable text.');
    if(wiki&&cacheSeconds){if(publicCache.size>=8)publicCache.delete(publicCache.keys().next().value);publicCache.set(url,{at:Date.now(),source:copySource(source)});}
    return source;
   }catch(error){
    last=error;const status=Number(error.status);
    console.info('[URL_RETRIEVAL]',JSON.stringify({requestId:performanceRequestId(),method:plan.method,attempt:attempt+1,status:'failed',errorCode:error.code||'SOURCE_NETWORK_ERROR',...(status?{providerStatus:status}:{}),failurePhase:error.failurePhase}));
    if(restricted.has(error.code)||error.failurePhase==='content-type'||[401,402,403].includes(status))throw error;
    if(wiki&&[429,503].includes(status)&&error.retryAfter)throw error;
    // A missing API route may fall back to the same article HTML. A missing
    // ordinary page is permanent; never replace it with another page.
    if(!transientSourceError(error)||attempt||wiki)break;
    const header=error.retryAfter;let wait=header?(/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:Date.parse(header)-Date.now()):150+Math.floor((options.random||Math.random)()*100);
    wait=Math.max(0,Number.isFinite(wait)?wait:250);if(wait>1000||Date.now()+wait+100>=httpDeadline)throw error;
    await (options.sleep||((ms,signal)=>delay(ms,undefined,{signal})))(wait,options.signal);
   }
  }
 }
 if(options.webFetch&&!restricted.has(last?.code)&&![401,402,403,404,410,429].includes(last?.status)&&Date.now()<deadline){
  const end=Math.min(deadline,Date.now()+settings.webFetchMs);
  const response=await measureStage('url-claude-web-fetch',()=>withinUrlBudget(end,'claude-web-fetch',signal=>options.webFetch(url,{signal,timeoutMs:Math.max(1,end-Date.now())}),options.signal));
  return extractRetrievedContent(response,url,'claude-web-fetch');
 }
 throw last||sourceError('SOURCE_URL_TIMEOUT','URL retrieval exhausted its time budget.');
}
