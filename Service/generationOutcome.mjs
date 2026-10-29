// Preserve legacy polling states while exposing one consistent output outcome.
export function generationOutcome(result={}){
 const state=result.status==='incomplete'?'incomplete':result.status==='failed'?'failed':['completed_with_warnings','partial_success'].includes(result.status)?'completed_with_warnings':'complete';
 return {state,recoverable:state==='incomplete',artifactsAvailable:!!(result.preview||result.artifacts),...(result.recovery?.status==='completed_with_recovery'?{recovered:true}:{}),...(state==='incomplete'?{action:'retry-missing-assets-or-export'}:{})};
}
