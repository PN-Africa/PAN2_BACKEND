import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../../src/app.mjs';
import {generateService} from '../../Service/generateService.mjs';
import {planImageCoverage} from '../../Service/visual/imageArtDirection.mjs';
import {generationOutcome} from '../../Service/generationOutcome.mjs';
import {publicGenerationResult} from '../../Service/publicGenerationResult.mjs';
import {stakeholderDeck,stakeholderCases} from '../fixtures/stakeholderCases.mjs';
const prompt="Generate a premium, visually stunning, stakeholder-ready PowerPoint presentation titled 'The Future of Artificial Intelligence";
function deck(){const d=stakeholderDeck(stakeholderCases.ai);d.slides[0].content.titleContent.supportingText='Learning from examples.';d.slides=d.slides.filter((_,i)=>i!==6).map((s,i)=>({...s,slideNumber:i+1,visualRequirement:i<5?{role:i?'foreground':'background',kind:'photo',required:true,description:'Computing research context',searchQuery:'computing research',altText:'Computing research'}:{role:'none',kind:'none',required:false,description:'',searchQuery:'',altText:''}}));return d;}
test('abbc625b: planner required flags do not turn four decorative photos into essential requirements',()=>{
 const result=planImageCoverage(deck(),{instructions:prompt});assert.equal(result.slides.filter(s=>s.imageRequirement).length,5);assert.deepEqual(result.imageCoveragePlan.requiredSlideNumbers,[1]);assert.ok(result.slides.slice(1,5).every(s=>s.imageRequirement.requirementOrigin==='planner'));
 const explicit=planImageCoverage(deck(),{instructions:'Every slide must include a photograph.'});assert.equal(explicit.imageCoveragePlan.requiredSlideNumbers.length,9);
 const scoped=planImageCoverage(deck(),{instructions:'Include a photograph on slide 3.'});assert.deepEqual(scoped.imageCoveragePlan.requiredSlideNumbers,[1,3]);
 const inferred=planImageCoverage(deck(),{instructions:prompt,keyInstructions:['Every slide must have images.'],imageRequirementInstructions:prompt});assert.deepEqual(inferred.imageCoveragePlan.requiredSlideNumbers,[1]);
});
test('recovered presentation outcome preserves ordinary successful states and strips private diagnostics only for presentations',()=>{
 const r={outputType:'presentation',status:'completed',recovery:{status:'completed_with_recovery'},preview:{previewId:'fixture'},generatedContent:{visualQuality:{diagnostics:[{stack:'secret'}],failedRequests:[{reason:'secret'}]},warnings:[{message:'Adapted',imageFailures:[{reasonCode:'PROVIDER_TIMEOUT'}]}]}};
 assert.deepEqual(generationOutcome(r),{state:'complete',recoverable:false,artifactsAvailable:true,recovered:true});assert.ok(!JSON.stringify(publicGenerationResult(r)).includes('secret'));assert.ok(!JSON.stringify(publicGenerationResult(r)).includes('PROVIDER_TIMEOUT'));
 assert.equal(publicGenerationResult({outputType:'document',diagnostics:['retained']}).diagnostics[0],'retained');
});
test('abbc625b: nine slides, one of five photos, four professional fallbacks deliver successful HTTP/database/job states and downloads',async t=>{
 const records=[],content=deck(),root=path.resolve('generated/recovery-delivery-abbc625b');await fs.mkdir(root,{recursive:true});let result;
 const cover={slideNumber:1,buffer:await fs.readFile('assets/webpage/curated/computing-cern.jpg'),description:'Computing research',source:'Controlled licensed fixture',creator:'Regression fixture',license:'Local test fixture'};
 const app=createApp({jobRoot:path.join(root,'jobs'),deliveryLogger:()=>{},model:{create:async value=>{const record={...value,save:async()=>{records.push({status:record.status,outcome:record.outcome});}};return record;}},generator:async(kind,input,output,context)=>result??=await generateService(kind,input,output,context,{completedContent:{inputType:kind,input,outputType:output,generatedContent:content},visuals:{providers:{search:async()=>null},userAssets:[cover],external:false,diagramPlanner:false,cacheRoot:path.join(root,'assets'),policy:{retries:0}}})});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>server.close());const origin='http://127.0.0.1:'+server.address().port,body={textPrompt:prompt,outputType:'presentation'};
 const response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),json=await response.json();assert.equal(response.status,201,JSON.stringify(json));const r=json.data.result;
 assert.equal(r.status,'completed');assert.equal(r.outcome.state,'complete');assert.equal(r.outcome.recovered,true);assert.equal(r.outcome.artifactsAvailable,true);assert.equal(json.errorCode,undefined);assert.equal(json.data.request.status,'completed');assert.equal(records.at(-1).status,'completed');assert.equal(r.generatedContent.slides.length,9);
 assert.equal(r.generatedContent.visualQuality.actual,1);assert.deepEqual(r.imageValidation.requiredMissing,[]);assert.equal(r.generatedContent.imageCoveragePlan.plannedTarget,5);assert.equal(r.generatedContent.imageCoveragePlan.target,1);assert.deepEqual(r.recovery.optionalImageSlides,[2,3,4,5]);assert.ok(r.generatedContent.slides.slice(1,5).every(s=>s.visualResolution.status==='adapted'&&s.visualRequirement.required===false));assert.ok(r.designSpecification.assets.filter(a=>['slide-2','slide-3','slide-4','slide-5'].includes(a.contentId)&&a.kind==='photo').every(a=>!a.required));
 for(const url of [r.preview.downloads.pptx,r.preview.downloads.pdf,...r.preview.slides.map(s=>s.url)]){const download=await fetch(origin+url);assert.equal(download.status,200);assert.ok((await download.arrayBuffer()).byteLength>100);}
 const queued=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'respond-async'},body:JSON.stringify(body)}),accepted=await queued.json();assert.equal(queued.status,202);let job;
 for(let i=0;i<200;i++){job=(await (await fetch(origin+accepted.data.statusUrl)).json()).data;if(['completed','failed'].includes(job.status))break;await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(job.status,'completed');assert.equal(job.error,undefined);assert.equal(job.result.status,'completed');assert.equal(job.outcome.recovered,true);
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify({requestId:'abbc625b-e6e6-440c-b55f-3d30e3e1fe0e',httpStatus:response.status,slides:9,requestedImages:5,retrievedImages:1,adaptedSlides:r.recovery.optionalImageSlides,outcome:r.outcome,preview:r.preview,jobStatus:job.status},null,2));
});
