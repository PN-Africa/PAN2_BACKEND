import test from 'node:test';
import {coverAsset} from '../fixtures/coverAsset.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {docxSource,pdfSource,DOCX_MIME} from '../fixtures/uploadFiles.mjs';
import {createApp} from '../../src/app.mjs';
import {generateService} from '../../Service/generateService.mjs';
import {resolvePresentationVisuals} from '../../Service/visual/presentationVisuals.mjs';
import {presentationLayoutService} from '../../Service/presentationLayoutService.mjs';
import {presentationThemeService} from '../../Service/presentationThemeService.mjs';
import {presentationRendererService} from '../../Service/presentationRendererService.mjs';
import {generatePresentationBuffer} from '../../renderer/presentation/pptxRenderer.mjs';
import {validateRenderedPptx} from '../../renderer/presentation/renderedOutputValidation.mjs';
import {imagePolicy} from '../../Service/visual/imagePolicy.mjs';
import {imagerySamples} from '../fixtures/presentationImagery.mjs';

const ready=deck=>presentationRendererService(presentationThemeService(presentationLayoutService(deck)));
const temporary=async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-outage-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;};
const sample=()=>structuredClone(imagerySamples[4].presentation);

test('an unavailable supporting image leaves the source incomplete while a verified cover and draft artifacts remain available',async t=>{
    const root=await temporary(t),deck=sample();for(const s of deck.slides)s.imageLayoutPlanned=true;
    const output=await resolvePresentationVisuals(ready(deck),{instructions:'Every slide must include an authentic photograph.'},{providers:{},userAssets:[await coverAsset('laboratory.jpg','Laboratory research')],diagramPlanner:false,cacheRoot:root});
    assert.equal(imagePolicy({}).failureMode,'warn');assert.equal(output.imageCoveragePlan.enforcement,'best-effort');
    assert.equal(output.visualQuality.meetsTarget,false);assert.equal(output.visualQuality.missingAssets.length,deck.slides.length-1);
    assert.ok(output.warnings.some(w=>w.code==='PRESENTATION_IMAGES_UNAVAILABLE'&&w.missingSlides.length===deck.slides.length-1));
    assert.ok(output.slides[0].photoAsset);assert.ok(output.slides.slice(1).every(s=>!s.photoAsset&&!s.imageLayoutPlanned));
    const rendered=await generatePresentationBuffer(output),file=path.join(root,'outage.pptx');await fs.writeFile(file,rendered.buffer);
    assert.equal(output.imageValidation.status,'incomplete');
    const report=await validateRenderedPptx(file,{...output,imageCoveragePlan:{...output.imageCoveragePlan,required:false}});assert.equal(report.slides.length,deck.slides.length);assert.equal(report.embeddedImages,1);
    assert.equal(imagePolicy({PRESENTATION_IMAGE_FAILURE_MODE:'strict'}).failureMode,'strict');
    await assert.rejects(resolvePresentationVisuals(ready(deck),{}, {providers:{},policy:{failureMode:'strict'},cacheRoot:root}),{code:'PRESENTATION_IMAGES_UNAVAILABLE'});
});

test('partial photo success preserves the available image and reports precisely which slides lack images',async t=>{
    const root=await temporary(t),buffer=await fs.readFile('assets/webpage/curated/laboratory.jpg');
    const output=await resolvePresentationVisuals(ready(sample()),{}, {cacheRoot:root,diagramPlanner:false,policy:{retries:0},providers:{search:async b=>{
        if(b.slideNumber!==1)throw new Error('Provider network unavailable');
        return {buffer,description:'Laboratory research with a scientist pipetting samples',source:'CDC',creator:'James Gathany',license:'Public domain',generationMethod:'licensed-search'};
    }}});
    assert.ok(output.slides[0].photoAsset);assert.equal(output.visualQuality.actual,1);
    assert.deepEqual(output.warnings.find(w=>w.code==='PRESENTATION_IMAGES_UNAVAILABLE').missingSlides,[2,3,4,5,8]);
});

test('stalled mandatory cover retrieval is bounded and cannot publish a cover-free deck',async t=>{
    const root=await temporary(t),start=Date.now();
    await assert.rejects(resolvePresentationVisuals(ready(sample()),{}, {cacheRoot:root,diagramPlanner:false,policy:{retries:0,timeoutMs:15,deadlineMs:60},providers:{search:async()=>new Promise(()=>{})}}),{code:'PRESENTATION_IMAGES_UNAVAILABLE',stage:'presentation-cover'});
    assert.ok(Date.now()-start<3000);
});

test('all presentation inputs deliver usable artifacts with honest warnings during a required-image outage, including async jobs',async t=>{
    const root=await temporary(t),content=sample();content.slides=content.slides.slice(0,2);
    const cover=await coverAsset('laboratory.jpg','Laboratory research');
    let result;
    const app=createApp({jobRoot:path.join(root,'jobs'),model:{create:async v=>({...v,async save(){}})},extractUrl:async()=> 'Source article',generator:async(kind,input,output,context)=>{
        result??=await generateService(kind,input,output,{...context,instructions:'Every slide must include an authentic photograph.'},{completedContent:{inputType:kind,input,outputType:output,generatedContent:content},visuals:{cacheRoot:root,userAssets:[cover],providers:{search:async()=>{throw new Error('Provider offline');},generate:async()=>null},policy:{retries:0},diagramPlanner:false}});
        return result;
    }});
    const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>server.close());
    const base=`http://127.0.0.1:${server.address().port}`;
    for(const [name,bytes,mime] of [['source.pdf',pdfSource(),'application/pdf'],['source.docx',await docxSource(),DOCX_MIME]]){
        const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),name);form.append('outputType','presentation');
        const response=await fetch(base+'/api/generate/file',{method:'POST',body:form});assert.equal(response.status,422);const body=await response.json();
        assert.equal(body.data.result.status,'incomplete');assert.equal(body.errorCode,'IMAGE_REQUIREMENTS_UNMET');assert.equal(body.data.request.status,'failed');
        assert.equal(body.data.result.imageValidation.status,'incomplete');
        assert.ok(body.data.result.imageValidation.requiredMissing.length>0);
        assert.ok(body.data.result.warnings.some(w=>w.code==='IMAGE_REQUIREMENTS_UNMET'));
        assert.ok(body.data.result.warnings.some(w=>w.code==='PRESENTATION_IMAGES_UNAVAILABLE'));
        for(const [url,signature] of [[body.data.result.preview.downloads.pptx,'504b'],[body.data.result.preview.downloads.pdf,'25504446'],[body.data.result.preview.slides[0].url,'89504e47']]){
            const file=await fetch(base+url);assert.equal(file.status,200);assert.ok(Buffer.from(await file.arrayBuffer()).toString('hex').startsWith(signature));
        }
    }
    for(const [route,body] of [['textPrompt',{textPrompt:'Create a presentation',outputType:'presentation'}],['urlPrompt',{urlPrompt:'https://example.org/source',outputType:'presentation'}],['',{textPrompt:'Create a presentation',urlPrompt:'https://example.org/source',outputType:'presentation'}]]){
        const response=await fetch(base+'/api/generate'+(route?'/'+route:''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,422);
        assert.equal((await response.json()).data.result.status,'incomplete');
    }
    const queued=await fetch(base+'/api/generate/textPrompt',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'respond-async'},body:JSON.stringify({textPrompt:'Create a presentation',outputType:'presentation'})});
    assert.equal(queued.status,202);const accepted=await queued.json();
    let job;const deadline=Date.now()+10000;
    do {const response=await fetch(base+accepted.data.statusUrl);assert.equal(response.status,200);job=(await response.json()).data;if(['completed','failed'].includes(job.status))break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
    assert.equal(job.status,'failed');assert.equal(job.error.errorCode,'IMAGE_REQUIREMENTS_UNMET');
    assert.equal(job.result.status,'incomplete');assert.equal(job.result.imageValidation.status,'incomplete');
    if(result?.preview?.previewId){const base=path.resolve('generated/previews'),target=path.resolve(base,result.preview.previewId);assert.ok(target.startsWith(base+path.sep));t.after(()=>fs.rm(target,{recursive:true,force:true}));}
});
