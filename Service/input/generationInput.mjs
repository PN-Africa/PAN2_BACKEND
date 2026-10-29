import {randomUUID} from 'node:crypto';
import {resolveSlideCount} from '../ai/slideCount.mjs';
import {MAX_SOURCE_CHARACTERS} from './sourceLimits.mjs';
export function normalizeGenerationInput(kind,source,artifactType,context={},requestId=randomUUID()){
 if(!['prompt','url','file'].includes(kind)||!['presentation','webpage','document'].includes(artifactType)||typeof source!=='string'||!source.trim()||source.length>MAX_SOURCE_CHARACTERS)throw Object.assign(new Error('Unsupported or invalid generation input.'),{code:'INVALID_GENERATION_INPUT',stage:'input-processing'});
 return {requestId,artifactType,inputKind:kind,source:{text:source,trust:kind==='prompt'?'user-instruction':'untrusted-source-data'},instructions:kind==='prompt'?source:context.instructions||'',hints:{topic:context.topic||'',audience:context.audience||'',tone:context.tone||'',sectionCount:context.sectionCount??null,pageCount:context.pageCount??null,wordCount:context.wordCount??null,...(artifactType==='presentation'?{slideCount:resolveSlideCount(kind==='prompt'?source:'',context)}:{}),designPreferences:structuredClone(context.designPreferences||{})},constraints:{preserveSourceMeaning:true,allowSourceInstructionOverride:false}};
}
