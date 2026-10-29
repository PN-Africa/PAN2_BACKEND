import {CAPTION_MAX_CHARACTERS} from '../../renderer/presentation/visualLayout.mjs';
import {DIAGRAM_TEXT_LIMITS} from '../../renderer/presentation/visuals/diagramLimits.mjs';
const s = { type: 'string' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const visualRequirementSchema = object({ role: { type: 'string', enum: ['none', 'background', 'foreground'] },
    kind: { type: 'string', enum: ['photo', 'illustration', 'diagram', 'texture', 'none'] }, required: { type: 'boolean' },
    description: s, searchQuery: s, altText: s });
visualRequirementSchema.properties.sourceStrategy={type:'string',enum:['generate-first','licensed-search-first']};
// Server-owned image specifications remain separate from the AI content contract;
// the model cannot invent resolved files, base64 payloads or successful statuses.
export const imageSpecificationSchema={type:'object',additionalProperties:true,required:['slideNumber','slideTitle','subject','purpose','sourceStrategy','description','searchQuery','style','aspectRatio','preferredPlacement','cropStrategy','textSpace','qualityRequirements'],properties:{
    slideNumber:{type:'integer',minimum:1,maximum:12},slideTitle:s,subject:s,purpose:s,sourceStrategy:{type:'string',enum:['generate-first','licensed-search-first']},description:s,searchQuery:s,style:s,
    aspectRatio:{type:'string',enum:['16:9','4:3']},preferredPlacement:s,cropStrategy:s,textSpace:s,
    qualityRequirements:object({minWidth:{type:'integer',minimum:800},minHeight:{type:'integer',minimum:600},minEffectivePpi:{type:'integer',minimum:90},maxBytes:{type:'integer'}})
}};
export const diagramSchema = object({ kind: { type: 'string', enum: ['flowchart', 'cycle', 'labeled'] },
    nodes: { type: 'array', minItems: 2, maxItems: 8, items: object({ id: s, label: {type:'string',maxLength:DIAGRAM_TEXT_LIMITS.label}, description: {type:'string',maxLength:DIAGRAM_TEXT_LIMITS.description} }) },
    edges: { type: 'array', maxItems: 12, items: object({ from: s, to: s, label: {type:'string',maxLength:DIAGRAM_TEXT_LIMITS.edgeLabel} }) }, caption: {type:'string',maxLength:CAPTION_MAX_CHARACTERS} });
