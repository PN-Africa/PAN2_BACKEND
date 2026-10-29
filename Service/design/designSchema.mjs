import {componentsFor} from './componentRegistry.mjs';
const text=(maxLength=200)=>({type:'string',minLength:1,maxLength});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const FONT_PAIRS=['humanist','editorial','technical','classical','geometric'];
export function designPlanSchema(type){
 const schema=object({schemaVersion:{type:'string',enum:['2.0']},rationale:text(500),theme:object({colors:object(Object.fromEntries(['background','surface','text','muted','primary','accent'].map(key=>[key,text(7)]))),fontPair:{type:'string',enum:FONT_PAIRS},spacing:{type:'string',enum:['compact','balanced','spacious']}}),units:{type:'array',minItems:1,maxItems:type==='presentation'?12:type==='webpage'?8:40,items:object({contentId:text(60),component:{type:'string',enum:componentsFor(type).map(c=>c.id)},purpose:text(300)})}});
 if(type==='presentation')schema.properties.vectors={type:'array',maxItems:3,items:object({contentId:text(60),description:text(300),svg:text(20000)})};
 if(type==='presentation')schema.properties.units.items.properties.background={type:'string',enum:['plain','light','dark','highlight','brand-tint','gradient']};
 return schema;
}
// Content stays in the existing canonical schemas; the universal boundary
// carries stable IDs, exact content hashes, and independently validated design.
export const universalSpecificationSchema=object({schemaVersion:{type:'string',enum:['2.0']},artifactType:{type:'string',enum:['presentation','webpage','document']},requestId:text(100),content:{type:'array',minItems:1,maxItems:40,items:object({id:text(60),kind:text(60),sha256:text(64)})},design:{anyOf:['presentation','webpage','document'].map(designPlanSchema)},assets:{type:'array',maxItems:40,items:object({contentId:text(60),kind:{type:'string',enum:['photo','diagram','chart','illustration']},required:{type:'boolean'},subject:text(500)})},provenance:{type:'string',enum:['ai-directed','legacy-adapter']}});
universalSpecificationSchema.properties.assets.items.properties.subject.maxLength=4000;
export function designPlanningPrompt(type){
 if(process.env.LEDIFY_DESIGN_ENGINE==='legacy')return '';
 const vectorRules=type==='presentation'?'Optional vectors may describe up to three supporting conceptual illustrations using restricted SVG: svg/viewBox, rect, circle, ellipse, line, path, g and plain text; literal numeric coordinates and hex colors only. No scripts, CSS, links, entities or external resources. Never use an SVG as the photographic cover or substitute one for an editable chart or precise technical diagram. Omit vectors for image-free requests.':'';
 return `Content and design are separate logical stages in this SAME response; do not make another request. Include artifactDesign using schemaVersion 2.0. Choose coherent literal #RRGGBB colors with text and muted at least 4.5:1 against background AND surface; primary/accent are brand colors, not body text. ${type==='document'?'The current Word renderer uses white paper: background must be #FFFFFF.':''} Choose one supported fontPair and spacing rhythm for the whole artifact. Give a reason grounded in this specific brief, not an industry template. Map EVERY ${type==='presentation'?'slide as slide-1, slide-2, etc.':type==='webpage'?'section as section-1, section-2, etc.':'section by its exact section ID'} to a compatible component ID, with its communication purpose. Preserve all meaningful content; the backend validates geometry and may report a compatible alternative. No executable code, CSS, paths, URLs or server commands in design fields. ${vectorRules} Available component contracts: ${JSON.stringify(componentsFor(type).map(({id,supports})=>({id,supports})))}`;
}
