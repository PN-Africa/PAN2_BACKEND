import {qualitySettings} from './qualityIssues.mjs';
export function presentationRepairBudget(options={}){
 const {maxRepairedSlides}=qualitySettings(options),used=new Map(),totals={targeted:0,layout:0,fallback:0,validation:0};
 // A real deck supplies its eligible content slides. One slide cannot spend
 // another slide's fallback reserve; legacy standalone callers retain two.
 const eligible=Array.isArray(options.fallbackSlideNumbers)?new Set(options.fallbackSlideNumbers.filter(n=>Number.isInteger(n)&&n>=1&&n<=12)):null;
 const limits={targeted:maxRepairedSlides,validation:4,layout:4,fallback:eligible?eligible.size:2};
 const perSlide={targeted:1,validation:1,layout:1,fallback:1};
 const availability=(slideNumber,kind)=>{
  const reason=!Object.hasOwn(limits,kind)?'UNKNOWN_REPAIR_KIND':!Number.isInteger(slideNumber)||slideNumber<1||slideNumber>12?'INVALID_SLIDE':kind==='fallback'&&eligible&&!eligible.has(slideNumber)?'SLIDE_NOT_ELIGIBLE':(used.get(slideNumber+':'+kind)||0)>=perSlide[kind]?'SLIDE_RESERVE_USED':totals[kind]>=limits[kind]?'REQUEST_LIMIT_REACHED':'AVAILABLE';
  return {allowed:reason==='AVAILABLE',reason,remaining:Object.hasOwn(limits,kind)?Math.max(0,limits[kind]-totals[kind]):0};
 };
 return {availability,claim(slideNumber,kind){if(!availability(slideNumber,kind).allowed)return false;used.set(slideNumber+':'+kind,1);totals[kind]++;return true;},snapshot:()=>({perSlide:{draftCalls:3,layoutCalls:2,validationCalls:3,targetedCalls:2,fallbackCalls:2},request:{targeted:limits.targeted,targetedCalls:limits.targeted*2,validation:limits.validation,validationCalls:limits.validation*3,layoutCalls:8,fallback:limits.fallback,fallbackCalls:limits.fallback*2},used:{...totals}})};
}
export function recoverableSlideFailure(error){
 if(error?.providerReason||/^AI_(?:PROVIDER|REQUEST|RESPONSE_BLOCKED)/.test(error?.code||''))return false;
 return ['AI_RETRY_EXHAUSTED','AI_SCHEMA_VALIDATION_FAILED','PRESENTATION_CONTENT_TOO_DENSE','PRESENTATION_LAYOUT_UNSAFE','PRESENTATION_QUALITY_FAILED','SLIDE_REPAIR_BUDGET_EXHAUSTED'].includes(error?.code);
}
