import fs from 'node:fs/promises';
import {diagramContent} from './fixtures/hypertensionRecovery.mjs';
import {validatePlannedRenderContent} from '../renderer/presentation/professionalLayouts.mjs';
const rows=[];
for(const imageLayoutPlanned of [false,true])for(const count of [2,3,4])for(const kind of ['flowchart','labeled'])for(const longCaption of [false,true])for(const body of ['Related factors.', 'Several physiological factors contribute to changes in blood pressure and influence the response of the circulation.']){
 const content=diagramContent(),d=content.visualContent.visual.diagram;content.visualContent.text=body;d.kind=kind;d.nodes=Array.from({length:count},(_,i)=>({id:'n'+i,label:'Related factor',description:'Wide words WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW'}));d.edges=kind==='labeled'?[]:Array.from({length:count-1},(_,i)=>({from:'n0',to:'n'+(i+1),label:'influences'}));d.caption=longCaption?'This simplified explanatory diagram shows related factors and their connections for educational discussion.':'Simplified model.';
 try{validatePlannedRenderContent({slideNumber:8,slideType:'text-visual',title:'Related factors',imageLayoutPlanned,content});}catch(error){for(const issue of error.validationErrors||[])if(issue.field.endsWith('.description'))rows.push({photo:imageLayoutPlanned,nodes:count,kind,bodyLength:body.length,captionLength:d.caption.length,field:issue.field,maxCharacters:issue.maxCharacters});}
}
await fs.writeFile('generated/slide-recovery-reserve/diagram-budgets.json',JSON.stringify(rows,null,2));console.log(JSON.stringify({observed:[...new Set(rows.map(r=>r.maxCharacters))].sort((a,b)=>a-b),examples:rows.filter(r=>[20,40].includes(r.maxCharacters)).filter((r,i,a)=>a.findIndex(v=>v.maxCharacters===r.maxCharacters)===i)}));
