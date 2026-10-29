import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {aiService} from '../../Service/aiService.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';
import {imagerySamples} from '../fixtures/presentationImagery.mjs';
import {fixtures,fixtureClient} from '../webpage/fixtures.mjs';
import {documentFixtureClient,documentParagraph} from '../fixtures/documentFixtures.mjs';
import {generateDocumentIllustrations} from '../../Service/document/documentIllustrations.mjs';
import {renderDocumentDocx} from '../../renderer/document/docxRenderer.mjs';
import {approvedImageEnv} from '../fixtures/coverAsset.mjs';

test('native Anthropic Messages protocol supplies outline and every slide with original local contracts',async()=>{
 const deck=structuredClone(imagerySamples[1].presentation);
 deck.inferredContext={userRole:'',purpose:'Explain endangered marine species',audience:'Students',topic:'Endangered marine species and marine conservation',tone:'educational',keyInstructions:[]};
 deck.slides[0].content.titleContent.supportingText='Marine conservation and evidence.';
 deck.slides[7].content.summary.statement='Protect marine habitats and evaluate conservation outcomes.';
 const mock=anthropicFixture(({prompt,schema})=>{
  if(schema.properties.slides)return {...deck,slides:deck.slides.map(({content,layoutId,...slide})=>slide)};
  const number=Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1]);
  assert.ok(number,'An individual slide request identifies its own slide');return deck.slides[number-1].content;
 });
 const result=await aiService('prompt','Create exactly eight slides about endangered marine species and marine conservation.','presentation',{}, {client:mock.client,qualityReview:false,logger:()=>{}});
 assert.equal(result.generatedContent.slides.length,8);assert.equal(mock.modelChecks,1);assert.equal(mock.calls.length,9);assert.ok(mock.calls.every(body=>body.model==='claude-opus-5-5'));
});

for(const type of ['webpage','document'])test(`native Anthropic Messages protocol traverses ${type} planning and content validation`,async()=>{
 const legacy=type==='webpage'?fixtureClient(fixtures.school):documentFixtureClient();
 const mock=anthropicFixture(async({prompt,schema})=>JSON.parse((await legacy.models.generateContent({contents:prompt,config:{responseJsonSchema:schema}})).text));
 const input=type==='webpage'?fixtures.school.source:'Write a 100-word technical document explaining REST APIs.';
 const result=await aiService('prompt',input,type,{}, {client:mock.client,logger:()=>{}});
 assert.equal(result.outputType,type);assert.ok(result.generatedContent.sections.length);assert.equal(mock.modelChecks,1);assert.ok(mock.calls.length>=2);
});

test('approved dedicated document illustrations use Claude planning and embed validated JPEG bytes in Word',async()=>{
 const mock=anthropicFixture(()=>({images:[{sectionId:'overview',prompt:'An editorial concept illustration of a solar panel energy system',alt:'Concept solar energy system'}]})),buffer=await fs.readFile('assets/webpage/curated/computing-cern.jpg');let images=0;
 const plan={sections:[{id:'overview',heading:'Solar energy'}]};
 assert.deepEqual(await generateDocumentIllustrations({client:mock.client,plan,input:'Include a concept illustration',options:{env:{}}}),[]);assert.equal(mock.calls.length,0);
 const assets=await generateDocumentIllustrations({client:mock.client,plan,input:'Include a concept illustration',options:{env:{...approvedImageEnv,DOCUMENT_ALLOW_IMAGE_GENERATION:'true',AI_IMAGE_ESTIMATED_UNIT_COST:'.06',AI_IMAGE_MAX_ESTIMATED_COST:'.12'},imageGenerator:async()=>{images++;return {buffer};},logger:()=>{}}});
 assert.equal(images,1);assert.equal(assets[0].synthetic,true);
 const document={documentType:'report',title:'Solar energy',coverPage:false,assets,references:[],sections:[{id:'overview',heading:'Solar energy',blocks:[{type:'image',assetId:assets[0].id}]}]};
 const rendered=await renderDocumentDocx(document),zip=await JSZip.loadAsync(rendered.buffer||rendered);
 assert.ok(Object.keys(zip.files).some(name=>/^word\/media\/.+\.(?:jpg|jpeg)$/.test(name)));
});

for(const omit of [false,true])test(`document generation ${omit?'rejects an omitted':'retains the planned'} generated illustration in its exact section`,async()=>{
 const buffer=await fs.readFile('assets/webpage/curated/computing-electronics.jpg');
 const mock=anthropicFixture(({prompt,schema})=>{
  if(schema.properties.documentType)return {documentType:'technical-documentation',title:'REST API concepts',audience:'Developers',purpose:'Explain REST API interfaces',tone:'technical',coverPage:false,sections:[{id:'overview',heading:'REST API overview',objective:'Explain HTTP resources',topics:[],targetWords:100}]};
  if(schema.properties.images)return {images:[{sectionId:'overview',prompt:'An editorial concept illustration of software server connections, no text',alt:'Concept illustration of connected servers'}]};
  if(schema.properties.blocks){const id=prompt.match(/"id":"(generated-[a-z0-9-]+)"/)?.[1];assert.ok(id);return {id:'overview',heading:'REST API overview',blocks:[{type:'paragraph',text:documentParagraph},...(omit?[]:[{type:'image',assetId:id}])]};}
  return {issues:[]};
 });
 const work=aiService('prompt','Write a 100-word technical document explaining REST APIs with a concept illustration.','document',{}, {client:mock.client,env:{...approvedImageEnv,DOCUMENT_ALLOW_IMAGE_GENERATION:'true',AI_IMAGE_ESTIMATED_UNIT_COST:'.06',AI_IMAGE_MAX_ESTIMATED_COST:'.12'},imageGenerator:async()=>({buffer}),logger:()=>{}});
 if(omit)await assert.rejects(work,{code:'DOCUMENT_ILLUSTRATION_MISSING'});
 else{const result=await work;assert.equal(result.generatedContent.assets.length,1);assert.equal(result.generatedContent.sections[0].blocks[1].assetId,result.generatedContent.assets[0].id);assert.equal(mock.calls.length,4);}
});
