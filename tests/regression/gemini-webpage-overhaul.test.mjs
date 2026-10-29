import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {generateImage,imageGenerationSettings,imageGenerationEstimate} from '../../Service/visual/imageGenerationService.mjs';
import {once} from 'node:events';
import JSZip from 'jszip';
import {createApp} from '../../src/app.mjs';
import {generateService} from '../../Service/generateService.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';
import {generateDocumentIllustrations} from '../../Service/document/documentIllustrations.mjs';
import {renderDocumentDocx} from '../../renderer/document/docxRenderer.mjs';
import {generateGoogleImage} from '../../Service/visual/googleImageService.mjs';
import {commonsSearch} from '../../Service/visual/imageProviders.mjs';
import {websiteImageProviders} from '../../Service/webpage/imageProviders.mjs';
import {acquireWebsiteImages} from '../../Service/webpage/imagePipeline.mjs';
import {planWebsiteImages} from '../../Service/webpage/imageStrategy.mjs';
import {reviewImageCandidate} from '../../Service/webpage/imageReview.mjs';
import {fixtures,fixturePlan,fixtureDraft} from '../webpage/fixtures.mjs';
import {webpageLayoutService} from '../../Service/webpageLayoutService.mjs';
import {webpageThemeService} from '../../Service/webpageThemeService.mjs';
import {webpageRenderer} from '../../renderer/webpage/webpageRenderer.mjs';
import {inspectDesignCompleteness} from '../../Service/webpage/designQuality.mjs';
import {validateStaticWebsite} from '../../Service/webpageStaticValidator.mjs';
// These legacy fallback cases explicitly exercise the retained rollback mode.
// The default four-provider architecture has its own concurrency regressions.
const env={IMAGE_RACE_ENABLED:'false',AI_IMAGE_PROVIDER:'gemini',AI_IMAGE_PROVIDER_APPROVED:'true',GEMINI_API_KEY:'fixture-key',WEBPAGE_ALLOW_IMAGE_GENERATION:'true'};
const page=()=>webpageThemeService(webpageLayoutService({outputType:'webpage',...fixturePlan(fixtures.pharmaceutical),...fixtureDraft(fixtures.pharmaceutical)}));
async function root(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-gemini-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
const photo=()=>sharp('assets/webpage/curated/laboratory.jpg').resize(1024,576).jpeg().toBuffer();
test('Gemini image approval is explicit and never changes Claude text settings',()=>{assert.equal(imageGenerationSettings(env).model,'gemini-nano-banana-2.1');assert.equal(imageGenerationSettings(env).ready,true);assert.equal(imageGenerationSettings({...env,AI_IMAGE_PROVIDER_APPROVED:'false'}).ready,false);assert.equal(imageGenerationSettings({...env,GEMINI_API_KEY:''}).ready,false);assert.equal(imageGenerationSettings({...env,AI_IMAGE_MODEL:'gemini-3-pro-image'}).model,'gemini-3-pro-image');});
test('premium and high-resolution estimates cannot use the cheaper configured unit amount',()=>{assert.equal(imageGenerationEstimate({...env,AI_IMAGE_MODEL:'gemini-3-pro-image',AI_IMAGE_ESTIMATED_UNIT_COST:'.06'},'1K'),.134);assert.equal(imageGenerationEstimate({...env,AI_IMAGE_ESTIMATED_UNIT_COST:'.06'},'4K'),.113);});
test('Commons stops after one empty search round by default',async()=>{let searches=0;assert.equal(await commonsSearch({searchQuery:'Luxury marble kitchen brass fixtures'},{find:async()=>{searches++;return [];}}),null);assert.equal(searches,1);});
test('provider order searches Commons before eligible generated imagery',()=>{const providers=websiteImageProviders(env);assert.equal(providers[0].id,'commons');assert.equal(providers.at(-1).kind,'generation');});
for(const model of ['gemini-nano-banana-2.1','gemini-3-pro-image'])test(`${model} uses official Interactions image format and validates returned raster`,async t=>{const buffer=await photo();let sent,options;
 const result=await generateImage({prompt:'A conceptual laboratory illustration, without text',aspectRatio:'16:9',resolution:'1K',generationType:'webpage'},{env:{...env,AI_IMAGE_MODEL:model},cacheRoot:await root(t),client:{interactions:{create:async(a,b)=>{sent=a;options=b;return {output_image:{mime_type:'image/jpeg',data:buffer.toString('base64')}};}}}});
 assert.equal(sent.model,model);assert.deepEqual(sent.response_format,{type:'image',aspect_ratio:'16:9',image_size:'1K'});assert.equal(sent.store,false);assert.equal(options.maxRetries,0);assert.equal(result.provider,'gemini');assert.equal(result.generated,true);assert.equal(result.width,1024);
});
test('Gemini rejects corrupted data and MIME mismatch',async t=>{
 for(const data of [Buffer.from('corrupt'),await photo()]){
  const client={interactions:{create:async()=>({output_image:{mime_type:'image/png',data:data.toString('base64')}})}};
  await assert.rejects(generateGoogleImage({prompt:'Concept'},{env,model:'gemini-nano-banana-2.1',cacheRoot:await root(t),client}));
 }
});
test('Gemini cancellation prevents a late result entering the pipeline',async t=>{const controller=new AbortController();let complete;const operation=generateImage({prompt:'Concept illustration',signal:controller.signal},{env,cacheRoot:await root(t),client:{interactions:{create:()=>new Promise(resolve=>{complete=resolve;})}}});await new Promise(resolve=>setTimeout(resolve,20));controller.abort();await assert.rejects(operation,{code:'IMAGE_CANCELLED'});complete?.({});});
test('identical Gemini requests share work but never mutable result buffers',async t=>{const buffer=await photo();let calls=0;const options={env,cache:true,cacheRoot:await root(t),client:{interactions:{create:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return {output_image:{mime_type:'image/jpeg',data:buffer.toString('base64')}};}}}};const [a,b]=await Promise.all([generateImage({prompt:'A laboratory concept'},options),generateImage({prompt:'A laboratory concept'},options)]);assert.equal(calls,1);a.buffer.fill(0);assert.notEqual(b.buffer[0],0);});
test('Gemini times out and classifies a 429 without an SDK retry',async t=>{let calls=0;await assert.rejects(generateGoogleImage({prompt:'Concept'},{env,model:'gemini-nano-banana-2.1',timeoutMs:1000,cacheRoot:await root(t),client:{interactions:{create:()=>new Promise(()=>{})}}}),error=>error.code==='PROVIDER_TIMEOUT');await assert.rejects(generateGoogleImage({prompt:'Another concept'},{env,model:'gemini-nano-banana-2.1',cacheRoot:await root(t),client:{interactions:{create:async()=>{calls++;throw Object.assign(new Error('Private provider detail'),{status:429});}}}}),error=>error.code==='PROVIDER_RATE_LIMITED');assert.equal(calls,1);});
test('empty Commons results reach Gemini and package the verified image locally',async t=>{
 const buffer=await photo(),events=[],calls=[];const providers=websiteImageProviders(env,{commonsSearch:async()=>{calls.push('commons');return null;},imageGenerator:async request=>{calls.push('gemini');assert.equal(request.aspectRatio,'16:9');return {buffer,model:'gemini-nano-banana-2.1'};}});
 const result=await acquireWebsiteImages(page(),{}, {providers,curated:false,policy:{maxAssets:1,maxGenerated:1,estimatedUnitCost:.06,maxEstimatedCost:.06,concurrency:1},optimization:{cacheRoot:await root(t)},logger:e=>events.push(e)});
 assert.deepEqual(calls,['commons','gemini']);assert.ok(result.page.visualAssets.hero);assert.equal(result.page.visualAssets.hero.sourceType,'ai-generated');assert.equal(result.page.imageStrategy.budget.attempts,1);const files=webpageRenderer(result.page,result.assets);validateStaticWebsite(files);assert.ok(files[result.page.visualAssets.hero.url.slice(2)]);assert.equal(inspectDesignCompleteness(files).status,'passed');
});
test('relevant Commons result avoids generation',async t=>{let generated=0;const buffer=await photo(),providers=websiteImageProviders(env,{commonsSearch:async()=>({buffer,creator:'Fixture scientist',license:'Public domain',source:'Wikimedia Commons',description:'A scientist pipetting in a pharmaceutical laboratory',subject:'Pharmaceutical laboratory research',mediaKind:'photograph',originalUrl:'https://commons.wikimedia.org/wiki/File:Fixture.jpg'}),imageGenerator:async()=>{generated++;}});const result=await acquireWebsiteImages(page(),{}, {providers,curated:false,policy:{maxAssets:1,concurrency:1},optimization:{cacheRoot:await root(t)},logger:()=>{}});assert.ok(result.page.visualAssets.hero);assert.equal(generated,0);});
test('irrelevant licensed Commons material is rejected before Gemini fallback',async t=>{let calls=0;const buffer=await photo(),providers=websiteImageProviders(env,{commonsSearch:async()=>({buffer,creator:'Fixture',license:'Public domain',source:'Wikimedia Commons',description:'A real estate sign beside a road',subject:'Real estate sign',mediaKind:'photograph',originalUrl:'https://commons.wikimedia.org/wiki/File:Sign.jpg'}),imageGenerator:async()=>{calls++;return {buffer};}});const result=await acquireWebsiteImages(page(),{}, {providers,curated:false,policy:{maxAssets:1,maxGenerated:1,estimatedUnitCost:.06,maxEstimatedCost:.06,concurrency:1},optimization:{cacheRoot:await root(t)},logger:()=>{}});assert.equal(calls,1);assert.equal(result.page.visualAssets.hero.sourceType,'ai-generated');assert.ok(result.warnings.some(w=>w.code==='WEBPAGE_IMAGE_RELEVANCE_REJECTED'));});
test('authentic and geographic requirements cannot silently use generated imagery',async t=>{for(const context of [{instructions:'Use authentic photographs only.'},{}]){const p=page();if(!context.instructions)p.imagePlan=[{role:'hero',subject:'Lagos skyline lagoon',alt:'Lagos skyline',aspectRatio:'16:9',required:true}];let calls=0;const result=await acquireWebsiteImages(p,context,{curated:false,providers:[{id:'generated-image',kind:'generation',acquire:async()=>{calls++;}}],policy:{maxAssets:1,maxGenerated:2,estimatedUnitCost:.06,maxEstimatedCost:.12},optimization:{cacheRoot:await root(t)},logger:()=>{}});assert.equal(calls,0);assert.equal(result.page.visualAssets.hero,undefined);}});
test('zero count or insufficient spending budget prevents Gemini calls',async t=>{for(const policy of [{maxGenerated:0,maxEstimatedCost:.12},{maxGenerated:2,maxEstimatedCost:.01}]){let calls=0;await acquireWebsiteImages(page(),{}, {curated:false,providers:[{id:'generated-image',kind:'generation',acquire:async()=>{calls++;}}],policy:{...policy,maxAssets:1,estimatedUnitCost:.06},optimization:{cacheRoot:await root(t)},logger:()=>{}});assert.equal(calls,0);}});
test('default image plan includes a hero and supporting scenes; text-only is respected',()=>{assert.ok(planWebsiteImages(page()).some(p=>p.role==='hero'));assert.ok(planWebsiteImages(page()).filter(p=>p.role==='section').length>=1);assert.deepEqual(planWebsiteImages(page(),{instructions:'Create an image-free website.'}),[]);});
test('scene filters reject material samples and real estate signs',()=>{for(const [query,subject] of [['Luxury marble kitchen with brass fixtures','Marble countertop samples in a home improvement store'],['Property advisor handing keys to a client','Real estate agent sign beside a road']])assert.equal(reviewImageCandidate({subject,alt:subject,source:'Wikimedia Commons',creator:'Fixture',license:'Public domain',mediaKind:'photograph'},{query,role:'hero'},{width:1600,height:1000}).accepted,false);});
test('missing-media hero has a topic-linked composition without pretending a photo exists',()=>{const files=webpageRenderer(page());assert.match(files['index.html'],/hero-story|product-preview/);assert.doesNotMatch(files['index.html'],/class="hero-art"/);assert.equal(inspectDesignCompleteness(files).pages[0].heroAsset,'not-present');});
test('document concept illustrations use the shared Gemini adapter and embed in DOCX',async t=>{
 const directory=await root(t),buffer=await photo(),mock=anthropicFixture(()=>({images:[{sectionId:'overview',prompt:'A conceptual laboratory workspace without lettering',alt:'Conceptual laboratory workspace'}]}));
 const settings={...env,DOCUMENT_ALLOW_IMAGE_GENERATION:'true',AI_IMAGE_ESTIMATED_UNIT_COST:'.06',AI_IMAGE_MAX_ESTIMATED_COST:'.12'};
 const assets=await generateDocumentIllustrations({client:mock.client,plan:{sections:[{id:'overview',heading:'Laboratory concepts'}]},input:'Include a concept illustration.',options:{env:settings,logger:()=>{},imageGenerator:request=>generateImage(request,{env:settings,cacheRoot:directory,client:{interactions:{create:async()=>({output_image:{mime_type:'image/jpeg',data:buffer.toString('base64')}})}}})}});
 assert.equal(assets.length,1);assert.equal(assets[0].provider,'gemini');const document={documentType:'report',title:'Laboratory concepts',coverPage:false,assets,references:[],sections:[{id:'overview',heading:'Laboratory concepts',blocks:[{type:'image',assetId:assets[0].id}]}]};
 const rendered=await renderDocumentDocx(document),zip=await JSZip.loadAsync(rendered.buffer||rendered);assert.ok(Object.keys(zip.files).some(name=>/^word\/media\//.test(name)));
});
test('Gemini fallback image is served identically from HTTP preview and downloaded ZIP',async t=>{
 const directory=await root(t),buffer=await photo(),fixture=fixtures.pharmaceutical,mock=anthropicFixture(({schema})=>schema.properties.pageType?fixturePlan(fixture):fixtureDraft(fixture));
 const providers=websiteImageProviders(env,{commonsSearch:async()=>null,imageGenerator:async()=>({buffer})});
 const app=createApp({webpageRoot:directory,model:{create:async value=>({...value,_id:'gemini-http',save:async()=>{}})},generator:(kind,input,type,context)=>generateService(kind,input,type,context,{ai:{client:mock.client,logger:()=>{}},webpageAssets:{providers,curated:false,policy:{maxAssets:1,maxGenerated:1,estimatedUnitCost:.06,maxEstimatedCost:.06},optimization:{cacheRoot:directory}},artifacts:{root:directory}})});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});const origin=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:fixture.source,outputType:'webpage'})}),body=await response.json();assert.equal(response.status,201,JSON.stringify(body));const result=body.data.result,hero=result.generatedContent.visualAssets.hero;assert.ok(hero);
 assert.equal((await fetch(origin+result.artifacts.previewUrl)).status,200);const image=await fetch(origin+result.artifacts.siteUrl.replace('index.html','')+hero.url.slice(2));assert.equal(image.status,200);const served=Buffer.from(await image.arrayBuffer());
 const download=await fetch(origin+result.artifacts.downloadUrl);assert.equal(download.status,200);const zip=await JSZip.loadAsync(await download.arrayBuffer(),{checkCRC32:true}),entry=Object.entries(zip.files).find(([name])=>name.endsWith('/'+hero.url.slice(2)));assert.ok(entry);assert.deepEqual(await entry[1].async('nodebuffer'),served);assert.equal(hero.sourceType,'ai-generated');
});
