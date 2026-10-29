import {createHash} from 'node:crypto';
export const qualityHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20);
export function qualityIssue(issue){
 const target=typeof issue.repairTarget==='string'&&/^(?:title|subtitle|content(?:\.[A-Za-z0-9_]+|\[\d+\])*)$/.test(issue.repairTarget)?issue.repairTarget:'content';
 const category=['IMAGE','LAYOUT'].includes(issue.code)?issue.code.toLowerCase():issue.code==='METADATA'||['title','subtitle'].includes(target)?'metadata':'content';
 return {slideNumber:issue.slideNumber,code:issue.code,category,severity:issue.severity,repairTarget:target,fingerprint:qualityHash([issue.slideNumber,issue.code,category,target]),description:({FACTUAL:'A factual claim needs correction against the available evidence.',COVERAGE:'A requested subject lacks adequate visible coverage.',DEPTH:'The visible explanation needs more substantive detail.',CLARITY:'The visible explanation needs clarification.',REPETITION:'The content repeats information without adding meaning.',CONCLUSION:'The ending needs to synthesize the supplied material.',REFERENCE:'A reference requires verification.',METADATA:'Slide title or subtitle metadata needs correction.',IMAGE:'An image requirement must be checked during asset resolution.',LAYOUT:'A layout requirement must be checked during rendering.'})[issue.code]||'A quality requirement needs review.',assessmentHash:qualityHash([issue.message,issue.repairInstruction])};
}
export function qualitySettings(options={},env=process.env){
 const bounded=(v,f,max)=>v===undefined?f:Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):f;
 return {maxRepairRounds:bounded(options.qualityRepairRounds??env.PRESENTATION_QUALITY_MAX_REPAIR_ROUNDS,1,2),maxRepairedSlides:bounded(options.qualityRepairSlides??env.PRESENTATION_QUALITY_MAX_REPAIRED_SLIDES,4,12)};
}
