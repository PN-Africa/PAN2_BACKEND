// Read-only public-source audit. No AI calls and no source text in reports.
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {urlService} from '../Service/urlService.mjs';
import {fetchPublicText} from '../Service/input/publicUrl.mjs';
const mode=process.argv[2]||'after',start=performance.now(),requests=[];let downloadedAt;
const request=(url,options,callback)=>{
 const at=performance.now(),entry={method:url.pathname.startsWith('/w/rest.php/')?'wikipedia-api':'html',bytes:0};requests.push(entry);
 const req=(url.protocol==='https:'?https:http).request(url,options,res=>{
  entry.headersMs=Math.round(performance.now()-at);res.on('data',chunk=>entry.bytes+=chunk.length);res.once('end',()=>entry.downloadMs=Math.round(performance.now()-at));callback(res);
 });
 req.once('socket',socket=>{socket.once('connect',()=>entry.tcpMs=Math.round(performance.now()-at));socket.once('secureConnect',()=>entry.tlsMs=Math.round(performance.now()-at));});return req;
};
let dnsMs=0;const lookup=async(...args)=>{const at=performance.now();try{return await dns.lookup(...args);}finally{dnsMs+=performance.now()-at;}};
const fetchText=async(url,options)=>{const result=await fetchPublicText(url,{...options,lookup,request});downloadedAt=performance.now();return result;};
let report;
try{const content=await urlService('https://en.wikipedia.org/wiki/Artificial_intelligence',{fetchText,wikipedia:true});report={status:'passed',characters:content.length};}
catch(error){report={status:'failed',errorCode:error.code,failurePhase:error.failurePhase};}
report={mode,...report,totalMs:Math.round(performance.now()-start),dnsMs:Math.round(dnsMs),postDownloadMs:downloadedAt?Math.round(performance.now()-downloadedAt):undefined,requests};
await fs.mkdir('generated',{recursive:true});await fs.writeFile(`generated/url-extraction-${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
