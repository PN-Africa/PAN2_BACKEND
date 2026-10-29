import test from 'node:test';
import {approvedImageEnv} from '../fixtures/coverAsset.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixtures,fixturePlan,fixtureDraft} from '../webpage/fixtures.mjs';
import {webpageLayoutService} from '../../Service/webpageLayoutService.mjs';
import {webpageThemeService,contrast} from '../../Service/webpageThemeService.mjs';
import {webpageRenderer} from '../../renderer/webpage/webpageRenderer.mjs';
import {compileWebsiteBrief} from '../../Service/webpage/websiteBrief.mjs';
import {acquireWebsiteImages} from '../../Service/webpage/imagePipeline.mjs';
import {planWebsiteImages,imagePolicy} from '../../Service/webpage/imageStrategy.mjs';
import {websiteImageProviders} from '../../Service/webpage/imageProviders.mjs';
import {validateStaticWebsite} from '../../Service/webpageStaticValidator.mjs';
import {validateWebpagePlan} from '../../Service/webpageContentValidator.mjs';
import {inspectWebsite} from '../../Service/webpage/qualityGate.mjs';
import {webpagePlanningProviderSchema,webpagePlanSchema} from '../../templates/webpage/webpageSchema.mjs';
const base=(fixture=fixtures.event,context={})=>{
    const page=webpageLayoutService({outputType:'webpage',...fixturePlan(fixture),...fixtureDraft(fixture),sections:fixture.sections},{...context,topic:fixture.source});
    page.websiteBrief=compileWebsiteBrief(page,fixture.source,context);return webpageThemeService(page,context);
};
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-universal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('same-category briefs produce intentionally different color, type, background and interaction systems',()=>{
    const quiet=base(fixtures.school),expressive=base(fixtures.schoolExpressive);
    assert.equal(quiet.designBrief.industry,expressive.designBrief.industry);
    assert.notEqual(quiet.theme.paletteId,expressive.theme.paletteId);assert.notDeepEqual(quiet.theme.typography,expressive.theme.typography);
    assert.notEqual(quiet.designBrief.heroComposition,expressive.designBrief.heroComposition);
    assert.ok(expressive.creativeDirection.interactions.includes('search'));
    const files=webpageRenderer(expressive);assert.match(files['index.html'],/data-search/);assert.match(files['index.html'],/background-gradient/);assert.match(files['style.css'],/linear-gradient/);
    validateStaticWebsite(files);
    for(const background of ['background','surface'])for(const foreground of ['text','muted'])assert.ok(contrast(expressive.theme.colors[foreground],expressive.theme.colors[background])>=4.5);
});

test('explicit creative preferences override inferred direction, while unsafe values fail validation',()=>{
    const page=base(fixtures.school,{designPreferences:{background:'split',geometry:'square',spacing:'compact',ctaStyle:'outline',fontPair:'mono',paletteId:'ocean-night',heroComposition:'minimal',interactions:['filter']}});
    assert.equal(page.creativeDirection.ctaStyle,'outline');assert.equal(page.theme.paletteId,'ocean-night');assert.equal(page.designSpec.fontPair,'mono');assert.equal(page.sections[1].background,'split');
    assert.throws(()=>base(fixtures.school,{designPreferences:{geometry:'url(evil)'}}));
    assert.throws(()=>base(fixtures.school,{designPreferences:{interactions:['payment']}}));
});

test('section backgrounds survive normalization and invalid image-plan references are rejected',()=>{
    const page=base();assert.equal(page.sections[0].background,'dark');assert.equal(page.sections[2].background,'gradient');
    const plan=fixturePlan(fixtures.event);plan.imagePlan=[{role:'item',sectionIndex:99,itemIndex:0,subject:'Reading room',alt:'Reading environment',aspectRatio:'3:2'}];
    assert.throws(()=>validateWebpagePlan(plan),/Invalid image target/);
    assert.equal(imagePolicy({WEBPAGE_IMAGE_MAX_ASSETS:'999',WEBPAGE_IMAGE_MAX_GENERATED:'-8',WEBPAGE_IMAGE_RETRIES:'9'}).maxAssets,8);
    assert.equal(imagePolicy({WEBPAGE_IMAGE_MAX_GENERATED:'-8'}).maxGenerated,0);
});
test('new Gemini plans use a bounded provider schema without removing saved-plan capabilities',()=>{
    const schema=webpagePlanningProviderSchema();
    assert.ok(schema.properties.creativeDirection);assert.equal(schema.properties.imagePlan,undefined);assert.equal(schema.properties.sections.items.properties.background,undefined);
    assert.ok(webpagePlanSchema.properties.imagePlan);assert.ok(webpagePlanSchema.properties.sections.items.properties.background);
});

test('gallery plans acquire actual relevant local photographs for distinct items, with exact packaged references',async t=>{
    const root=await temporary(t),page=base();
    const planned=planWebsiteImages(page);assert.equal(planned.filter(image=>image.role==='item').length,3);
    const result=await acquireWebsiteImages(page,{}, {external:false,optimization:{cacheRoot:root}});
    const items=result.page.sections[0].items;assert.ok(items.filter(item=>item.image).length>=2);
    assert.equal(new Set(result.page.visualAssets.credits.map(item=>item.url)).size,result.page.visualAssets.credits.length);
    const files=webpageRenderer(result.page,result.assets);assert.match(files['index.html'],/data-gallery-open/);assert.match(files['index.html'],/<dialog/);
    assert.equal(validateStaticWebsite(files).valid,true);
    for(const item of items){assert.ok(files[item.image.url.slice(2)]);assert.ok(item.image.license&&item.image.creator);}
});

test('generated image adapter sends art direction and aspect ratio to the configured model without claiming authentic photos',async()=>{
    const buffer=await fs.readFile('assets/webpage/curated/food.jpg');let request;
    const providers=websiteImageProviders({...approvedImageEnv,WEBPAGE_ALLOW_IMAGE_GENERATION:'true'}, {imageGenerator:async value=>{request=value;return {buffer};}});
    const asset=await providers.find(provider=>provider.kind==='generation').acquire({query:'conceptual garden food still life',style:'warm soft light',alt:'Concept food still life',role:'item',aspectRatio:'1:1'});
    assert.equal(request.aspectRatio,'1:1');assert.match(request.prompt,/warm soft light/);assert.match(request.prompt,/No text, logos/);assert.equal(asset.illustrative,true);assert.match(asset.caption,/AI-generated conceptual/);assert.deepEqual(asset.buffer,buffer);
});

test('provider retries, timeout and asset budgets are bounded; missing generation configuration is explicit',async t=>{
    const root=await temporary(t),buffer=await fs.readFile('assets/webpage/curated/library.jpg');let calls=0;
    const provider={id:'controlled-test',acquire:async request=>{if(++calls===1)throw Object.assign(new Error('Temporary failure'),{status:503});return {buffer,creator:'Jorge Mendoza',license:'CC0',alt:'Library reading environment',illustrative:true};}};
    const result=await acquireWebsiteImages(base(),{}, {curated:false,providers:[provider],policy:{maxAssets:1,retries:1},optimization:{cacheRoot:root}});
    assert.equal(calls,2);assert.equal(result.page.visualAssets.credits.length,1);assert.ok(result.warnings.some(w=>w.code==='WEBPAGE_IMAGE_GENERATION_NOT_CONFIGURED'));
    const start=Date.now();const timeout=await acquireWebsiteImages(base(),{}, {curated:false,providers:[{id:'never-responds',acquire:()=>new Promise(()=>{})}],policy:{timeoutMs:10,totalMs:20,maxAssets:1}});
    assert.ok(Date.now()-start<1000);assert.ok(timeout.warnings.some(w=>w.code==='WEBPAGE_IMAGE_PROVIDER_UNAVAILABLE'));
});

test('quality gate validates every output and performs at most one trusted responsive repair',async()=>{
    const files=webpageRenderer(base(fixtures.school));let calls=0;
    const result=await inspectWebsite(files,{runner:async()=>({checks:[{width:360}],failures:++calls===1?[{code:'overflow'}]:[]})});
    assert.equal(calls,2);assert.equal(result.report.browser,'passed');assert.equal(result.report.repairAttempts,1);assert.match(result.files['style.css'],/Bounded responsive/);
    calls=0;const failure=await inspectWebsite(files,{runner:async()=>{calls++;return {checks:[],failures:[{code:'broken-image'}]};}});
    assert.equal(calls,1);assert.equal(failure.report.browser,'failed');assert.ok(failure.warnings.some(w=>w.code==='WEBPAGE_BROWSER_QA_FAILED'));
    const unavailable=await inspectWebsite(files,{runner:async()=>{throw new Error('No browser');}});assert.equal(unavailable.report.browser,'unavailable');
});
