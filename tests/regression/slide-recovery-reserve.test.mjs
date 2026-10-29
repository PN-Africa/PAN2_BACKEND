import {failingFixture} from '../fixtures/slideFallback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {textCharacterBudget} from '../../renderer/presentation/contentFit.mjs';
import {validateRenderContent,validatePlannedRenderContent,renderProfessionalSlide} from '../../renderer/presentation/professionalLayouts.mjs';
import {fieldRepairPlan} from '../../Service/ai/fieldRepair.mjs';
import {presentationRepairBudget} from '../../Service/ai/presentationRepairBudget.mjs';
import {reviewAndRepairPresentation,visibleSlideText} from '../../Service/ai/presentationQuality.mjs';
import {aiService} from '../../Service/aiService.mjs';
import {hypertensionFixture,hypertensionPrompt,diagramContent} from '../fixtures/hypertensionRecovery.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';
import {designPlan} from '../fixtures/designPlan.mjs';
const response=value=>({text:JSON.stringify(value),candidates:[{finishReason:'STOP'}]});
const issue=(n,code='CLARITY')=>({slideNumber:n,severity:'error',code,message:'The relation fails to say that the source actor influences the named target.',repairInstruction:'State the actors and their supported relation explicitly; do not replace the relation with A or B.'});
const slide=(n,body='Evidence supports a qualified conclusion.')=>({slideNumber:n,slideType:'focused-explanation',title:'Evidence '+n,subtitle:'',objective:'Explain evidence',content:{textContent:{heading:'Evidence',body}}});

test('e46031e8: long endpoint names no longer consume the relationship-label budget',()=>{
 const labels=['Peripheral vascular resistance','Cardiovascular response pathways','Arterial elasticity mechanisms','Circulating blood volume'];
 const prefix=labels[0]+' → '+labels[1]+': ';assert.equal(Math.max(1,textCharacterBudget({w:4.9,h:.82,fontSize:18})-prefix.length),1);
 const s={slideNumber:5,slideType:'relationship',title:'Related factors',content:{relationship:{nodes:labels.map((label,i)=>({id:'n'+i,label,description:'Related factor'})),relationships:[{from:'n0',to:'n1',label:'affects blood flow'},{from:'n1',to:'n2',label:'changes the response'},{from:'n2',to:'n3',label:'supports circulation'},{from:'n3',to:'n0',label:'influences pressure'}]}}};
 assert.equal(validateRenderContent(s),true);const fields=[],texts=[];
 renderProfessionalSlide({slideData:s,slide:{addText(value){texts.push(value);},addShape(){},addImage(){},addChart(){}},onTextLayout:e=>fields.push(e)});
 for(const edge of s.content.relationship.relationships)assert.ok(texts.includes(edge.label));
 assert.ok(texts.includes('1 → 2'));for(const field of fields.filter(e=>/^relationship\.relationships/.test(e.field)))assert.ok(textCharacterBudget(field)>=20);
});

test('a one-character repair cannot masquerade as a meaningful relationship or change units',()=>{
 const input={relationship:{relationships:[{label:'affects blood flow'}]},text:'Pressure may rise by 10 mmHg.'};
 let plan=fieldRepairPlan(JSON.stringify(input),{field:'relationship.relationships[0].label',maxCharacters:1});assert.equal(plan.assess({value:'A'}).errors.length,1);
 plan=fieldRepairPlan(JSON.stringify(input),{field:'text',maxCharacters:40});assert.equal(plan.assess({value:'Pressure may rise by 10 mg.'}).errors.length,1);assert.equal(plan.assess({value:'Pressure rises by 10 mmHg.'}).errors.length,1);
});

test('review evidence includes visible native diagram text but excludes search instructions',()=>{
 const content=diagramContent();content.visualContent.visual.description='PRIVATE ASSET INSTRUCTION';content.visualContent.visual.searchQuery='PRIVATE SEARCH';
 const visible=visibleSlideText({content});assert.match(visible,/Peripheral vascular resistance/);assert.match(visible,/Blood volume/);assert.doesNotMatch(visible,/PRIVATE/);
});

test('fallback capacity is reserved even after every ordinary request repair is consumed',()=>{
 const budget=presentationRepairBudget();for(let n=1;n<=4;n++)assert.equal(budget.claim(n,'targeted'),true);assert.equal(budget.claim(5,'targeted'),false);
 assert.equal(budget.claim(1,'targeted'),false);assert.equal(budget.claim(1,'fallback'),true);assert.equal(budget.claim(2,'fallback'),true);assert.equal(budget.claim(1,'fallback'),false);assert.equal(budget.claim(3,'fallback'),false);
});

test('a structurally accepted but meaningless quality repair triggers a reviewed text fallback',async()=>{
 const good={...slide(1),photoAsset:{id:'approved-asset',data:'preserved-media'}},bad=slide(2,'A relation needs its actors.'),presentation={title:'Evidence',slides:[good,bad]},original=JSON.stringify(good),seen=[];let reviews=0,targeted=0,fallbacks=0;
 const result=await reviewAndRepairPresentation({presentation,input:'Explain evidence.',inputType:'prompt',client:{generateStructured:async r=>{seen.push(r.contents);return response({coverage:[],issues:reviews++<2?[issue(2,reviews===1?'CLARITY':'FACTUAL')]:[]});}},options:{logger:()=>{},qualityLogger:()=>{}},repairSlide:async s=>{targeted++;s.content.textContent.body='A → B.';return s;},fallbackSlide:async(s,instructions,plan)=>{fallbacks++;assert.match(instructions,/actors/);assert.match(plan.reviewFeedback[0].repairInstruction,/supported relation/);return {...s,content:{textContent:{heading:'Explicit relationships',body:'The source actor influences the named target within the stated scope.'}},contentFallback:{from:s.slideType,to:'focused-explanation'}};}});
 assert.equal(targeted,1);assert.equal(fallbacks,1);assert.equal(reviews,3);assert.equal(JSON.stringify(good),original);assert.equal(result.slides[0],good);assert.equal(result.slides[1].slideNumber,2);assert.ok(seen[2].includes('contextSlides'));assert.equal(result.quality.repairHistory.at(-1).method,'fallback');
});

test('factual or clarity errors in a fallback remain blocked; minor explicit warnings can pass',async()=>{
 for(const code of ['FACTUAL','CLARITY']){
  let repairs=0,rebuilds=0;await assert.rejects(reviewAndRepairPresentation({presentation:{title:'Evidence',slides:[slide(1)]},input:'Explain evidence.',inputType:'prompt',client:{generateStructured:async()=>response({coverage:[],issues:[issue(1,code)]})},options:{logger:()=>{},qualityLogger:()=>{}},repairSlide:async s=>{repairs++;s.content.textContent.body='An edited but unsupported relation.';return s;},fallbackSlide:async s=>{rebuilds++;return {...s,content:{textContent:{heading:'Still wrong',body:'An unsupported conclusion.'}}};}}),{code:'PRESENTATION_QUALITY_FAILED'});assert.equal(repairs,1);assert.equal(rebuilds,1);
 }
 const result=await reviewAndRepairPresentation({presentation:{title:'Evidence',slides:[slide(1)]},input:'Explain evidence.',inputType:'prompt',client:{generateStructured:async()=>response({coverage:[],issues:[{...issue(1,'REPETITION'),severity:'warning',message:'A minor stylistic phrase repeats; all essential explanations remain clear.'}]})},options:{logger:()=>{},qualityLogger:()=>{}},repairSlide:()=>assert.fail()});assert.equal(result.quality.status,'completed_with_warnings');
});

test('two exhausted diagram slides become supported text slides while ten successful slides stay unchanged',async()=>{
 const f=failingFixture(),before=structuredClone(f.deck),result=await aiService('prompt',hypertensionPrompt,'presentation',f.context,{client:f.mock.client,logger:e=>f.logs.push(e),qualityLogger:()=>{},layoutLogger:()=>{},sleep:async()=>{}});
 assert.equal(f.outlines,1);assert.deepEqual(f.fallbacks.slice().sort((a,b)=>a-b),[8,11]);assert.equal(result.generatedContent.slides.length,12);assert.deepEqual(result.generatedContent.slides.map(s=>s.slideNumber),Array.from({length:12},(_,i)=>i+1));
 for(const s of result.generatedContent.slides)if([8,11].includes(s.slideNumber)){assert.equal(s.slideType,'focused-explanation');assert.equal(validateRenderContent(s),true);assert.equal(f.attempts.get(s.slideNumber),3);}else assert.deepEqual(s.content,before.slides[s.slideNumber-1].content);
 assert.equal(result.generatedContent.slideRecovery.budget.used.fallback,2);assert.equal(f.logs.filter(e=>e.stage==='slide-fallback-generation').length,2);assert.equal(result.generatedContent.quality.reviewed,true);
});

test('a failed replacement stays controlled and successful work remains in checkpoints',async()=>{
 const f=failingFixture([8],true),checkpoints=[];
 await assert.rejects(aiService('prompt',hypertensionPrompt,'presentation',f.context,{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},layoutLogger:()=>{},sleep:async()=>{},onSlideCheckpoint:d=>checkpoints.push(structuredClone(d))}),{code:'PRESENTATION_QUALITY_FAILED'});
 assert.equal(f.outlines,1);assert.equal(f.fallbacks.length,1);assert.ok(checkpoints.at(-1).slides[0].content.titleContent);assert.ok(checkpoints.at(-1).slides[1].content.textContent);assert.ok(f.attempts.get(8)<=5); // three draft calls plus two bounded semantic calls
});

test('fallback updates only its own design component and removes only its obsolete diagram vector',async()=>{
 const f=failingFixture([8]);f.deck.artifactDesign=designPlan(f.deck);f.deck.artifactDesign.vectors=[{contentId:'slide-8',description:'Previous diagram',svg:'<svg viewBox="0 0 100 100"><rect x="1" y="1" width="90" height="90" fill="#123456"/></svg>'}];
 const before=structuredClone(f.deck.artifactDesign.units),result=await aiService('prompt',hypertensionPrompt,'presentation',f.context,{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},layoutLogger:()=>{},sleep:async()=>{}});
 assert.equal(result.generatedContent.artifactDesign.units[7].component,'explanation-editorial');assert.deepEqual(result.generatedContent.artifactDesign.vectors,[]);assert.equal(result.generatedContent.slides[7].contentFallback.replacedStaleDiagramVector,true);for(let i=0;i<12;i++)if(i!==7)assert.deepEqual(result.generatedContent.artifactDesign.units[i],before[i]);
});

test('resumed converted slides are reviewed and cannot spend another fallback attempt',async()=>{
 const f=failingFixture([8]),first=await aiService('prompt',hypertensionPrompt,'presentation',f.context,{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}});
 let reviews=0,contentCalls=0;const mock=anthropicFixture(({schema})=>{
  if(schema.properties.coverage){reviews++;return {coverage:[],issues:[issue(8,'FACTUAL')]};}
  contentCalls++;assert.ok(schema.properties.textContent);return {textContent:{heading:'A revised claim',body:'The revised explanation still needs factual review.'}};
 });
 await assert.rejects(aiService('prompt',hypertensionPrompt,'presentation',f.context,{initialPresentation:first.generatedContent,qualityReview:false,client:mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}}),error=>error.code==='PRESENTATION_QUALITY_FAILED'&&error.stopReason==='FALLBACK_BUDGET_EXHAUSTED');
 assert.equal(reviews,2);assert.equal(contentCalls,1);
});

test('20 and 40 character diagram descriptions reflect real geometry and resolve to canonical fields',()=>{
 for(const count of [2,3]){
  const content=diagramContent(),d=content.visualContent.visual.diagram;content.visualContent.text=count===2?'Related factors.':'Several physiological factors contribute to changes in blood pressure and influence the response of the circulation.';d.kind=count===2?'labeled':'flowchart';d.nodes=Array.from({length:count},(_,i)=>({id:'n'+i,label:'Related factor',description:'Wide words WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW'}));d.edges=count===2?[]:[{from:'n0',to:'n1',label:'influences'},{from:'n0',to:'n2',label:'influences'}];d.caption=count===2?'Simplified model.':'This simplified explanatory diagram shows related factors and their connections for educational discussion.';
  let error;try{validatePlannedRenderContent({slideNumber:8,slideType:'text-visual',title:'Related factors',imageLayoutPlanned:true,content});}catch(e){error=e;}
  assert.ok(error.validationErrors.some(e=>e.field.endsWith('.description')&&e.maxCharacters===(count===2?40:20)));const plan=fieldRepairPlan(JSON.stringify(content),error);assert.ok(plan.fields.includes('visualContent.visual.diagram.nodes[0].description'));
 }
});

test('a fallback must retain a numerical value and its unit even when a mocked reviewer would approve',async()=>{
 for(const retain of [false,true]){
  const f=failingFixture([8],false,'Peripheral vascular resistance is related to blood flow.'+(retain?' The supplied difference is 25 mmHg.':''));f.deck.slides[7].content.visualContent.text+=' The supplied difference is 25 mmHg.';
  const work=aiService('prompt',hypertensionPrompt+' Supplied illustrative pressure difference: 25 mmHg.','presentation',f.context,{client:f.mock.client,logger:()=>{},qualityLogger:()=>{},layoutLogger:()=>{},sleep:async()=>{}});
  if(retain){const result=await work;assert.match(result.generatedContent.slides[7].content.textContent.body,/25 mmHg/);}else await assert.rejects(work,error=>error.stage==='slide-fallback-generation'&&error.validationRule==='FALLBACK_FACT_PRESERVATION');
  assert.equal(f.fallbacks.length,1);
 }
});
