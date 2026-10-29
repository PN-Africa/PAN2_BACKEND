import test from 'node:test';
import {approvedImageEnv} from '../fixtures/coverAsset.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import {imagePolicy,generationBudget} from '../../Service/visual/imagePolicy.mjs';
import {imageBrief,generationPrompt,planImageCoverage} from '../../Service/visual/imageArtDirection.mjs';
import {normalizePhoto,createImageAssetSession} from '../../Service/visual/presentationImageAssets.mjs';
import {prepareInputImageAssets,documentImageInventory} from '../../Service/visual/inputImageAssets.mjs';
import {imagerySamples} from '../fixtures/presentationImagery.mjs';
import {presentationLayoutService} from '../../Service/presentationLayoutService.mjs';
import {presentationThemeService} from '../../Service/presentationThemeService.mjs';
import {presentationRendererService} from '../../Service/presentationRendererService.mjs';
import {resolvePresentationVisuals} from '../../Service/visual/presentationVisuals.mjs';
import {generatePresentationBuffer} from '../../renderer/presentation/pptxRenderer.mjs';
import {validateRenderedPptx} from '../../renderer/presentation/renderedOutputValidation.mjs';
import {validatePhotoPreviews} from '../../renderer/presentation/photoQuality.mjs';
import {publicGenerationResult} from '../../Service/publicGenerationResult.mjs';
import {candidateSuitability,commonsCandidates,configuredImageProviders} from '../../Service/visual/imageProviders.mjs';
import {createApp} from '../../src/app.mjs';

const photoBuffer=()=>fs.readFile(new URL('../../assets/webpage/curated/laboratory.jpg',import.meta.url));
// Provider metadata is simulated here; these tests verify byte embedding/cache,
// not visual recognition. Relevance tests separately exercise real CDC metadata.
const asset=buffer=>({buffer,description:'MRI scanner hospital radiology',source:'Fixture provider',creator:'Fixture creator',license:'Test fixture',attributionRequired:true,attribution:'Fixture creator',generationMethod:'licensed-search'});
const temp=async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-images-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;};
const theme={family:'scientific',palette:{accent:'teal'},style:'editorial'};

test('image policy requires explicit cost configuration; retries reserve budget even on failures',()=>{
    const disabled=generationBudget(imagePolicy({}));assert.equal(disabled.reserve(),false);
    const b=generationBudget(imagePolicy({...approvedImageEnv,PRESENTATION_ALLOW_IMAGE_GENERATION:'true',PRESENTATION_IMAGE_ESTIMATED_UNIT_COST:'.04',PRESENTATION_IMAGE_MAX_ESTIMATED_COST:'.08',PRESENTATION_MAX_GENERATED_IMAGES:'4'}));
    assert.equal(b.reserve(),true);assert.equal(b.reserve(),true);assert.equal(b.reserve(),false);assert.equal(b.report().estimatedReservedCost,.08);
    assert.equal(imagePolicy({PRESENTATION_IMAGE_CONCURRENCY:'100'}).concurrency,3);
    assert.equal(imagePolicy({PRESENTATION_IMAGE_RETRIES:'99'}).retries,2);
});
test('text-only supporting slides retain the required cover and do not displace precise diagrams',()=>{
    const d=structuredClone(imagerySamples[0].presentation),planned=planImageCoverage(d);
    assert.equal(planned.imageCoveragePlan.target,6);assert.equal(planned.slides[6].visualRequirement.kind,'diagram');assert.equal(planned.slides[6].imageRequirement,undefined);
    const no=planImageCoverage(d,{instructions:'No photographs please.'});assert.equal(no.imageCoveragePlan.target,0);assert.equal(no.imageCoveragePlan.coverRequired,false);assert.ok(!no.slides.some(s=>s.imageRequirement));
    const reserved=planImageCoverage(d,{designPreferences:{noImageSlideNumbers:[8]}});assert.equal(reserved.slides[7].visualRequirement.kind,'none');assert.equal(reserved.imageCoveragePlan.target,5);
});
test('art direction records audience, message, focal point and synthetic disclosure',()=>{
    const sample=imagerySamples[0],b=imageBrief(sample.presentation,sample.presentation.slides[0],theme,{audience:'Clinicians'}),prompt=generationPrompt(b);
    for(const value of ['Clinicians','MRI scanner','Lighting:','Perspective:','16:9','not a photograph','No text'])assert.ok(prompt.includes(value),value);
    assert.ok(b.textSpace.includes('opaque'));assert.equal(b.composition,'hero-full-bleed');
    assert.deepEqual(imageBrief(sample.presentation,sample.presentation.slides[0],theme,{designPreferences:{imageFocalPoints:{1:{x:12,y:-3}}}}).focalPoint,{x:1,y:0});
});
test('decode, rights and effective resolution validation run before photo caching',async t=>{
    const root=await temp(t),sample=imagerySamples[0],b=imageBrief(sample.presentation,sample.presentation.slides[1],theme);
    await assert.rejects(normalizePhoto({...asset(Buffer.from('not an image'))},b,root,imagePolicy({})));
    await assert.rejects(normalizePhoto({buffer:await photoBuffer()},b,root,imagePolicy({})),/provenance/);
    const blank=await sharp({create:{width:1200,height:900,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(normalizePhoto(asset(blank),b,root,imagePolicy({})),/blank/);
    const p=await normalizePhoto({...asset(await photoBuffer()),description:'Actual licensed laboratory photograph'},b,root,imagePolicy({}));
    assert.equal(p.format,'jpeg');assert.ok(p.width>=800);assert.ok(Math.abs(p.width/p.height-p.crop.targetAspectRatio)<.01);assert.ok(p.sourceChecksum);
    assert.equal(p.altText,'Actual licensed laboratory photograph');
});
test('deck image session caps concurrency, caches decoded assets and rejects duplicate sources',async t=>{
    const root=await temp(t),sample=imagerySamples[0],buffer=await photoBuffer();let calls=0,active=0,peak=0;
    const providers={identity:'test',search:async()=>{calls++;active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,15));active--;return asset(buffer);}};
    const policy={...imagePolicy({}),concurrency:1,retries:0};
    const first=createImageAssetSession({providers,policy,root});
    const result=await Promise.all(sample.presentation.slides.slice(0,2).map(s=>first.resolve(sample.presentation,s,theme,{})));
    assert.equal(peak,1);assert.equal(result.filter(Boolean).length,1);assert.ok(first.diagnostics.some(d=>d.status==='failed'));
    const before=calls,second=createImageAssetSession({providers,policy,root});
    const cached=await second.resolve(sample.presentation,sample.presentation.slides[0],theme,{});assert.equal(cached.cacheHit,true);assert.equal(calls,before);
    await fs.writeFile(cached.filePath,'corrupt');const third=createImageAssetSession({providers,policy,root});await third.resolve(sample.presentation,sample.presentation.slides[0],theme,{});assert.ok(calls>before);
});
test('timed-out providers are aborted and paid retries never exceed configured estimated budget',async t=>{
    const root=await temp(t),sample=imagerySamples[0];let aborted=false,calls=0;
    const policy={...imagePolicy({...approvedImageEnv,PRESENTATION_ALLOW_IMAGE_GENERATION:'true',PRESENTATION_IMAGE_ESTIMATED_UNIT_COST:'.1',PRESENTATION_IMAGE_MAX_ESTIMATED_COST:'.1'}),timeoutMs:20,retries:2};
    const session=createImageAssetSession({root,policy,providers:{generate:async b=>{calls++;b.signal.addEventListener('abort',()=>aborted=true);await new Promise(r=>setTimeout(r,45));return null;}}});
    assert.equal(await session.resolve(sample.presentation,sample.presentation.slides[0],theme,{}),null);assert.equal(aborted,true);assert.equal(calls,1);assert.equal(session.budget.report().attempts,1);
});
test('a deck deadline prevents queued image requests from extending retrieval indefinitely',async t=>{
    const root=await temp(t),sample=imagerySamples[0];let calls=0;
    const session=createImageAssetSession({root,policy:{...imagePolicy({}),deadlineMs:20,timeoutMs:100,concurrency:1,retries:1},providers:{search:async()=>{calls++;await new Promise(r=>setTimeout(r,50));return null;}}});
    const result=await Promise.all(sample.presentation.slides.slice(0,3).map(s=>session.resolve(sample.presentation,s,theme,{})));
    // Filesystem/cache checks can consume this deliberately tiny deadline before
    // the first provider call. Both zero and one call respect the same bound.
    assert.ok(result.every(v=>v===null));assert.ok(calls<=1);assert.ok(session.diagnostics.some(d=>d.reason==='Deck image deadline reached'));
});
test('user image payloads are decoded and stripped before text-model context/public response',async()=>{
    const dataUrl='data:image/jpeg;base64,'+(await photoBuffer()).toString('base64');
    const supplied={dataUrl,slideNumber:2,description:'Illustrative laboratory',usageRights:'I have permission to reuse this image.'};
    const result=await prepareInputImageAssets({visualAssets:[supplied],audience:'Students'});
    assert.equal(result.assets[0].sourceType,'user-upload');assert.equal(result.context.visualAssets,undefined);assert.equal(result.context.imageAssetHints[0].slideNumber,2);
    assert.ok(!JSON.stringify(publicGenerationResult(result.context)).includes('base64'));
    await assert.rejects(prepareInputImageAssets({visualAssets:[{...supplied,usageRights:''}]}),e=>e.code==='INVALID_VISUAL_ASSET');
    await assert.rejects(prepareInputImageAssets({visualAssets:[{...supplied,dataUrl:'data:image/png;base64,bm90aW1hZ2U='}]}),e=>e.code==='INVALID_VISUAL_ASSET');
});
test('DOCX embedded images require explicit mapping and user-asserted reuse rights',async()=>{
    const z=new JSZip();z.file('[Content_Types].xml','<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels','<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Source text</w:t></w:r></w:p></w:body></w:document>');z.file('word/media/image1.jpg',await photoBuffer());
    const file={originalname:'source.docx',mimetype:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:await z.generateAsync({type:'nodebuffer'})};
    const context={documentImageSlides:[{imageName:'word/media/image1.jpg',slideNumber:3,description:'User document laboratory image'}],documentImageRights:'Permission granted by uploader'};
    const result=await prepareInputImageAssets(context,file);assert.equal(result.assets[0].sourceType,'document-extracted');
    const inventory=await documentImageInventory(file);assert.equal(inventory.images[0].imageName,'word/media/image1.jpg');assert.ok(inventory.images[0].width>=800);
    await assert.rejects(prepareInputImageAssets({...context,documentImageRights:''},file),e=>e.code==='INVALID_VISUAL_ASSET');
    await assert.rejects(prepareInputImageAssets({...context,documentImageSlides:[{...context.documentImageSlides[0],imageName:'../secret.jpg'}]},file),e=>e.code==='INVALID_VISUAL_ASSET');
});
test('actual PPTX embeds the exact photo bytes and package validation detects removal',async t=>{
    const root=await temp(t),sample=structuredClone(imagerySamples[0]);sample.presentation.slides=sample.presentation.slides.slice(0,1);
    const ready=presentationRendererService(presentationThemeService(presentationLayoutService(sample.presentation),sample.context));
    const resolved=await resolvePresentationVisuals(ready,sample.context,{cacheRoot:root,providers:{search:async()=>asset(await photoBuffer())},policy:{...imagePolicy({}),retries:0}});
    assert.equal(resolved.visualQuality.actual,1);
    const {buffer}=await generatePresentationBuffer(resolved),file=path.join(root,'photo.pptx');await fs.writeFile(file,buffer);await validateRenderedPptx(file,resolved);
    const zip=await JSZip.loadAsync(buffer);for(const name of Object.keys(zip.files).filter(n=>n.startsWith('ppt/media/')&&!zip.files[n].dir))zip.remove(name);
    await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));await assert.rejects(validateRenderedPptx(file,resolved),/missing/);
});
test('PDF embedded-image inventory and explicit reuse work with a real image stream',async()=>{
    const jpeg=await photoBuffer(),meta=await sharp(jpeg).metadata();
    const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 600] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>')];
    const content=Buffer.from('q 600 0 0 450 0 0 cm /Im1 Do Q');objects.push(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`),content,Buffer.from('\nendstream')]));
    objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${meta.width} /Height ${meta.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]));
    const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let total=chunks[0].length;
    for(const [i,obj] of objects.entries()){offsets.push(total);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),obj,Buffer.from('\nendobj\n')]);chunks.push(chunk);total+=chunk.length;}
    chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${total}\n%%EOF`));
    const file={originalname:'source.pdf',mimetype:'application/pdf',buffer:Buffer.concat(chunks)};
    const inventory=await documentImageInventory(file);assert.equal(inventory.images.length,1);assert.ok(inventory.images[0].imageName.startsWith('1:'));
    const result=await prepareInputImageAssets({documentImageRights:'Permission asserted by uploader',documentImageSlides:[{imageName:inventory.images[0].imageName,slideNumber:2,description:'Illustrative laboratory image'}]},file);
    assert.equal(result.assets[0].sourceType,'document-extracted');assert.ok(result.assets[0].buffer.length>0);
});
test('post-PDF image-region comparison rejects a missing photo even on a nonblank slide',async t=>{
    const root=await temp(t),filePath=path.join(root,'wrong.png'),sample=structuredClone(imagerySamples[0]);
    await sharp({create:{width:1600,height:900,channels:3,background:'#ffffff'}}).png().toFile(filePath);
    const b=imageBrief(sample.presentation,sample.presentation.slides[0],theme),photo=await normalizePhoto(asset(await photoBuffer()),b,root,imagePolicy({}));
    const d={slides:[{photoAsset:photo,photoComposition:b.composition}]};await assert.rejects(validatePhotoPreviews([{filePath}],d),e=>e.code==='PNG_PHOTO_MISSING');
});
test('stock suitability rejects ambiguous tablets, diagrams and historical imagery',()=>{
    const photo={mediaKind:'photograph',originalUrl:'https://commons.wikimedia.org/wiki/File:Modern_tablet_press.jpg',description:'A tablet press device'};
    assert.ok(candidateSuitability('tablet press device',photo)>0);
    assert.equal(candidateSuitability('tablet press device',{...photo,originalUrl:'https://commons.wikimedia.org/wiki/File:Commissioner_press_event.jpg',description:'An electronic tablet during a press event'}),-1);
    assert.equal(candidateSuitability('MRI scanner',{...photo,mediaKind:'illustration'}),-1);
    assert.equal(candidateSuitability('laboratory microscope',{...photo,originalUrl:'https://commons.wikimedia.org/wiki/File:Marie_Stopes_1904_Restoration.jpg',description:'Laboratory microscope'}),-1);
});
test('Commons adapter retains genuine licenses and rejects unlicensed or synthetic candidates',async t=>{
    const metadata={Artist:{value:'<a>Actual author</a>'},LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0/'},ImageDescription:{value:'Laboratory equipment'},Categories:{value:'Laboratory photographs'}};
    t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({query:{pages:{1:{pageid:1,title:'File:Lab.jpg',imageinfo:[{width:2400,height:1600,mime:'image/jpeg',url:'https://upload.wikimedia.org/lab.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Lab.jpg',extmetadata:metadata}]}}}})}));
    const [candidate]=await commonsCandidates('laboratory');assert.equal(candidate.creator,'Actual author');assert.equal(candidate.license,'CC BY 4.0');assert.equal(candidate.mediaKind,'photograph');
    metadata.Categories.value='AI-generated images';const [synthetic]=await commonsCandidates('laboratory');assert.equal(candidateSuitability('laboratory',synthetic),-1);
    metadata.LicenseShortName.value='All rights reserved';assert.equal((await commonsCandidates('laboratory')).length,0);
});
test('configured image generation retains provenance without adding a visible synthetic label',async t=>{
    const root=await temp(t),buffer=await photoBuffer();let sent;
    const env={...approvedImageEnv,IMAGE_RACE_ENABLED:'false',PRESENTATION_STOCK_PROVIDER:'none',PRESENTATION_ALLOW_IMAGE_GENERATION:'true',PRESENTATION_IMAGE_ESTIMATED_UNIT_COST:'.1',PRESENTATION_IMAGE_MAX_ESTIMATED_COST:'.1'};
    const providers=configuredImageProviders(env,{imageGenerator:async request=>{sent=request;return {buffer,cacheHit:false};}});
    const sample=structuredClone(imagerySamples[0]);sample.presentation.slides=sample.presentation.slides.slice(0,1);
    const ready=presentationRendererService(presentationThemeService(presentationLayoutService(sample.presentation),sample.context));
    const resolved=await resolvePresentationVisuals(ready,sample.context,{cacheRoot:root,providers,policy:imagePolicy(env)});
    assert.equal(resolved.visualQuality.distribution.illustrations,1);assert.equal(resolved.visualQuality.budget.attempts,1);
    assert.equal(sent.aspectRatio,'16:9');assert.ok(sent.prompt.includes('not a photograph'));
    assert.ok(resolved.slides[0].photoAsset.generationPrompt.includes('Artificial Intelligence'));assert.equal(resolved.slides[0].photoAsset.synthetic,true);
    const firstPrompt=sent.prompt;await providers.generate({...imageBrief(ready,ready.slides[0],theme),attempt:1});
    assert.notEqual(sent.prompt,firstPrompt);assert.match(sent.prompt,/Recovery variation 1/);
    const {buffer:pptx}=await generatePresentationBuffer(resolved),zip=await JSZip.loadAsync(pptx);const xml=await zip.file('ppt/slides/slide1.xml').async('string');assert.ok(!xml.includes('AI-generated illustration'));assert.equal(resolved.slides[0].photoAsset.synthetic,true);
});
test('two explicitly supplied photos produce a self-contained editorial grid',async t=>{
    const root=await temp(t),sample=structuredClone(imagerySamples[0]),first=await photoBuffer();
    const second=await sharp(first).modulate({brightness:.8}).jpeg().toBuffer();
    sample.presentation.slides=sample.presentation.slides.slice(0,2);
    const userAssets=[{...asset(await fs.readFile('assets/webpage/curated/medical-mri.jpg')),slideNumber:1,description:'MRI scanner'}, {...asset(first),slideNumber:2,description:'Laboratory image A'},{...asset(second),slideNumber:2,description:'Laboratory image B'}];
    const ready=presentationRendererService(presentationThemeService(presentationLayoutService(sample.presentation),sample.context));
    const resolved=await resolvePresentationVisuals(ready,{...sample.context,designPreferences:{noImageSlideNumbers:[1]}},{external:false,cacheRoot:root,userAssets,policy:{...imagePolicy({}),retries:0}});
    assert.equal(resolved.slides[1].photoComposition,'photo-grid');assert.equal(resolved.slides[1].photoAssets.length,2);
    const {buffer}=await generatePresentationBuffer(resolved),file=path.join(root,'grid.pptx');await fs.writeFile(file,buffer);await validateRenderedPptx(file,resolved);
    const zip=await JSZip.loadAsync(buffer),xml=await zip.file('ppt/slides/slide2.xml').async('string');assert.equal((xml.match(/<p:pic>/g)||[]).length,2);
});
test('real generation endpoint passes user images internally without putting binary data into AI context',async t=>{
    let generated=0;
    const model={create:async data=>({...data,_id:'test-id',save:async()=>{}})};
    const generator=async(kind,input,output,context,options)=>{
        generated++;assert.equal(context.visualAssets,undefined);assert.ok(Buffer.isBuffer(options.visuals.userAssets[0].buffer));
        return {generatedContent:{title:'Test'},status:'completed'};
    };
    const app=createApp({model,generator}),server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>server.close());
    const base=`http://127.0.0.1:${server.address().port}`;
    const body={textPrompt:'Create a healthcare presentation',outputType:'presentation',context:{visualAssets:[{slideNumber:2,description:'Laboratory',usageRights:'Authorized by uploader',dataUrl:'data:image/jpeg;base64,'+(await photoBuffer()).toString('base64')}]}};
    const response=await fetch(base+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,201);await response.json();assert.equal(generated,1);
    body.context.visualAssets[0].usageRights='';const invalid=await fetch(base+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(invalid.status,400);assert.equal((await invalid.json()).errorCode,'INVALID_VISUAL_ASSET');assert.equal(generated,1);
    const missing=await fetch(base+'/api/presentations/source-images',{method:'POST'});assert.equal(missing.status,400);await missing.json();
    const form=new FormData();form.append('file',new Blob(['not an image'],{type:'image/png'}),'image.png');
    const unsupported=await fetch(base+'/api/presentations/source-images',{method:'POST',body:form});assert.equal(unsupported.status,415);await unsupported.json();
});
