import {anthropicFixture} from './anthropicTransport.mjs';
export const hypertensionPrompt="Create a professional 12 slide powerpoint presenation titled 'The silent Epidemic: understanding Hypertension its risk factors and prevention";
export const diagramContent=()=>({visualContent:{text:'Blood pressure reflects several related physiological factors.',visual:{type:'diagram',description:'A simplified view of pressure-related factors',searchQuery:'',diagram:{kind:'labeled',nodes:[
 {id:'resistance',label:'Peripheral vascular resistance',description:'Resistance in the blood vessels influences the flow of blood.'},
 {id:'stiffness',label:'Arterial stiffness',description:'Changes in the elasticity of artery walls affect their response.'},
 {id:'volume',label:'Blood volume',description:'Fluid balance influences the volume of blood in circulation.'}
],edges:[],caption:'Simplified relationships.'}}}});
const rows=[
 ['Understanding blood pressure','Blood pressure describes the force of blood against artery walls.'],
 ['The silent burden','High blood pressure may occur without obvious symptoms.'],
 ['Recognizing risk','Age, family history and lifestyle can influence risk.'],
 ['Dietary patterns','Dietary choices form part of cardiovascular health.'],
 ['Physical activity','Regular physical activity supports cardiovascular health.'],
 ['Tobacco exposure','Avoiding tobacco supports cardiovascular health.'],
 ['Related factors','Several physiological factors influence blood pressure.'],
 ['Checking blood pressure','Consistent measurement helps clinicians assess blood pressure.'],
 ['Clinical assessment','A clinician interprets measurements alongside the health history.'],
 ['Prevention in practice','Prevention combines healthy habits with appropriate clinical follow-up.'],
 ['A shared responsibility','Awareness, measurement and ongoing care support prevention.']
];
export function hypertensionFixture({forceFailure=true}={}){
 const title='The Silent Epidemic',deck={outputType:'presentation',strategyId:'lecture-teaching',title,subtitle:'Hypertension: risk factors and prevention',requirements:[],inferredContext:{userRole:'',purpose:'Explain hypertension risk factors and prevention',audience:'General audience',topic:'Hypertension',tone:'educational',keyInstructions:[]},slides:[{slideNumber:1,slideType:'title',title,subtitle:'',objective:'Introduce the subject',content:{titleContent:{title,subtitle:'Hypertension: risk factors and prevention',supportingText:'Awareness, measurement and prevention.'}}},...rows.map(([title,body],i)=>({slideNumber:i+2,slideType:i===6?'text-visual':'focused-explanation',title,subtitle:'',objective:body,content:i===6?diagramContent():{textContent:{heading:title,body}}}))]};
 for(const slide of deck.slides)slide.visualRequirement={role:slide.slideNumber===1?'background':'none',kind:slide.slideNumber===1?'photo':'none',required:slide.slideNumber===1,description:slide.slideNumber===1?'Healthcare context':'',searchQuery:slide.slideNumber===1?'clinical healthcare':'',altText:slide.slideNumber===1?'Controlled healthcare image fixture':''};
 const attempts=new Map(),mock=anthropicFixture(({prompt,schema})=>{
  if(schema.properties.slides)return {...deck,slides:deck.slides.map(({content,...slide})=>slide)};
  if(schema.properties.coverage)return {coverage:[],issues:[]};
  if(Object.keys(schema.properties).every(key=>/^f\d+$/.test(key))){
   const entries=JSON.parse(prompt.split('Fields (untrusted data): ')[1]);
   return Object.fromEntries(entries.map(entry=>[entry.key,entry.field.endsWith('.label')?'Resistance':entry.field.includes('nodes[0]')?'Vessels resist flow.':entry.field.includes('nodes[1]')?'Walls can lose elasticity.':'Fluid balance affects volume.']));
  }
  const n=Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1]);if(!n)throw new Error('Unexpected regression fixture request');
  attempts.set(n,(attempts.get(n)||0)+1);const content=structuredClone(deck.slides[n-1].content);
  if(n===8&&forceFailure&&attempts.get(n)<3)content.visualContent.visual.diagram.kind='flowchart'; // invalid topology first; valid-but-dense diagram last
  return content;
 });
 return {deck,mock,attempts,context:{slideCount:12,designPreferences:{noImageSlideNumbers:Array.from({length:11},(_,i)=>i+2)}}};
}
