import {createGenerationCapacity} from '../generationCapacity.mjs';
export const inputAdmission=Symbol('input-admission');
export const inputCapacity=createGenerationCapacity({concurrency:2,maxWaiting:32,waitMs:120000});
// Hold incoming bodies under transport backpressure until a parsing/extraction
// slot exists. Release before AI work so parsing does not serialize generation.
export async function admitGenerationInput(req,res,next){
 const controller=new AbortController(),started=performance.now();
 const abort=()=>controller.abort();res.once('close',abort);
 try{
  const releaseSlot=await inputCapacity.acquire({signal:controller.signal});let released=false;
  const release=()=>{if(released)return;released=true;releaseSlot();res.removeListener('close',abort);};
  req[inputAdmission]={release,signal:controller.signal,waitMs:Math.round(performance.now()-started)};
  res.once('finish',release);res.once('close',release);
  if(controller.signal.aborted||res.destroyed){release();return;}
  next();
 }catch{res.removeListener('close',abort);if(res.destroyed)return;res.set('Retry-After','15');res.status(503).json({errorCode:'INPUT_CAPACITY_BUSY',stage:'input-admission',message:'Input processing capacity is occupied. Retry shortly.'});}
}
