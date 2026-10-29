import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceWarningPolicy} from '../../Service/ai/referenceReviewPolicy.mjs';
import {reviewAndRepairPresentation} from '../../Service/ai/presentationQuality.mjs';
const reference=(message='A reference requires verification.',repairInstruction='Verify the reference externally before use.')=>({slideNumber:2,code:'REFERENCE',severity:'warning',message,repairInstruction,repairTarget:'content.textContent.body'});
const slide=n=>({slideNumber:n,slideType:'focused-explanation',title:'Evidence '+n,content:{textContent:{heading:'Evidence',body:'A qualified explanation with its scope and limitations.'}},photoAsset:{id:'asset-'+n}});
const run=({issues,input='Explain the subject.',context={},presentation={title:'Evidence',slides:Array.from({length:10},(_,i)=>slide(i+1))},repairSlide=()=>assert.fail('Unexpected repair'),fallbackSlide,...options})=>reviewAndRepairPresentation({presentation,input,inputType:'prompt',context,client:{generateStructured:async request=>({text:JSON.stringify({coverage:[],issues:typeof issues==='function'?issues(request):issues}),candidates:[{finishReason:'STOP'}]})},options:{logger:()=>{},qualityLogger:()=>{},...options},repairSlide,fallbackSlide});

test('optional reference verification returns warnings immediately without spending repair capacity',async()=>{
 const events=[],result=await run({issues:[reference()],qualityLogger:e=>events.push(e)});
 assert.equal(result.quality.status,'completed_with_warnings');assert.equal(result.quality.reviewed,true);assert.equal(result.quality.repairRounds,0);assert.deepEqual(result.quality.repairHistory,[]);
 assert.equal(result.warnings[0].code,'CONTENT_REFERENCE');assert.deepEqual(result.slides,Array.from({length:10},(_,i)=>slide(i+1)));
 assert.equal(events[0].referenceDecisions[0].reason,'OPTIONAL_REFERENCE_LIMITATION');assert.equal(events[0].blockingIssues.length,0);
});

test('reference warnings never excuse actual citation defects, unsupported claims or required citations',()=>{
 for(const message of ['The citation was fabricated.','The source is nonexistent.','The quotation is misattributed.','The reference URL is broken.','The source does not support the claim.','The claim is unsupported.','The statistic requires verification.','The source cannot be traced.','The claim has no source.','The 40% rate has no source.'])assert.equal(referenceWarningPolicy(reference(message,'Correct this source defect.')).nonBlocking,false,message);
 for(const input of ['Include citations.','Provide authoritative references.','Cite every claim.','Add a bibliography.','Use APA-style citations.'])assert.equal(referenceWarningPolicy(reference(),{input}).nonBlocking,false,input);
 assert.equal(referenceWarningPolicy(reference(),{context:{requireCitations:true}}).nonBlocking,false);
 assert.equal(referenceWarningPolicy({...reference(),severity:'error'}).nonBlocking,false);
 assert.equal(referenceWarningPolicy({...reference(),code:'FACTUAL'}).nonBlocking,false);
});

test('a real reference defect remains blocked after bounded targeted and fallback attempts',async()=>{
 let targeted=0,fallback=0;
 await assert.rejects(run({issues:[reference('The citation is fabricated.','Remove the invented citation and correct the unsupported claim.')],repairSlide:async s=>{targeted++;s.content.textContent.body+=' Revised.';return s;},fallbackSlide:async s=>{fallback++;s.content.textContent.body+=' Rebuilt.';return s;}}),error=>error.code==='PRESENTATION_QUALITY_FAILED'&&error.stopReason==='REPAIR_BUDGET_EXHAUSTED');
 assert.equal(targeted,1);assert.equal(fallback,1);
});

test('mixed review repairs only the substantive slide and retains the unchanged reference warning',async()=>{
 let reviews=0,repairs=0;const prompts=[];
 const result=await run({issues:request=>{prompts.push(request.contents);return reviews++===0?[reference(),{slideNumber:6,code:'DEPTH',severity:'error',message:'The mechanism is missing.',repairInstruction:'Explain the supported mechanism.',repairTarget:'content'}]:[];},repairSlide:async s=>{repairs++;assert.equal(s.slideNumber,6);s.content.textContent.body='The mechanism is explained with supported scope and limitations.';return s;}});
 assert.equal(reviews,2);assert.equal(repairs,1);assert.equal(result.quality.status,'completed_with_warnings');assert.equal(result.warnings[0].slideNumber,2);assert.ok(prompts[1].includes('contextSlides'));
 assert.deepEqual(result.slides.filter(s=>s.slideNumber!==6),Array.from({length:10},(_,i)=>slide(i+1)).filter(s=>s.slideNumber!==6));
 assert.deepEqual(result.slides.map(s=>s.slideNumber),Array.from({length:10},(_,i)=>i+1));
});

test('an optional reference warning does not override deterministic unsupported-claim checks',async()=>{
 const presentation={title:'Evidence',slides:[slide(1),slide(2)]};presentation.slides[0].content.textContent.body='This guarantees safety.';
 await assert.rejects(run({presentation,issues:[reference()],repairSlide:async s=>s}),{code:'PRESENTATION_QUALITY_FAILED'});
});
