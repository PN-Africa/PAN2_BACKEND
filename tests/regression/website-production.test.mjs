import test from 'node:test';
import {approvedImageEnv} from '../fixtures/coverAsset.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {fixtures,fixturePlan,fixtureDraft,fixtureClient} from '../webpage/fixtures.mjs';
import {webpageLayoutService} from '../../Service/webpageLayoutService.mjs';
import {webpageThemeService,contrast} from '../../Service/webpageThemeService.mjs';
import {compileWebsiteBrief,userWebsiteBrief} from '../../Service/webpage/websiteBrief.mjs';
import {acquireWebsiteImages} from '../../Service/webpage/imagePipeline.mjs';
import {optimizeWebsiteImage} from '../../Service/webpage/imageOptimization.mjs';
import {webpageRenderer} from '../../renderer/webpage/webpageRenderer.mjs';
import {validateStaticWebsite} from '../../Service/webpageStaticValidator.mjs';
import {webpageArtifactService} from '../../Service/webpageArtifactService.mjs';
import {downloadWebsiteImage,websiteImageProviders} from '../../Service/webpage/imageProviders.mjs';
import {createGenerationRouter} from '../../route/generateRoute.mjs';
import express from 'express';
import {validateWebpageContent} from '../../Service/webpageContentValidator.mjs';
import {generateWebpageContent} from '../../Service/ai/webpageGeneration.mjs';
import {acquireProviderImage} from '../../Service/webpage/providerCache.mjs';
import {generalWebsiteDraft} from '../fixtures/generalWebsiteDraft.mjs';
import {specifyWebsiteContent,internalCopy} from '../../Service/webpage/contentSpecification.mjs';

const base=(f=fixtures.pharmaceutical)=>webpageThemeService(webpageLayoutService({outputType:'webpage',...fixturePlan(f),...fixtureDraft(f)}));
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-site-production-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('simple sources compile a professional brief; explicit facts/preferences override automatic direction',()=>{
    const p=base(),ctx={websiteBrief:{audience:'Procurement teams',conversionGoal:'Request information',pages:['home','about','contact'],referenceUrls:['https://brand.example/'],photoSubjects:['clean-room equipment']}};
    const brief=compileWebsiteBrief(p,fixtures.pharmaceutical.source,ctx);
    assert.equal(brief.project.audience,'Procurement teams');assert.equal(brief.project.conversionGoal,'Request information');assert.equal(brief.facts.nameVerified,true);assert.deepEqual(brief.photography.subjects,['clean-room equipment']);
    assert.throws(()=>userWebsiteBrief('',{websiteBrief:{imageAssets:[{url:'https://example.com/a.jpg',rightsConfirmed:false}]}}),/confirmed rights/);
    assert.throws(()=>userWebsiteBrief('',{websiteBrief:{referenceUrls:['javascript:alert(1)']}}));
});

test('negative instructions and stock-image directions cannot ground invented facilities or manufacturing claims',()=>{
    const draft=fixtureDraft(fixtures.pharmaceutical);draft.hero.subheadline='Pharmax operates dedicated infrastructure for sterile injectable production.';
    assert.throws(()=>validateWebpageContent(draft,{source:'Create a pharmaceutical company website called Pharmax. Do not invent facilities, infrastructure or sterile production. Use laboratory photography.'}),/Unsupported business claim/);
    draft.hero.subheadline='Infrastructure and product information have not been provided.';
    validateWebpageContent(draft,{source:fixtures.pharmaceutical.source});
});

test('name-and-industry-only prompts generate scoped explanations with missing facts kept out of website copy',async ()=>{
    const source='Create a professional website for a pharmaceutical manufacturing company called Pharmax.';
    const plan=fixturePlan(fixtures.pharmaceutical),scoped=specifyWebsiteContent(plan,source);
    let calls=0;const client={models:{generateContent:async()=>({text:JSON.stringify(calls++===0?plan:generalWebsiteDraft(scoped.plan)),candidates:[{finishReason:'STOP'}]})}};
    const result=await generateWebpageContent({client,inputType:'prompt',input:'Create a professional website for a pharmaceutical manufacturing company called Pharmax.',options:{logger:()=>{}}});
    assert.equal(calls,2);assert.equal(result.quality.status,'requires_fact_review');assert.ok(result.warnings.some(w=>w.code==='WEBSITE_FACTS_REQUIRED'));assert.ok(!internalCopy.test(JSON.stringify(result.sections)));assert.ok(!JSON.stringify(result.sections).includes('cleanroom'));
    validateWebpageContent(result,{source:'Create a professional website for a pharmaceutical manufacturing company called Pharmax.'});
});

test('real curated pharmaceutical photograph becomes responsive local WebP assets and survives ZIP packaging',async t=>{
    const root=await temporary(t),p=base();p.websiteBrief=compileWebsiteBrief(p,fixtures.pharmaceutical.source);
    const resolved=await acquireWebsiteImages(p,{}, {external:false,optimization:{cacheRoot:path.join(root,'cache')}});
    assert.ok(resolved.page.visualAssets.hero);assert.equal(resolved.page.visualAssets.hero.source,'Wikimedia Commons curated catalog');
    assert.ok(resolved.page.visualAssets.hero.variants.length>=2);assert.ok(resolved.page.visualAssets.hero.bytes<resolved.page.visualAssets.hero.sourceBytes);
    const files=webpageRenderer(resolved.page,resolved.assets),validation=validateStaticWebsite(files);assert.ok(validation.quality.images>0);assert.match(files['index.html'],/srcset=/);assert.doesNotMatch(files['index.html'],/Illustrative stock image; not a photograph of this organization/);assert.match(files['index.html'],/Image credits and licenses/);assert.ok(resolved.page.visualAssets.hero.caption);
    const artifact=await webpageArtifactService(files,{root:path.join(root,'artifacts')});const zip=await JSZip.loadAsync(await fs.readFile(artifact.files.zipPath));
    for(const [name,bytes] of Object.entries(resolved.assets))assert.deepEqual(await zip.file('my-website/'+name).async('nodebuffer'),bytes);
    const second=await acquireWebsiteImages(p,{}, {external:false,optimization:{cacheRoot:path.join(root,'cache')}});assert.equal(second.page.visualAssets.hero.cacheHit,true);
});

test('supplied authorized imagery takes priority and provider outages fall back without credential leakage',async t=>{
    const root=await temporary(t),image=await fs.readFile('assets/webpage/curated/laboratory.jpg'),p=base();
    let called=0;const provider={id:'test-provider',acquire:async()=>{called++;throw new Error('SECRET-KEY-should-never-be-exposed');}};
    const context={websiteBrief:{imageAssets:[{url:'https://brand.example/photo.jpg',rightsConfirmed:true,creator:'Brand',license:'Authorized brand image',alt:'Brand laboratory',role:'hero',authentic:true}]}};
    const supplied=await acquireWebsiteImages(p,context,{download:async()=>image,providers:[provider],policy:{maxAssets:1},optimization:{cacheRoot:root}});
    assert.equal(called,0);assert.equal(supplied.page.visualAssets.hero.source,'User supplied');assert.equal(supplied.page.visualAssets.hero.caption,'');
    const fallback=await acquireWebsiteImages(p,{}, {providers:[provider],policy:{maxAssets:1},optimization:{cacheRoot:root}});assert.equal(called,1);assert.ok(fallback.page.visualAssets.hero);assert.ok(!JSON.stringify(fallback.warnings).includes('SECRET'));
    const none=await acquireWebsiteImages(p,{}, {providers:[],curated:false});assert.equal(none.page.visualAssets.hero,undefined);assert.ok(none.warnings.some(w=>w.code==='WEBPAGE_IMAGERY_UNAVAILABLE'));
});

test('unsafe/oversized/corrupt image input fails safely, and paid image generation requires explicit configuration',async t=>{
    const root=await temporary(t);await assert.rejects(optimizeWebsiteImage(Buffer.from('not a raster'),{cacheRoot:root}));
    await assert.rejects(optimizeWebsiteImage(Buffer.alloc(12*1024*1024+1),{cacheRoot:root}),/budget/);
    await assert.rejects(downloadWebsiteImage('https://127.0.0.1/a.jpg'),/public internet/);
    assert.deepEqual(websiteImageProviders({GEMINI_API_KEY:'test-key'}).map(provider=>provider.id),['commons']);
    assert.ok(!websiteImageProviders({WEBPAGE_ALLOW_IMAGE_GENERATION:'true',WEBPAGE_IMAGE_MODEL:'configured-model',GEMINI_API_KEY:'test-key'}).some(provider=>provider.kind==='generation'));
    assert.ok(websiteImageProviders({...approvedImageEnv,WEBPAGE_ALLOW_IMAGE_GENERATION:'true'}).some(provider=>provider.id==='generated-image'));
    const image=await fs.readFile('assets/webpage/curated/laboratory.jpg');await assert.rejects(optimizeWebsiteImage(image,{cacheRoot:path.join(root,'timeout'),timeoutMs:1}),/timed out/);
});

test('identical configured-provider subjects reuse a short-lived disk result instead of another provider request',async t=>{
    const root=await temporary(t);let calls=0;const image=await fs.readFile('assets/webpage/curated/laboratory.jpg');
    const provider={id:'pexels',acquire:async()=>{calls++;return {buffer:image,creator:'Test',license:'Original fixture'};}};
    await Promise.all([acquireProviderImage(provider,{query:'laboratory',style:'natural'},{cacheRoot:root}),acquireProviderImage(provider,{query:'laboratory',style:'natural'},{cacheRoot:root})]);
    const reused=await acquireProviderImage(provider,{query:'laboratory',style:'natural'},{cacheRoot:root});assert.equal(calls,1);assert.deepEqual(reused.buffer,image);
});

test('all industry palettes and explicit branding retain AA foreground contrast on normal surfaces',()=>{
    assert.equal(base(fixtures.realestate).designBrief.industry,'real-estate');
    for(const f of Object.values(fixtures)){
        const p=base(f),colors=p.theme.colors;
        for(const [a,b] of [['text','background'],['text','surface'],['muted','background'],['muted','surface'],['onPrimary','primary'],['onAccent','accent'],['onPrimaryHover','primaryHover']])assert.ok(contrast(colors[a],colors[b])>=4.5,`${f.title}: ${a}/${b}`);
    }
    const p=webpageThemeService(base(),{designPreferences:{paletteId:'wine-linen',colors:{primary:'#60243f'},fontPair:'classical'}});assert.equal(p.theme.colors.primary,'#60243f');assert.equal(p.designSpec.fontPair,'classical');
});

test('multi-page generation keeps valid links and exact assets in both HTTP preview and the downloaded archive',async t=>{
    const root=await temporary(t),p=base();p.websiteBrief=compileWebsiteBrief(p,fixtures.pharmaceutical.source,{websiteBrief:{pages:['home','about','services','contact'],canonicalUrl:'https://pharmax.example/'}});
    const files=webpageRenderer(p);const validation=validateStaticWebsite(files);assert.equal(validation.pages,4);assert.ok(files['about.html']);assert.match(files['index.html'],/\.\/contact.html/);assert.match(files['about.html'],/https:\/\/pharmax.example\/about.html/);
    assert.throws(()=>validateStaticWebsite({...files,'index.html':files['index.html'].replace('./contact.html','./missing.html')}),/Missing local/);
    const artifact=await webpageArtifactService(files,{root});const app=express();app.use('/api',createGenerationRouter({webpageRoot:root}));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>server.close());
    const baseUrl=`http://127.0.0.1:${server.address().port}`;const about=await fetch(baseUrl+artifact.siteUrl.replace('index.html','about.html'));assert.equal(about.status,200);assert.match(about.headers.get('content-security-policy'),/sandbox allow-scripts/);
    const archive=await fetch(baseUrl+artifact.downloadUrl);assert.equal(archive.status,200);const zip=await JSZip.loadAsync(await archive.arrayBuffer());for(const name of ['index.html','about.html','services.html','contact.html'])assert.equal(await zip.file('my-website/'+name).async('string'),files[name]);
});
