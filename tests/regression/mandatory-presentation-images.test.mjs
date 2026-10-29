import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import {validateRenderedPptx} from '../../renderer/presentation/renderedOutputValidation.mjs';
import {resolvePresentationVisuals} from '../../Service/visual/presentationVisuals.mjs';
import {imagerySamples} from '../fixtures/presentationImagery.mjs';
import {fixtures} from '../fixtures/presentationContent.mjs';
import {presentationLayoutService} from '../../Service/presentationLayoutService.mjs';
import {presentationThemeService} from '../../Service/presentationThemeService.mjs';
import {presentationRendererService} from '../../Service/presentationRendererService.mjs';
import {generatePresentationBuffer} from '../../renderer/presentation/pptxRenderer.mjs';
import {createGenerationHandlers} from '../../controller/generateController.mjs';

const ready=deck=>presentationRendererService(presentationThemeService(presentationLayoutService(deck)));
const temporary=async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-mandatory-images-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;};
test('cinematic dark instructions reach theme selection while an explicit appearance still wins',()=>{
    const deck=structuredClone(imagerySamples[4].presentation);
    deck.inferredContext={keyInstructions:['Cinematic dark visual style with diverse image layouts']};
    const dark=presentationThemeService(deck,{designPreferences:{theme:'scholarly-clean'}}),light=presentationThemeService(deck,{designPreferences:{theme:'scholarly-clean',appearance:'light'}});
    assert.notEqual(dark.design.variantId,light.design.variantId);
});
test('the actual failed ten-slide user PPTX with zero pictures fails the mandatory package gate',async()=>{
    const file='tests/fixtures/zero-image-space.pptx',zip=await JSZip.loadAsync(await fs.readFile(file));
    assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,10);
    assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/media\//.test(n)&&!zip.files[n].dir).length,0);
    await assert.rejects(validateRenderedPptx(file,{slides:Array.from({length:10},(_,i)=>({slideNumber:i+1,title:'Space exploration'}))}),error=>error.code==='PPTX_REQUIRED_IMAGE_MISSING'&&error.slideNumber===1);
});
test('missing cover providers fail clearly even when supporting slides are text-only',async t=>{
    const deck=ready(structuredClone(imagerySamples[4].presentation));
    await assert.rejects(resolvePresentationVisuals(deck,{}, {allowIncompleteImages:false,providers:{},cacheRoot:await temporary(t),diagramPlanner:false}),error=>error.code==='PRESENTATION_IMAGES_UNAVAILABLE'&&error.missingSlides.includes(1));
    const textOnly=await resolvePresentationVisuals(deck,{instructions:'Create a text-only presentation.'},{providers:{},cacheRoot:await temporary(t),diagramPlanner:false});assert.equal(textOnly.imageCoveragePlan.coverRequired,false);assert.equal(textOnly.imageValidation.status,'passed');
});
test('charts, tables and relationship diagrams retain editable content beside distinct embedded pictures',async t=>{
    const root=await temporary(t),sample=structuredClone(imagerySamples[4].presentation);
    sample.slides=[sample.slides[0],{slideNumber:2,slideType:'data-chart',title:'Illustrative comparison',content:{chart:structuredClone(fixtures.chart)}},{slideNumber:3,slideType:'table',title:'Structured comparison',content:{table:structuredClone(fixtures.table)}},{...sample.slides[6],slideNumber:4}];
    const buffer=await fs.readFile('assets/webpage/curated/laboratory.jpg');let calls=0;
    const resolved=await resolvePresentationVisuals(ready(sample),{instructions:'Every slide must include a photograph.'}, {cacheRoot:root,diagramPlanner:false,providers:{search:async()=>({buffer:await sharp(buffer).modulate({brightness:.6+(calls++)*.12}).jpeg().toBuffer(),description:'Laboratory research with a scientist pipetting samples',source:'CDC test fixture',creator:'James Gathany',license:'Public domain',generationMethod:'licensed-search'})},policy:{retries:0}});
    assert.equal(resolved.visualQuality.actual,4);assert.equal(resolved.visualQuality.meetsTarget,true);assert.equal(new Set(resolved.slides.map(s=>s.photoAsset.id)).size,4);
    const output=await generatePresentationBuffer(resolved),file=path.join(root,'deck.pptx');await fs.writeFile(file,output.buffer);
    const report=await validateRenderedPptx(file,resolved);assert.equal(report.slidesWithPictures,4);assert.equal(report.embeddedImages,4);assert.ok(report.slides.every(s=>s.embeddedPictures>=1));
    const zip=await JSZip.loadAsync(output.buffer);assert.ok(Object.keys(zip.files).some(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n)));
    const xml=await zip.file('ppt/slides/slide4.xml').async('string');for(const node of sample.slides[3].content.relationship.nodes)assert.ok(xml.includes(node.label));
    zip.remove('ppt/media/'+Object.keys(zip.files).find(n=>/^ppt\/media\/.*\.(?:jpg|jpeg|png)$/.test(n)).split('/').at(-1));
    await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));await assert.rejects(validateRenderedPptx(file,resolved));
});
for(const inputType of ['prompt','url','file'])test(`${inputType} generation handler returns an actionable image failure instead of publishing an image-free deck`,async t=>{
    let status,body;const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
    const root=await temporary(t),handlers=createGenerationHandlers({model:{create:async item=>({...item,save:async()=>{}})},extractFile:async()=> 'Laboratory research',extractUrl:async()=> 'Laboratory research',generator:async()=>resolvePresentationVisuals(ready(structuredClone(imagerySamples[4].presentation)),{}, {allowIncompleteImages:false,providers:{},cacheRoot:root})});
    const req={body:{outputType:'presentation',textPrompt:'Explain laboratory research',urlPrompt:'https://example.org/research'},file:inputType==='file'?{buffer:pdf,originalname:'source.pdf',mimetype:'application/pdf'}:undefined};
    await ({prompt:handlers.userText,url:handlers.userUrl,file:handlers.userFile}[inputType])(req,{status(code){status=code;return this;},json(value){body=value;return value;}});
    assert.equal(status,503);assert.equal(body.errorCode,'PRESENTATION_IMAGES_UNAVAILABLE');assert.deepEqual(body.missingSlides,[1]);assert.match(body.error,/cover/i);
});
