// Mocked Claude transport + real PPTX/LibreOffice/Poppler + local HTTP.
// Old versus new SETTINGS, not live before/after provider latency.
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createApp} from '../src/app.mjs';
import {generateService} from '../Service/generateService.mjs';
import {tenSlideFixture} from './fixtures/tenSlideClaude.mjs';
import {designPlan} from './fixtures/designPlan.mjs';
const v2=process.argv.includes('--design-v2');
const mode=process.argv[2]||'optimized',users=Number(process.argv[3]||1),root=path.resolve(v2?'generated/design-native':'generated/migration-native',mode+'-'+users);
assert.ok(['reference','optimized'].includes(mode));assert.ok([1,2].includes(users));
await fs.mkdir(root,{recursive:true});process.env.LEDIFY_PRESENTATION_ROOT=path.join(root,'presentations');process.env.LEDIFY_PNG_ENCODING=mode==='reference'?'poppler':'sharp';
if(v2){process.env.LEDIFY_DESIGN_ENGINE=mode==='reference'?'legacy':'2.0';process.env.LEDIFY_PNG_ENCODING='sharp';}
const fixtures=await Promise.all(Array.from({length:users},(_,i)=>tenSlideFixture(i,100))),perfs=[],history=[];
if(v2)for(const fixture of fixtures)fixture.deck.artifactDesign=designPlan(fixture.deck);
const app=createApp({jobRoot:path.join(root,'jobs'),jobOptions:{onPerformanceReport:report=>perfs.push(report)},model:{create:async value=>({...value,save:async()=>{}}),findByIdAndUpdate:async()=>{}},generator:(kind,input,output,context,options)=>{
 const fixture=fixtures.find(f=>f.prompt===input);assert.ok(fixture);
 return generateService(kind,input,output,context,{...options,ai:{client:fixture.mock.client,qualityReview:false,slideConcurrency:v2?6:mode==='reference'?4:6},visuals:{external:false,diagramPlanner:false,userAssets:fixture.assets,cacheRoot:path.join(root,'cache')},preview:{...options.preview,outputDirectory:process.env.LEDIFY_PRESENTATION_ROOT}});
}});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
async function read(url){const response=await fetch(origin+url);assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());}
const start=performance.now(),cpu=process.cpuUsage(),health=[];let peak=process.memoryUsage().rss;
const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);const at=performance.now();fetch(origin+'/healthz').then(r=>{assert.equal(r.status,200);health.push(performance.now()-at);}).catch(()=>{});},100);sampler.unref();
try{
 const reports=await Promise.all(fixtures.map(async(f,index)=>{
  const response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'respond-async'},body:JSON.stringify({textPrompt:f.prompt,outputType:'presentation',context:f.context})});assert.equal(response.status,202);const receipt=(await response.json()).data;
  let job;const deadline=Date.now()+180000;do{job=(await(await fetch(origin+receipt.statusUrl)).json()).data;if(['completed','failed'].includes(job.status))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
  assert.equal(job.status,'completed',JSON.stringify(job.error));const result=job.result;assert.equal(result.imageValidation.status,'passed');assert.equal(result.preview.slides.length,10);assert.equal(f.mock.calls.length,11);assert.equal(f.mock.modelChecks,1);
  if(v2&&mode==='optimized'){assert.equal(result.designSpecification.provenance,'ai-directed');assert.equal(result.designQuality.status,'passed');assert.equal(result.engineVersion,'2.0');}
  const pptx=await read(result.preview.downloads.pptx),zip=await JSZip.loadAsync(pptx);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,10);
  assert.equal(result.generatedContent.slides.filter(s=>s.photoAsset).length,3);assert.equal(result.generatedContent.slides[0].photoComposition,'hero-full-bleed');
  const cover=await zip.file('ppt/slides/slide1.xml').async('string');assert.ok(cover.includes('<p:pic>'));assert.ok(!cover.includes('AI-generated illustration'));
  const urls=[result.preview.downloads.pptx,result.preview.downloads.pdf,...result.preview.slides.map(s=>s.url)];
  for(const [i,url] of urls.entries()){const buffer=i===0?pptx:await read(url);assert.ok(buffer.length>100);if(i===1)assert.equal(buffer.subarray(0,4).toString(),'%PDF');if(i>1)assert.equal(buffer.subarray(0,8).toString('hex'),'89504e470d0a1a0a');history.push({url,sha256:hash(buffer)});if(i===2)await fs.writeFile(path.join(root,'cover-'+index+'.png'),buffer);}
  return {status:job.status,topic:f.deck.title,totalMs:job.timings.totalMs,aiCalls:f.mock.calls.length,modelChecks:f.mock.modelChecks,photoSourceChecksums:result.generatedContent.slides.filter(s=>s.photoAsset).map(s=>s.photoAsset.sourceChecksum),previewQuality:result.preview.quality,coverComposition:result.generatedContent.slides[0].photoComposition};
 }));
 for(const artifact of history)assert.equal(hash(await read(artifact.url)),artifact.sha256,'Concurrent artifacts remain unchanged');
 if(users===2)assert.ok(reports[0].photoSourceChecksums.every(h=>!reports[1].photoSourceChecksums.includes(h)));
 health.sort((a,b)=>a-b);const usage=process.cpuUsage(cpu),summary={scope:'Mocked Claude with 100 ms per Messages call; real exports; local metadata stub; reference settings versus optimized settings, not live provider comparison.',mode,users,totalMs:Math.round(performance.now()-start),peakParentRssBytes:peak,parentCpuMs:(usage.user+usage.system)/1000,healthP95Ms:health[Math.max(0,Math.ceil(health.length*.95)-1)],reports,perfs};
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify(summary,null,2));console.log('[MIGRATION_NATIVE]',JSON.stringify({mode,users,totalMs:summary.totalMs,requests:reports.map(r=>r.totalMs),checks:'passed'}));
}finally{clearInterval(sampler);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
