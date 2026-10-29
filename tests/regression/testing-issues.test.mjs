import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../../src/app.mjs';
import {once} from 'node:events';
import {testingIssuesRequests} from '../fixtures/testingIssuesRequests.mjs';
import {resolveSlideCount} from '../../Service/ai/slideCount.mjs';
import {renderProfessionalSlide,validateRenderContent} from '../../renderer/presentation/professionalLayouts.mjs';
import {presentationLayoutService} from '../../Service/presentationLayoutService.mjs';
import {isAutomaticImageLabel} from '../../renderer/imageLabels.mjs';
import {generateService} from '../../Service/generateService.mjs';
import {reviewAndRepairPresentation} from '../../Service/ai/presentationQuality.mjs';
import {isInformationalWebsite,validateWebsiteClaims} from '../../Service/webpage/contentGrounding.mjs';
import {fixtures} from '../fixtures/presentationContent.mjs';
import {candidateSuitability} from '../../Service/visual/imageProviders.mjs';
import {hero} from '../../renderer/webpage/components.mjs';

test('exactly 2000 characters traverse the production HTTP middleware for both output types',async t=>{
 const reached=[];const app=createApp({model:{create:async value=>({...value,save:async()=>{}})},generator:async(kind,input,output)=>{reached.push({kind,input,output});return {status:'completed',outputType:output,generatedContent:{title:'Accepted'}};}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const fixture of testingIssuesRequests.slice(0,2)){
  assert.equal(fixture.textPrompt.length,2000);
  const response=await fetch(base+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fixture)});
  assert.equal(response.status,201);assert.equal(reached.at(-1).input,fixture.textPrompt);
  const rejected=await fetch(base+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fixture,textPrompt:fixture.textPrompt+'x'})});assert.equal(rejected.status,400);
 }
 assert.equal(reached.length,2);
});
test('slide counts in context instructions and typographic hyphens are explicit counts',()=>{
 for(const input of ['Create a 10‑slide deck.','Create ten–slide PowerPoint slides.'])assert.equal(resolveSlideCount(input).min,10);
 assert.equal(resolveSlideCount('Explain transport',{instructions:'Create exactly 10 slides.'}).min,10);
});
test('stock metadata rejects archival buildings, paintings and forensic photos for modern property advertising',()=>{
 for(const description of ['Built in 1857, this Italianate residence is now categorized under modern architecture.','Luxury living room interior oil on canvas painting.','Modern mansion pool, Palm Beach Police Department search at Jeffrey Epstein mansion.'])assert.equal(candidateSuitability('modern luxury mansion living room',{mediaKind:'photograph',description},{partial:true}),-1);
 assert.equal(candidateSuitability('modern luxury mansion',{mediaKind:'photograph',description:'Krueger Scott Mansion; Newark, NJ; Close-up entry on sidewalk'},{partial:true}),-1);
 assert.equal(candidateSuitability('luxury living room',{mediaKind:'photograph',description:'Reconstruction of the living room of a typical rural house.'},{partial:true}),-1);
});
test('titles, subtitles and body text share sizes across photo and native compositions without labels',()=>{
 const native=[],photo=[];
 const make=items=>({addText:(value,options)=>items.push({value,...options}),addShape(){},addImage(){},addChart(){}});
 const content={titleContent:{title:'Transport choices',subtitle:'A practical overview',supportingText:'Options for cities'}};
 renderProfessionalSlide({slide:make(native),slideData:{slideNumber:1,slideType:'title',title:'Transport choices',content,layoutId:'title-editorial'}});
 renderProfessionalSlide({slide:make(photo),slideData:{slideNumber:1,slideType:'title',title:'Transport choices',content,photoAsset:{data:'test',synthetic:true},photoComposition:'hero-full-bleed'}});
 for(const value of ['Transport choices','A practical overview','Options for cities'])assert.equal(native.find(t=>t.value===value).fontSize,photo.find(t=>t.value===value).fontSize);
 assert.ok(!photo.some(t=>isAutomaticImageLabel(t.value)));
});
test('website photo boilerplate is omitted from visible captions while metadata is retained',()=>{
 for(const caption of ['AI-generated illustration','Illustrative photograph','AI-generated conceptual illustration; not an actual photograph of this organization.']){
  const asset={url:'./assets/house.jpg',width:1200,height:800,alt:'A house',caption};
  const html=hero({brandName:'Homes',hero:{headline:'Places to live',subheadline:'Explore housing',actionLabel:'Explore'},heroTarget:'#overview',contact:{},visualAssets:{hero:asset},sections:[{id:'overview',heading:'Overview',content:'Housing overview',items:[]}]});
  assert.ok(!html.includes('<figcaption>'));assert.equal(asset.caption,caption);
 }
});
test('process prose is checked against final layout candidates before generation is approved',()=>{
 const slide={slideNumber:11,slideType:'process',title:'Customer journey',content:{process:{steps:Array.from({length:4},(_,i)=>({stepNumber:i+1,title:`Stage ${i+1}`,description:'Discuss the priorities, review suitable homes and arrange a private viewing with an advisor before choosing the next step.'}))}}};
 assert.throws(()=>validateRenderContent({...slide,layoutId:'process-horizontal'}));
 const planned=presentationLayoutService({title:'Property',slides:[slide]});assert.equal(planned.slides[0].layoutId,'process-vertical');assert.equal(validateRenderContent(planned.slides[0]),true);
});
test('resumed content cannot silently return eight slides for an explicit ten-slide request',async()=>{
 await assert.rejects(generateService('prompt','Create exactly 10 slides about transport.','presentation',{}, {completedContent:{generatedContent:{slides:Array.from({length:8},()=>({}))}},prefetchImages:false}),error=>error.code==='AI_SCHEMA_VALIDATION_FAILED'&&error.expectedSlides===10&&error.actualSlides===8);
});
test('unresolved clarity, factual and coverage errors remain blocking after bounded repairs',async()=>{
 const presentation={title:'Transport',slides:[{slideNumber:1,title:'Transport choices',slideType:'focused-explanation',content:{textContent:{body:'Cities can compare walking and public transport.'}}}]};
 for(const code of ['CLARITY','FACTUAL','COVERAGE']){
  const client={models:{generateContent:async()=>({text:JSON.stringify({coverage:[],issues:[{slideNumber:1,severity:'error',code,message:'Review the explanation.',repairInstruction:'Explain the comparison.'}]}),candidates:[{finishReason:'STOP'}]})}};
  const work=reviewAndRepairPresentation({presentation:structuredClone(presentation),input:'Explain transport choices.',inputType:'prompt',context:{},client,options:{logger:()=>{}},repairSlide:async slide=>slide.content});
  await assert.rejects(work,{code:'PRESENTATION_QUALITY_FAILED'});
 }
});
test('educational prompts mentioning excluded business claims do not become corporate facility claims',()=>{
 const source=testingIssuesRequests.find(r=>r.name==='long-webpage').textPrompt;
 assert.equal(isInformationalWebsite('education',source),true);
 const page={pageType:'education',brandName:'Urban Transport',sections:[{heading:'Electric buses',content:'Depot charging infrastructure supports battery-electric fleets.',items:[{title:'Depot facilities',description:'Charging facilities need grid connections.'}]}]};
 assert.doesNotThrow(()=>validateWebsiteClaims(page,source,{pageType:'education'}));
 assert.equal(isInformationalWebsite('education','Build a website for our school. We offer courses.'),false);
 assert.throws(()=>validateWebsiteClaims({...page,sections:[{heading:'Our school',content:'Our school owns certified facilities.',items:[]}]},'Build a website for our school.',{pageType:'education'}));
});
test('failed post-content work aborts in-flight image prefetch',async()=>{
 let aborted=false,started=false,notifyStarted;const entered=new Promise(resolve=>{notifyStarted=resolve;});
 const plan={outputType:'presentation',strategyId:'business-strategy',title:'Source review',subtitle:'A practical overview',inferredContext:{userRole:'',purpose:'Explain source review',audience:'Readers',topic:'Source review',tone:'professional',keyInstructions:[]},slides:[{slideNumber:1,slideType:'title',title:'Source review',visualRequirement:{kind:'photo',role:'background',description:'Research library',searchQuery:'library',sourceStrategy:'licensed-search-first'}},{slideNumber:2,slideType:'summary',title:'Review conclusions'}]};
 Object.assign(plan.slides[0].visualRequirement,{required:true,altText:'Research library'});
 const client={models:{generateContent:async request=>{
  const properties=request.config.responseJsonSchema.properties;
  const value=properties.strategyId?structuredClone(plan):{[Object.keys(properties)[0]]:structuredClone(fixtures[Object.keys(properties)[0]])};
  return {text:JSON.stringify(value),candidates:[{finishReason:'STOP'}]};
 }}};
 await assert.rejects(generateService('prompt','Create exactly two slides explaining source review.','presentation',{}, {ai:{client,qualityReview:false,logger:()=>{}},onContentReady:async()=>{let timer;try{await Promise.race([entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Image provider did not start')),3000);})]);}finally{clearTimeout(timer);}assert.equal(started,true);throw new Error('Post-content fixture failure');},visuals:{providers:{search:async brief=>{started=true;notifyStarted();await new Promise(resolve=>brief.signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));return null;}},policy:{retries:0}}}),/Post-content fixture failure/);
 assert.equal(aborted,true);
});
