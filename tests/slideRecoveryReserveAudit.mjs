// Deterministic Claude transport and controlled cover bytes; real HTTP/native
// exports. This does not call paid providers or produce a clinically reviewed deck.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import JSZip from 'jszip';
import {createApp} from '../src/app.mjs';
import {generateService} from '../Service/generateService.mjs';
import {hypertensionPrompt} from './fixtures/hypertensionRecovery.mjs';
import {failingFixture} from './fixtures/slideFallback.mjs';
const root=path.resolve('generated/slide-recovery-reserve/native');await fs.mkdir(root,{recursive:true});
process.env.LEDIFY_PRESENTATION_ROOT=path.join(root,'previews');
const fixture=failingFixture(),logs=[],records=[];
const relationshipLabels=['Peripheral vascular resistance','Cardiovascular response pathways','Arterial elasticity mechanisms','Circulating blood volume'];
const relationshipEdges=['affects blood flow','changes the response','supports circulation','influences pressure'];
fixture.deck.slides[4]={...fixture.deck.slides[4],slideType:'relationship',title:'Interrelated systems',content:{relationship:{nodes:relationshipLabels.map((label,i)=>({id:'n'+i,label,description:'Related factor'})),relationships:relationshipEdges.map((label,i)=>({from:'n'+i,to:'n'+((i+1)%4),label}))}}};
const cover={slideNumber:1,buffer:await fs.readFile('assets/webpage/curated/medical-mri.jpg'),description:'Controlled healthcare image fixture',source:'Controlled native-render fixture',creator:'Regression fixture',license:'Test fixture'};
const app=createApp({deliveryLogger:()=>{},model:{create:async value=>{const record={...value,save:async()=>{records.push(record.status);}};return record;}},generator:(kind,input,type)=>generateService(kind,input,type,fixture.context,{ai:{client:fixture.mock.client,logger:e=>logs.push(e),qualityLogger:()=>{},layoutLogger:()=>{},sleep:async()=>{}},visuals:{userAssets:[cover],external:false,diagramPlanner:false,providers:{search:async()=>null},cacheRoot:path.join(root,'assets')},preview:{outputDirectory:process.env.LEDIFY_PRESENTATION_ROOT},performance:{stageLogger:()=>{},logger:()=>{}}})});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
try{
 const origin='http://127.0.0.1:'+server.address().port,start=performance.now();
 const response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:hypertensionPrompt,outputType:'presentation'})});
 const body=await response.json();assert.equal(response.status,201,JSON.stringify(body));const result=body.data.result;assert.equal(result.status,'completed');assert.equal(records.at(-1),'completed');assert.equal(result.generatedContent.slides.length,12);assert.equal(result.preview.slides.length,12);assert.equal(result.generatedContent.quality.reviewed,true);
 assert.deepEqual(result.generatedContent.slideRecovery.slides.map(s=>s.slideNumber).sort((a,b)=>a-b),[8,11]);const downloads=[];for(const url of [result.preview.downloads.pptx,result.preview.downloads.pdf,...result.preview.slides.map(s=>s.url)]){
  const res=await fetch(origin+url),buffer=Buffer.from(await res.arrayBuffer());assert.equal(res.status,200);assert.ok(buffer.length>100);downloads.push({url,bytes:buffer.length});
  if(url===result.preview.downloads.pptx){const zip=await JSZip.loadAsync(buffer);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,12);assert.ok(Object.keys(zip.files).some(n=>/^ppt\/media\/.+\.(jpg|png|jpeg)$/.test(n)));const xml=await zip.file('ppt/slides/slide5.xml').async('string');for(const label of [...relationshipLabels,...relationshipEdges])assert.ok(xml.includes(label));}
 }
 const report={httpStatus:response.status,status:result.status,slides:12,previews:12,downloads,elapsedMs:performance.now()-start,aiCalls:fixture.mock.calls.length,slide8WholeAttempts:fixture.attempts.get(8),fallbackCalls:logs.filter(e=>e.stage==='slide-fallback-generation').length,convertedSlides:result.generatedContent.slideRecovery.slides,qualityReviewed:true,liveProviders:false};
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
