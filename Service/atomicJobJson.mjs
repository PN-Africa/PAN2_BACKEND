import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export async function atomicJobJson(file,value,{io=fs,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,onRetry=()=>{}}={}){
 const text=JSON.stringify(value),temp=file+'.'+randomUUID()+'.tmp',started=now();
 try{await io.writeFile(temp,text);for(let attempt=0;;attempt++){
  try{await io.rename(temp,file);return text;}catch(error){
   if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=24||now()-started>=5000)throw error;
   onRetry({attempt:attempt+1,errorCode:error.code});
   await sleep(Math.min(250,10*2**Math.min(attempt,5))+(attempt%3)*7);
  }
 }}finally{await io.unlink(temp).catch(()=>{});}
}
