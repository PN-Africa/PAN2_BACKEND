import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import {createGunzip,createInflate,createBrotliDecompress} from 'node:zlib';
import {measureStage,performanceRequestId} from '../performance.mjs';

export function isPublicAddress(value) {
    try {
        const address = ipaddr.parse(value);
        if (address.range() !== 'unicast') return false;
        if (address.kind() === 'ipv4' && address.match(ipaddr.parse('198.18.0.0'), 15)) return false;
        // IPv6 global unicast only, excluding transition/local/reserved ranges.
        if (address.kind() === 'ipv6' && !address.match(ipaddr.parse('2000::'), 3)) return false;
        if (address.kind() === 'ipv6' && address.match(ipaddr.parse('2001::'), 23)) return false;
        return true;
    } catch { return false; }
}
export function validatePublicUrl(value){
    let url;try{url=new URL(value);}catch{throw Object.assign(new Error('Use a valid public HTTP(S) URL'),{code:'INVALID_SOURCE_URL'});}
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error('Use a public HTTP(S) URL without credentials'), { code: 'INVALID_SOURCE_URL' });
    url.hash='';return url;
}
export async function resolvePublicUrl(value, lookup = dns.lookup) {
    const url = await measureStage('url-validation',()=>validatePublicUrl(value));
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await measureStage('url-dns',()=>lookup(hostname, { all: true, verbatim: true }));
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw Object.assign(new Error('Source URLs must resolve exclusively to public internet addresses'), { code: 'INVALID_SOURCE_URL' });
    url.hash = '';
    return { url, address: addresses.find(a=>a.family===4)||addresses[0],addresses };
}

// Resolve and pin the validated IP for each hop. Native fetch's separate DNS
// lookup would leave a rebinding window between validation and connection.
export async function fetchPublicResource(value,{lookup=dns.lookup,request:requestOverride,timeoutMs=20000,dnsTimeoutMs=3000,connectTimeoutMs=4000,headersTimeoutMs=6000,idleTimeoutMs=5000,maxBytes=2*1024*1024,signal,
 contentTypes=/^(text\/(html|plain)|application\/xhtml\+xml)(?:;|$)/i,accept='text/html,application/xhtml+xml,text/plain',userAgent=process.env.LEDIFY_SOURCE_USER_AGENT||'Ledify-SourceReader/2.0 (https://ledify-frontend.vercel.app/)',onDiagnostic=entry=>console.info('[URL_FETCH]',JSON.stringify(entry))}={}){
 for(const number of [timeoutMs,dnsTimeoutMs,connectTimeoutMs,headersTimeoutMs,idleTimeoutMs,maxBytes])if(!Number.isSafeInteger(number)||number<1)throw new Error('URL fetch budgets must be positive integers');
 const deadline=Date.now()+timeoutMs;
 const failure=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
 const timed=phase=>failure('SOURCE_URL_TIMEOUT','Source retrieval exceeded its time budget',{failurePhase:phase});
 const cancelled=()=>failure('SOURCE_URL_CANCELLED','Source retrieval was cancelled');
 const log=entry=>{try{onDiagnostic({requestId:performanceRequestId(),...entry});}catch{}};
 for(let hop=0;hop<=3;hop++){
  signal?.throwIfAborted();let timer,abort;
  const started=performance.now();
  const target=await Promise.race([resolvePublicUrl(value,lookup),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(timed('dns')),Math.max(1,Math.min(dnsTimeoutMs,deadline-Date.now())));
   abort=()=>reject(cancelled());signal?.addEventListener('abort',abort,{once:true});
  })]).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);});
  log({phase:'dns-validation',hop,status:'completed',elapsedMs:Math.round(performance.now()-started)});
  const remaining=deadline-Date.now();if(remaining<=0)throw timed('total');
  const {url,address}=target;
  const response=await new Promise((resolve,reject)=>{
   let req,res,decoder,settled=false,phase='connection',connectTimer,headersTimer,idleTimer,totalTimer;
   const at=performance.now();
   const clear=()=>{for(const t of [connectTimer,headersTimer,idleTimer,totalTimer])clearTimeout(t);signal?.removeEventListener('abort',onAbort);};
   const finish=(error,result)=>{if(settled)return;settled=true;clear();log({phase,hop,status:error?'failed':'completed',elapsedMs:Math.round(performance.now()-at),...(error?{errorCode:error.code||'SOURCE_NETWORK_ERROR'}:{})});if(error){reject(error);decoder?.destroy();res?.destroy?.();req?.destroy?.();}else{resolve(result);if(result?.redirect){res?.destroy?.();req?.destroy?.();}}};
   const onAbort=()=>finish(cancelled());
   const connected=()=>{clearTimeout(connectTimer);if(phase!=='connection')return;phase='headers';headersTimer=setTimeout(()=>finish(timed('headers')),Math.min(headersTimeoutMs,Math.max(1,deadline-Date.now())));};
   try{
    const request=requestOverride||(url.protocol==='https:'?https.request:http.request);
    req=request(url,{method:'GET',autoSelectFamily:false,agent:false,
     headers:{'User-Agent':userAgent,Accept:accept,'Accept-Encoding':'gzip, deflate, br'},
     lookup:(hostname,options,callback)=>callback(null,address.address,address.family)
    },incoming=>{
     if(settled){incoming.destroy?.();return;}res=incoming;clearTimeout(connectTimer);clearTimeout(headersTimer);
     log({phase:'response-headers',hop,status:'completed',httpStatus:res.statusCode,elapsedMs:Math.round(performance.now()-at)});
     res.once('error',error=>finish(error));res.once('aborted',()=>finish(failure('ECONNRESET','Source response was interrupted')));
     if([301,302,303,307,308].includes(res.statusCode)){res.resume?.();finish(null,{redirect:res.headers.location});res.destroy?.();return;}
     if(res.statusCode<200||res.statusCode>=300){finish(failure(res.statusCode===429?'SOURCE_URL_RATE_LIMITED':'SOURCE_HTTP_ERROR','Source returned an unsuccessful HTTP status',{status:res.statusCode,retryAfter:res.headers['retry-after']}));return;}
     contentTypes.lastIndex=0;if(!contentTypes.test(res.headers['content-type']||'')){finish(failure('INVALID_SOURCE_URL_CONTENT','Source returned an unsupported content type',{failurePhase:'content-type'}));return;}
     if(Number(res.headers['content-length'])>maxBytes){finish(failure('SOURCE_URL_TOO_LARGE','Source exceeds its download byte limit',{maxBytes}));return;}
     phase='body';const bodyStarted=performance.now();let bytes=0,wireBytes=0;const chunks=[];
     const idle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>finish(timed('body-idle')),Math.min(idleTimeoutMs,Math.max(1,deadline-Date.now())));};idle();
     const encoding=String(res.headers['content-encoding']||'identity').trim().toLowerCase();
     if(encoding!=='identity'){
      const create={gzip:createGunzip,deflate:createInflate,br:createBrotliDecompress}[encoding];
      if(!create||typeof res.pipe!=='function'){finish(failure('SOURCE_URL_ENCODING_ERROR','Unsupported source content encoding'));return;}
      decoder=create();decoder.once('error',()=>finish(failure('SOURCE_URL_ENCODING_ERROR','Source decompression failed')));
     }
     res.on('data',chunk=>{wireBytes+=chunk.length;idle();if(wireBytes>maxBytes)finish(failure('SOURCE_URL_TOO_LARGE','Source exceeds its wire-byte limit',{maxBytes}));});
     const body=decoder||res;
     body.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>maxBytes){finish(failure('SOURCE_URL_TOO_LARGE','Source exceeds its decoded-byte limit',{maxBytes}));return;}chunks.push(Buffer.from(chunk));});
     body.once('end',()=>{log({phase:'body-download',hop,status:'completed',elapsedMs:Math.round(performance.now()-bodyStarted),wireBytes,decodedBytes:bytes,encoding});finish(null,{buffer:Buffer.concat(chunks),contentType:res.headers['content-type'],finalUrl:url.href});});
     if(decoder)res.pipe(decoder);
    });
    connectTimer=setTimeout(()=>finish(timed('connection')),Math.min(connectTimeoutMs,remaining));
    totalTimer=setTimeout(()=>finish(timed(phase==='body'?'body-total':phase)),remaining);
    signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted){onAbort();return;}
    req.once('socket',socket=>{if(!socket.connecting){connected();return;}
     socket.once('connect',()=>log({phase:'tcp-connect',hop,status:'completed',elapsedMs:Math.round(performance.now()-at)}));
     socket.once(url.protocol==='https:'?'secureConnect':'connect',()=>{if(url.protocol==='https:')log({phase:'tls-connect',hop,status:'completed',elapsedMs:Math.round(performance.now()-at)});connected();});
    });
    req.on('error',error=>finish(error));req.end();
   }catch(error){finish(error);}
  });
  if(!Object.hasOwn(response,'redirect'))return response;
  if(!response.redirect||hop===3)throw failure('INVALID_SOURCE_URL','Source has too many or invalid redirects');
  try{value=new URL(response.redirect,url).href;}catch{throw failure('INVALID_SOURCE_URL','Invalid source redirect');}
 }
}
export async function fetchPublicText(value,options){
 const {buffer,contentType,finalUrl}=await fetchPublicResource(value,options);
 let encoding=contentType?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
 if(!encoding&&/html/i.test(contentType||''))encoding=buffer.subarray(0,4096).toString('ascii').match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1];
 let text;try{text=new TextDecoder(encoding||'utf-8').decode(buffer);}catch{throw Object.assign(new Error('Source character encoding is unsupported'),{code:'INVALID_SOURCE_URL_CONTENT'});}
 return {text,contentType,finalUrl};
}
