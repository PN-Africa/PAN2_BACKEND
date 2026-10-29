// Controlled Claude transport + local images; real HTTP, PPTX, PDF and PNGs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import JSZip from 'jszip';
import {createApp} from '../src/app.mjs';
import {generateService} from '../Service/generateService.mjs';
import {tenSlideFixture} from './fixtures/tenSlideClaude.mjs';
import {anthropicFixture} from './fixtures/anthropicTransport.mjs';
const root=path.resolve('generated/reference-warning-recovery/native');await fs.mkdir(root,{recursive:true});
process.env.LEDIFY_PRESENTATION_ROOT=path.join(root,'previews');
const fixture=await tenSlideFixture(0,0),logs=[],records=[];
const mock=anthropicFixture(({schema,prompt})=>{
 if(schema.properties.slides)return {...fixture.deck,requirements:[],slides:fixture.deck.slides.map(({content,...slide})=>slide)};
 if(schema.properties.coverage)return {coverage:[],issues:[{slideNumber:2,code:'REFERENCE',severity:'warning',message:'An optional reference requires external verification.',repairInstruction:'Verify references externally before use; no concrete citation defect was identified.',repairTarget:'content.textContent.body'}]};
 const n=Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1]);assert.ok(n,'Unexpected request');return fixture.deck.slides[n-1].content;
});
const app=createApp({deliveryLogger:()=>{},model:{create:async value=>({...value,save:async function(){records.push({status:this.status,outcome:this.outcome});}})},generator:(kind,input,type)=>generateService(kind,input,type,fixture.context,{ai:{client:mock.client,logger:e=>logs.push(e),qualityLogger:()=>{},sleep:async()=>{}},visuals:{userAssets:fixture.assets,external:false,diagramPlanner:false,providers:{search:async()=>null},cacheRoot:path.join(root,'assets')},preview:{outputDirectory:process.env.LEDIFY_PRESENTATION_ROOT},performance:{stageLogger:()=>{},logger:()=>{}}})});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
try{
 const origin='http://127.0.0.1:'+server.address().port,start=performance.now();
 const response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:fixture.prompt,outputType:'presentation'})}),body=await response.json();
 assert.equal(response.status,201,JSON.stringify(body));const result=body.data.result;
 assert.equal(result.status,'completed_with_warnings');assert.equal(records.at(-1).status,'completed');assert.equal(records.at(-1).outcome.state,result.status);assert.equal(result.generatedContent.quality.status,'completed_with_warnings');
 assert.equal(result.generatedContent.slides.length,10);assert.equal(result.preview.slides.length,10);assert.deepEqual(result.generatedContent.quality.repairHistory,[]);
 assert.ok(result.warnings.some(w=>w.code==='CONTENT_REFERENCE'));const downloads=[];
 for(const url of [result.preview.downloads.pptx,result.preview.downloads.pdf,...result.preview.slides.map(s=>s.url)]){
  const res=await fetch(origin+url),buffer=Buffer.from(await res.arrayBuffer());assert.equal(res.status,200);assert.ok(buffer.length>100);downloads.push({url,bytes:buffer.length});
  if(url===result.preview.downloads.pptx){const zip=await JSZip.loadAsync(buffer);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,10);assert.ok(Object.keys(zip.files).some(n=>/^ppt\/media\/.+\.(jpg|png|jpeg)$/.test(n)));}
 }
 const report={httpStatus:response.status,status:result.status,databaseStatus:records.at(-1),slides:10,previews:10,downloads,elapsedMs:performance.now()-start,aiCalls:mock.calls.length,reviewCalls:logs.filter(e=>e.stage==='presentation-quality-review'&&e.status==='completed').length,repairHistory:result.generatedContent.quality.repairHistory,liveProviders:false};
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
