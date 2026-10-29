import {createHash,randomUUID} from 'node:crypto';
import {validateSchema} from '../ai/responseValidation.mjs';
import {designPlanSchema,universalSpecificationSchema} from './designSchema.mjs';
import {componentById,componentsFor} from './componentRegistry.mjs';
import {wantsTextOnly,requiresAuthenticPhotography} from '../visual/imageArtDirection.mjs';
import {sanitizeDesignSvg} from './safeSvg.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const payload=(unit,type)=>type==='presentation'?{title:unit.content?.titleContent?.title||unit.title,subtitle:unit.content?.titleContent?.subtitle??unit.subtitle??'',content:unit.content}:type==='webpage'?{type:unit.type,heading:unit.heading,content:unit.content,items:unit.items}:{id:unit.id,heading:unit.heading,blocks:unit.blocks};
export const designError=(message,field)=>Object.assign(new Error(message),{code:'DESIGN_SPEC_INVALID',stage:'design-validation',field});
export function contrast(a,b){const lum=color=>{const rgb=color.replace('#','').match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function validateDesignPlan(plan,type,ids){
 validateSchema(plan,designPlanSchema(type));
 for(const [key,value] of Object.entries(plan.theme.colors))if(!/^#[a-f\d]{6}$/i.test(value))throw designError('Design colors must be literal #RRGGBB values.','theme.colors.'+key);
 if(type==='document'&&plan.theme.colors.background.toUpperCase()!=='#FFFFFF')throw designError('The current Word renderer requires a white paper background.','theme.colors.background');
 for(const fg of ['text','muted'])for(const bg of ['background','surface'])if(contrast(plan.theme.colors[fg],plan.theme.colors[bg])<4.5)throw designError('Body typography requires sufficient contrast on each reading surface.','theme.colors.'+fg);
 const unique=new Set(plan.units.map(unit=>unit.contentId));if(unique.size!==plan.units.length||ids&&(unique.size!==ids.length||ids.some(id=>!unique.has(id))))throw designError('Design units must map each content unit exactly once.','units');
 const vectorIds=new Set();for(const vector of plan.vectors||[]){if(type!=='presentation'||!unique.has(vector.contentId)||vector.contentId==='slide-1'||vectorIds.has(vector.contentId))throw designError('SVG illustrations need distinct supporting slide targets.','vectors');sanitizeDesignSvg(vector.svg);vectorIds.add(vector.contentId);}
 return plan;
}
export function contentUnits(content,type){
 const units=type==='presentation'?content.slides:content.sections;
 if(!Array.isArray(units)||!units.length)throw designError('The artifact needs complete content units.','content');
 return units.map((unit,index)=>({id:type==='presentation'?'slide-'+unit.slideNumber:type==='webpage'?'section-'+(index+1):unit.id,kind:type==='presentation'?unit.slideType:type==='webpage'?unit.type:'section',value:unit}));
}
const defaultTheme={colors:{background:'#FFFFFF',surface:'#F3F5F7',text:'#152536',muted:'#405062',primary:'#173B60',accent:'#946000'},fontPair:'humanist',spacing:'balanced'};
export function createSpecification(content,type,{requestId=randomUUID(),context={}}={}){
 const units=contentUnits(content,type),given=content.artifactDesign;
 if(given)validateDesignPlan(given,type,units.map(u=>u.id));
 if(given?.vectors?.length&&wantsTextOnly(context))throw designError('An image-free request cannot contain generated illustrations.','vectors');
 if(given?.vectors?.length&&requiresAuthenticPhotography(context))throw designError('SVG illustrations cannot satisfy a request for authentic photography.','vectors');
 for(const vector of given?.vectors||[]){const slide=content.slides.find(s=>'slide-'+s.slideNumber===vector.contentId);if(context.designPreferences?.noImageSlideNumbers?.includes(slide?.slideNumber))throw designError('An SVG conflicts with an explicit slide image exclusion.','vectors');if(slide?.content?.chart||slide?.content?.relationship||slide?.content?.visualContent?.visual?.diagram)throw designError('A decorative SVG cannot replace a required editable chart or technical diagram.','vectors');}
 const design=given?structuredClone(given):{schemaVersion:'2.0',rationale:'Compatibility adapter preserves the existing validated renderer decisions.',theme:structuredClone(defaultTheme),units:units.map(unit=>({contentId:unit.id,component:type==='presentation'?componentsFor(type).find(c=>c.supports.includes(unit.kind))?.id:type==='webpage'?unit.value.composition&&componentById(type,unit.value.composition)?unit.value.composition:'editorial':'prose',purpose:unit.value.objective||unit.value.heading||unit.value.title||'Communicate the supplied content'}))};
 const assets=units.flatMap((unit,index)=>{
  const vector=given?.vectors?.find(v=>v.contentId===unit.id);if(vector)return [{contentId:unit.id,kind:'illustration',required:true,subject:vector.description}];
  if(type==='document')return (unit.value.blocks||[]).filter(block=>block.type==='image').map(block=>({contentId:unit.id,kind:'illustration',required:true,subject:content.assets?.find(asset=>asset.id===block.assetId)?.alt||unit.value.heading}));
  const requirement=unit.value.visualRequirement;
  if(type==='presentation'&&index===0&&!wantsTextOnly(context))return [{contentId:unit.id,kind:'photo',required:true,subject:content.inferredContext?.topic||content.title}];
  if(type==='presentation'&&['photo','illustration','diagram'].includes(requirement?.kind)&&!wantsTextOnly(context))return [{contentId:unit.id,kind:requirement.kind,required:requirement.required===true,subject:requirement.description||unit.value.title}];
  if(type==='presentation'&&unit.value.content?.chart)return [{contentId:unit.id,kind:'chart',required:true,subject:unit.value.title}];return [];
 });
 const specification={schemaVersion:'2.0',artifactType:type,requestId,content:units.map(unit=>({id:unit.id,kind:unit.kind,sha256:digest(payload(unit.value,type))})),design,assets,provenance:given?'ai-directed':'legacy-adapter'};
 // The universal wrapper's nested design has a type-specific schema.
 validateSchema(specification,universalSpecificationSchema);validateDesignPlan(design,type,units.map(u=>u.id));return specification;
}
export function setAssetRequirements(spec,assets){
 const candidate={...spec,assets};validateSchema(candidate,universalSpecificationSchema);
 const ids=new Set(spec.content.map(unit=>unit.id));if(assets.some(asset=>asset.contentId!=='@artifact'&&!ids.has(asset.contentId)))throw designError('Asset requirements reference unknown content.','assets');
 spec.assets=assets;return spec;
}
export function assertContentUnchanged(spec,content){const units=contentUnits(content,spec.artifactType);if(units.length!==spec.content.length||units.some((unit,i)=>unit.id!==spec.content[i].id||digest(payload(unit.value,spec.artifactType))!==spec.content[i].sha256))throw designError('Layout compilation changed or lost canonical content.','content');return true;}
export function compileDesign(spec,content){
 const copy=structuredClone(content);assertContentUnchanged(spec,copy);
 if(spec.provenance==='ai-directed'){
  if(spec.artifactType==='presentation')copy.slides=copy.slides.map(slide=>({...slide,designComponent:spec.design.units.find(unit=>unit.contentId==='slide-'+slide.slideNumber).component,...(spec.design.units.find(unit=>unit.contentId==='slide-'+slide.slideNumber).background?{backgroundTreatment:spec.design.units.find(unit=>unit.contentId==='slide-'+slide.slideNumber).background}:{})}));
  if(spec.artifactType==='webpage')copy.sections=copy.sections.map((section,i)=>({...section,composition:spec.design.units.find(unit=>unit.contentId==='section-'+(i+1)).component}));
  if(spec.artifactType==='document')copy.sections=copy.sections.map(section=>({...section,designComponent:spec.design.units.find(unit=>unit.contentId===section.id).component}));
 }
 // Website layout metadata is not canonical content; hash only the source
 // section fields in later output validation, not renderer-derived properties.
 assertContentUnchanged(spec,copy);
 return copy;
}
export const designFonts={humanist:{heading:'Arial',body:'Arial'},editorial:{heading:'Georgia',body:'Arial'},technical:{heading:'Arial',body:'Arial'},classical:{heading:'Times New Roman',body:'Arial'},geometric:{heading:'Trebuchet MS',body:'Arial'}};
export function applyPresentationDesign(presentation,spec,context={}){
 if(spec.provenance!=='ai-directed')return presentation;
 const colors={...spec.design.theme.colors,...context.designPreferences?.colors},fonts=designFonts[spec.design.theme.fontPair];
 for(const value of Object.values(colors))if(!/^#[a-f\d]{6}$/i.test(value))throw designError('Explicit colors must be #RRGGBB.','theme.colors');
 for(const fg of ['text','muted'])for(const bg of ['background','surface'])if(contrast(colors[fg],colors[bg])<4.5)throw designError('Explicit colors have insufficient reading contrast.','theme.colors');
 const tokens=structuredClone(presentation.design.tokens);tokens.colors={...tokens.colors,canvas:colors.background,background:colors.background,surface:colors.surface,surfaceAlt:colors.surface,text:colors.text,textMuted:colors.muted,primary:colors.primary,accent:colors.accent};tokens.typography={...tokens.typography,headingFamily:fonts.heading,bodyFamily:fonts.body};
 return {...presentation,design:{...presentation.design,tokens}};
}
