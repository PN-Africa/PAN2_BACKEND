import {createApp} from './app.mjs';
import {createHttpServer} from './httpServer.mjs';

// Bind before remote database discovery/retries. Generation is admitted only
// after readiness succeeds; opening a port never pretends MongoDB is ready.
export function startBackend({config,connect,recover=async()=>{},createApplication=createApp,databaseAvailable=()=>true,logger=()=>{}}){
 let connected=false;
 const server=createHttpServer(createApplication({isReady:()=>connected&&databaseAvailable()}));
 const listening=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,()=>{server.removeListener('error',reject);resolve();});});
 const ready=listening.then(async()=>{logger('listening');await connect();try{await recover();}catch(cause){throw Object.assign(new Error('Job recovery failed',{cause}),{stage:'job-recovery'});}connected=true;logger('ready');}).catch(async error=>{await new Promise(resolve=>server.close(resolve));throw error;});
 return {server,ready,beginDrain(){connected=false;}};
}
