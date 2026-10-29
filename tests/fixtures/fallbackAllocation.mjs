import assert from 'node:assert/strict';
import {tenSlideFixture} from './tenSlideClaude.mjs';
import {anthropicFixture} from './anthropicTransport.mjs';
const overlong='Interdisciplinary evidence interpretation and careful explanation of the relationships between the systems and their supporting components.';
export async function fallbackAllocationFixture({repairFields=false,rejectReplacement=false}={}){
 const f=await tenSlideFixture(0,0),deck=structuredClone(f.deck),fallbacks=[],patches=[],reviews=[],attempts=new Map();let outlines=0;
 for(const s of deck.slides)if(s.slideNumber!==1)s.visualRequirement={role:'none',kind:'none',required:false,description:'',searchQuery:'',altText:''};
 deck.slides[2]={...deck.slides[2],slideType:'cards',title:'System considerations',content:{cards:Array.from({length:6},(_,i)=>({title:'Factor '+String.fromCharCode(65+i),description:'Assess local conditions.'}))}};
 for(const n of [5,7])deck.slides[n-1]={...deck.slides[n-1],slideType:'text-visual',title:n===5?'How the system works':'Related components',content:{visualContent:{text:'Local conditions affect the system and its supporting components.',visual:{type:'diagram',description:'Simplified components',searchQuery:'',diagram:{kind:'labeled',nodes:[{id:'a',label:'Resource',description:'Supplies energy.'},{id:'b',label:'Equipment',description:'Converts energy.'},{id:'c',label:'Infrastructure',description:'Supports delivery.'}],edges:[],caption:'A simplified component model.'}}}}};
 const mock=anthropicFixture(async({schema,prompt})=>{
  if(schema.properties.slides){outlines++;return {...deck,requirements:[],slides:deck.slides.map(({content,...s})=>s)};}
  if(schema.properties.coverage){const payload=JSON.parse(prompt.slice(prompt.lastIndexOf('Deck: ')+6)),first=reviews.length===0;reviews.push(payload);return {coverage:[],issues:first?[5,3,10,7].map(n=>({slideNumber:n,code:n===5?'DEPTH':n===10?'CONCLUSION':'CLARITY',severity:n===7?'warning':'error',message:n===5?'The explanation needs to distinguish the main components and supporting roles.':'The explanation needs a precise synthesis of the component roles.',repairInstruction:'Explain the resource, equipment and supporting infrastructure using the supplied scope.',repairTarget:n===3?'content.cards[5].description':n===10?'content.textContent.body':'content.visualContent.text'})):rejectReplacement?[{slideNumber:5,code:'FACTUAL',severity:'error',message:'The replacement contains an unsupported causal claim.',repairInstruction:'Remove the unsupported causal claim and preserve the supported explanation.',repairTarget:'content.textContent.body'}]:[]};}
  if(Object.keys(schema.properties).every(k=>k==='value'||/^f\d+$/.test(k))){patches.push(Object.keys(schema.properties));return Object.fromEntries(Object.keys(schema.properties).map(k=>[k,repairFields?'Related role.':overlong]));}
  const n=Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1]);assert.ok(n);attempts.set(n,(attempts.get(n)||0)+1);
  if(prompt.includes('Reserved fallback:')){fallbacks.push(n);return {textContent:{heading:'System roles',body:'Resources supply energy to equipment, which converts it for suitable uses. Infrastructure supports delivery. Local conditions affect which arrangements are suitable.'}};}
  const content=structuredClone(deck.slides[n-1].content);
  if(prompt.includes('Targeted quality repair')){
   // The supplied trace has slides 3 and 7 finish fallback before slide 5.
   // Preserve that ordering so the old two-slot pool demonstrably starves 5.
   if(n===5)await new Promise(resolve=>setTimeout(resolve,15));
   if(n===3)content.cards[5].description=overlong;
   else if([5,7].includes(n))content.visualContent.visual.diagram.nodes[0].description=overlong;
   else content.textContent.body+=' Connect the roles when evaluating the complete system.';
  }
  return content;
 });
 return {...f,deck,mock,fallbacks,patches,reviews,attempts,get outlines(){return outlines;},assets:[f.assets[0]],context:{slideCount:10,designPreferences:{noImageSlideNumbers:[2,3,4,5,6,7,8,9,10]}},prompt:'Create exactly 10 slides explaining renewable energy systems. Use only a full-slide first background photo; supporting slides must be image-free.'};
}
