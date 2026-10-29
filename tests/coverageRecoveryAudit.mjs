// Reproduces the coverage -> targeted -> clarity -> fallback sequence using
// mocked Claude transport, with real HTTP and native export validation.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import JSZip from 'jszip';
import {createApp} from '../src/app.mjs';
import {generateService} from '../Service/generateService.mjs';
import {coverageRecoveryFixture,recoveredSolarBody} from './fixtures/coverageRecovery.mjs';
const root=path.resolve('generated/coverage-recovery/native');await fs.mkdir(root,{recursive:true});process.env.LEDIFY_PRESENTATION_ROOT=path.join(root,'previews');
const f=await coverageRecoveryFixture(),records=[],photoCalls=[];
const providers={identity:'controlled-coverage-audit-'+Date.now(),search:async brief=>{photoCalls.push(brief.slideNumber);const photo=f.assets.find(a=>a.slideNumber===brief.slideNumber);assert.ok(photo);return {...photo,description:brief.description+' '+brief.searchQuery};}};
const app=createApp({deliveryLogger:()=>{},model:{create:async value=>({...value,save:async function(){records.push({status:this.status,outcome:this.outcome});}})},generator:(kind,input,type)=>generateService(kind,input,type,f.context,{ai:{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}},visuals:{external:true,diagramPlanner:false,providers,cacheRoot:path.join(root,'assets')},preview:{outputDirectory:process.env.LEDIFY_PRESENTATION_ROOT},performance:{stageLogger:()=>{},logger:()=>{}}})});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
try{
 const origin='http://127.0.0.1:'+server.address().port,start=performance.now(),response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:f.prompt,outputType:'presentation'})}),body=await response.json();
 assert.equal(response.status,201,JSON.stringify(body));const result=body.data.result;assert.notEqual(result.status,'incomplete');assert.equal(records.at(-1).status,'completed');
 assert.equal(result.generatedContent.slides.length,10);assert.equal(result.preview.slides.length,10);assert.equal(result.generatedContent.quality.reviewed,true);assert.equal(result.generatedContent.slides[5].content.textContent.body,recoveredSolarBody);
 assert.ok(result.generatedContent.slides[5].photoAsset,'The supporting image must remain embedded');assert.equal(result.generatedContent.slides[5].photoComposition,'photo-technical');
 assert.deepEqual(photoCalls.slice().sort((a,b)=>a-b),[1,6]);assert.ok(result.generatedContent.slides[5].photoAsset.reframedFrom);
 const downloads=[];for(const url of [result.preview.downloads.pptx,result.preview.downloads.pdf,...result.preview.slides.map(s=>s.url)]){
  const res=await fetch(origin+url),buffer=Buffer.from(await res.arrayBuffer());assert.equal(res.status,200);assert.ok(buffer.length>100);downloads.push({url,bytes:buffer.length});
  if(url===result.preview.downloads.pptx){const zip=await JSZip.loadAsync(buffer);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,10);const xml=await zip.file('ppt/slides/slide6.xml').async('string');assert.ok(xml.includes('Solar cells convert sunlight'));assert.ok(xml.includes('supporting systems are distinct'));assert.ok(xml.includes('<p:pic>'));}
 }
 const report={httpStatus:response.status,status:result.status,slides:10,previews:10,downloads,elapsedMs:performance.now()-start,reviewCalls:f.reviews.length,fallbacks:f.fallbacks,repairedSlides:result.generatedContent.quality.repairHistory,budget:result.generatedContent.slideRecovery.budget,photoCalls,supportingPhotoPreserved:true,prefetchedPhotoReframed:true,liveProviders:false};await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
