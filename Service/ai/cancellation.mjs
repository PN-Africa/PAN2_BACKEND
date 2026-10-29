export function abortReason(signal){return signal?.reason||Object.assign(new Error('AI request cancelled'),{code:'AI_REQUEST_CANCELLED'});}
// Reject promptly even if an injected transport ignores signals. Consume its
// eventual settlement so no late result can enter validation or generation.
export function abortable(invoke,signal){
 if(signal?.aborted)return Promise.reject(abortReason(signal));
 if(!signal)return Promise.resolve().then(invoke);
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error,value)=>{if(done)return;done=true;signal.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
  const cancel=()=>finish(abortReason(signal));signal.addEventListener('abort',cancel,{once:true});
  Promise.resolve().then(()=>{if(signal.aborted)throw abortReason(signal);return invoke();}).then(value=>finish(null,value),error=>finish(error));
 });
}
