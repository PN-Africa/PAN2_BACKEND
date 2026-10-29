import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {APIConnectionTimeoutError,APIConnectionError} from '@anthropic-ai/sdk';
import {urlSourceService} from '../../Service/input/urlUnderstanding.mjs';
import {selectUnderstandingEvidence} from '../../Service/input/sourceEvidenceSelection.mjs';
import {withinUnderstandingBudget} from '../../Service/input/urlBudget.mjs';
import {generateJsonWithRetry,isProviderTimeout} from '../../Service/ai/generateJsonWithRetry.mjs';
import {profileGeneration,performanceReport,performanceRequestId,measureStage,generationSignal} from '../../Service/performance.mjs';
import {createAiCapacity} from '../../Service/ai/providerCapacity.mjs';
import {createAnthropicService} from '../../Service/ai/textProvider.mjs';
import {createApp} from '../../src/app.mjs';
import {generateService} from '../../Service/generateService.mjs';
import {fixtures,fixturePlan,fixtureDraft} from '../webpage/fixtures.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const text='Artificial intelligence studies systems that perform tasks associated with learning, reasoning and planning. Evidence should distinguish measured capabilities from proposals and unsupported claims. Reliable descriptions preserve the scope and limitations of the source.';
const fetchText=async()=>({text,contentType:'text/plain'});
const silent={logger:()=>{},stageLogger:()=>{}};
test('analysis selection is bounded and transparent while preserving source ranges, end content and metadata',()=>{
 const sections=Array.from({length:40},(_,i)=>`Section ${i}\n${('Section '+i+' discusses evidence, methods and carefully qualified conclusions. ').repeat(60)}`),source={text:sections.join('\n')+'\nFinal critical limitation.',headings:sections.map((_,i)=>'Section '+i),references:[{url:'https://example.com/reference'}]};
 const before=source.text,selected=selectUnderstandingEvidence(source,24000);assert.ok(selected.partial);assert.ok(selected.text.length<=24000);assert.ok(selected.text.includes('Final critical limitation.'));assert.equal(source.text,before);assert.equal(source.references.length,1);for(const r of selected.ranges)assert.ok(source.text.slice(r.start,r.end));assert.ok(selected.selectedCharacters/source.text.length<.25);
});
test('small sources are not shortened by optional analysis selection',()=>{const selected=selectUnderstandingEvidence({text,headings:[]});assert.equal(selected.text,text);assert.equal(selected.partial,false);});
test('large-source Claude payload is bounded while the generator retains every source character',async()=>{
 const full=text+'\n'+Array.from({length:40},(_,i)=>`# Section ${i}\n${(`Evidence section ${i} discusses learning methods, measured capabilities and limitations. `).repeat(40).trim()}`).join('\n');let sent;
 const value={schemaVersion:'1.0',mainTopic:'Artificial intelligence',summaryQuote:text,sections:[{heading:'Introduction',quote:text,keyPoints:[text]}],keyConcepts:[],importantFacts:[],limitations:[],sufficientForGeneration:true,warnings:[]};
 const source=await urlSourceService('https://example.com/article',{fetchText:async()=>({text:full,contentType:'text/plain'}),client:{generateStructured:async request=>{sent=request;return {text:JSON.stringify(value),candidates:[{finishReason:'STOP'}]};}}});
 assert.ok(full.length>100000);assert.equal(source.text,full);assert.ok(sent.contents.length<35000);assert.equal(sent.config.maxOutputTokens,3072);assert.equal(source.understanding.quality.evidencePartial,true);assert.ok(source.understanding.quality.warnings.includes('SOURCE_EVIDENCE_INDEX_PARTIAL'));
});
test('local understanding deadline is an AI timeout rather than SOURCE_URL_TIMEOUT',async()=>{
 await assert.rejects(withinUnderstandingBudget(Date.now()+15,()=>new Promise(()=>{}),undefined,'claude-opus-5-5'),error=>error.code==='AI_PROVIDER_TIMEOUT'&&error.stage==='url-content-understanding'&&error.providerReason==='PROVIDER_TIMEOUT');
});

test('overall budget cancels an active AI call without retries and records the failed attempt',async()=>{
 let calls=0,report;
 await assert.rejects(profileGeneration(()=>generateJsonWithRetry({client:{generateStructured:()=>{calls++;return new Promise(()=>{});}},request:{model:'claude-opus-5-5',contents:'fixture',config:{}},schema:{type:'object'},outputType:'webpage',stage:'webpage-planning',logger:()=>{}}),{...silent,timeoutMs:30,onReport:value=>{report=value;}}),error=>error.code==='GENERATION_TIMEOUT');
 assert.equal(calls,1);assert.equal(report.ai.calls,1);assert.equal(report.ai.failedCalls,1);assert.equal(report.ai.inFlightCalls,0);
});

test('overall budget prevents later stages after noncancellable local work returns',async()=>{
 let later=0;
 await assert.rejects(profileGeneration(async()=>{await measureStage('fixture-render',()=>wait(30));await measureStage('fixture-save',()=>{later++;});},{...silent,timeoutMs:10}),error=>error.code==='GENERATION_TIMEOUT');
 assert.equal(later,0);
});

test('overall cancellation cannot become optional-understanding recovery',async()=>{
 await assert.rejects(profileGeneration(()=>urlSourceService('https://example.com/article',{fetchText,signal:generationSignal(),client:{generateStructured:()=>new Promise(()=>{})}}),{...silent,timeoutMs:30}),error=>['GENERATION_TIMEOUT','AI_REQUEST_CANCELLED'].includes(error.code));
});

test('HTTP overall timeout returns 504 and marks the generation record failed',async t=>{
 const previous=process.env.LEDIFY_GENERATION_TIMEOUT_MS;process.env.LEDIFY_GENERATION_TIMEOUT_MS='30';t.after(()=>{if(previous===undefined)delete process.env.LEDIFY_GENERATION_TIMEOUT_MS;else process.env.LEDIFY_GENERATION_TIMEOUT_MS=previous;});let record;
 const app=createApp({deliveryLogger:()=>{},model:{create:async value=>(record={...value,_id:'timeout-fixture',save:async()=>{}})},generator:()=>generateJsonWithRetry({client:{generateStructured:()=>new Promise(()=>{})},request:{model:'claude-opus-5-5',contents:'fixture',config:{}},schema:{type:'object'},outputType:'webpage',stage:'webpage-planning',logger:()=>{}})});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/generate/textPrompt`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:'Create a useful educational website.',outputType:'webpage'})}),body=await response.json();assert.equal(response.status,504,JSON.stringify(body));assert.equal(body.errorCode,'GENERATION_TIMEOUT');assert.equal(record.status,'failed');assert.ok(body.requestId);
});
test('a provider attempt remains visible while in flight and finishes once after cancellation',async()=>{
 let report,observed,requestId;
 await profileGeneration(async()=>{
  requestId=performanceRequestId();
  const client={provider:'anthropic',generateStructured:()=>new Promise(()=>{})};
  const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};
  const work=withinUnderstandingBudget(Date.now()+40,signal=>generateJsonWithRetry({client,schema,outputType:'source',stage:'url-content-understanding',maxAttempts:1,logger:()=>{},request:{model:'claude-opus-5-5',contents:'Source',signal,config:{responseJsonSchema:schema}}}),undefined,'claude-opus-5-5');
  await wait(10);observed=performanceReport();await assert.rejects(work,{code:'AI_PROVIDER_TIMEOUT'});await wait(0);
 },{...silent,onReport:value=>{report=value;}});
 assert.equal(observed.ai.calls,1);assert.equal(observed.ai.inFlightCalls,1);assert.ok(observed.ai.elapsedMs>0);assert.equal(report.ai.calls,1);assert.equal(report.ai.failedCalls,1);assert.equal(report.ai.inFlightCalls,0);assert.equal(report.ai.totalTokens,0);assert.equal(report.requestId,requestId);
 assert.equal(report.ai.usageUnknownCalls,1);assert.ok(report.ai.providerMs>0);
});
test('deadline aborts waiters before they can send a late paid request',async()=>{
 const capacity=createAiCapacity({limit:1}),controller=new AbortController();let release,dispatched=0;
 const first=capacity.run(()=>new Promise(resolve=>{release=resolve;}));await wait(0);const queued=capacity.run(()=>{dispatched++;},'',controller.signal);controller.abort(Object.assign(new Error('deadline'),{code:'AI_PROVIDER_TIMEOUT'}));await assert.rejects(queued,{code:'AI_PROVIDER_TIMEOUT'});release();await first;assert.equal(dispatched,0);assert.equal(capacity.stats().queued,0);
});
test('model verification finishing after cancellation cannot start Messages',async()=>{
 const controller=new AbortController();let messages=0;
 const client=createAnthropicService({env:{CLAUDE_MODEL:'claude-opus-5-5'},sdk:{models:{retrieve:async()=>{await wait(30);return {id:'claude-opus-5-5'};}},messages:{create:async()=>{messages++;}}}});
 const work=client.generateStructured({model:'claude-opus-5-5',contents:'Source',signal:controller.signal,config:{responseJsonSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}});controller.abort();await assert.rejects(work);assert.equal(messages,0);
});

test('one overall deadline cannot poison model verification shared with another request',async()=>{
 let verifications=0,messages=0;
 const client=createAnthropicService({env:{CLAUDE_MODEL:'claude-opus-5-5'},sdk:{models:{retrieve:async()=>{verifications++;await wait(80);return {id:'claude-opus-5-5'};}},messages:{create:async()=>{messages++;return {model:'claude-opus-5-5',content:[{type:'text',text:'{"ok":true}'}],stop_reason:'end_turn'};}}}});
 const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};
 const run=timeoutMs=>profileGeneration(()=>generateJsonWithRetry({client,request:{model:'claude-opus-5-5',contents:'fixture',config:{responseJsonSchema:schema}},schema,outputType:'webpage',stage:'webpage-planning',logger:()=>{}}),{...silent,timeoutMs});
 const outcomes=await Promise.allSettled([run(20),run(1000)]);assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[0].reason.code,'GENERATION_TIMEOUT');assert.equal(outcomes[1].status,'fulfilled');assert.equal(outcomes[1].value.ok,true);assert.equal(verifications,1);assert.equal(messages,1);
});
test('connection failure recovers full validated source without pretending analysis succeeded',async()=>{
 let calls=0;const source=await urlSourceService('https://example.com/article',{fetchText,client:{generateStructured:async()=>{calls++;throw new APIConnectionError({cause:Object.assign(new Error('secret-canary private network'),{code:'ECONNRESET'})});}}});assert.equal(calls,1);assert.equal(source.text,text);assert.equal(source.understanding.content,null);assert.equal(source.understanding.quality.understandingPerformed,false);assert.ok(source.understanding.quality.warnings.includes('URL_UNDERSTANDING_BYPASSED'));
});
test('stage timeout recovers source while required mode preserves correct timeout classification',async()=>{
 const options={fetchText,env:{URL_UNDERSTANDING_MS:'100',URL_EXTRACTION_TOTAL_MS:'1000'},client:{generateStructured:()=>new Promise(()=>{})}};
 const source=await urlSourceService('https://example.com/article',options);assert.equal(source.text,text);assert.equal(source.understanding.quality.bypassReason,'AI_PROVIDER_TIMEOUT');
 await assert.rejects(urlSourceService('https://example.com/article',{...options,env:{...options.env,URL_UNDERSTANDING_REQUIRED:'true'}}),error=>error.code==='AI_PROVIDER_TIMEOUT'&&error.stage==='url-content-understanding');
});
test('permanent 400 request errors do not retry or trigger content fallback',async()=>{
 let calls=0;await assert.rejects(urlSourceService('https://example.com/article',{fetchText,client:{generateStructured:async()=>{calls++;throw Object.assign(new Error('Invalid request'),{status:400});}}}),error=>error.code==='AI_PROVIDER_ERROR'&&error.stage==='url-content-understanding'&&error.providerReason==='REQUEST_REJECTED');assert.equal(calls,1);
});
test('malformed analysis is discarded; raw evidence remains available for the validated planner',async()=>{
 const source=await urlSourceService('https://example.com/article',{fetchText,client:{generateStructured:async()=>({text:'{"invented":"Do not trust this"}',candidates:[{finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:10,totalTokenCount:110}})}});assert.equal(source.text,text);assert.equal(source.understanding.content,null);assert.equal(source.understanding.quality.bypassReason,'AI_SCHEMA_VALIDATION_FAILED');
});
test('SDK timeout diagnostics distinguish exception type/cause and never log source or credential prose',async()=>{
 const entries=[],schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};
 await assert.rejects(generateJsonWithRetry({client:{generateStructured:async()=>{throw new APIConnectionTimeoutError();}},schema,outputType:'source',stage:'url-content-understanding',maxAttempts:1,logger:value=>entries.push(value),request:{model:'claude-opus-5-5',contents:'secret-canary',config:{responseJsonSchema:schema}}}),e=>e.lastErrorCode==='AI_PROVIDER_TIMEOUT');
 assert.equal(entries[0].providerReason,'PROVIDER_TIMEOUT');assert.equal(entries[0].exceptionName,'APIConnectionTimeoutError');assert.ok(!JSON.stringify(entries).includes('secret-canary'));
});
test('timeout causes are classified even when wrapped in a generic SDK connection exception',()=>{
 const wrapped=new APIConnectionError({cause:Object.assign(new Error('Private socket detail'),{code:'ETIMEDOUT'})});assert.equal(isProviderTimeout(wrapped),true);assert.equal(isProviderTimeout(new APIConnectionError({cause:Object.assign(new Error('Reset'),{code:'ECONNRESET'})})),false);
});
test('required understanding timeout returns HTTP 504 with the AI stage and original request ID',async t=>{
 let generated=0;const app=createApp({deliveryLogger:()=>{},extractUrl:url=>urlSourceService(url,{fetchText,env:{URL_UNDERSTANDING_MS:'100',URL_EXTRACTION_TOTAL_MS:'1000',URL_UNDERSTANDING_REQUIRED:'true'},client:{generateStructured:()=>new Promise(()=>{})}}),generator:async()=>{generated++;}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/generate/urlPrompt`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urlPrompt:'https://example.com/article',outputType:'webpage'})}),body=await response.json();assert.equal(response.status,504);assert.equal(body.errorCode,'AI_PROVIDER_TIMEOUT');assert.equal(body.stage,'url-content-understanding');assert.equal(body.providerReason,'PROVIDER_TIMEOUT');assert.ok(body.requestId);assert.ok(!body.message.includes('source website'));assert.equal(generated,0);
});
test('recovered source passes through HTTP webpage planning, rendering, persistence and download',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-url-recovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const fixture=fixtures.business,planning=anthropicFixture(({schema})=>schema.properties.pageType?fixturePlan(fixture):fixtureDraft(fixture));let record;
 const app=createApp({webpageRoot:root,deliveryLogger:()=>{},model:{create:async value=>(record={...value,_id:'fixture',save:async()=>{}})},extractUrl:url=>urlSourceService(url,{fetchText:async()=>({text:fixture.source,contentType:'text/plain'}),client:{generateStructured:async()=>{throw Object.assign(new Error('Reset'),{code:'ECONNRESET'});}}}),generator:(kind,input,type,context)=>{assert.equal(input,fixture.source);assert.equal(context.sourceUnderstanding.content,null);return generateService(kind,input,type,context,{ai:{client:planning.client,logger:()=>{}},webpageAssets:{providers:[],curated:false,external:false},artifacts:{root}});}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});const origin=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(origin+'/api/generate/urlPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urlPrompt:'https://example.com/article',outputType:'webpage',context:{instructions:'Create an image-free website.'}})}),body=await response.json();assert.equal(response.status,201,JSON.stringify(body));assert.equal(planning.calls.length,2);assert.equal(record.status,'completed');assert.equal(body.data.result.status,'completed_with_warnings');assert.ok(body.data.result.warnings.some(w=>w.code==='URL_UNDERSTANDING_BYPASSED'));assert.equal((await fetch(origin+body.data.result.artifacts.downloadUrl)).status,200);
});
