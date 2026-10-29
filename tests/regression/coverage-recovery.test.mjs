import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageRecoveryFixture,recoveredSolarBody} from '../fixtures/coverageRecovery.mjs';
import {aiService} from '../../Service/aiService.mjs';
import {imageSlideSchema} from '../../Service/ai/presentationContentBudget.mjs';
import {photoCompositionFor} from '../../Service/visual/imageArtDirection.mjs';
import {validatePlannedRenderContent} from '../../renderer/presentation/professionalLayouts.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createImageAssetSession} from '../../Service/visual/presentationImageAssets.mjs';
import {photoSignature,photoSubjectSignature,planImageCoverage} from '../../Service/visual/imageArtDirection.mjs';
import {resolvePresentationVisuals,deriveVisualTheme} from '../../Service/visual/presentationVisuals.mjs';
import {presentationThemeService} from '../../Service/presentationThemeService.mjs';
import {imagePolicy} from '../../Service/visual/imagePolicy.mjs';
const options=f=>({client:f.mock.client,logger:()=>{},qualityLogger:()=>{},sleep:async()=>{}});

test('993d87a3: recovery expands the existing text/photo composition, not every image budget',()=>{
 const schema={type:'object',properties:{textContent:{type:'object',properties:{heading:{type:'string'},body:{type:'string'}}}}};
 assert.equal(imageSlideSchema(schema).properties.textContent.properties.body.maxLength,280);
 assert.equal(imageSlideSchema(schema,{recoveryText:true}).properties.textContent.properties.body.maxLength,547);
 assert.ok(recoveredSolarBody.length>280);assert.equal(schema.properties.textContent.properties.body.maxLength,undefined);
 const s={slideNumber:6,slideType:'focused-explanation',title:'Solar systems',imageLayoutPlanned:true,contentFallback:{to:'focused-explanation'},content:{textContent:{heading:'Solar systems',body:recoveredSolarBody}}};
 assert.equal(photoCompositionFor(s),'photo-technical');assert.equal(validatePlannedRenderContent(s),true);
});

test('coverage then clarity repairs retain the original findings and essential points through fallback',async()=>{
 const f=await coverageRecoveryFixture(),before=structuredClone(f.deck),r=await aiService('prompt',f.prompt,'presentation',f.context,options(f)),p=r.generatedContent;
 assert.equal(f.reviews.length,3);assert.deepEqual(f.fallbacks,[6]);assert.equal(f.drafts.get(6),3);assert.equal(p.slides.length,10);
 assert.deepEqual(p.slides.map(s=>s.slideNumber),Array.from({length:10},(_,i)=>i+1));
 for(const s of p.slides)if(s.slideNumber!==6)assert.deepEqual(s.content,before.slides[s.slideNumber-1].content);
 assert.equal(p.slides[5].content.textContent.body,recoveredSolarBody);assert.equal(p.quality.status,'completed');
 const replacement=f.reviews[2].replacements[0];assert.ok(replacement.feedback.some(i=>i.code==='COVERAGE'));assert.ok(replacement.feedback.some(i=>i.code==='CLARITY'));
 assert.equal(p.slideRecovery.budget.used.targeted,1);assert.equal(p.slideRecovery.budget.used.fallback,1);
});

test('a replacement with remaining essential coverage errors still fails within the same bounded budget',async()=>{
 const f=await coverageRecoveryFixture({rejectFallback:true});await assert.rejects(aiService('prompt',f.prompt,'presentation',f.context,options(f)),error=>error.code==='PRESENTATION_QUALITY_FAILED'&&error.stopReason==='REPAIR_BUDGET_EXHAUSTED');
 assert.deepEqual(f.fallbacks,[6]);assert.equal(f.reviews.length,3);assert.equal(f.drafts.get(6),3);
});

test('a composition-only fallback reuses its prefetched photo without another provider request; other requests cannot reframe it',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-coverage-photo-')),f=await coverageRecoveryFixture(),context={...f.context,instructions:f.prompt};
 const before=planImageCoverage(presentationThemeService(f.deck,context),context),theme=deriveVisualTheme(before,context),policy=imagePolicy({});
 const session=createImageAssetSession({root,policy,external:false,userAssets:f.assets}),entries=new Map();
 for(const n of [1,6]){const s=before.slides[n-1];entries.set(n,{signature:photoSignature(s,before,context),subjectSignature:photoSubjectSignature(s,before,context),promise:Promise.resolve(await session.resolve(before,s,theme,context))});}
 const approved=await entries.get(6).promise;assert.ok(approved);
 const after=structuredClone(before);after.slides[5]={...after.slides[5],slideType:'focused-explanation',contentFallback:{to:'focused-explanation'},content:{textContent:{heading:'Solar systems',body:recoveredSolarBody}}};
 let resolves=0;session.resolve=()=>{resolves++;assert.fail('A composition change must not request a new photo');};
 const result=await resolvePresentationVisuals(after,context,{external:false,prefetch:{session,entries},diagramPlanner:false,cacheRoot:root});
 assert.equal(resolves,0);assert.equal(result.slides[5].photoAsset.reframedFrom,approved.id);assert.equal(result.slides[5].photoComposition,'photo-technical');
 assert.equal(result.slides[5].photoAsset.binding.requestId,session.requestId);
 const other=createImageAssetSession({root,policy,external:false});await assert.rejects(other.reframe(approved,after,after.slides[5],theme,context),{code:'IMAGE_BINDING_MISMATCH'});
 const changed=structuredClone(after);changed.slides[5].objective='An unrelated subject';assert.notEqual(photoSubjectSignature(changed.slides[5],changed,context),entries.get(6).subjectSignature);
});
