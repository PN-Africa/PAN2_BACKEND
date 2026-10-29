import test from 'node:test';
import {coverAsset} from '../fixtures/coverAsset.mjs';
import {approvedImageEnv} from '../fixtures/coverAsset.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { requestedTopics, canonicalTitles, reviewAndRepairPresentation, unsupportedAbsoluteClaims } from '../../Service/ai/presentationQuality.mjs';
import { validateOutline } from '../../Service/ai/presentationPrompts.mjs';
import { presentationLayoutService } from '../../Service/presentationLayoutService.mjs';
import { presentationThemeService } from '../../Service/presentationThemeService.mjs';
import { presentationRendererService } from '../../Service/presentationRendererService.mjs';
import { resolvePresentationVisuals,prepareBackground,imageDimensions,deriveVisualTheme } from '../../Service/visual/presentationVisuals.mjs';
import { configuredImageProviders } from '../../Service/visual/imageProviders.mjs';
import { validateDiagram } from '../../renderer/presentation/visuals/svgGraphics.mjs';
import { generatePresentationBuffer } from '../../renderer/presentation/pptxRenderer.mjs';
import { validateRenderedPptx } from '../../renderer/presentation/renderedOutputValidation.mjs';
import { publicGenerationResult } from '../../Service/publicGenerationResult.mjs';
import { fixtures } from '../fixtures/presentationContent.mjs';
import express from 'express';
import {validateRenderContent} from '../../renderer/presentation/professionalLayouts.mjs';

const originalPrompt='Create a professional 8-slide PowerPoint presentation on the human cardiovascular system. Cover the introduction, anatomy of the heart, cardiac chambers and valves, pulmonary circulation, systemic circulation, cardiac conduction system, functions of the cardiovascular system, and conclusion. Give each slide a unique title and meaningful scientific content. Avoid duplicate slides.';
const base=()=>({outputType:'presentation',strategyId:'academic-seminar',title:'Source review',subtitle:'A practical overview',slides:[
    {slideNumber:1,slideType:'title',title:'Wrong alternative',subtitle:'Wrong subtitle',content:{titleContent:structuredClone(fixtures.titleContent)}},
    {slideNumber:2,slideType:'focused-explanation',title:'Review evidence',subtitle:'Preserve the actors and relationships',content:{textContent:structuredClone(fixtures.textContent)}}
]});
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-visual-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const ready=content=>presentationRendererService(presentationThemeService(presentationLayoutService(content)));

test('original eight-topic request is an exact coverage fixture; other subjects use the same parser',()=>{
    assert.deepEqual(requestedTopics(originalPrompt),['introduction','anatomy of the heart','cardiac chambers and valves','pulmonary circulation','systemic circulation','cardiac conduction system','functions of the cardiovascular system','conclusion']);
    assert.deepEqual(requestedTopics('Cover the request lifecycle, access control, and conclusion.'),['request lifecycle','access control','conclusion']);
    assert.deepEqual(requestedTopics('Explain a broad topic',{requiredTopics:['Approach','Evidence','Approach']}),['Approach','Evidence']);
    assert.throws(()=>validateOutline({...base(),slides:[base().slides[0]]},{min:1,max:1},['anatomy']),/map requested topic/);
});
test('canonical metadata and content titles/subtitles are synchronized',()=>{
    const deck=canonicalTitles(base());assert.equal(deck.slides[0].title,deck.title);assert.equal(deck.slides[0].content.titleContent.subtitle,deck.subtitle);
});
test('unqualified security guarantees require a repair unless explicitly supported by the source',()=>{
    const slides=[{slideNumber:2,content:{textContent:{body:'This entirely prevents every vulnerability.'}}}];
    assert.equal(unsupportedAbsoluteClaims(slides).length,1);
    assert.equal(unsupportedAbsoluteClaims(slides,'This entirely prevents every vulnerability.').length,0);
});
test('explicit registered themes are not constrained by strategy recommendations',()=>{
    const deck=base();deck.strategyId='lecture-teaching';
    const theme=presentationThemeService(presentationLayoutService(deck),{designPreferences:{theme:'scholarly-clean',variant:'ivory-journal'}});
    assert.equal(theme.design.variantId,'ivory-journal');
});
test('semantic quality repairs only the affected slide and records exact body evidence',async()=>{
    const presentation=base();let calls=0,repairs=0;
    const client={models:{generateContent:async()=>({text:JSON.stringify(calls++===0?{coverage:[{topic:'evidence',slideNumbers:[2],evidence:'',adequate:false}],issues:[{slideNumber:2,severity:'error',code:'DEPTH',message:'The evidence distinction is missing.',repairInstruction:'Explain evidence review without claiming results.'}]}:
        {coverage:[{topic:'evidence',slideNumbers:[2],evidence:'Evidence review distinguishes observations from assumptions.',adequate:true}],issues:[]}),candidates:[{finishReason:'STOP'}]})}};
    const result=await reviewAndRepairPresentation({presentation,input:'Cover evidence.',inputType:'prompt',context:{},client,requestId:'fixture',options:{logger:()=>{},sleep:async()=>{}},repairSlide:async(slide,instruction)=>{
        repairs++;assert.equal(slide.slideNumber,2);assert.match(instruction,/evidence/);return {textContent:{heading:'Evidence',body:'Evidence review distinguishes observations from assumptions.'}};
    }});
    assert.equal(repairs,1);assert.equal(result.quality.repairRounds,1);assert.equal(result.quality.coverage[0].adequate,true);
});
test('a title-only coverage assertion is rejected instead of accepted as adequate',async()=>{
    const client={models:{generateContent:async()=>({text:JSON.stringify({coverage:[{topic:'evidence',slideNumbers:[2],evidence:'Review evidence',adequate:true}],issues:[]}),candidates:[{finishReason:'STOP'}]})}};
    await assert.rejects(reviewAndRepairPresentation({presentation:base(),input:'Cover evidence.',inputType:'prompt',context:{},client,requestId:'fixture',options:{logger:()=>{},sleep:async()=>{}},repairSlide:async()=>{throw new Error('Must not repair an invalid review');}}),e=>e.code==='AI_RETRY_EXHAUSTED');
});
test('persistent substantive issues stop after bounded repairs',async()=>{
    let repairs=0;const client={models:{generateContent:async()=>({text:JSON.stringify({coverage:[],issues:[{slideNumber:2,severity:'error',code:'FACTUAL',message:'Wrong actor.',repairInstruction:'Preserve the source actor.'}]}),candidates:[{finishReason:'STOP'}]})}};
    await assert.rejects(reviewAndRepairPresentation({presentation:base(),input:'Explain a subject.',inputType:'prompt',context:{},client,requestId:'fixture',options:{logger:()=>{}},repairSlide:async slide=>{repairs++;return slide.content;}}),e=>e.code==='PRESENTATION_QUALITY_FAILED'&&e.stopReason==='NO_MEANINGFUL_REPAIR');assert.equal(repairs,1);
});
test('three processes select genuinely distinct geometry while preserving a deliberate comparison series',()=>{
    const deck=base();deck.slides=Array.from({length:3},(_,i)=>({slideNumber:i+1,slideType:'process',title:'Stage '+(i+1),content:{process:structuredClone(fixtures.process)}}));
    const layouts=presentationLayoutService(deck).slides.map(s=>s.layoutId);assert.deepEqual(layouts,['process-horizontal','process-horizontal','process-vertical']);
});
test('structured diagrams reject invented connections and duplicate nodes',()=>{
    assert.throws(()=>validateDiagram({kind:'flowchart',nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],edges:[{from:'a',to:'missing',label:'Causes'}]}),/existing/);
    assert.throws(()=>validateDiagram({kind:'labeled',nodes:[{id:'a',label:'A'},{id:'a',label:'B'}],edges:[]}),/unique/);
});
test('actual PPTX contains subtitles, real media and editable diagram labels; instructions stay private',async t=>{
    const deck=base();deck.slides[1]={slideNumber:2,slideType:'text-visual',title:'Heart anatomy',subtitle:'A simplified chamber and valve schematic',content:{visualContent:{text:'The right side pumps blood to the lungs. The left side pumps blood to the body.',visual:{type:'diagram',description:'Internal request for a four-chamber heart anatomy diagram',searchQuery:'internal anatomy search query'}}}};
    const visual=await resolvePresentationVisuals(ready(deck),{}, {allowIncompleteImages:true,cacheRoot:await temp(t),external:false,userAssets:[await coverAsset()]});
    assert.equal(visual.slides[1].visualResolution.status,'resolved');
    const {buffer}=await generatePresentationBuffer(visual),file=path.join(await temp(t),'presentation.pptx');await fs.writeFile(file,buffer);
    await validateRenderedPptx(file,visual);const zip=await JSZip.loadAsync(buffer),xml=await zip.file('ppt/slides/slide2.xml').async('string');
    for(const text of ['Right atrium','Left atrium','Right ventricle','Left ventricle','Tricuspid','Mitral','Pulmonary valve','Aortic valve','A simplified chamber'])assert.ok(xml.includes(text),text);
    assert.ok(!xml.includes('Internal request'));assert.ok(!xml.includes('internal anatomy search query'));
    // Native diagram elements remain editable; a decorative raster is no longer injected.
    assert.ok(xml.includes('<p:sp>'));
    assert.ok((await zip.file('ppt/notesSlides/notesSlide2.xml').async('string')).includes('nhlbi.nih.gov'));
});
test('unavailable or unsuitable providers fall back with truthful visual warnings',async t=>{
    let calls=0;const deck=base();deck.slides[0].visualRequirement={role:'background',kind:'photo',required:false,description:'A calm editorial background',searchQuery:'architecture',altText:''};
    deck.slides[1]={slideNumber:2,slideType:'text-visual',title:'Unavailable product image',content:{visualContent:structuredClone(fixtures.visualContent)},visualRequirement:{role:'foreground',kind:'photo',required:true,description:'A clinical imaging device',searchQuery:'MRI scanner',altText:'MRI scanner'}};
    const visual=await resolvePresentationVisuals(ready(deck),{}, {allowIncompleteImages:true,cacheRoot:await temp(t),userAssets:[await coverAsset()],providers:{search:async()=>{calls++;throw new Error('Unavailable');},generate:async()=>{calls++;return null;}}});
    assert.equal(calls,1);assert.equal(visual.visualQuality.budget.attempts,0);assert.ok(visual.warnings.some(w=>w.code==='IMAGE_PROVIDER_FALLBACK'));assert.ok(visual.warnings.some(w=>w.code==='VISUAL_UNRESOLVED'));
    assert.equal(visual.slides[1].layoutId,'text-visual-text-fallback');
    assert.equal(visual.slides[0].backgroundAsset,undefined);
    assert.equal(visual.slides[0].coverArtwork,undefined);
});
test('photographic backgrounds are cropped without distortion and checked against every composited pixel',async t=>{
    const canvas=createCanvas(2400,1200),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,1200);ctx.fillStyle='black';ctx.fillRect(1200,0,1200,1200);
    const asset=await prepareBackground({buffer:canvas.toBuffer('image/png'),source:'Synthetic regression image',creator:'Test fixture',license:'Original test fixture'},deriveVisualTheme(ready(base())),await temp(t));
    assert.equal(asset.width,1920);assert.equal(asset.height,1080);assert.equal(asset.crop.mode,'cover');assert.ok(asset.overlay.minimumContrast>=4.5);
    const small=createCanvas(400,300).toBuffer('image/png');await assert.rejects(prepareBackground({buffer:small},deriveVisualTheme(ready(base())),await temp(t)),/no artificial upscaling/);
    const huge=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(huge);huge.writeUInt32BE(90000,16);huge.writeUInt32BE(90000,20);assert.throws(()=>imageDimensions(huge),/dimensions/);
});
test('paid image generation needs explicit authorization and model configuration',()=>{
    assert.equal(configuredImageProviders({GEMINI_API_KEY:'present'}).generate,undefined);
    assert.equal(typeof configuredImageProviders({...approvedImageEnv,PRESENTATION_ALLOW_IMAGE_GENERATION:'true'}).generate,'function');
});
test('public projection removes nested internal paths and image payloads while preserving metadata',()=>{
    const result=publicGenerationResult({preview:{files:{pptxPath:'C:\\private\\deck.pptx'},slides:[{slideNumber:1,filePath:'C:\\private\\slide.png'}]},generatedContent:{slides:[{resolvedVisual:{data:'image/png;base64,private',filePath:'C:\\private\\asset.png',id:'asset',source:'Original'}}]}});
    assert.ok(!JSON.stringify(result).includes('private'));assert.equal(result.generatedContent.slides[0].resolvedVisual.source,'Original');
});
test('response v2 returns content once and truthful warnings; v1 compatibility is explicit and sanitized',async()=>{
    process.env.GEMINI_API_KEY ||= 'test-key-never-used';
    const {createGenerationHandlers}=await import('../../controller/generateController.mjs');
    const model={create:async value=>({...value,_id:'fixture',async save(){}})};
    const generator=async()=>({outputType:'presentation',status:'completed_with_warnings',generatedContent:{title:'Fixture',slides:[]},
        warnings:[{code:'VISUAL_UNRESOLVED',message:'A required visual is unresolved.'}],preview:{files:{pptxPath:'C:\\private\\deck.pptx'},downloads:{pptx:'/api/presentations/fixture/download'}}});
    const {userText}=createGenerationHandlers({model,generator});
    for(const version of ['2','1']){
        let body;const headers={};const res={status(code){assert.equal(code,201);return this;},set(k,v){headers[k]=v;},json(value){body=value;}};
        await userText({body:{textPrompt:'Explain the supplied topic.',outputType:'presentation'},get:()=>version},res);
        assert.equal(headers['X-Ledify-Response-Version'],version);assert.match(body.message,/warnings/);
        assert.equal((JSON.stringify(body).match(/"generatedContent"/g)||[]).length,version==='1'?2:1);
        assert.ok(!JSON.stringify(body).includes('private'));assert.ok(body.data.result.preview.downloads.pptx.startsWith('/api/'));
    }
});
test('long approved cover titles retain their full text without arbitrary decorative artwork',async t=>{
    const title='Artificial Intelligence: History, Technologies, Applications and Future Developments';
    const content=base();content.title=title;content.subtitle='Understanding the technology transforming our world';
    canonicalTitles(content);validateRenderContent(content.slides[0]);
    const root=await temp(t),resolved=await resolvePresentationVisuals(ready(content),{}, {allowIncompleteImages:true,external:false,diagramPlanner:false,cacheRoot:root,userAssets:[await coverAsset('computing-cern.jpg','Computing systems supporting artificial intelligence')]});
    assert.equal(resolved.slides[0].coverArtwork,undefined);assert.equal(resolved.slides[0].backgroundAsset,undefined);
    assert.ok(!resolved.warnings.some(warning=>warning.code==='COVER_LAYOUT_FALLBACK'));assert.equal(resolved.title,title);
    const {buffer}=await generatePresentationBuffer(resolved);const target=path.join(root,'long-title.pptx');await fs.writeFile(target,buffer);
    await validateRenderedPptx(target,resolved);
    const zip=await JSZip.loadAsync(buffer);assert.ok((await zip.file('ppt/slides/slide1.xml').async('string')).includes(title));
});

test('combined generation rendering errors retain actionable metadata without exposing raw errors',async t=>{
    process.env.GEMINI_API_KEY ||= 'test-key-never-used';
    const {createGenerationRouter}=await import('../../route/generateRoute.mjs');
    const app=express();app.use(express.json());app.use('/api',createGenerationRouter({
        model:{create:async value=>({...value,save:async()=>{}})},extractUrl:async()=> 'Article source',
        generator:async()=>{throw Object.assign(new Error('Private source and filesystem details'),{code:'PRESENTATION_RENDER_FAILED',stage:'presentation-rendering',slideNumber:1,field:'title.title',maxCharacters:53});}
    }));
    const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});t.after(()=>server.close());
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outputType:'presentation',textPrompt:'Create 8 slides',urlPrompt:'https://en.wikipedia.org/wiki/Artificial_intelligence'})});
    assert.equal(response.status,500);const result=await response.json();assert.equal(result.errorCode,'PRESENTATION_RENDER_FAILED');assert.equal(result.stage,'presentation-rendering');assert.equal(result.slideNumber,1);assert.equal(result.field,'title.title');assert.equal(result.maxCharacters,53);assert.ok(!JSON.stringify(result).includes('Private source'));
});

test('original cardiovascular HTTP request traverses the real rendering pipeline and downloads actual artifacts',async t=>{
    process.env.GEMINI_API_KEY ||= 'test-key-never-used';
    const {createGenerationRouter}=await import('../../route/generateRoute.mjs');
    const {generateService}=await import('../../Service/generateService.mjs');
    const approved=JSON.parse(await fs.readFile(new URL('../fixtures/cardiovascular-approved.json',import.meta.url),'utf8'));
    const testCover=await coverAsset();
    const model={create:async value=>({...value,_id:'fixture',async save(){}})};
    const app=express();app.use(express.json());app.use('/api',createGenerationRouter({model,generator:(kind,input,output,context)=>generateService(kind,input,output,{...context,instructions:'Text-only presentation'},
        {ai:{initialPresentation:approved,qualityReview:false,client:{models:{generateContent:async()=>{throw new Error('Deterministic regression must not call the provider');}}}},visuals:{allowIncompleteImages:true,external:false,diagramPlanner:false,userAssets:[testCover]}})}));
    const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>server.close());
    const baseUrl=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(baseUrl+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({textPrompt:originalPrompt,outputType:'presentation'})});
    assert.equal(response.status,201);const value=await response.json(),result=value.data.result;
    assert.equal(result.generatedContent.slides.length,8);assert.equal(result.preview.previewCount,8);
    assert.equal(value.data.request.generatedContent,undefined);assert.equal(result.preview.files,undefined);
    assert.ok(!JSON.stringify(value).includes('C:\\'));assert.ok(result.warnings.some(w=>w.code==='DIAGRAM_SIMPLIFIED'));
    const pptx=await fetch(baseUrl+result.preview.downloads.pptx),pdf=await fetch(baseUrl+result.preview.downloads.pdf),png=await fetch(baseUrl+result.preview.slides[1].url);
    assert.equal(pptx.status,200);assert.equal(pdf.status,200);assert.equal(png.status,200);
    const zip=await JSZip.loadAsync(await pptx.arrayBuffer());assert.ok(zip.file('ppt/slides/slide8.xml'));
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
    assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const target=path.resolve('generated/previews',result.preview.previewId),allowed=path.resolve('generated/previews')+path.sep;
    assert.ok(target.startsWith(allowed));t.after(()=>fs.rm(target,{recursive:true,force:true}));
});
