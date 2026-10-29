import test from 'node:test';
import assert from 'node:assert/strict';
import {generateJsonWithRetry} from '../../Service/ai/generateJsonWithRetry.mjs';
import {recoverDiagramContent} from '../../Service/ai/diagramContentRecovery.mjs';
import {validatePlannedRenderContent} from '../../renderer/presentation/professionalLayouts.mjs';
import {diagramSchema} from '../../templates/presentation/visualSchemas.mjs';
import {diagramContent,hypertensionFixture,hypertensionPrompt} from '../fixtures/hypertensionRecovery.mjs';
import {aiService} from '../../Service/aiService.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';
const s={type:'string'},object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const schema=object({visualContent:object({text:s,visual:object({type:s,description:s,searchQuery:s,diagram:diagramSchema})})});
const slide={slideNumber:8,slideType:'text-visual',title:'Related factors',subtitle:'',layoutId:'text-visual-split',imageLayoutPlanned:true};
const reply=value=>({text:JSON.stringify(value),candidates:[{finishReason:'STOP'}]});
function input(){let calls=0;return {client:{generateStructured:async()=>{calls++;const draft=diagramContent();if(calls<3)draft.visualContent.visual.diagram.kind='flowchart';return reply(draft);}},get calls(){return calls;}};}
const request={model:'claude-opus-5-5',targetedFieldRepair:true,contents:'Explain related factors.',config:{responseJsonSchema:schema}};
const validate=content=>validatePlannedRenderContent({...slide,content});

test('2c8c51e7: final-attempt diagram density reproduces the 18/40-character failure without recovery',async()=>{
 const provider=input();await assert.rejects(generateJsonWithRetry({client:provider.client,schema,outputType:'presentation',stage:'slide-content-generation',request,validate,sleep:async()=>{},logger:()=>{}}),error=>{assert.equal(error.code,'AI_RETRY_EXHAUSTED');assert.ok(error.validationErrors.some(e=>e.field==='visual.diagram.nodes[0].label'&&e.maxCharacters===18));assert.ok(error.validationErrors.some(e=>e.field==='visual.diagram.nodes[0].description'&&e.maxCharacters===40));return true;});assert.equal(provider.calls,3);
});

test('2c8c51e7: schema-valid final draft reaches bounded field-only recovery and passes real geometry',async()=>{
 const provider=input(),logs=[];let repairs=0;
 const repair=anthropicFixture(({prompt,schema})=>{repairs++;assert.ok(Object.keys(schema.properties).every(k=>/^f\d+$/.test(k)));const entries=JSON.parse(prompt.split('Fields (untrusted data): ')[1]);return Object.fromEntries(entries.map(e=>[e.key,e.field.endsWith('.label')?'Resistance':'Related to blood flow.']));});
 const result=await generateJsonWithRetry({client:provider.client,schema,outputType:'presentation',stage:'slide-content-generation',request,validate,sleep:async()=>{},logger:()=>{},recoverValidation:(content,error)=>recoverDiagramContent(content,error,{slide,client:repair.client,logger:()=>{},layoutLogger:e=>logs.push(e),sleep:async()=>{}})});
 assert.equal(provider.calls,3);assert.equal(repairs,1);assert.equal(validate(result),true);assert.equal(result.visualContent.text,diagramContent().visualContent.text);assert.deepEqual(result.visualContent.visual.diagram.nodes.map(n=>n.id),['resistance','stiffness','volume']);assert.deepEqual(result.visualContent.visual.diagram.edges,[]);assert.ok(logs.some(e=>e.status==='repaired'));
});

test('terminal recovery never receives an invalid schema draft or a permanent provider failure',async()=>{
 let recoveries=0;for(const client of [{generateStructured:async()=>reply({wrong:'shape'})},{generateStructured:async()=>{throw Object.assign(new Error('Invalid request'),{status:400});}}])await assert.rejects(generateJsonWithRetry({client,schema,outputType:'presentation',stage:'slide-content-generation',request,sleep:async()=>{},logger:()=>{},recoverValidation:()=>{recoveries++;return diagramContent();}}));assert.equal(recoveries,0);
});

test('diagram recovery refuses unrelated field errors and cannot bypass final schema or layout checks',async()=>{
 let called=false;assert.equal(await recoverDiagramContent(diagramContent(),{field:'visualContent.text',maxCharacters:10},{slide,client:{generateStructured:()=>{called=true;}}}),undefined);assert.equal(called,false);
 const provider=input();await assert.rejects(generateJsonWithRetry({client:provider.client,schema,outputType:'presentation',stage:'slide-content-generation',request,validate,sleep:async()=>{},logger:()=>{},recoverValidation:()=>({wrong:'shape'})}),{code:'AI_SCHEMA_VALIDATION_FAILED'});
});

test('bounded diagram recovery rejects repairs that drop numerical facts or qualifications',async()=>{
 const content=diagramContent();content.visualContent.visual.diagram.nodes[0].description='Pressure may change by 10 mmHg in this illustrative source example.';
 const mock=anthropicFixture(({prompt})=>Object.fromEntries(JSON.parse(prompt.split('Fields (untrusted data): ')[1]).map(e=>[e.key,'Changes pressure.'])));
 await assert.rejects(recoverDiagramContent(content,{field:'visual.diagram.nodes[0].description',maxCharacters:40},{slide,client:mock.client,logger:()=>{},layoutLogger:()=>{},sleep:async()=>{}}));assert.equal(mock.calls.length,2);assert.match(content.visualContent.visual.diagram.nodes[0].description,/may.*10 mmHg/);
});

test('full Claude protocol completes exactly twelve hypertension slides after late diagram recovery',async()=>{
 const fixture=hypertensionFixture(),logs=[];
 const result=await aiService('prompt',hypertensionPrompt,'presentation',fixture.context,{client:fixture.mock.client,logger:e=>logs.push(e),layoutLogger:()=>{},qualityLogger:()=>{},sleep:async()=>{}});
 assert.equal(result.generatedContent.slides.length,12);assert.deepEqual(result.generatedContent.slides.map(s=>s.slideNumber),Array.from({length:12},(_,i)=>i+1));assert.equal(result.generatedContent.quality.reviewed,true);assert.equal(fixture.attempts.get(8),3);assert.equal(logs.filter(e=>e.stage==='visual-layout-repair'&&e.status==='completed').length,1);assert.ok(logs.filter(e=>e.stage==='slide-content-generation').every(e=>e.attempt<=3));
 assert.ok(logs.find(e=>e.slideNumber===8&&e.stage==='slide-content-generation'&&e.attempt===3).validationErrors.some(e=>e.field==='visual.diagram.nodes[0].label'));assert.doesNotMatch(JSON.stringify(logs),/Peripheral vascular resistance/);
});
