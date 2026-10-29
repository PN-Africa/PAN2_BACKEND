import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationRepairBudget} from '../../Service/ai/presentationRepairBudget.mjs';
import {aiService} from '../../Service/aiService.mjs';
import {fallbackAllocationFixture} from '../fixtures/fallbackAllocation.mjs';
import {reviewAndRepairPresentation} from '../../Service/ai/presentationQuality.mjs';
import {coverageRecoveryFixture,recoveredSolarBody} from '../fixtures/coverageRecovery.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';

test('per-deck fallback reserves cannot be consumed by earlier slides',()=>{
 const legacy=presentationRepairBudget();assert.equal(legacy.claim(3,'fallback'),true);assert.equal(legacy.claim(7,'fallback'),true);assert.equal(legacy.claim(5,'fallback'),false);
 const b=presentationRepairBudget({fallbackSlideNumbers:[3,5,7]});assert.equal(b.claim(3,'fallback'),true);assert.equal(b.claim(7,'fallback'),true);assert.equal(b.claim(5,'fallback'),true);
 assert.equal(b.claim(5,'fallback'),false);assert.equal(b.availability(5,'fallback').reason,'SLIDE_RESERVE_USED');assert.equal(b.availability(1,'fallback').reason,'SLIDE_NOT_ELIGIBLE');assert.equal(b.claim(13,'fallback'),false);assert.equal(b.snapshot().request.fallbackCalls,6);
 const separate=presentationRepairBudget({fallbackSlideNumbers:[3,5,7]});assert.equal(separate.availability(5,'fallback').allowed,true);
});

test('a converted image-bearing slide keeps its recovery text capacity during a later semantic repair',async()=>{
 const f=await coverageRecoveryFixture(),initial=await aiService('prompt',f.prompt,'presentation',f.context,{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}});let reviews=0,contentCalls=0;
 const body=recoveredSolarBody+' Assess these supporting roles together.';
 const mock=anthropicFixture(({schema})=>{
  if(schema.properties.coverage)return {coverage:[{topic:'Solar generation and variability',slideNumbers:[6],adequate:true,evidence:'Solar cells convert sunlight'}],issues:reviews++===0?[{slideNumber:6,code:'DEPTH',severity:'error',message:'Explain the combined supporting roles.',repairInstruction:'State that these supporting roles should be assessed together.',repairTarget:'content.textContent.body'}]:[]};
  contentCalls++;const node=schema.properties.textContent.properties.body,limit=node.maxLength||Number(node.description.match(/maxLength: (\d+)/)[1]);assert.equal(limit,547);return {textContent:{heading:'Solar systems',body}};
 });
 const result=await aiService('prompt',f.prompt,'presentation',f.context,{initialPresentation:initial.generatedContent,client:mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}});
 assert.equal(contentCalls,1);assert.equal(reviews,2);assert.equal(result.generatedContent.slides[5].content.textContent.body,body);assert.equal(result.generatedContent.slideRecovery.budget.used.fallback,1);
});

test('structural validation reserves do not consume semantic targeted repairs',()=>{
 const b=presentationRepairBudget({fallbackSlideNumbers:[5]});assert.equal(b.claim(5,'validation'),true);assert.equal(b.claim(5,'targeted'),true);assert.equal(b.claim(5,'targeted'),false);assert.equal(b.claim(5,'fallback'),true);
});

test('f0a3dc60: slides 3 and 7 cannot prevent slide 5 from receiving its first fallback',async()=>{
 const f=await fallbackAllocationFixture(),logs=[];const r=await aiService('prompt',f.prompt,'presentation',f.context,{client:f.mock.client,logger:e=>logs.push(e),qualityLogger:()=>{},sleep:async()=>{}}),p=r.generatedContent;
 assert.deepEqual(f.fallbacks.slice().sort((a,b)=>a-b),[3,5,7]);assert.equal(f.outlines,1);assert.equal(f.reviews.length,2);assert.equal(p.slides.length,10);assert.equal(p.quality.reviewed,true);
 assert.equal(f.fallbacks.at(-1),5);
 for(const n of [3,5,7])assert.equal(p.slides[n-1].slideType,'focused-explanation');
 for(const s of p.slides)if(![3,5,7,10].includes(s.slideNumber))assert.deepEqual(s.content,f.deck.slides[s.slideNumber-1].content);
 assert.deepEqual(p.slides.map(s=>s.slideNumber),[1,2,3,4,5,6,7,8,9,10]);assert.equal(p.slideRecovery.budget.used.fallback,3);assert.equal(p.slideRecovery.budget.request.fallback,9);
 for(const n of [3,5,7])assert.equal(logs.filter(e=>e.stage==='slide-content-generation'&&e.slideNumber===n&&e.attempt===2).length,1);
});

test('small targeted length failures use one field-only repair rather than converting the slide',async()=>{
 const f=await fallbackAllocationFixture({repairFields:true}),r=await aiService('prompt',f.prompt,'presentation',f.context,{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}});
 assert.equal(f.patches.length,3);assert.deepEqual(f.fallbacks,[]);assert.equal(r.generatedContent.slides[2].slideType,'cards');assert.equal(r.generatedContent.slides[4].slideType,'text-visual');assert.equal(f.reviews.length,2);
});

test('unresolved factual defects still stop and report the actual reserve state without another conversion',async()=>{
 const f=await fallbackAllocationFixture({rejectReplacement:true});
 await assert.rejects(aiService('prompt',f.prompt,'presentation',f.context,{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}}),e=>e.code==='PRESENTATION_QUALITY_FAILED'&&e.recoveryReason==='SLIDE_ALREADY_CONVERTED'&&e.repairBudget.used.fallback===3&&e.repairHistory.length===4);
 assert.deepEqual(f.fallbacks.slice().sort((a,b)=>a-b),[3,5,7]);assert.equal(f.reviews.length,2);
});

test('a fallback round handles more than two pending slides with at most two concurrent rebuilds',async()=>{
 const slides=Array.from({length:10},(_,i)=>({slideNumber:i+1,slideType:'focused-explanation',title:'Subject '+(i+1),content:{textContent:{heading:'Subject',body:'An explanation with defined scope.'}}}));let review=0,active=0,peak=0;const rebuilt=[];
 const r=await reviewAndRepairPresentation({presentation:{title:'Systems',slides},input:'Explain systems.',inputType:'prompt',options:{qualityRepairRounds:0,logger:()=>{},qualityLogger:()=>{}},client:{generateStructured:async()=>({text:JSON.stringify({coverage:[],issues:review++===0?[3,5,7].map(n=>({slideNumber:n,code:'DEPTH',severity:'error',message:'Explain the roles.',repairInstruction:'Distinguish the component roles.'})):[]}),candidates:[{finishReason:'STOP'}]})},repairSlide:()=>assert.fail(),fallbackSlide:async s=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;rebuilt.push(s.slideNumber);return {...s,content:{textContent:{heading:'Distinct roles',body:'Components serve distinct roles within the system.'}}};}});
 assert.deepEqual(rebuilt.sort((a,b)=>a-b),[3,5,7]);assert.ok(peak<=2);assert.equal(r.slides.length,10);assert.equal(review,2);
});
