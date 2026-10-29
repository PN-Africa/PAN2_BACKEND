// Normalize notation, not quantities: 25.0 mm Hg == 25 mmHg; 25 mg != 25 kg.
const units='millimet(?:er|re)s?\\s+of\\s+mercury|mm\\s*Hg|kilograms?|milligrams?|millilit(?:er|re)s?|percent|per\\s+cent|kg|mg|mL|cm|mm|km|Hz|kW|MW|°C|°F|g|L|%';
const pattern=new RegExp('(?<![\\p{L}\\p{N}_])([+\\-−]?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+))(?:[ \\t]*('+units+')(?![\\p{L}\\p{N}_]))?(?![\\p{L}\\p{N}_])','giu');
function number(value){
 let text=value.replaceAll(',','').replace('−','-'),sign=text.startsWith('-')?'-':'';text=text.replace(/^[+-]/,'');
 let [whole,fraction='']=text.split('.');whole=(whole||'0').replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
 if(whole==='0'&&!fraction)sign='';return sign+whole+(fraction?'.'+fraction:'');
}
function unit(value=''){
 const key=value.toLowerCase().replace(/\s+/g,'');
 if(/^millimet(?:er|re)s?ofmercury$/.test(key)||key==='mmhg')return 'mmHg';
 if(/^kilograms?$/.test(key))return 'kg';if(/^milligrams?$/.test(key))return 'mg';if(/^millilit(?:er|re)s?$/.test(key))return 'mL';
 return ({percent:'%',ml:'mL',l:'L',hz:'Hz',kw:'kW',mw:'MW','°c':'°C','°f':'°F'})[key]||key;
}
export const layoutNumericFacts=value=>[...String(value).normalize('NFC').matchAll(pattern)].map(match=>number(match[1])+unit(match[2]));

// A content projection, not JSON serialization: IDs, edges' endpoints, step
// numbers and visual search instructions are never protected numeric claims.
export function visibleFactText(content){
 const rows=[];
 const walk=(value,path='',arrayLength=0,context='')=>{
  if(typeof value==='string'||typeof value==='number'){
   if(/(?:^|\.)(?:id|from|to|type|searchQuery|stepNumber)$/.test(path))return;
   if(/(?:phases|steps)\[\d+\]\.label$/.test(path)){
    const ordinal=String(value).trim().match(/^(?:(?:phase|step|stage)\s*)?(\d{1,2})[.)]?$/i);
    if(ordinal&&Number(ordinal[1])>=1&&Number(ordinal[1])<=arrayLength)return;
   }
   rows.push({field:path,text:String(value),context:context||String(value)});return;
  }
  if(Array.isArray(value)){value.forEach((child,i)=>walk(child,path+'['+i+']',value.length));return;}
  if(value&&typeof value==='object'){const local=Object.entries(value).filter(([key,child])=>['label','title','description','text','body','heading','value'].includes(key)&&typeof child==='string').map(([key,child])=>key+': '+child).join('\n').slice(0,1200);for(const [key,child] of Object.entries(value)){
   if(['id','from','to','type','searchQuery','stepNumber'].includes(key))continue;
   if(key==='visual'){if(child?.diagram)walk(child.diagram,path?path+'.visual.diagram':'visual.diagram',arrayLength);continue;}
   walk(child,path?path+'.'+key:key,arrayLength,local);
  }}
 };
 walk(content);return rows;
}

export function fallbackFactLedger(content,feedback=[]){
 const facts=new Map();
 for(const row of visibleFactText(content))for(const value of layoutNumericFacts(row.text)){
  if(!facts.has(value))facts.set(value,{value,fields:[],contexts:[]});const entry=facts.get(value);if(!entry.fields.includes(row.field))entry.fields.push(row.field);if(entry.contexts.length<4&&!entry.contexts.includes(row.context))entry.contexts.push(row.context.slice(0,600));
 }
 return [...facts.values()].filter(fact=>!feedback.some(issue=>issue.code==='FACTUAL'&&layoutNumericFacts(issue.message+' '+issue.repairInstruction).includes(fact.value)&&/unsupported|incorrect|not supported|no evidence|source (?:says|states)/i.test(issue.message+' '+issue.repairInstruction)));
}
export function missingFallbackFacts(ledger,content){const present=new Set(visibleFactText(content).flatMap(row=>layoutNumericFacts(row.text)));return ledger.filter(fact=>!present.has(fact.value));}
