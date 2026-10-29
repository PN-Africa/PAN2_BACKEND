import assert from 'node:assert/strict';
import {tenSlideFixture} from './tenSlideClaude.mjs';
import {anthropicFixture} from './anthropicTransport.mjs';
export const recoveredSolarBody='Solar cells convert sunlight into direct-current electricity. An inverter converts this to alternating current for suitable loads or the grid. Output varies with daylight, cloud cover and shading; a panel does not provide constant power. Storage can shift some generated energy to another time, while grid supply can cover a shortfall. These supporting systems are distinct from the panels themselves.';
export async function coverageRecoveryFixture({rejectFallback=false}={}){
 const f=await tenSlideFixture(0,0),reviews=[],fallbacks=[],drafts=new Map();
 const deck=structuredClone(f.deck);deck.requirements=[{topic:'Solar generation and variability',slideNumbers:[6],essentialPoints:['Cells produce direct current; an inverter converts it for suitable loads.','Output depends on daylight, weather and shading.','Storage and grid supply have distinct supporting roles.']}];
 for(const s of deck.slides)if(s.slideNumber!==1)s.visualRequirement={role:s.slideNumber===6?'foreground':'none',kind:s.slideNumber===6?'photo':'none',required:s.slideNumber===6,description:'Solar panels generating electricity',searchQuery:'solar panels',altText:'Solar panels'};
 deck.slides[5]={...deck.slides[5],slideType:'text-visual',title:'Solar generation and variability',objective:'Explain the mechanism, variable output and distinct supporting roles.',content:{visualContent:{text:'Solar panels convert sunlight into electricity.',visual:{type:'photo',description:'Solar farm',searchQuery:'solar panels'}}}};
 const handler=({schema,prompt})=>{
  if(schema.properties.slides)return {...deck,slides:deck.slides.map(({content,...s})=>s)};
  if(schema.properties.coverage){
   const payload=JSON.parse(prompt.slice(prompt.lastIndexOf('Deck: ')+6)),s=payload.slides.find(s=>s.slideNumber===6),body=s.content.textContent?.body||s.content.visualContent.text,round=reviews.length;reviews.push(payload);
   const issue={slideNumber:6,code:round===0?'COVERAGE':'CLARITY',severity:round>1?'error':'warning',message:round===0?'The distinct inverter, storage and grid roles need coverage.':'The supporting systems and variable generation need a clearer explanation.',repairInstruction:'Explain cells producing direct current, inverter conversion, variable daylight and shading, and distinguish storage from grid supply.',repairTarget:s.content.textContent?'content.textContent.body':'content.visualContent.text'};
   return {coverage:[{topic:deck.requirements[0].topic,slideNumbers:[6],adequate:round<2||!rejectFallback,evidence:body.slice(0,40)}],issues:round<2||rejectFallback?[issue]:[]};
  }
  const n=Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1]);assert.ok(n);drafts.set(n,(drafts.get(n)||0)+1);
  if(prompt.includes('Reserved fallback:')){
   const current=JSON.parse(prompt.match(/Current slide: ([^\n]+)/)[1]);assert.equal(current.content,undefined);
   assert.match(prompt,/The distinct inverter, storage and grid roles need coverage/);assert.match(prompt,/Cells produce direct current/);
   const bodySchema=schema.properties.textContent.properties.body,budget=bodySchema.maxLength||Number(bodySchema.description?.match(/maxLength: (\d+)/)?.[1]);assert.ok(budget>=recoveredSolarBody.length);
   fallbacks.push(n);return {textContent:{heading:'Solar systems',body:recoveredSolarBody}};
  }
  if(n===6&&drafts.get(n)>1)return {visualContent:{...deck.slides[5].content.visualContent,text:'Solar cells produce electricity from sunlight; supporting systems have distinct roles.'}};
  return deck.slides[n-1].content;
 };
 const client=anthropicFixture(handler);
 return {...f,deck,mock:client,reviews,fallbacks,drafts,assets:[f.assets[0],{...f.assets[1],slideNumber:6}],context:{slideCount:10,designPreferences:{noImageSlideNumbers:[2,3,4,5,7,8,9,10]}},prompt:'Create exactly 10 slides about renewable energy systems. Explain solar generation and variability. Use photographs only on slides 1 and 6, with a full-slide first background.'};
}
