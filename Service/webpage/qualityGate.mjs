import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {trackedFork as fork} from '../renderProcesses.mjs';
import {fileURLToPath} from 'node:url';
import {validateStaticWebsite} from '../webpageStaticValidator.mjs';
import {inspectDesignCompleteness} from './designQuality.mjs';
let browserBusy=false;
const repairCss='\n/* Bounded responsive containment repair */\n.hero-grid,.section-layout,.card-grid,.project-grid,.collection-grid{min-width:0}.hero-copy,.section-body,article{min-width:0;overflow-wrap:anywhere}.nav{overflow-wrap:anywhere}.brand{max-width:36%}@media(max-width:820px){.hero-grid,.section-layout{grid-template-columns:minmax(0,1fr)}.nav{max-width:100%}}\n';

async function browserAudit(files,options){
    const root=path.resolve(options.root||'generated/webpage-qa'),directory=path.join(root,randomUUID());
    await fs.mkdir(directory,{recursive:true});
    for(const [name,content] of Object.entries(files)){
        const destination=path.resolve(directory,'site',name);
        if(!destination.startsWith(path.join(directory,'site')+path.sep))throw new Error('Invalid QA path');
        await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,content);
    }
    return new Promise((resolve,reject)=>{
        const worker=fork(fileURLToPath(new URL('./qualityWorker.mjs',import.meta.url)),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
        const timer=setTimeout(()=>{worker.kill();reject(new Error('Browser QA exceeded its deadline'));},45000);
        worker.once('message',result=>{clearTimeout(timer);worker.disconnect();if(result.error)reject(new Error(result.error));else resolve(result);});
        worker.once('error',error=>{clearTimeout(timer);reject(error);});
        worker.once('exit',()=>{clearTimeout(timer);reject(new Error('Browser QA worker exited before a report'));});
        worker.send({directory,pages:Object.keys(files).filter(name=>name.endsWith('.html'))});
    }).finally(async()=>{if(process.env.LEDIFY_RETAIN_QA_ARTIFACTS==='true')return;try{await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:50});}catch{console.warn('[QA_CLEANUP]',JSON.stringify({errorCode:'QA_TEMP_CLEANUP_FAILED'}));}});
}

export async function inspectWebsite(files,options={}){
    const staticResult=validateStaticWebsite(files),warnings=[];
    const designCompleteness=inspectDesignCompleteness(files);
    if(designCompleteness.issues.length)warnings.push({code:'WEBPAGE_DESIGN_REVIEW_REQUIRED',message:'Objective visual completeness checks require review.',issues:designCompleteness.issues});
    let report={static:'passed',designCompleteness,browser:'not-run',repairAttempts:0,subjectiveReview:'required'};
    if(!options.runner && process.env.WEBPAGE_BROWSER_QA!=='true')return {files,report,warnings};
    if(browserBusy)return {files,report:{...report,browser:'skipped-capacity'},warnings:[{code:'WEBPAGE_BROWSER_QA_BUSY',message:'Browser QA capacity is occupied; static validation passed.'}]};
    browserBusy=true;
    try{
        const runner=options.runner||browserAudit;
        for(let attempt=0;attempt<2;attempt++){
            const result=await runner(files,options);
            report={...report,browser:result.failures.length?'failed':'passed',checks:result.checks,failures:result.failures,repairAttempts:attempt};
            if(!result.failures.length)break;
            if(attempt||result.failures.some(f=>!['overflow','overlap','clipped'].includes(f.code)))break;
            files={...files,'style.css':files['style.css']+repairCss};validateStaticWebsite(files);
        }
        if(report.browser==='failed')warnings.push({code:'WEBPAGE_BROWSER_QA_FAILED',message:'Browser checks still require review after bounded repair.',failures:report.failures});
    }catch{report.browser='unavailable';warnings.push({code:'WEBPAGE_BROWSER_QA_UNAVAILABLE',message:'Browser QA could not run. Install the development browser tooling and Chromium/Edge in a separate QA environment; static checks passed.'});}
    finally{browserBusy=false;}
    return {files,report:{...report,images:staticResult.quality.images},warnings};
}
