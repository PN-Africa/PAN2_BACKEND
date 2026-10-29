import {execFile,fork} from 'node:child_process';
const children=new Set();
function own(child){children.add(child);const release=()=>children.delete(child);child.once('close',release);child.once('error',release);return child;}
export function trackedExecFile(...args){return own(execFile(...args));}
export function trackedFork(...args){return own(fork(...args));}
export const renderProcessCount=()=>children.size;
export async function terminateRenderProcesses({graceMs=1000}={}){
 const owned=[...children];for(const child of owned)child.kill('SIGTERM');
 if(!owned.length)return;
 await new Promise(resolve=>setTimeout(resolve,graceMs));
 for(const child of owned)if(children.has(child))child.kill('SIGKILL');
}
