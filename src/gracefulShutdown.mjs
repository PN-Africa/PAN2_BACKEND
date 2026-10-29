import {terminateRenderProcesses,renderProcessCount} from '../Service/renderProcesses.mjs';
export function installGracefulShutdown({server,quiesce=async()=>{},disconnect=async()=>{},beginDrain=()=>{},processControl=process,timeoutMs=25000,logger=entry=>console.info('[LIFECYCLE]',JSON.stringify(entry))}){
 let stopping;
 const shutdown=signal=>stopping??=(async()=>{
  const started=Date.now();beginDrain();logger({phase:'draining',signal,renderChildren:renderProcessCount()});
  const closed=new Promise(resolve=>server.close(resolve));let timer;
  try{await Promise.race([Promise.all([closed,quiesce({timeoutMs})]),new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);}
  finally{clearTimeout(timer);await terminateRenderProcesses();server.closeAllConnections?.();
   let disconnectTimer;await Promise.race([Promise.resolve().then(disconnect).catch(()=>{}),new Promise(resolve=>{disconnectTimer=setTimeout(resolve,2000);})]);clearTimeout(disconnectTimer);
   logger({phase:'stopped',signal,elapsedMs:Date.now()-started,renderChildren:renderProcessCount()});processControl.exit(0);
  }
 })();
 processControl.once('SIGTERM',()=>shutdown('SIGTERM'));processControl.once('SIGINT',()=>shutdown('SIGINT'));return shutdown;
}
