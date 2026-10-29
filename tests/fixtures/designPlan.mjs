import {componentsFor} from '../../Service/design/componentRegistry.mjs';
export function designPlan(content,type='presentation'){
 const units=type==='presentation'?content.slides:content.sections;
 return {schemaVersion:'2.0',rationale:'A restrained editorial design makes the supplied explanations easy to compare.',theme:{colors:{background:'#FFFFFF',surface:'#F5F7FA',text:'#142536',muted:'#405062',primary:'#153F63',accent:'#A66A3F'},fontPair:'editorial',spacing:'spacious'},units:units.map((unit,i)=>({contentId:type==='presentation'?'slide-'+(i+1):type==='webpage'?'section-'+(i+1):unit.id,component:type==='presentation'?componentsFor(type).find(component=>component.supports.includes(unit.slideType)).id:type==='webpage'?'editorial':'prose',purpose:unit.title||unit.heading||'Explain the content'}))};
}
