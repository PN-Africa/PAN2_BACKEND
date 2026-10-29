import {hypertensionFixture,hypertensionPrompt} from './hypertensionRecovery.mjs';
import {anthropicFixture} from './anthropicTransport.mjs';
export const roadmapPrompt=hypertensionPrompt+' Use this supplied illustrative planning example: 2025 assessment, 2030 preparation, 2040 trial, 2050 review.';
export function roadmapFactFixture(){
 const fixture=hypertensionFixture(),attempts=new Map(),description='Evidence-based-interdisciplinary-validation-and-stakeholder-coordination';
 fixture.deck.slides[7]={...fixture.deck.slides[7],slideType:'focused-explanation',content:{textContent:{heading:'Related factors',body:'Related factors influence the circulation.'}}};
 fixture.deck.slides[8]={...fixture.deck.slides[8],slideType:'roadmap',title:'Illustrative planning roadmap',objective:'Explain the supplied illustrative milestones without promising outcomes.',content:{roadmap:{phases:[2025,2030,2040,2050].map((year,i)=>({label:String(year),title:['Assessment','Preparation','Trial','Review'][i],description}))}}};
 const mock=anthropicFixture(({schema,prompt})=>{
  if(schema.properties.slides)return {...fixture.deck,slides:fixture.deck.slides.map(({content,...slide})=>slide)};
  if(schema.properties.coverage)return {coverage:[],issues:[]};
  if(Object.keys(schema.properties).every(k=>k==='value'||/^f\d+$/.test(k))){
   const restoring=prompt.includes('Restore the protected facts');return Object.fromEntries(Object.keys(schema.properties).map(key=>[key,restoring?'Illustrative milestones: 2025 assessment; 2030 preparation; 2040 trial; 2050 review.':description]));
  }
  const n=Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1]);if(!n)throw new Error('Unexpected roadmap fixture request');attempts.set(n,(attempts.get(n)||0)+1);
  if(prompt.includes('Reserved fallback:'))return {textContent:{heading:'Illustrative milestones',body:'Review the supplied illustrative planning milestones.'}};
  return fixture.deck.slides[n-1].content;
 });return {...fixture,mock,attempts};
}
