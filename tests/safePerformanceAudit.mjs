// Controlled before/after audit. This script never loads .env or real providers.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import JSZip from 'jszip';
import {createApp} from '../src/app.mjs';
import {generateService} from '../Service/generateService.mjs';
import {tenSlideFixture} from './fixtures/tenSlideClaude.mjs';
import {anthropicFixture} from './fixtures/anthropicTransport.mjs';
import {fixtures,fixturePlan,fixtureDraft} from './webpage/fixtures.mjs';
import {documentFixtureClient,documentParagraph} from './fixtures/documentFixtures.mjs';
import {docxSource,DOCX_MIME,pdfSource} from './fixtures/uploadFiles.mjs';
import {convertPdfToImages} from '../renderer/converters/pdfToImages.mjs';
import {validateDocumentPdf} from '../Service/document/documentPdfService.mjs';
import {optimizeWebsiteImage} from '../Service/webpage/imageOptimization.mjs';
const phase=process.argv[2]||'before',root=path.resolve('generated/safe-performance-2026-10-29',phase);await fs.mkdir(root,{recursive:true});
process.env.LEDIFY_PRESENTATION_ROOT=path.join(root,'previews');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(phase==='snapshot'){
 const targets=['renderer/converters/pdfToImages.mjs','Service/webpage/imageOptimization.mjs','Service/document/documentPdfService.mjs','Service/performance.mjs'];const manifest=[];
 for(const file of targets){const bytes=await fs.readFile(file),destination=path.join(root,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);manifest.push({file,sha256:hash(bytes)});}
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));await fs.writeFile(path.join(root,'git-status.txt'),execFileSync('git',['status','--short']));await fs.writeFile(path.join(root,'tracked-working-state.patch'),execFileSync('git',['diff','--binary'],{maxBuffer:20*1024*1024}));console.log('Exact optimization-target backups and existing tracked diff preserved.');process.exit(0);
}
const reports=[],metrics=async(name,fn)=>{const cpu=process.cpuUsage(),rss=process.memoryUsage().rss,start=performance.now();let peak=rss;const timer=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),20);try{const result=await fn();return {name,elapsedMs:performance.now()-start,cpuMs:process.cpuUsage(cpu),startRssBytes:rss,peakRssBytes:Math.max(peak,process.memoryUsage().rss),result};}finally{clearInterval(timer);}};
if(process.argv[3]==='units'){
 const require=createRequire(import.meta.url),cp=require('node:child_process'),original=cp.fork;let forks=0;cp.fork=(...args)=>{forks++;return original(...args);};syncBuiltinESMExports();
 const unitRoot=await fs.mkdtemp(path.join(root,'units-'));const image=await fs.readFile('assets/webpage/curated/laboratory.jpg'),pdf=path.resolve('generated/connector-artifacts/final/dark.pdf');
 for(let run=1;run<=3;run++){
  reports.push(await metrics('png',async()=>{const images=await convertPdfToImages({pdfPath:pdf,outputDirectory:path.join(root,'png-'+run),engine:'poppler'});return Promise.all(images.map(async image=>{const buffer=await fs.readFile(image.filePath);return {file:image.fileName,bytes:buffer.length,sha256:hash(buffer),pixels:hash(await sharp(buffer).raw().toBuffer())};}));}));
  const before=forks;reports.push(await metrics('web-image-twins',async()=>{const variants=await Promise.all([0,1].map(()=>optimizeWebsiteImage(image,{cacheRoot:path.join(unitRoot,'image-'+run)})));return {workers:forks-before,hashes:variants.map(r=>r.variants.map(v=>hash(v.buffer))),bytes:variants[0].variants.map(v=>v.buffer.length)};}));
  reports.push(await metrics('document-pdf-validation',async()=>{const bytes=pdfSource(documentParagraph);const validations=[];for(let i=0;i<10;i++)validations.push(await validateDocumentPdf(bytes));return validations;}));
 }
 await fs.writeFile(path.join(root,'units.json'),JSON.stringify(reports,null,2));for(const r of reports)console.log(JSON.stringify({name:r.name,elapsedMs:r.elapsedMs,workers:r.result?.workers}));process.exit(0);
}
const fixture=await tenSlideFixture(0,0),source=fixtures.pharmaceutical.source,records=new Map();let output,currentSource=source;
const app=createApp({documentRoot:path.join(root,'documents'),webpageRoot:path.join(root,'websites'),deliveryLogger:()=>{},extractUrl:async()=>currentSource,model:{create:async v=>({...v,_id:'performance-fixture',save:async()=>{}})},generator:async(kind,input,type,context)=>{
 const legacy=type==='document'?documentFixtureClient():null;
 const mock=anthropicFixture(async({prompt,schema})=>{await sleep(15);if(type==='document')return JSON.parse((await legacy.models.generateContent({contents:prompt,config:{responseJsonSchema:schema}})).text);if(type==='webpage')return schema.properties.pageType?fixturePlan(fixtures.pharmaceutical):fixtureDraft(fixtures.pharmaceutical);if(schema.properties.coverage)return {coverage:[],issues:[]};if(schema.properties.slides)return {...fixture.deck,requirements:[],slides:fixture.deck.slides.map(({content,...s})=>s)};const n=Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1]);assert.ok(n);return fixture.deck.slides[n-1].content;});
 const providers=['commons','unsplash','picsum','gemini','pixabay'].map(id=>({id,kind:id==='gemini'?'generation':'stock',acquire:async request=>{await sleep(id==='commons'?5:30);if(id!=='commons')return null;const asset=type==='presentation'?fixture.assets.find(a=>a.slideNumber===request.slideNumber):{buffer:await fs.readFile('assets/webpage/curated/laboratory.jpg'),description:'A scientist pipetting in a pharmaceutical research laboratory'};return {...asset,alt:asset.description,source:'Wikimedia Commons',creator:'Controlled licensed fixture',license:'Public domain',sourceType:'licensed-stock',mediaKind:'photograph',generationMethod:'licensed-search'};}}));const webProviders=[];webProviders.raceProviders=providers;
 let profile;const result=await generateService(kind,input,type,context,{prefetchImages:false,ai:{client:mock.client,logger:()=>{},qualityLogger:()=>{}},visuals:{providers:{raceProviders:providers,raceLogger:()=>{}},diagramPlanner:false,cacheRoot:path.join(root,'assets'),policy:{allowGeneration:true,maxGenerated:3,estimatedUnitCost:.05,maxEstimatedCost:.15}},preview:{outputDirectory:path.join(root,'previews')},webpageAssets:{providers:webProviders,curated:false,logger:()=>{},policy:{maxAssets:1,maxGenerated:1,estimatedUnitCost:.05,maxEstimatedCost:.05},optimization:{cacheRoot:path.join(root,'web-image-cache')}},artifacts:{root:path.join(root,'websites')},document:{root:path.join(root,'documents')},performance:{forceNew:true,onReport:r=>{profile=r;},stageLogger:()=>{},logger:()=>{}}});records.set(result.preview?.previewId||result.artifacts?.id,{profile,calls:mock.calls.length});output=result;return result;
}}),server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
try{
 for(const type of ['presentation','webpage','document'])for(const input of ['textPrompt','urlPrompt','file']){
  if(process.argv[3]==='text-only'&&input!=='textPrompt')continue;
  if(process.argv[3]==='resume'){const saved=JSON.parse(await fs.readFile(path.join(root,'pipelines.json'),'utf8'));if(!reports.length)reports.push(...saved);if(reports.some(row=>row.name===type+'-'+input))continue;}const run=await metrics(type+'-'+input,async()=>{
   const context=type==='presentation'?fixture.context:type==='document'?{exportFormat:'pdf',wordCount:100}:{},prompt=type==='presentation'?fixture.prompt:type==='webpage'?fixtures.pharmaceutical.source:'Write a 100-word technical document explaining REST APIs.';currentSource=prompt;let body,headers;
   if(input==='file'){body=new FormData();body.set('outputType',type);body.set('context',JSON.stringify(context));body.set('file',new Blob([await docxSource(prompt)],{type:DOCX_MIME}),'source.docx');}else{headers={'Content-Type':'application/json'};body=JSON.stringify({outputType:type,context,...(input==='textPrompt'?{textPrompt:prompt}:{urlPrompt:'https://example.org/controlled-source'})});}
   const start=performance.now(),response=await fetch(origin+'/api/generate/'+input,{method:'POST',headers,body}),json=await response.json();assert.equal(response.status,201,JSON.stringify(json));const generationMs=performance.now()-start,r=json.data.result;assert.ok(['completed','completed_with_warnings'].includes(r.status));
   const urls=type==='presentation'?[r.preview.downloads.pptx,r.preview.downloads.pdf,...r.preview.slides.map(s=>s.url)]:[r.artifacts.previewUrl,...Object.values(r.artifacts.downloads||{zip:r.artifacts.downloadUrl})];const downloads=[];for(const url of urls){const file=await fetch(origin+url);assert.equal(file.status,200);downloads.push({bytes:(await file.arrayBuffer()).byteLength,type:file.headers.get('content-type')});}
   if(type==='presentation')assert.equal(r.generatedContent.slides.length,10);if(type==='document')assert.ok(r.generatedContent.sections.length);if(type==='webpage')assert.ok(r.generatedContent.visualAssets.hero);
   return {inputType:input,outputType:type,generationMs,status:r.status,profile:records.get(output.preview?.previewId||output.artifacts?.id)?.profile,aiCalls:records.get(output.preview?.previewId||output.artifacts?.id)?.calls,downloads};
  });reports.push(run);await fs.writeFile(path.join(root,'pipelines.json'),JSON.stringify(reports,null,2));console.log('[SAFE_PERF]',JSON.stringify({name:run.name,elapsedMs:run.elapsedMs,generationMs:run.result.generationMs}));
 }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
