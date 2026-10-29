import {designPlanSchema} from '../design/designSchema.mjs';
const string = { type: 'string' };
const strings = (maxItems = 20) => ({ type: 'array', maxItems, items: string });
const blockFields = { type: 'object', properties: {
    type: { type: 'string', enum: ['paragraph','heading','list','table','code','quote','image','caption','pageBreak','sectionBreak'] },
    text: string, level: { type: 'integer' }, ordered: { type: 'boolean' }, items: strings(),
    columns: strings(8), rows: { type: 'array', maxItems: 20, items: { type:'object', properties:{ cells: strings(8) }, required:['cells'] } },
    assetId: string, caption: string, referenceIds: strings(10), orientation: { type:'string', enum:['portrait','landscape'] }
}, required:['type'] };
const variants={paragraph:['text','referenceIds'],heading:['text','level'],list:['ordered','items','referenceIds'],table:['columns','rows','caption','referenceIds'],code:['text'],quote:['text','referenceIds'],image:['assetId','caption','referenceIds'],caption:['text'],pageBreak:[],sectionBreak:['orientation']};
const requiredFields={paragraph:['text'],heading:['text','level'],list:['items'],table:['columns','rows'],code:['text'],quote:['text'],image:['assetId'],caption:['text'],pageBreak:[],sectionBreak:['orientation']};
export const blockSchema={anyOf:Object.entries(variants).map(([type,fields])=>({type:'object',properties:{type:{type:'string',enum:[type]},...Object.fromEntries(fields.map(field=>[field,blockFields.properties[field]]))},required:['type',...requiredFields[type]],additionalProperties:false}))};
export const sectionSchema = { type: 'object', properties: { id:string, heading:string, blocks: { type:'array', maxItems:24, items:blockSchema } }, required:['id','heading','blocks'] };
export const outlineSchema = { type:'object', properties: {
    documentType:string, title:string, subtitle:string, audience:string, purpose:string, tone:string,
    coverPage:{type:'boolean'}, sections:{type:'array',maxItems:40,items:{type:'object',properties:{id:string,heading:string,objective:string,topics:strings(24),targetWords:{type:'integer'}},required:['id','heading','objective','topics','targetWords']}}
}, required:['documentType','title','audience','purpose','tone','coverPage','sections'] };
export const reviewSchema = {type:'object',properties:{issues:{type:'array',maxItems:12,items:{type:'object',properties:{sectionId:string,instruction:string},required:['sectionId','instruction']}}},required:['issues']};
outlineSchema.properties.artifactDesign=designPlanSchema('document');
