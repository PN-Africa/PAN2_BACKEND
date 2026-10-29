import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {classifyImageError,imageRetryDelay,storeImageAsset,validateImageBytes,withImageCapacity,shareImageWork} from '../../Service/visual/imageAssetService.mjs';
import {acquireProviderImage} from '../../Service/webpage/providerCache.mjs';
import {acquireWebsiteImages} from '../../Service/webpage/imagePipeline.mjs';
import {webpageLayoutService} from '../../Service/webpageLayoutService.mjs';
import {webpageThemeService} from '../../Service/webpageThemeService.mjs';
import {fixtures,fixturePlan,fixtureDraft} from '../webpage/fixtures.mjs';
import {compileWebsiteBrief} from '../../Service/webpage/websiteBrief.mjs';
import {generationJobs} from '../../Service/generationJobs.mjs';
import {generateGoogleImage} from '../../Service/visual/googleImageService.mjs';

async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-image-reliability-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const photograph=()=>fs.readFile('assets/webpage/curated/laboratory.jpg');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const stop=Date.now()+10000;while(Date.now()<stop){const v=await fn();if(v)return v;await sleep(25);}assert.fail('Job did not settle');}
function page(){const fixture=fixtures.pharmaceutical,result=webpageThemeService(webpageLayoutService({outputType:'webpage',...fixturePlan(fixture),...fixtureDraft(fixture)}));result.websiteBrief=compileWebsiteBrief(result,fixture.source);return result;}

test('required website hero receives the image budget before an optional supporting image',async t=>{
 const root=await temporary(t),draft=page(),queries=[];draft.imagePlan=[{role:'section',sectionIndex:0,required:false,subject:'Clinical research',alt:'Clinical laboratory',aspectRatio:'16:9'},{role:'hero',required:true,subject:'Pharmaceutical laboratory',alt:'Laboratory research',aspectRatio:'16:9'}];
 const buffer=await photograph(),result=await acquireWebsiteImages(draft,{}, {curated:false,policy:{estimatedUnitCost:.06,maxEstimatedCost:.06,maxGenerated:1,maxAssets:2,retries:0,concurrency:1},optimization:{cacheRoot:root},providers:[{id:'generated-image',kind:'generation',acquire:async request=>{queries.push(request.query);return {source:'Mock dedicated provider',sourceType:'ai-generated',creator:'AI generated',license:'Controlled test',alt:request.alt,buffer};}}],logger:()=>{}});
 assert.deepEqual(queries,['Pharmaceutical laboratory']);assert.equal(result.page.imageValidation.status,'passed');assert.ok(result.page.visualAssets.hero);assert.ok(result.warnings.some(w=>w.code==='WEBPAGE_IMAGE_PLAN_INCOMPLETE'));
});

for(const [status,reason,retryable] of [[401,'IMAGE_INVALID_CREDENTIALS',false],[403,'IMAGE_ACCESS_DENIED',false],[404,'IMAGE_MODEL_UNAVAILABLE',false],[400,'IMAGE_REQUEST_REJECTED',false],[429,'PROVIDER_RATE_LIMITED',true],[503,'PROVIDER_UNAVAILABLE',true]])test(`HTTP ${status} classification is safe and bounded`,()=>{assert.deepEqual(classifyImageError({status,message:'private details'}),{reasonCode:reason,retryable,providerStatus:status});});
test('backoff honors rate-limit advice with bounded jitter',()=>{assert.equal(imageRetryDelay({headers:new Headers({'Retry-After':'2'})},0,{random:()=>0}),2000);assert.equal(imageRetryDelay({},1,{random:()=>0}),500);assert.equal(imageRetryDelay({headers:{'retry-after':'999'}},0),60000);});
test('expired download URLs are distinguished from a missing image model',()=>{assert.equal(classifyImageError({status:404,imageOperation:'download'}).reasonCode,'IMAGE_DOWNLOAD_UNAVAILABLE');assert.equal(classifyImageError({status:404}).reasonCode,'IMAGE_MODEL_UNAVAILABLE');});
test('source assets persist as verified content-addressed files and corrupt data is rejected',async t=>{
 const root=await temporary(t),buffer=await photograph();const [a,b]=await Promise.all([storeImageAsset(buffer,{root}),storeImageAsset(buffer,{root})]);assert.equal(a.filePath,b.filePath);assert.deepEqual(await fs.readFile(a.filePath),buffer);await fs.writeFile(a.filePath,'corrupt');await storeImageAsset(buffer,{root});assert.deepEqual(await fs.readFile(a.filePath),buffer);await assert.rejects(validateImageBytes(Buffer.from('invalid')),{code:'IMAGE_INVALID'});
});
test('image admission queues concurrent requests instead of rejecting spare work',async()=>{
 let active=0,peak=0;const provider=randomUUID();await Promise.all(Array.from({length:8},()=>withImageCapacity(provider,async()=>{peak=Math.max(peak,++active);await sleep(20);active--;},{concurrency:2})));assert.equal(peak,2);assert.equal(active,0);
});
test('aborted queued work never invokes or leaks provider capacity',async()=>{
 const key=randomUUID(),controller=new AbortController();let release,calls=0;const gate=new Promise(r=>{release=r;});const first=withImageCapacity(key,()=>gate,{concurrency:1});const waiting=withImageCapacity(key,()=>{calls++;},{concurrency:1,signal:controller.signal});controller.abort();await assert.rejects(waiting);release();await first;await withImageCapacity(key,()=>{calls++;},{concurrency:1});assert.equal(calls,1);
});
test('one cancelled client cannot cancel the shared image needed by another client',async()=>{
 const key=randomUUID(),first=new AbortController();let calls=0,release;const gate=new Promise(r=>{release=r;});
 const work=async signal=>{calls++;await gate;assert.equal(signal.aborted,false);return 'verified asset';};
 const a=shareImageWork(key,work,{signal:first.signal}),b=shareImageWork(key,work);first.abort();await assert.rejects(a,{code:'IMAGE_CANCELLED'});release();assert.equal(await b,'verified asset');assert.equal(calls,1);
});
test('website provider cache checks integrity, coalesces identical requests, and queues distinct requests',async t=>{
 const root=await temporary(t),buffer=await photograph();let calls=0;const provider={id:'gemini-image',acquire:async()=>{calls++;await sleep(15);return {buffer,source:'Test',license:'Public domain',creator:'Fixture'};}};
 await Promise.all([acquireProviderImage(provider,{query:'A'},{cacheRoot:root}),acquireProviderImage(provider,{query:'A'},{cacheRoot:root}),acquireProviderImage(provider,{query:'B'},{cacheRoot:root})]);assert.equal(calls,2);
 const files=await fs.readdir(path.join(root,'providers'));for(const file of files.filter(n=>n.endsWith('.bin')))await fs.writeFile(path.join(root,'providers',file),'corrupt');await acquireProviderImage(provider,{query:'A'},{cacheRoot:root});assert.equal(calls,3);
});
test('a required website hero failure is explicit; invalid credentials are not retried',async t=>{
 let calls=0;const result=await acquireWebsiteImages(page(),{instructions:'A required hero image'},{providers:[{id:'fixture',acquire:async()=>{calls++;throw Object.assign(new Error('secret'),{status:401});}}],curated:false,policy:{retries:1},optimization:{cacheRoot:await temporary(t)},logger:()=>{}});assert.equal(calls,1);assert.equal(result.page.imageValidation.status,'incomplete');assert.ok(result.page.imageValidation.requiredMissing.some(t=>t.role==='hero'));assert.ok(result.warnings.some(w=>w.reasonCode==='IMAGE_INVALID_CREDENTIALS'));assert.ok(!JSON.stringify(result).includes('secret'));
});
test('a transient 429 retries within the existing image budget and uses the recovered bytes',async t=>{
 const root=await temporary(t),buffer=await photograph();let calls=0;const result=await acquireWebsiteImages(page(),{}, {providers:[{id:'generated-image',kind:'generation',acquire:async target=>{if(++calls===1)throw Object.assign(new Error('rate limited'),{status:429});return {buffer,source:'Mock dedicated provider',sourceType:'ai-generated',creator:'Generated fixture',license:'Test',alt:target.alt};}}],curated:false,policy:{estimatedUnitCost:.06,maxEstimatedCost:.12,maxAssets:1,maxGenerated:2,retries:1,totalMs:10000},optimization:{cacheRoot:root},sleep:async()=>{},logger:()=>{}});assert.equal(calls,2);assert.ok(result.page.visualAssets.hero);assert.equal(result.page.imageStrategy.generatedCalls,2);
});
test('fatal Google access failures expose safe reason codes without repeated SDK attempts',async()=>{
 for(const status of [401,404]){let calls=0;await assert.rejects(generateGoogleImage({prompt:'Scientific laboratory'},{env:{GEMINI_API_KEY:'test-key',GOOGLE_IMAGE_MODEL:'fixture'},client:{models:{generateContent:async()=>{calls++;throw Object.assign(new Error('private credential text'),{status});}}},logger:()=>{}}),e=>e.providerStatus===status&&!e.message.includes('credential text'));assert.equal(calls,1);}
});
test('Google timeout and blocked/empty responses are explicit and never fabricate successful bytes',async()=>{
 const options={env:{GEMINI_API_KEY:'fixture',GOOGLE_IMAGE_MODEL:'fixture'},timeoutMs:1000,logger:()=>{}};
 await assert.rejects(generateGoogleImage({prompt:'Laboratory'},{...options,client:{models:{generateContent:()=>new Promise(()=>{})}}}),{code:'PROVIDER_TIMEOUT'});
 for(const response of [{promptFeedback:{blockReason:'SAFETY'},candidates:[]},{candidates:[]}])await assert.rejects(generateGoogleImage({prompt:'Laboratory'},{...options,client:{models:{generateContent:async()=>response}}}),e=>['IMAGE_EMPTY_RESPONSE','IMAGE_CONTENT_BLOCKED'].includes(e.code));
});
test('a missing required image cannot become a completed background job',async t=>{
 const root=await temporary(t),jobs=generationJobs({root,generator:async()=>({status:'incomplete',imageValidation:{status:'incomplete',requiredMissing:[1]},preview:{downloads:{pptx:'/available-draft'}}})});const accepted=await jobs.enqueue({kind:'prompt',input:'Source',outputType:'presentation',context:{},options:{}}),token=accepted.statusUrl.split('/').at(-1);const result=await until(async()=>{const s=await jobs.read(accepted.jobId,token);return s.status==='failed'&&s;});assert.equal(result.error.errorCode,'IMAGE_REQUIREMENTS_UNMET');assert.equal(result.result.preview.downloads.pptx,'/available-draft');
});
test('job restart restores authorized image buffers and uses the persisted source without provider access',async t=>{
 const root=await temporary(t),id=randomUUID(),token='c'.repeat(64),dir=path.join(root,id),buffer=await photograph();await fs.mkdir(dir);
 await fs.writeFile(path.join(dir,'input.json'),JSON.stringify({kind:'prompt',input:'Source',outputType:'presentation',options:{visuals:{userAssets:[{buffer}]}},context:{}}));await fs.writeFile(path.join(dir,'status.json'),JSON.stringify({jobId:id,tokenHash:createHash('sha256').update(token).digest('hex'),status:'processing',progress:{},artifacts:{},runs:1}));
 const jobs=generationJobs({root,generator:async(a,b,c,d,options)=>{assert.ok(Buffer.isBuffer(options.visuals.userAssets[0].buffer));assert.deepEqual(options.visuals.userAssets[0].buffer,buffer);return {status:'completed'};}});await jobs.initialize();await until(async()=>(await jobs.read(id,token)).status==='completed');
});
