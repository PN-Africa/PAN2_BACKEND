// Mock Gemini and Claude; real rendering, conversions and HTTP downloads.
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {tenSlideFixture} from './fixtures/tenSlideClaude.mjs';
import {createApp} from '../src/app.mjs';
import {generateService} from '../Service/generateService.mjs';
import {generateImage} from '../Service/visual/imageGenerationService.mjs';
const root=path.resolve('generated/gemini-artifact-audit'),presentationRoot=path.join(root,'presentations');await fs.mkdir(root,{recursive:true});process.env.LEDIFY_PRESENTATION_ROOT=presentationRoot;
const fixture=await tenSlideFixture(0,0),env={AI_IMAGE_PROVIDER:'gemini',AI_IMAGE_PROVIDER_APPROVED:'true',GEMINI_API_KEY:'fixture-key',AI_IMAGE_MODEL:'gemini-nano-banana-2.1'};let calls=0;
const providers={identity:'controlled-gemini-artifact-audit',search:async()=>null,generate:async brief=>{
 const asset=fixture.assets.find(asset=>asset.slideNumber===brief.slideNumber);assert.ok(asset);calls++;
 const image=await generateImage({prompt:brief.description,aspectRatio:brief.aspectRatio,generationType:'presentation',signal:brief.signal},{env,cacheRoot:path.join(root,'cache'),client:{interactions:{create:async()=>({output_image:{mime_type:'image/jpeg',data:asset.buffer.toString('base64')}})}}});
 return {buffer:image.buffer,source:'Google Gemini',creator:'Mock Gemini generation',license:'Controlled fixture; no live generated content',model:image.model,sourceType:'ai-generated',generationMethod:'ai-generated',description:brief.description};
}};
const app=createApp({presentationRoot,model:{create:async value=>({...value,_id:'gemini-native',save:async()=>{}})},generator:(kind,input,type,context)=>generateService(kind,input,type,context,{ai:{client:fixture.mock.client,qualityReview:false,logger:()=>{}},visuals:{providers,diagramPlanner:false,cacheRoot:path.join(root,'session-cache'),policy:{allowGeneration:true,maxGenerated:3,estimatedUnitCost:.06,maxEstimatedCost:.18}},preview:{outputDirectory:presentationRoot}})});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`,started=performance.now();
try{
 const response=await fetch(origin+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:fixture.prompt,outputType:'presentation',context:fixture.context})}),body=await response.json();assert.equal(response.status,201,JSON.stringify(body));const result=body.data.result;
 assert.equal(calls,3);assert.equal(result.preview.slides.length,10);assert.equal(result.imageValidation.status,'passed');
 const read=async url=>{const response=await fetch(origin+url);assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());};
 const pptx=await read(result.preview.downloads.pptx),zip=await JSZip.loadAsync(pptx);assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length,10);assert.ok(Object.keys(zip.files).filter(name=>name.startsWith('ppt/media/')&&!zip.files[name].dir).length>=3);
 assert.equal((await read(result.preview.downloads.pdf)).subarray(0,4).toString(),'%PDF');for(const slide of result.preview.slides)assert.equal((await read(slide.url)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 await fs.writeFile(path.join(root,'cover.png'),await read(result.preview.slides[0].url));await fs.writeFile(path.join(root,'report.json'),JSON.stringify({status:'passed',elapsedMs:Math.round(performance.now()-started),mockGeminiCalls:calls,slideCount:10,pptxBytes:pptx.length,pdf:true,pngCount:10,liveAi:false},null,2));console.log('[GEMINI_ARTIFACT_AUDIT]',await fs.readFile(path.join(root,'report.json'),'utf8'));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
