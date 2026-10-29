import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {raceImages} from '../../Service/visual/imageRace.mjs';
import {acquireRacingImage,raceProviderAdapters} from '../../Service/visual/imageRaceProviders.mjs';
import {imageContextHash} from '../../Service/visual/assetBinding.mjs';
import {configuredImageProviders} from '../../Service/visual/imageProviders.mjs';
import {websiteImageProviders} from '../../Service/webpage/imageProviders.mjs';
import {pixabayAdapter} from '../../Service/visual/pixabayProvider.mjs';
const ids=['commons','unsplash','picsum','gemini','pixabay'],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const winner of ids)test(`${winner} can win; all providers start before any result is validated`,async()=>{
 const starts=[],logs=[],controllers=[];
 const result=await raceImages(ids.map(id=>({id,kind:id==='gemini'?'generation':'stock',acquire:async r=>{starts.push(id);controllers.push([id,r.signal]);await sleep(id===winner?5:35);return {id};}})),{generationType:'presentation',slideNumber:3},{logger:e=>logs.push(e),validate:async()=>{assert.equal(starts.length,ids.length);return true;}});
 assert.equal(result.raceWinner,winner);assert.equal(logs.filter(e=>e.status==='winner').length,1);assert.ok(controllers.filter(([id])=>id!==winner).every(([,signal])=>signal.aborted));assert.ok(logs.some(e=>e.status==='winner'&&e.validationMs>=0&&e.timeToFirstImageMs>=0));
});
test('irrelevant and failed fast contenders do not end a race; slow losers do not delay selection',async()=>{
 const started=performance.now(),logs=[];const result=await raceImages([{id:'picsum',acquire:async()=>({valid:false})},{id:'commons',acquire:async()=>{throw new Error('private');}},{id:'unsplash',acquire:async()=>{await sleep(10);return {valid:true};}},{id:'gemini',acquire:()=>new Promise(()=>{})}],{generationType:'webpage',sectionId:'overview'},{timeoutMs:300,logger:e=>logs.push(e),validate:asset=>asset.valid});
 assert.equal(result.raceWinner,'unsplash');assert.ok(performance.now()-started<250);assert.equal(logs.filter(e=>e.status==='rejected').length,2);assert.ok(!JSON.stringify(logs).includes('private'));
});
test('first HTTP completion loses if its actual validation is slower',async()=>{
 const r=await raceImages([{id:'picsum',acquire:async()=>({delay:40})},{id:'commons',acquire:async()=>{await sleep(8);return {delay:1};}}],{},{logger:()=>{},validate:async asset=>{await sleep(asset.delay);return true;}});assert.equal(r.raceWinner,'commons');
});
test('timeouts include validation; all failures and external abort settle without unhandled rejections',async()=>{
 assert.equal(await raceImages([{id:'stalled-validation',acquire:async()=>({})}],{},{logger:()=>{},timeoutMs:15,validate:()=>new Promise(()=>{})}),null);
 let calls=0;const controller=new AbortController(),r=raceImages(ids.map(id=>({id,acquire:async()=>{calls++;await sleep(25);throw new Error('late');}})),{signal:controller.signal},{logger:()=>{},validate:()=>true});controller.abort();assert.equal(await r,null);await sleep(30);assert.equal(calls,0);
 const running=new AbortController(),active=raceImages(ids.map(id=>({id,acquire:async()=>{calls++;await sleep(25);throw new Error('late');}})),{signal:running.signal},{logger:()=>{},validate:()=>true});await sleep(5);running.abort();assert.equal(await active,null);await sleep(30);assert.equal(calls,5);
});
test('loser and rejected private assets are cleaned once; winner is retained',async()=>{
 const cleaned=[];const result=await raceImages([{id:'bad',acquire:async()=>({id:'bad'})},{id:'winner',acquire:async()=>{await sleep(5);return {id:'winner'};}},{id:'late',acquire:async()=>{await sleep(20);return {id:'late'};}}],{},{logger:()=>{},validate:a=>a.id!=='bad',cleanup:a=>cleaned.push(a.id)});await sleep(35);assert.equal(result.raceWinner,'winner');assert.deepEqual(cleaned.sort(),['bad','late']);
});
const buffer=await fs.readFile('assets/webpage/curated/laboratory.jpg');
const asset=()=>({buffer,source:'Wikimedia Commons',sourceType:'licensed-stock',mediaKind:'photograph',creator:'CDC',license:'Public domain',description:'A scientist pipetting in a pharmaceutical research laboratory',alt:'Scientist in a pharmaceutical research laboratory',generationMethod:'licensed-search'});
test('Picsum may win only with pixel review bound to the same requirement and exact bytes',async()=>{
 const requirement={query:'pharmaceutical research laboratory',generationType:'webpage',role:'hero'},candidate={...asset(),source:'Lorem Picsum',license:'Unsplash License',licenseVerified:true};
 assert.equal(await acquireRacingImage([{id:'picsum',acquire:async()=>candidate}],requirement,{logger:()=>{}}),null);
 const normalized={...requirement,searchQuery:requirement.query};candidate.visualVerification={status:'passed',contextHash:imageContextHash(normalized),sha256:createHash('sha256').update(buffer).digest('hex')};assert.equal((await acquireRacingImage([{id:'picsum',acquire:async()=>candidate}],requirement,{logger:()=>{}})).raceWinner,'picsum');
});
test('unlicensed, irrelevant, corrupt and undersized images cannot win',async()=>{
 for(const candidate of [{...asset(),license:''},{...asset(),description:'A car in a showroom',alt:'A car in a showroom'},{...asset(),buffer:Buffer.from('corrupt')},{...asset(),buffer:await sharp(buffer).resize(400,300).toBuffer()},{...asset(),buffer:await sharp(buffer).resize(800,1600,{fit:'fill'}).toBuffer()}])assert.equal(await acquireRacingImage([{id:'commons',acquire:async()=>candidate}],{query:'pharmaceutical laboratory',generationType:'webpage'},{logger:()=>{}}),null);
});
test('fact-only requirements reject generated contenders and budgets prevent paid starts',async()=>{
 let calls=0;const providers=[{id:'gemini',kind:'generation',acquire:async()=>{calls++;return {...asset(),source:'Google Gemini',sourceType:'ai-generated',generationMethod:'ai-generated'};}}];
 assert.equal(await acquireRacingImage(providers,{query:'laboratory',authenticOnly:true},{reserveGeneration:()=>true,logger:()=>{}}),null);assert.equal(await acquireRacingImage(providers,{query:'laboratory'},{reserveGeneration:()=>false,logger:()=>{}}),null);assert.equal(calls,1);
});
test('default presentation and webpage provider sets expose the same five contenders',()=>{assert.deepEqual(configuredImageProviders({}).raceProviders.map(p=>p.id),ids);assert.deepEqual(websiteImageProviders({}).raceProviders.map(p=>p.id),ids);});
test('Unsplash without export approval remains a contender but cannot license a bundled output',async()=>{
 let network=0;const p=raceProviderAdapters({UNSPLASH_ACCESS_KEY:'test-secret'},{commonsAcquire:async()=>null,fetcher:async()=>{network++;return new Response(JSON.stringify({results:[]}));}}).find(p=>p.id==='unsplash');await assert.rejects(p.acquire({query:'laboratory'}),{code:'UNSPLASH_EXPORT_PERMISSION_REQUIRED'});assert.equal(network,1);
});
test('Pixabay uses authenticated semantic search, caches metadata for 24h and downloads eligible photos',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-pixabay-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let searches=0,downloads=0;
 const p=pixabayAdapter({PIXABAY_API_KEY:'mock-private-key'},{cacheRoot:root,fetcher:async url=>{searches++;assert.equal(url.searchParams.get('q'),'pharmaceutical research laboratory');assert.equal(url.searchParams.get('safesearch'),'true');assert.equal(url.searchParams.get('image_type'),'photo');return new Response(JSON.stringify({hits:[{id:123,type:'photo',user:'Scientist',user_id:42,pageURL:'https://pixabay.com/photos/laboratory-123/',tags:'pharmaceutical research laboratory scientist pipetting',imageWidth:1920,imageHeight:1080,largeImageURL:'https://cdn.pixabay.com/photo/laboratory.jpg'}]}));},download:async url=>{downloads++;assert.equal(new URL(url).hostname,'cdn.pixabay.com');return {buffer};}});
 for(let i=0;i<2;i++){const r=await p.acquire({query:'pharmaceutical research laboratory'});assert.equal(r.licenseVerified,true);assert.equal(r.source,'Pixabay');assert.ok(r.buffer.length);}
 assert.equal(searches,1);assert.equal(downloads,2);for(const file of await fs.readdir(root))assert.ok(!(await fs.readFile(path.join(root,file),'utf8')).includes('mock-private-key'));
 await assert.rejects(pixabayAdapter({}).acquire({query:'laboratory'}),{code:'PIXABAY_CREDENTIALS_REQUIRED'});
});
test('Picsum adapter reviews actual pixels and fails closed on rejected or absent visual verification',async()=>{
 let reviews=0;const options={commonsAcquire:async()=>null,fetcher:async()=>new Response(JSON.stringify({id:'42',author:'Photographer',url:'https://unsplash.com/photos/fixture'})),download:async url=>({buffer:url.includes('unsplash.com/photos')?Buffer.from('<a href="https://unsplash.com/license">License</a>'):buffer}),visionReview:async request=>{reviews++;assert.deepEqual(request.buffer,buffer);assert.equal(request.prompt,'pharmaceutical laboratory');return {status:'passed'};}};
 const p=raceProviderAdapters({},options).find(p=>p.id==='picsum'),r=await p.acquire({query:'pharmaceutical laboratory'});assert.equal(reviews,1);assert.equal(r.visualVerification.sha256,createHash('sha256').update(buffer).digest('hex'));
 const rejected=raceProviderAdapters({}, {...options,visionReview:async()=>({status:'rejected'})}).find(p=>p.id==='picsum');await assert.rejects(rejected.acquire({query:'pharmaceutical laboratory'}),{code:'IMAGE_SEMANTIC_REJECTED'});
});
test('approved Unsplash adapter preserves CDN ixid, author referral credit and download tracking',async()=>{
 let tracked=0;const p=raceProviderAdapters({UNSPLASH_ACCESS_KEY:'mock-only',UNSPLASH_BUNDLED_EXPORT_APPROVED:'true'},{commonsAcquire:async()=>null,fetcher:async url=>{if(String(url).includes('/download')){tracked++;return new Response('{}');}return new Response(JSON.stringify({results:[{user:{name:'Photographer',links:{html:'https://unsplash.com/@photographer'}},urls:{regular:'https://images.unsplash.com/photo-1?ixid=keep-this'},links:{html:'https://unsplash.com/photos/fixture',download_location:'https://api.unsplash.com/photos/fixture/download'},description:'A scientist pipetting in a pharmaceutical research laboratory'}]}));},download:async url=>{assert.equal(new URL(url).searchParams.get('ixid'),'keep-this');return {buffer};}}).find(p=>p.id==='unsplash');
 const r=await p.acquire({query:'pharmaceutical laboratory'});assert.equal(tracked,1);assert.ok(r.creatorUrl.includes('utm_source=ledify'));assert.equal(r.licenseVerified,true);
});
import {createImageAssetSession} from '../../Service/visual/presentationImageAssets.mjs';
import {imagePolicy} from '../../Service/visual/imagePolicy.mjs';
import {acquireWebsiteImages} from '../../Service/webpage/imagePipeline.mjs';
import {webpageLayoutService} from '../../Service/webpageLayoutService.mjs';
import {webpageThemeService} from '../../Service/webpageThemeService.mjs';
import {fixtures,fixturePlan,fixtureDraft} from '../webpage/fixtures.mjs';
test('both presentation normalization and webpage responsive assets use the shared race winner',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-race-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const providers=ids.map(id=>({id,kind:id==='gemini'?'generation':'stock',acquire:async()=>{if(id!=='commons'){await sleep(25);return null;}return asset();}}));
 const session=createImageAssetSession({providers:{raceProviders:providers,raceLogger:()=>{}},root,policy:{...imagePolicy({}),retries:0}}),photo=await session.resolve({title:'Pharmaceutical laboratory'},{slideNumber:1,title:'Pharmaceutical laboratory',slideType:'title',imageRequirement:{kind:'photo',role:'background',description:'A scientist pipetting in a pharmaceutical research laboratory',searchQuery:'pharmaceutical laboratory'}},{family:'scientific',style:'editorial',palette:{background:'FFFFFF'}},{});assert.equal(photo.raceWinner,'commons');assert.ok(photo.binding);assert.ok(photo.filePath);
 const webpageProviders=[];webpageProviders.raceProviders=providers;const page=webpageThemeService(webpageLayoutService({outputType:'webpage',...fixturePlan(fixtures.pharmaceutical),...fixtureDraft(fixtures.pharmaceutical)}));
 const result=await acquireWebsiteImages(page,{}, {providers:webpageProviders,curated:false,policy:{maxAssets:1,concurrency:1},optimization:{cacheRoot:root},logger:()=>{}});assert.equal(result.page.visualAssets.hero.raceWinner,'commons');assert.ok(Object.keys(result.assets).length);assert.ok(result.page.visualAssets.hero.binding);
});
