import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {monitorEventLoopDelay,performance as nodePerformance} from 'node:perf_hooks';
import {containerResources} from './runtimeResources.mjs';
import {AiGenerationError} from './ai/responseValidation.mjs';
const precise=value=>Math.round(value*1000)/1000;
const storage=new AsyncLocalStorage();
export const performanceRequestId=()=>storage.getStore()?.id;
export const generationSignal=()=>storage.getStore()?.generationController?.signal;
export function checkGenerationDeadline(){
    const state=storage.getStore();if(!state)return;
    if(Date.now()>=state.deadline&&!state.generationController.signal.aborted)state.generationController.abort(new AiGenerationError('GENERATION_TIMEOUT','The overall generation time budget was exhausted.',{stage:'generation',requestId:state.id}));
    state.generationController.signal.throwIfAborted();
}
export function reservePerformanceBudget(name,limit){
    const state=storage.getStore();if(!state)return undefined;
    state.budgets??=new Map();const used=state.budgets.get(name)||0;
    if(used>=limit)return false;state.budgets.set(name,used+1);return true;
}
export function performanceReport(){
    const state=storage.getStore();if(!state)return undefined;
    const cpu=process.cpuUsage(state.cpu),loop=nodePerformance.eventLoopUtilization(state.loop);
    const ai=structuredClone(state.ai);
    for(const pending of state.pendingAi||[]){const elapsed=performance.now()-pending.started;ai.elapsedMs+=elapsed;ai.stages[pending.stage].elapsedMs+=elapsed;}
    return {requestId:state.id,totalMs:precise(performance.now()-state.started),stages:state.stages,ai,
        processCpuMs:{user:cpu.user/1000,system:cpu.system/1000},eventLoop:{utilization:loop.utilization,p95DelayMs:precise(state.delay.percentile(95)/1e6),maxDelayMs:precise(state.delay.max/1e6)},
        memory:{startRssBytes:state.startRss,peakRssBytes:state.peakRss,endRssBytes:process.memoryUsage().rss},runtime:state.runtime};
}
export function beginAiAttempt(entry){
    const state=storage.getStore();if(!state)return;
    const stage=state.ai.stages[entry.stage]??={calls:0,completedCalls:0,failedCalls:0,inFlightCalls:0,retries:0,elapsedMs:0,promptTokens:0,outputTokens:0,totalTokens:0};
    for(const target of [state.ai,stage]){target.calls++;target.retries+=entry.attempt>1?1:0;target.inFlightCalls=(target.inFlightCalls||0)+1;target.peakInFlightCalls=Math.max(target.peakInFlightCalls||0,target.inFlightCalls);}
    const ticket={state,stage:entry.stage,started:performance.now(),finished:false};(state.pendingAi??=new Set()).add(ticket);return ticket;
}
export function recordAiAttempt(entry,ticket){
    if(ticket?.finished)return;
    const state=ticket?.state||storage.getStore();if(!state)return;
    if(ticket){ticket.finished=true;state.pendingAi.delete(ticket);}
    const stage=state.ai.stages[entry.stage]??={calls:0,completedCalls:0,failedCalls:0,inFlightCalls:0,retries:0,elapsedMs:0,promptTokens:0,outputTokens:0,totalTokens:0};
    for(const target of [state.ai,stage]){
        if(!ticket){target.calls++;target.retries+=entry.attempt>1?1:0;}
        else target.inFlightCalls=Math.max(0,(target.inFlightCalls||0)-1);
        if(entry.status==='completed')target.completedCalls=(target.completedCalls||0)+1;
        if(entry.status==='failed')target.failedCalls=(target.failedCalls||0)+1;
        if(entry.status==='failed'&&!entry.usage)target.usageUnknownCalls=(target.usageUnknownCalls||0)+1;
        target.elapsedMs+=entry.elapsedMs||0;
        for(const key of ['queueWaitMs','providerMs','validationMs'])target[key]=(target[key]||0)+(entry[key]||0);
        target.promptTokens+=entry.usage?.promptTokenCount||0;target.outputTokens+=entry.usage?.candidatesTokenCount||0;target.totalTokens+=entry.usage?.totalTokenCount||0;
        for(const [key,usageKey] of [['cacheReadTokens','cacheReadInputTokens'],['cacheWriteTokens','cacheCreationInputTokens']])target[key]=(target[key]||0)+(entry.usage?.[usageKey]||0);
        if(entry.provider==='anthropic'&&entry.model==='claude-opus-5-5')target.estimatedCostUsd=(target.estimatedCostUsd||0)+((entry.usage?.promptTokenCount||0)*4+(entry.usage?.candidatesTokenCount||0)*20+(entry.usage?.cacheReadInputTokens||0)*.2+(entry.usage?.cacheCreationInputTokens||0)*5)/1000000;
    }
    state.onProgress?.({stage:entry.stage,status:entry.status,slideNumber:entry.slideNumber,sectionId:entry.sectionId,attempt:entry.attempt});
}
export async function measureStage(name,fn,{sharedOperation=false}={}){
    const state=storage.getStore();if(!state)return fn();
    if(!sharedOperation)checkGenerationDeadline();
    const started=performance.now();state.onProgress?.({stage:name,status:'processing'});
    const log=status=>state.stageLogger({requestId:state.id,...(state.outputType?{outputType:state.outputType}:{}),stage:/^[a-zA-Z0-9_-]{1,100}$/.test(name)?name:'generation-stage',status,elapsedMs:precise(performance.now()-started)});
    log('started');
    try{const value=await fn();if(!sharedOperation)checkGenerationDeadline();state.onProgress?.({stage:name,status:'completed'});log('completed');return value;}
    catch(error){state.onProgress?.({stage:name,status:'failed'});log('failed');throw error;}
    finally{const metric=state.stages[name]??={calls:0,elapsedMs:0};metric.calls++;metric.elapsedMs=precise(metric.elapsedMs+performance.now()-started);}
}
export async function profileGeneration(fn,options={}){
    if(storage.getStore()&&!options.forceNew)return fn();
    const timeoutMs=Number(options.timeoutMs??process.env.LEDIFY_GENERATION_TIMEOUT_MS??600000);
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>1800000)throw Object.assign(new Error('LEDIFY_GENERATION_TIMEOUT_MS must be an integer from 1 to 1800000.'),{code:'INVALID_GENERATION_TIMEOUT'});
    const delay=monitorEventLoopDelay({resolution:20});delay.enable();
    const state={id:options.requestId||randomUUID(),outputType:options.outputType,stageLogger:options.stageLogger|| (entry=>console.info('[GENERATION_STAGE]',JSON.stringify(entry))),started:performance.now(),cpu:process.cpuUsage(),loop:nodePerformance.eventLoopUtilization(),delay,startRss:process.memoryUsage().rss,peakRss:0,stages:{},onProgress:options.onProgress,
        ai:{calls:0,completedCalls:0,failedCalls:0,inFlightCalls:0,retries:0,elapsedMs:0,promptTokens:0,outputTokens:0,totalTokens:0,stages:{}}};
    state.peakRss=state.startRss;state.deadline=Date.now()+timeoutMs;state.generationController=new AbortController();
    const resourceStart=process.resourceUsage();state.runtime={containerStart:await containerResources()};
    return storage.run(state,async()=>{
        const deadlineTimer=setTimeout(()=>state.generationController.abort(new AiGenerationError('GENERATION_TIMEOUT','The overall generation time budget was exhausted.',{stage:'generation',requestId:state.id})),timeoutMs);deadlineTimer.unref();
        const timer=setInterval(()=>{state.peakRss=Math.max(state.peakRss,process.memoryUsage().rss);},100);timer.unref();
        let sampling=false;const containerTimer=setInterval(async()=>{if(sampling)return;sampling=true;try{const sample=await containerResources();if(sample.available)state.runtime.sampledContainerPeakBytes=Math.max(state.runtime.sampledContainerPeakBytes||0,sample.memoryBytes||0);}finally{sampling=false;}},1000);containerTimer.unref();
        try{return await fn();}finally{
            clearTimeout(deadlineTimer);clearInterval(timer);clearInterval(containerTimer);state.peakRss=Math.max(state.peakRss,process.memoryUsage().rss);
            const resourceEnd=process.resourceUsage();state.runtime.containerEnd=await containerResources();state.runtime.processIoBlocks={read:resourceEnd.fsRead-resourceStart.fsRead,write:resourceEnd.fsWrite-resourceStart.fsWrite};
            const report=performanceReport();delay.disable();await options.onReport?.(report);
            (options.logger||((report)=>console.info('[PERF]',JSON.stringify(report))))(report);
        }
    });
}
