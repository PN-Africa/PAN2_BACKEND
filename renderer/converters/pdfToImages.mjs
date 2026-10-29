import fs from 'node:fs/promises';
import path from 'node:path';
import {trackedFork as fork} from '../../Service/renderProcesses.mjs';
import { fileURLToPath } from 'node:url';
import {trackedExecFile as execFile} from '../../Service/renderProcesses.mjs';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {ppmToPng} from './ppmPng.mjs';
const execute=promisify(execFile);

// Isolate PDF.js globals from the incompatible canvas used by PDF extraction.
export async function convertPdfToImages({ pdfPath, outputDirectory, timeoutMs = 120000, engine = process.env.LEDIFY_PDF_ENGINE || 'auto' }) {
    if (typeof pdfPath !== 'string' || !pdfPath) throw new Error('PDF file path is required');
    if (typeof outputDirectory !== 'string' || !outputDirectory) throw new Error('Preview output directory is required');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Preview timeout must be positive');
    if(!['auto','poppler','pdfjs'].includes(engine))throw Object.assign(new Error('Unsupported PDF rasterization engine'),{code:'PNG_RENDERER_CONFIGURATION',stage:'png'});
    await fs.access(pdfPath);
    await fs.mkdir(outputDirectory, { recursive: true });
    if(engine==='auto'||engine==='poppler'){
        const started=Date.now();
        const prefix='render-'+randomUUID(),outputPrefix=path.join(path.resolve(outputDirectory),prefix);
        const fast=process.env.LEDIFY_PNG_ENCODING!=='poppler';
        try{
            await execute(process.env.PDFTOPPM_PATH || 'pdftoppm',[...(fast?[]:['-png']),'-r','144',path.resolve(pdfPath),outputPrefix],{timeout:timeoutMs,windowsHide:true,maxBuffer:1024*1024});
            const extension=fast?'ppm':'png';
            const files=(await fs.readdir(outputDirectory)).filter(name=>name.startsWith(prefix+'-') && name.endsWith('.'+extension))
                .sort((a,b)=>Number(a.match(/-(\d+)\./)[1])-Number(b.match(/-(\d+)\./)[1]));
            if(!files.length)throw new Error('PDF contains no rendered pages');
            const images=[];
            for(const [i,name] of files.entries()){
                const fileName=`slide-${i+1}.png`,filePath=path.join(path.resolve(outputDirectory),fileName);
                if(Date.now()-started>=timeoutMs)throw Object.assign(new Error('PNG encoding deadline exceeded'),{killed:true});
                if(fast){await fs.writeFile(filePath,await ppmToPng(await fs.readFile(path.join(outputDirectory,name))));await fs.unlink(path.join(outputDirectory,name));}
                else await fs.rename(path.join(outputDirectory,name),filePath);
                const buffer=await fs.readFile(filePath);
                if(buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Rasterizer returned an invalid PNG');
                images.push({slideNumber:i+1,fileName,filePath});
            }
            return images;
        }catch(error){
            if(engine==='auto'&&error.code==='ENOENT'){
                const remaining=timeoutMs-(Date.now()-started);
                if(remaining<=0)throw Object.assign(new Error('PNG preview rendering timed out'),{code:'PNG_RENDER_TIMEOUT',stage:'png',pageNumber:1});
                console.warn('[PNG] Poppler executable is unavailable; using the isolated PDF.js renderer.');
                return convertPdfToImages({pdfPath,outputDirectory,timeoutMs:remaining,engine:'pdfjs'});
            }
            throw Object.assign(new Error(error.killed?'PNG preview rendering timed out':error.code==='ENOENT'?'PNG rendering requires Poppler pdftoppm on PATH or PDFTOPPM_PATH':'PNG rendering failed: the PDF could not be rasterized'),{
                code:error.killed?'PNG_RENDER_TIMEOUT':error.code==='ENOENT'?'PNG_RENDERER_UNAVAILABLE':'PNG_RENDER_FAILED',
                stage:'png',pageNumber:1,renderer:'poppler',cause:error
            });
        }finally{
            // Only this invocation's random-prefix raw pages are temporary.
            if(fast)for(const name of await fs.readdir(outputDirectory).catch(()=>[]))if(name.startsWith(prefix+'-')&&name.endsWith('.ppm'))await fs.unlink(path.join(outputDirectory,name)).catch(()=>{});
        }
    }
    return new Promise((resolve, reject) => {
        const worker = fork(fileURLToPath(new URL('./pdfToImagesWorker.mjs', import.meta.url)),
            [JSON.stringify({pdfPath:path.resolve(pdfPath),outputDirectory:path.resolve(outputDirectory)})],
            {execArgv:[],windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
        worker.stderr?.resume();
        let result;
        let failure;
        const timer = setTimeout(() => {
            failure = new Error('PNG preview rendering timed out');
            failure.code = 'PNG_RENDER_TIMEOUT';
            failure.stage = 'png';
            worker.kill();
        }, timeoutMs);
        worker.on('message', message => {
            if (message.error) {
                failure = new Error(message.error.message);
                failure.code = 'PNG_RENDER_FAILED';
                failure.stage = 'png';
                failure.pageNumber = message.error.pageNumber;
            } else result = message.images;
        });
        worker.on('error', error => { failure = Object.assign(new Error('PNG rendering worker could not start'),{code:'PNG_WORKER_FAILED',stage:'png',cause:error}); });
        worker.on('exit', (code,signal) => {
            clearTimeout(timer);
            if (failure) reject(failure);
            else if (code !== 0 || !result?.length) reject(Object.assign(new Error('PNG worker exited without previews'),{code:'PNG_WORKER_FAILED',stage:'png',renderer:'pdfjs',exitCode:code,signal}));
            else resolve(result);
        });
    });
}
