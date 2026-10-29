import {validatePlannedRenderContent} from '../../renderer/presentation/professionalLayouts.mjs';
import {canonicalRepairField} from './fieldRepair.mjs';
import {textCharacterBudget} from '../../renderer/presentation/contentFit.mjs';
import {DIAGRAM_TEXT_LIMITS} from '../../renderer/presentation/visuals/diagramLimits.mjs';

// Probe a bounded canonical component before drafting (four nodes for graphs).
// This dry run has no media, storage or AI side effects. Runtime wrapping checks
// still validate actual words: a character budget alone cannot guarantee fit.
export function layoutContentSchema(schema,slide){
 const hasDiagram=!!schema.properties?.visualContent?.properties?.visual?.properties?.diagram;
 if(!hasDiagram&&!['timeline','comparison','cards','relationship'].some(key=>schema.properties?.[key]))return schema;
 const result=JSON.parse(JSON.stringify(schema));
 const sample=(node,key='',i=0)=>{const type=String(node.type).toLowerCase();if(type==='object')return Object.fromEntries(Object.entries(node.properties||{}).map(([k,v])=>[k,sample(v,k,i)]));if(type==='array')return Array.from({length:Math.min(6,node.maxItems||3)},(_,n)=>sample(node.items,key,n));if(type==='integer'||type==='number')return i+1;if(type==='boolean')return false;return node.enum?.[0]||'Item';};
 const limits=new Map(),targets=new Map(),content=sample(result);
 const graph=content.visualContent?.visual?.diagram||content.relationship;
 if(graph){graph.nodes=graph.nodes.slice(0,4).map((node,i)=>({...node,id:'n'+i}));const edges=[];for(let i=1;i<graph.nodes.length;i++)edges.push({from:'n0',to:'n'+i,label:'Link'});if(graph.nodes.length===4)edges.push({from:'n1',to:'n2',label:'Link'});if(content.relationship)graph.relationships=edges;else {graph.kind='flowchart';graph.edges=edges;} }
 const onTextLayout=({field,w,h,fontSize,overhead=0})=>{const path=canonicalRepairField(content,field);if(!path||path.endsWith('.caption')||hasDiagram&&slide.imageLayoutPlanned&&path==='visualContent.text')return;const canonical=path.replace(/\[\d+\]/g,'[]'),box={w,h,fontSize,overhead:overhead+(field.includes('.points[')?2:0)},target=textCharacterBudget(box),isGraph=/^(?:visualContent\.visual\.diagram\.|relationship\.(?:nodes|relationships))/.test(path),ceiling=isGraph?(path.endsWith('.description')?DIAGRAM_TEXT_LIMITS.description:path.includes('.edges[')||path.includes('.relationships[')?DIAGRAM_TEXT_LIMITS.edgeLabel:DIAGRAM_TEXT_LIMITS.label):target;limits.set(canonical,Math.min(limits.get(canonical)||Infinity,ceiling));if(isGraph)targets.set(canonical,Math.min(targets.get(canonical)||Infinity,target));};
 validatePlannedRenderContent({...slide,content,layoutId:slide.slideType==='timeline'?'timeline-horizontal':slide.slideType==='comparison'?'comparison-multi-column':hasDiagram?'text-visual-split':content.relationship?'relationship-network':'cards-grid'},{skipContentValidation:true,onTextLayout});
 const walk=(node,path='')=>{if(limits.has(path)&&String(node.type).toLowerCase()==='string'){node.maxLength=Math.min(node.maxLength??Infinity,limits.get(path));if(targets.has(path))node.description=`Layout target: aim for about ${targets.get(path)} characters or fewer without losing essential terms. The hard ceiling is ${node.maxLength}; actual word wrapping is validated separately.`;}for(const [key,child] of Object.entries(node.properties||{}))walk(child,path?path+'.'+key:key);if(node.items)walk(node.items,path+'[]');};walk(result);return result;
}
