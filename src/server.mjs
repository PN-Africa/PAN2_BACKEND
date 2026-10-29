import "dotenv/config";

import mongoose from 'mongoose';
import {installGracefulShutdown} from './gracefulShutdown.mjs';
import { startBackend } from './serverLifecycle.mjs';
import {generationJobs} from '../Service/generationJobs.mjs';
import {generateService} from '../Service/generateService.mjs';
import generateModel from '../model/generateModel.mjs';
import { readServerConfig, safeStartupError, configureMongoDns, connectMongoWithRetry } from './serverConfig.mjs';


const startServer = async () => {
    try { 
        const {mongoUrl,port,host}=readServerConfig();
        configureMongoDns();
        const {server,ready,beginDrain}=startBackend({config:{port,host},connect:()=>connectMongoWithRetry(mongoUrl),recover:()=>generationJobs({generator:generateService,model:generateModel}).initialize(),databaseAvailable:()=>mongoose.connection.readyState===1,logger:phase=>console.log(phase==='listening'?`Ledify is listening on port ${port}`:'MongoDB is successfully connected; Ledify is ready')});
        server.on('error',error=>{console.error('[STARTUP]',JSON.stringify(safeStartupError(error)));process.exit(1);});
        installGracefulShutdown({server,beginDrain,quiesce:options=>generationJobs({generator:generateService,model:generateModel}).quiesce(options),disconnect:()=>mongoose.disconnect()});
        await ready;


    } catch(error) {
        console.error('[STARTUP]',JSON.stringify(safeStartupError(error)));
        process.exit(1);
    };
}



startServer();
