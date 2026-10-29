import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {planImageCoverage} from '../../Service/visual/imageArtDirection.mjs';
import {candidateSuitability,configuredImageProviders} from '../../Service/visual/imageProviders.mjs';
import {bundledPhotoSearch} from '../../Service/visual/bundledPhotoSearch.mjs';
import {createImageAssetSession} from '../../Service/visual/presentationImageAssets.mjs';
import {imagePolicy} from '../../Service/visual/imagePolicy.mjs';

const deck=()=>({title:'ÉLITE HAVENS REAL ESTATE',slides:Array.from({length:12},(_,i)=>({slideNumber:i+1,slideType:i?'focused-explanation':'title',title:`Property ${i+1}`,objective:'Luxury property overview',visualRequirement:{kind:'photo',required:true,sourceStrategy:'licensed-search-first',description:'Modern mansion',searchQuery:'modern luxury mansion',altText:'Illustrative mansion'}}))});
const selective='The title slide MUST contain one beautiful, relevant photograph embedded in the PPTX. Use additional images selectively where appropriate.';
test('selective image instructions constrain an over-eager outline before acquisition and remain stable',()=>{
 const original=deck(),planned=planImageCoverage(original,{instructions:selective});
 assert.equal(planned.imageCoveragePlan.target,4);
 assert.ok(planned.slides[0].imageRequirement?.required);
 assert.equal(planned.slides.filter(s=>s.visualRequirement.kind==='photo').length,4);
 assert.equal(original.slides.filter(s=>s.visualRequirement.kind==='photo').length,12);
 assert.deepEqual(planImageCoverage(planned,{instructions:selective}).imageCoveragePlan,planned.imageCoveragePlan);
});
test('every-slide and explicit minimum quantities take precedence over selective language',()=>{
 for(const instructions of [`${selective} Every slide must contain an image.`,`${selective} Use at least seven photographs.`])assert.equal(planImageCoverage(deck(),{instructions}).imageCoveragePlan.target,12);
 assert.equal(planImageCoverage(deck(),{instructions:`${selective} No images.`}).imageCoveragePlan.target,0);
 const excluded=planImageCoverage(deck(),{instructions:selective,designPreferences:{noImageSlideNumbers:[1,4,8]}});
 assert.ok(excluded.slides[0].imageRequirement.required);assert.ok(excluded.slides.filter(s=>[4,8].includes(s.slideNumber)).every(s=>!s.imageRequirement));
});
test('residential words cannot qualify a carpark sign as spa or university building as penthouse',()=>{
 const photo=description=>({mediaKind:'photograph',description});
 assert.equal(candidateSuitability('private residential luxury spa',photo('Residential buildings Malibu Garden name sign carpark'),{partial:true}),-1);
 assert.equal(candidateSuitability('luxury penthouse rooftop terrace',photo('Modern International-style university building rooftop terrace'),{partial:true}),-1);
 assert.equal(candidateSuitability('contemporary luxury modern mansion',photo('West Wycombe Park country house built between 1740 and 1800 Georgian pleasure palace'),{partial:true}),-1);
 assert.ok(candidateSuitability('modern waterfront villa',photo('Modern waterfront villa with private dock'))>0);
});
test('bundled stock and cached stock must match the requested scene before admission',async()=>{
 const providers=configuredImageProviders({PRESENTATION_STOCK_PROVIDER:'auto'});
 for(const searchQuery of ['luxury modern mansion exterior infinity pool','modern waterfront luxury villa private boat dock','luxury interior living room marble furniture','luxury penthouse terrace skyline']){
  const request={searchQuery,subject:'ÉLITE HAVENS REAL ESTATE',slideTitle:'Exceptional Living'};
  assert.equal(await bundledPhotoSearch(request,{acceptCandidate:asset=>candidateSuitability(searchQuery,asset)>=0}),null);
  assert.equal(providers.validateSearchAsset(request,{source:'Wikimedia Commons curated catalog',mediaKind:'photograph',description:'The interior of a modern library, education and books',originalUrl:'https://commons.wikimedia.org/wiki/File:Library.jpg'}),false);
 }
});
test('stock search has a separate deadline and releases capacity for AI fallback',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-speed-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let aborted=false,generated=0,queryLimit;
 const session=createImageAssetSession({root,policy:{...imagePolicy({}),stockSearchTimeoutMs:25,allowGeneration:true,estimatedUnitCost:.1,maxEstimatedCost:1,retries:0},providers:{search:async brief=>{queryLimit=brief.maxSearchQueries;await new Promise(resolve=>brief.signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));return null;},generate:async()=>{generated++;assert.equal(aborted,true);return null;}}});
 const presentation=deck();await session.resolve(presentation,presentation.slides[0],{family:'editorial',style:'luxury',palette:{}},{});
 assert.equal(queryLimit,1);assert.equal(generated,1);assert.equal(session.budget.report().attempts,1);
 assert.equal(imagePolicy({}).stockSearchTimeoutMs,12000);
 assert.equal(imagePolicy({PRESENTATION_STOCK_SEARCH_TIMEOUT_MS:'999999'}).stockSearchTimeoutMs,30000);
});
