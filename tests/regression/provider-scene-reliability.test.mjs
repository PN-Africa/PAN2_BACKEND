import test from 'node:test';
import assert from 'node:assert/strict';
import {webpagePlanningProviderSchema} from '../../templates/webpage/webpageSchema.mjs';
import {structuredOutputPlan,createAnthropicService} from '../../Service/ai/textProvider.mjs';
import {generateJsonWithRetry} from '../../Service/ai/generateJsonWithRetry.mjs';
import {evaluateImageRelevance} from '../../Service/visual/imageRelevance.mjs';
import {stockSearchQueries} from '../../Service/visual/imageProviders.mjs';
import {stockProviderAdapters,licensedStock} from '../../Service/visual/stockProviders.mjs';
import {presentationReviewPayload} from '../../Service/ai/presentationQuality.mjs';
import {generationOutcome} from '../../Service/generationOutcome.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import JSZip from 'jszip';
import {createApp} from '../../src/app.mjs';
import {generateService} from '../../Service/generateService.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';
import {fixtures,fixturePlan,fixtureDraft} from '../webpage/fixtures.mjs';
import {profileGeneration,reservePerformanceBudget} from '../../Service/performance.mjs';
const model='claude-opus-5-5';
test('webpage design grammar uses simple envelope while original plan remains locally constrained',()=>{
 const original=webpagePlanningProviderSchema(),plan=structuredOutputPlan(original);
 assert.equal(plan.mode,'validated-json-envelope');assert.deepEqual(Object.keys(plan.schema.properties),['payload']);assert.ok(original.properties.artifactDesign);assert.ok(original.properties.sections.maxItems===8);
});
test('malformed local schemas fail before model verification or paid Messages requests',async()=>{
 let calls=0;const service=createAnthropicService({env:{CLAUDE_MODEL:model},sdk:{models:{retrieve:async()=>{calls++;}},messages:{create:async()=>{calls++;}}}});
 await assert.rejects(service.generateStructured({model,contents:'Valid input',config:{responseJsonSchema:{properties:{title:{type:'string'}}}}}),{code:'AI_TEXT_SCHEMA_INVALID'});assert.equal(calls,0);
});
test('stock vision budget is shared within a generation and isolated across concurrent requests',async()=>{
 const run=()=>profileGeneration(async()=>{assert.equal(reservePerformanceBudget('stock-vision',1),true);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(reservePerformanceBudget('stock-vision',1),false);},{forceNew:true,logger:()=>{},stageLogger:()=>{}});
 await Promise.all([run(),run()]);
});
for(const [status,type,message,expected] of [[400,'invalid_request_error','Schema is too complex for compilation.','AI_PROVIDER_ERROR'],[400,'invalid_request_error','Private prompt SECRET must never appear','AI_PROVIDER_ERROR'],[408,'timeout_error','Timeout','AI_RETRY_EXHAUSTED']])test(`sanitized Anthropic ${status} ${type} preserves classification and bounded retries`,async()=>{
 let calls=0;const logs=[],schema={type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false};
 const sdk={models:{retrieve:async()=>({id:model})},messages:{create:async()=>{calls++;throw Object.assign(new Error(message),{status,error:{error:{type,message}}});}}};
 await assert.rejects(generateJsonWithRetry({client:createAnthropicService({env:{CLAUDE_MODEL:model},sdk}),request:{model,contents:'SECRET',config:{responseJsonSchema:schema}},schema,stage:'webpage-planning',outputType:'webpage',sleep:async()=>{},logger:entry=>logs.push(entry)}),{code:expected});
 assert.equal(calls,status===400?1:3);assert.equal(logs[0].providerErrorType,type);assert.ok(!JSON.stringify(logs).includes('SECRET'));if(message.startsWith('Schema'))assert.equal(logs[0].providerErrorMessage,message);
});
for(const [query,description,accepted] of [
 ['Lagos skyline lagoon','Lagos skyline of high-rise buildings overlooking Lagos lagoon',true],
 ['Lagos skyline lagoon','Dubai skyline waterfront luxury architecture',false],
 ['luxurious marble kitchen island brass fixtures pendant lighting','Marble countertop samples in a home improvement store',false],
 ['luxurious marble kitchen island brass fixtures pendant lighting','Luxury kitchen with a marble island, brass fixtures and pendant lighting',true],
 ['property advisor handing keys to a client','Real estate agent sign in the Netherlands',false],
 ['property advisor handing keys to a client','Property advisor handing house keys to a client outside a home',true],
 ['luxury modern villa exterior','Modern luxury villa residential architecture with a swimming pool',true]
])test('scene evidence: '+description,()=>assert.equal(evaluateImageRelevance({description},{searchQuery:query}).accepted,accepted));
test('geographic query expansion preserves Lagos on every bounded alternative',()=>{
 const queries=stockSearchQueries('Lagos skyline lagoon');assert.ok(queries.length<=4);assert.ok(queries.every(q=>/Lagos/.test(q)));assert.ok(queries.includes('Lagos skyline'));
});
test('shared Pexels adapter ranks matching scenes, downloads resized bytes and rejects store samples',async()=>{
 const urls=[],photos=[{id:1,alt:'Marble countertop samples in a home improvement store'},{id:2,alt:'Luxury kitchen with marble island and brass fixtures'}].map(p=>({...p,width:1920,height:1080,photographer:'Fixture photographer',url:`https://www.pexels.com/photo/${p.id}`,src:{large2x:`https://images.pexels.com/photos/${p.id}/large.jpg`}}));
 const adapter=stockProviderAdapters({PEXELS_API_KEY:'test-only'},{fetcher:async(url,options)=>{assert.equal(options.headers.Authorization,'test-only');return new Response(JSON.stringify({photos}));},download:async url=>{urls.push(url);return {buffer:Buffer.from('test bytes')};}})[0];
 const image=await adapter.acquire({searchQuery:'luxury marble kitchen island brass fixtures'});assert.equal(image.assetId,'2');assert.equal(urls.length,1);assert.ok(image.attributionRequired);assert.ok(licensedStock(image));
});
test('Openverse requires opt-in and rejects noncommercial/unknown/missing attribution licenses',async()=>{
 assert.equal(stockProviderAdapters({}).length,0);assert.equal(stockProviderAdapters({OPENVERSE_ENABLED:'true'})[0].id,'openverse');
 const record={source:'Openverse',license:'by',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',creator:'Creator',originalUrl:'https://example.org/photo'};
 assert.equal(licensedStock(record),true);for(const license of ['by-nc','by-nd','unknown'])assert.equal(licensedStock({...record,license}),false);assert.equal(licensedStock({...record,creator:''}),false);
});
test('Openverse corroborates indexed license on source page before downloading the selected image',async()=>{
 const record={id:'1',title:'Lagos skyline lagoon high-rise buildings',creator:'Fixture',foreign_landing_url:'https://example.org/photo',url:'https://example.org/photo.jpg',width:1920,height:1080,license:'by',license_url:'https://creativecommons.org/licenses/by/4.0/'};let licensed=false,images=0;
 const adapter=stockProviderAdapters({OPENVERSE_ENABLED:'true'},{fetcher:async()=>new Response(JSON.stringify({results:[record]})),download:async url=>url.endsWith('.jpg')?(images++,{buffer:Buffer.from('test')}):{buffer:Buffer.from(licensed?'<a rel="license" href="https://creativecommons.org/licenses/by/4.0/">License</a>':'Unverified page')}})[0];
 assert.equal(await adapter.acquire({query:'Lagos skyline lagoon'}),null);assert.equal(images,0);licensed=true;assert.equal((await adapter.acquire({query:'Lagos skyline lagoon'})).licenseVerification,'source-page-link-matched');assert.equal(images,1);
});
test('review payload removes asset/design bulk without deleting content or semantic diagram edges',()=>{
 const content={relationship:{nodes:[{id:'a'},{id:'b'}],edges:[{from:'a',to:'b',label:'supports'}]}},deck={title:'Mechanisms',artifactDesign:{vectors:[{svg:'large private design'}]},slides:[{slideNumber:1,slideType:'relationship',title:'Relationship',objective:'Explain actors',content,assetReceipt:'internal'}]};
 const reduced=presentationReviewPayload(deck);assert.deepEqual(reduced.slides[0].content,content);assert.ok(!JSON.stringify(reduced).includes('assetReceipt'));assert.ok(!JSON.stringify(reduced).includes('large private design'));
});
test('completion outcomes distinguish complete, warning, recoverable incomplete and failed while retaining drafts',()=>{
 assert.equal(generationOutcome({status:'completed'}).state,'complete');assert.equal(generationOutcome({status:'completed_with_warnings'}).state,'completed_with_warnings');assert.deepEqual(generationOutcome({status:'incomplete',preview:{downloads:{pptx:'/draft'}}}),{state:'incomplete',recoverable:true,artifactsAvailable:true,action:'retry-missing-assets-or-export'});assert.equal(generationOutcome({status:'failed'}).recoverable,false);
});
test('optional stock vision inspects actual bytes for one selected ambiguous scene and enforces its budget',async()=>{
 const buffer=await fs.readFile('assets/webpage/curated/laboratory.jpg');let calls=0;
 const client={generateStructured:async request=>{calls++;assert.equal(request.images[0].data,buffer.toString('base64'));assert.match(request.contents,/stock photograph/);return {text:JSON.stringify({accepted:true,reason:'MATCH'}),candidates:[{finishReason:'STOP'}]};}};
 const photo={id:1,alt:'Modern luxury villa exterior residential architecture',width:1920,height:1080,photographer:'Fixture',url:'https://www.pexels.com/photo/1',src:{large2x:'https://images.pexels.com/photos/1/large.jpg'}};
 const adapter=stockProviderAdapters({PEXELS_API_KEY:'test-only',AI_STOCK_SEMANTIC_REVIEW:'true'},{reviewClient:client,fetcher:async()=>new Response(JSON.stringify({photos:[photo]})),download:async()=>({buffer})})[0];
 assert.equal((await adapter.acquire({query:'modern luxury villa exterior'})).visualReview.status,'passed');assert.equal(calls,1);await assert.rejects(adapter.acquire({query:'modern luxury villa exterior'}),{code:'IMAGE_REVIEW_BUDGET_EXHAUSTED'});assert.equal(calls,1);
});
test('Claude webpage planning and content traverse HTTP generation, preview and self-contained ZIP download',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-claude-webpage-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const fixture=fixtures.business,mock=anthropicFixture(({schema})=>schema.properties.pageType?fixturePlan(fixture):fixtureDraft(fixture));
 const app=createApp({model:{create:async value=>({...value,_id:'fixture',save:async()=>{}})},webpageRoot:root,deliveryLogger:()=>{},generator:(kind,input,type,context)=>generateService(kind,input,type,context,{ai:{client:mock.client,logger:()=>{}},webpageAssets:{providers:[],curated:false,external:false},artifacts:{root}})});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const origin=`http://127.0.0.1:${server.address().port}`,response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:fixture.source,outputType:'webpage',context:{instructions:'Create an image-free website.'}})});
 const body=await response.json();assert.equal(response.status,201,JSON.stringify(body));const result=body.data.result;assert.equal(mock.calls.length,2);assert.equal(body.data.request.outcome.state,result.outcome.state);
 const preview=await fetch(origin+result.artifacts.previewUrl);assert.equal(preview.status,200);const viewer=await preview.text(),source=viewer.match(/<iframe[^>]+src="([^"]+)"/)?.[1];assert.ok(source);const site=await fetch(origin+source);assert.equal(site.status,200);assert.match(await site.text(),/Fieldwork Studio/);
 const archive=await fetch(origin+result.artifacts.downloadUrl);assert.equal(archive.status,200);const zip=await JSZip.loadAsync(await archive.arrayBuffer());assert.ok(zip.file('my-website/index.html'));assert.ok(zip.file('my-website/style.css'));
});
