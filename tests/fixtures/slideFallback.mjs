import assert from 'node:assert/strict';
import {hypertensionFixture,diagramContent} from './hypertensionRecovery.mjs';
import {anthropicFixture} from './anthropicTransport.mjs';
const issue=(slideNumber,code)=>({slideNumber,code,severity:'error',message:'The relation is unsupported by the supplied source.',repairInstruction:'State the supported actors and their precise relationship.'});
export function failingFixture(failed=[8,11],rejectFallback=false,fallbackBody,repairBody){
 const f=hypertensionFixture(),attempts=new Map(),logs=[],fallbacks=[];for(const n of failed){f.deck.slides[n-1].slideType='text-visual';f.deck.slides[n-1].content=diagramContent();}
 let outlines=0;
 const mock=anthropicFixture(({schema,prompt})=>{
  if(schema.properties.slides){outlines++;return {...f.deck,slides:f.deck.slides.map(({content,...s})=>s)};}
  if(schema.properties.coverage)return {coverage:[],issues:rejectFallback?[issue(failed[0],'FACTUAL')]:[]};
  if(Object.keys(schema.properties).every(key=>key==='value'||/^f\d+$/.test(key)))return Object.fromEntries(Object.keys(schema.properties).map(key=>[key,repairBody||fallbackBody||'The original explanation still needs its protected facts.']));
  const n=Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1]);assert.ok(n);
  if(prompt.includes('Reserved fallback:')){fallbacks.push(n);return {textContent:{heading:'Related factors',body:fallbackBody||'Peripheral vascular resistance affects blood flow. Arterial elasticity and blood volume are related factors.'}};}
  attempts.set(n,(attempts.get(n)||0)+1);const content=structuredClone(f.deck.slides[n-1].content);if(failed.includes(n))content.visualContent.visual.diagram.kind='flowchart';return content;
 });return {...f,mock,attempts,logs,fallbacks,get outlines(){return outlines;}};
}
