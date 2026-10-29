// Fixture retrieval + native Anthropic protocol mocks + actual API/exports.
// No live AI calls. No claims about real Wikipedia's article contents.
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createApp} from '../src/app.mjs';
import {generateService} from '../Service/generateService.mjs';
import {urlSourceService} from '../Service/input/urlUnderstanding.mjs';
import {anthropicFixture} from './fixtures/anthropicTransport.mjs';
import {tenSlideFixture} from './fixtures/tenSlideClaude.mjs';
import {visibleSlideText} from '../Service/ai/presentationQuality.mjs';
import {fixtures,fixturePlan,fixtureDraft} from './webpage/fixtures.mjs';
import {documentFixtureClient,documentParagraph} from './fixtures/documentFixtures.mjs';
const failure=process.argv.includes('--understanding-failure'),only=process.argv.slice(2).find(arg=>arg!=='--understanding-failure');if(only&&!['webpage','presentation','document'].includes(only))throw new Error('Unknown output audit');
const root=path.resolve('generated/url-generation-audit'+(only?'-'+only:'')+(failure?'-fallback':''));await fs.mkdir(root,{recursive:true});
process.env.LEDIFY_PRESENTATION_ROOT=path.join(root,'presentations');
const presentation=await tenSlideFixture(0,0),web=fixtures.business,legacyDoc=documentFixtureClient();
const cases={presentation:{title:presentation.deck.title,paragraphs:presentation.deck.slides.map(visibleSlideText),client:presentation.mock.client,context:{...presentation.context,instructions:presentation.prompt},assets:presentation.assets},webpage:{title:web.title,paragraphs:[web.source],client:anthropicFixture(({schema})=>schema.properties.pageType?fixturePlan(web):fixtureDraft(web)).client,context:{instructions:'Create an image-free website.'}},document:{title:'REST API source',paragraphs:[documentParagraph],client:anthropicFixture(async({schema,prompt})=>JSON.parse((await legacyDoc.models.generateContent({contents:prompt,config:{responseJsonSchema:schema}})).text)).client,context:{wordCount:100}}};
const understanding=new Map(),records=[],reports=[];
for(const [type,value] of Object.entries(cases))understanding.set(type,anthropicFixture(()=>{const quote=value.paragraphs[0].split(/(?<=[.!?])\s/)[0];return ({schemaVersion:'1.0',mainTopic:value.title,summaryQuote:quote,sections:[{heading:value.title,quote,keyPoints:[quote]}],keyConcepts:[],importantFacts:[],limitations:[],sufficientForGeneration:true,warnings:[]});}));
if(failure)for(const type of Object.keys(cases)){const calls=[];understanding.set(type,{calls,client:{provider:'anthropic',generateStructured:async request=>{calls.push(request);throw Object.assign(new Error('Controlled fixture connection reset'),{code:'ECONNRESET'});}}});}
const app=createApp({webpageRoot:path.join(root,'webpages'),documentRoot:path.join(root,'documents'),presentationRoot:path.join(root,'presentations'),model:{create:async value=>{const record={...value,_id:randomUUID(),save:async()=>{}};records.push(record);return record;}},extractUrl:async url=>{
 const type=new URL(url).pathname.slice(1),value=cases[type];assert.ok(value);
 return urlSourceService(url,{client:understanding.get(type).client,fetchText:async()=>({text:`<main><h1>${value.title}</h1>${value.paragraphs.map(p=>`<p>${p}</p>`).join('')}</main>`,contentType:'text/html'})});
},generator:(kind,input,type,context)=>{
 assert.equal(kind,'url');assert.ok(input.includes(cases[type].paragraphs[0]));assert.equal(context.sourceUnderstanding.source.requestedUrl,'https://example.com/'+type);
 return generateService(kind,input,type,context,{ai:{client:cases[type].client,qualityReview:false,logger:()=>{}},visuals:{external:false,diagramPlanner:false,userAssets:cases[type].assets||[],cacheRoot:path.join(root,'cache')},webpageAssets:{providers:[],external:false,curated:false},artifacts:{root:path.join(root,'webpages')},document:{root:path.join(root,'documents')},preview:{outputDirectory:path.join(root,'presentations')}});
}});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
async function read(url){const response=await fetch(origin+url);assert.equal(response.status,200,url);return Buffer.from(await response.arrayBuffer());}
try{
 for(const [type,value] of Object.entries(cases)){
  if(only&&type!==only)continue;
  const start=performance.now(),response=await fetch(origin+'/api/generate/urlPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urlPrompt:'https://example.com/'+type,outputType:type,context:value.context})});const body=await response.json();assert.equal(response.status,201,JSON.stringify(body));const result=body.data.result;
  assert.equal(records.at(-1).status,'completed');assert.equal(understanding.get(type).calls.length,1);
  if(failure){assert.equal(result.status,'completed_with_warnings');assert.ok(result.warnings.some(w=>w.code==='URL_UNDERSTANDING_BYPASSED'));}
  if(type==='presentation'){
   const zip=await JSZip.loadAsync(await read(result.preview.downloads.pptx));assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,10);assert.equal(result.preview.slides.length,10);assert.equal((await read(result.preview.downloads.pdf)).subarray(0,4).toString(),'%PDF');for(const slide of result.preview.slides)assert.equal((await read(slide.url)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(result.imageValidation.status,'passed');
  }else if(type==='webpage'){
   const viewer=(await read(result.artifacts.previewUrl)).toString(),site=viewer.match(/<iframe[^>]+src="([^"]+)"/)?.[1];assert.ok(site);const html=(await read(site)).toString();assert.match(html,/Fieldwork Studio/);assert.match(html,/aria-label="Content sources"/);assert.ok(html.includes('https://example.com/webpage'));const zip=await JSZip.loadAsync(await read(result.artifacts.downloadUrl));assert.ok(zip.file('my-website/index.html'));
  }else{
   const zip=await JSZip.loadAsync(await read(result.artifacts.downloads.docx));assert.ok(zip.file('word/document.xml'));assert.ok((await read(result.artifacts.previewUrl)).length);if(result.artifacts.downloads.pdf)assert.equal((await read(result.artifacts.downloads.pdf)).subarray(0,4).toString(),'%PDF');
  }
  const report={type,status:'passed',elapsedMs:Math.round(performance.now()-start),understandingCalls:1,sourceCharacters:result.resolvedContext?.sourceUnderstanding?undefined:value.paragraphs.join('\n').length};reports.push(report);console.log('[URL_GENERATION_AUDIT]',JSON.stringify(report));await fs.writeFile(path.join(root,'report.json'),JSON.stringify(reports,null,2));
 }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
