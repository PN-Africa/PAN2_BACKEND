// Sanitized reproduction of f0a3dc60's failure topology. Claude is mocked;
// HTTP handling and PPTX/PDF/PNG conversion/downloads are real.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import JSZip from 'jszip';
import {createApp} from '../src/app.mjs';
import {generateService} from '../Service/generateService.mjs';
import {fallbackAllocationFixture} from './fixtures/fallbackAllocation.mjs';
const root=path.resolve('generated/fallback-allocation/native');await fs.mkdir(root,{recursive:true});process.env.LEDIFY_PRESENTATION_ROOT=path.join(root,'previews');
const f=await fallbackAllocationFixture(),records=[];
const app=createApp({deliveryLogger:()=>{},model:{create:async value=>({...value,save:async function(){records.push(this.status);}})},generator:(kind,input,type)=>generateService(kind,input,type,f.context,{ai:{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}},visuals:{userAssets:f.assets,external:false,diagramPlanner:false,providers:{search:async()=>null},cacheRoot:path.join(root,'assets')},preview:{outputDirectory:process.env.LEDIFY_PRESENTATION_ROOT},performance:{stageLogger:()=>{},logger:()=>{}}})});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
try{
 const origin='http://127.0.0.1:'+server.address().port,start=performance.now(),response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:f.prompt,outputType:'presentation'})}),body=await response.json();assert.equal(response.status,201,JSON.stringify(body));
 const result=body.data.result;assert.notEqual(result.status,'incomplete');assert.equal(records.at(-1),'completed');assert.equal(result.generatedContent.slides.length,10);assert.equal(result.preview.slides.length,10);assert.equal(result.generatedContent.quality.reviewed,true);assert.deepEqual(f.fallbacks.slice().sort((a,b)=>a-b),[3,5,7]);
 const downloads=[];for(const url of [result.preview.downloads.pptx,result.preview.downloads.pdf,...result.preview.slides.map(s=>s.url)]){
  const res=await fetch(origin+url),buffer=Buffer.from(await res.arrayBuffer());assert.equal(res.status,200);assert.ok(buffer.length>100);downloads.push({url,bytes:buffer.length});
  if(url===result.preview.downloads.pptx){const zip=await JSZip.loadAsync(buffer);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,10);for(const n of [3,5,7])assert.ok((await zip.file('ppt/slides/slide'+n+'.xml').async('string')).includes('Infrastructure supports delivery'));assert.ok((await zip.file('ppt/slides/slide1.xml').async('string')).includes('<p:pic>'));}
 }
 const report={httpStatus:response.status,status:result.status,databaseStatus:records.at(-1),slides:10,previews:10,downloads,elapsedMs:performance.now()-start,outlineCalls:f.outlines,qualityReviews:f.reviews.length,fieldRepairCalls:f.patches.length,fallbacks:f.fallbacks,repairHistory:result.generatedContent.quality.repairHistory,budget:result.generatedContent.slideRecovery.budget,liveProviders:false};await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
