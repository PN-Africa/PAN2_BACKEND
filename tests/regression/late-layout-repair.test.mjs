import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverSlideLayout,createLayoutTextRepair} from '../../Service/visual/layoutRecovery.mjs';
import {validateRenderContent} from '../../renderer/presentation/professionalLayouts.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';

const wrappingFailure='WWWW WWWW WWWW WWWW WWWW WWWW';
export function lateDiagramSlide(){
 const diagram={kind:'flowchart',nodes:['a','b','c','d'].map((id,i)=>({id,label:['Observe','Model','Review','Decide'][i],description:i===1?'WWWW WWWW WWWW WWWW WWWW WWWW WWWW':'Check evidence'})),edges:[{from:'a',to:'b',label:''},{from:'b',to:'c',label:''},{from:'c',to:'d',label:''}],caption:'Simplified model.'};
 return {slideNumber:4,slideType:'text-visual',title:'The Future of Artificial Intelligence',subtitle:'',layoutId:'text-visual-primary',content:{visualContent:{text:'An illustrative pathway links evidence, models and review.',visual:{type:'diagram',description:'Evidence and models',searchQuery:'',diagram}}},resolvedVisual:{diagram:structuredClone(diagram),caption:diagram.caption}};
}
test('1fcd40b4: a 29-character replacement can still fail actual diagram wrapping',()=>{
 const slide=lateDiagramSlide();slide.resolvedVisual.diagram.nodes[1].description=wrappingFailure;
 assert.equal(wrappingFailure.length,29);
 assert.throws(()=>validateRenderContent(slide),{code:'PRESENTATION_CONTENT_TOO_DENSE',field:'visual.diagram.nodes[1].description',maxCharacters:29});
});
test('1fcd40b4: late Claude repair validates geometry inside the bounded retry, before success',async()=>{
 const original=lateDiagramSlide(),snapshot=JSON.stringify(original),logs=[];let calls=0;
 const mock=anthropicFixture(({prompt})=>{calls++;if(calls===2)assert.match(prompt,/wrapp|geometry|layout/i);return {f0:calls===1?wrappingFailure:'Models relationships.'};});
 const result=await recoverSlideLayout(original,{logger:()=>{},repairText:createLayoutTextRepair({client:mock.client,logger:e=>logs.push(e),sleep:async()=>{}})});
 assert.equal(calls,2);assert.equal(logs[0].status,'failed');assert.equal(logs[1].status,'completed');
 assert.equal(validateRenderContent(result),true);assert.equal(JSON.stringify(original),snapshot);
 assert.equal(result.content.visualContent.visual.diagram.nodes[1].description,'Models relationships.');
 assert.equal(result.resolvedVisual.diagram.nodes[1].description,'Models relationships.');
 const fallback={...result};delete fallback.resolvedVisual;assert.equal(validateRenderContent(fallback),true);
});
test('late resolved diagram repair updates matching canonical content without mutating the source',async()=>{
 const original=lateDiagramSlide(),snapshot=JSON.stringify(original);
 const result=await recoverSlideLayout(original,{logger:()=>{},repairText:async()=>['Models relationships.']});
 assert.equal(result.content.visualContent.visual.diagram.nodes[1].description,result.resolvedVisual.diagram.nodes[1].description);
 assert.equal(JSON.stringify(original),snapshot);
});
test('late geometry exhaustion stays bounded and never mutates approved content',async()=>{
 const original=lateDiagramSlide(),snapshot=JSON.stringify(original);let calls=0;
 const mock=anthropicFixture(()=>{calls++;return {f0:wrappingFailure};});
 await assert.rejects(recoverSlideLayout(original,{logger:()=>{},repairText:createLayoutTextRepair({client:mock.client,logger:()=>{},sleep:async()=>{}})}));
 assert.equal(calls,2);assert.equal(JSON.stringify(original),snapshot);
});
test('repairing an independent resolved diagram never overwrites unrelated canonical nodes',async()=>{
 const original=lateDiagramSlide();original.content.visualContent.visual.diagram.nodes[1]={id:'other',label:'Other',description:'Other evidence'};
 const result=await recoverSlideLayout(original,{logger:()=>{},repairText:async()=>['Models relationships.']});
 assert.equal(result.content.visualContent.visual.diagram.nodes[1].description,'Other evidence');assert.equal(result.resolvedVisual.diagram.nodes[1].description,'Models relationships.');
});
