import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {createApp} from '../../src/app.mjs';
import {generateService} from '../../Service/generateService.mjs';
import {fixtures,fixturePlan,fixtureDraft} from '../webpage/fixtures.mjs';
import {webpageLayoutService} from '../../Service/webpageLayoutService.mjs';
import {webpageThemeService} from '../../Service/webpageThemeService.mjs';
import {acquireWebsiteImages} from '../../Service/webpage/imagePipeline.mjs';
import {reviewImageCandidate} from '../../Service/webpage/imageReview.mjs';
import {planWebsiteImages} from '../../Service/webpage/imageStrategy.mjs';

async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-concept-delivery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const content=()=>({outputType:'webpage',...fixturePlan(fixtures.business),...fixtureDraft(fixtures.business)});
test('explicit futuristic hero scene overrides broad orbital image direction and rejects real stock substitutes',()=>{
 const page=webpageThemeService(webpageLayoutService(content()));page.designBrief.imageDirection='Speculative renderings of orbital habitats and ecological skyscrapers';
 const context={instructions:'Create an extraordinary hero section featuring a photorealistic futuristic city with advanced transportation and sustainable skyscrapers.'};
 const target=planWebsiteImages(page,context).find(p=>p.role==='hero');assert.match(target.query,/futuristic city/);assert.doesNotMatch(target.query,/orbital/);
 for(const description of ['Astronaut working outside a spacecraft during a spacewalk','Book-lined galleries in the Long Room library']){
  const record={source:'Wikimedia Commons curated catalog',creator:'Author',license:'CC BY 4.0',alt:description};
  assert.equal(reviewImageCandidate(record,target,{width:1200,height:800}).reason,'CONCEPT_IMAGE_REQUIRED');
 }
});
test('a requested futuristic image direction applies to the whole plan and missing gallery pictures preserve descriptions',async t=>{
 const root=await temporary(t),page=webpageThemeService(webpageLayoutService(content()));
 page.sections.push({id:'future-gallery',type:'gallery',heading:'Future infrastructure',intro:'Speculative studies.',composition:'showcase',items:[{title:'Atmospheric scrubber tower',description:'An architectural study of future carbon capture infrastructure.',detail:'',url:''}]});
 const context={instructions:'Use highly relevant futuristic imagery throughout the website.'};
 assert.ok(planWebsiteImages(page,context).every(target=>target.visualIntent==='concept'));
 const result=await acquireWebsiteImages(page,context,{providers:[],external:false,curated:false,optimization:{cacheRoot:root},logger:()=>{}});
 const gallery=result.page.sections.find(section=>section.id==='future-gallery');assert.equal(gallery.items.length,1);assert.equal(gallery.items[0].image,undefined);assert.equal(gallery.items[0].title,'Atmospheric scrubber tower');assert.equal(result.page.imageValidation.status,'incomplete');
});
test('concept requests skip live stock and curated fallbacks; configured generation may satisfy the hero',async t=>{
 const root=await temporary(t),page=webpageThemeService(webpageLayoutService(content()));page.inferredContext.topic='Future civilization including orbital habitats and digital education';
 page.imagePlan=[{role:'hero',subject:'Photorealistic futuristic city in 2080',alt:'Futuristic city concept',required:true,aspectRatio:'16:9'}];
 let stockCalls=0,generatedCalls=0;const stock={id:'commons',acquire:async()=>{stockCalls++;throw new Error('A real stock photo cannot depict this future concept');}};
 const unavailable=await acquireWebsiteImages(page,{}, {providers:[stock],optimization:{cacheRoot:root},logger:()=>{},relevanceLogger:()=>{}});
 assert.equal(stockCalls,0);assert.equal(unavailable.page.visualAssets.hero,undefined);assert.equal(unavailable.page.imageValidation.status,'incomplete');
 const buffer=await fs.readFile('assets/webpage/curated/space-orbit.jpg');
 const generated=await acquireWebsiteImages(page,{}, {policy:{estimatedUnitCost:.06,maxEstimatedCost:.06},providers:[stock,{id:'generated-image',kind:'generation',acquire:async()=>{generatedCalls++;return {buffer,source:'Mock dedicated provider',sourceType:'ai-generated',creator:'AI generated',license:'Fixture generation terms',alt:'Futuristic city concept'};}}],optimization:{cacheRoot:root},logger:()=>{},relevanceLogger:()=>{}});
 assert.equal(stockCalls,0);assert.equal(generatedCalls,1);assert.equal(generated.page.visualAssets.hero.source,'Mock dedicated provider');assert.equal(generated.page.imageValidation.status,'passed');
});
test('website missing required concept imagery returns recoverable draft files with HTTP 422',async t=>{
 const root=await temporary(t),model={create:async value=>({...value,_id:'fixture',save:async()=>{}})};
 const app=createApp({model,webpageRoot:root,generator:(kind,input,type,context)=>generateService(kind,input,type,context,{completedContent:{generatedContent:content()},webpageAssets:{providers:[],curated:false,external:false,policy:{failureMode:context.tone==='strict'?'strict':undefined}},artifacts:{root}})});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const strict of [false,true]){
  const response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:'Create a website with images and a futuristic city hero.',outputType:'webpage',context:{tone:strict?'strict':'educational'}})});
  const body=await response.json(),result=body.data.result;
  assert.equal(response.status,422);assert.equal(result.status,'incomplete');
  assert.equal(result.imageValidation.status,'incomplete');assert.ok(result.warnings.some(w=>w.code==='IMAGE_REQUIREMENTS_UNMET'));assert.ok(result.artifacts.previewUrl);assert.ok(result.artifacts.downloadUrl);
  const zip=await fetch(origin+result.artifacts.downloadUrl);assert.equal(zip.status,200);assert.ok((await zip.arrayBuffer()).byteLength>100);
 }
});
