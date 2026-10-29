import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {trackedExecFile as execFile} from '../renderProcesses.mjs';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {PDFParse} from 'pdf-parse';
import {presentationRenderQueue} from '../../renderer/presentation/renderQueue.mjs';
const execute=promisify(execFile),pending=new Map();
const validated=new Map();
const unavailable=()=>Object.assign(new Error('PDF export is temporarily unavailable. The Word download remains available. Retry or ask the service owner to check LibreOffice Writer.'),{code:'DOCUMENT_PDF_UNAVAILABLE',stage:'document-export',status:503});
export async function validateDocumentPdf(buffer){
    if(!Buffer.isBuffer(buffer)||buffer.length<100||buffer.subarray(0,5).toString()!=='%PDF-')throw unavailable();
    // Hash every byte: a changed or corrupt download must pass the parser again.
    // Retain only small successful validation summaries, never document text.
    const key=createHash('sha256').update(buffer).digest('hex'),now=Date.now();
    for(const [digest,entry] of validated)if(entry.expires<=now)validated.delete(digest);
    const cached=validated.get(key);if(cached)return {...cached.result};
    const parser=new PDFParse({data:buffer});
    try{
        const result=await parser.getText();if(!result.total||!result.text?.trim())throw unavailable();
        const summary={status:'passed',pages:result.total,characters:result.text.trim().length};
        if(validated.size>=32)validated.delete(validated.keys().next().value);
        validated.set(key,{expires:Date.now()+60000,result:summary});return {...summary};
    }finally{await parser.destroy();}
}
// Always convert the same saved DOCX used by the Word download. GET requests
// coalesce per document and reuse a validated PDF; failures preserve DOCX.
export async function ensureDocumentPdf(directory,{convert}={}){
    directory=path.resolve(directory);
    if(pending.has(directory))return pending.get(directory);
    const task=(async()=>{
        const pdfPath=path.join(directory,'document.pdf');
        try{const validation=await validateDocumentPdf(await fs.readFile(pdfPath));return {pdfPath,validation,cacheHit:true};}catch{}
        let release,work,profile;
        try{
            release=await presentationRenderQueue.acquire();
            work=path.join(directory,'.pdf-'+randomUUID());await fs.mkdir(work,{recursive:true});
            if(convert)await convert({docxPath:path.join(directory,'document.docx'),pdfPath:path.join(work,'document.pdf'),workingDirectory:work});
            else{
                // Keep native profile paths short: nested artifact roots can
                // exceed Writer's Windows path limits during profile creation.
                profile=await fs.mkdtemp(path.join(os.tmpdir(),'ld-pdf-'));
                await execute(process.env.LIBREOFFICE_PATH||(process.platform==='win32'?'C:\\Program Files\\LibreOffice\\program\\soffice.exe':'libreoffice'),[
                    '-env:UserInstallation='+pathToFileURL(profile).href,'--headless','--convert-to','pdf:writer_pdf_Export','--outdir',work,path.join(directory,'document.docx')
                ],{windowsHide:true,timeout:60000,maxBuffer:1024*1024});
            }
            const output=await fs.readFile(path.join(work,'document.pdf')),validation=await validateDocumentPdf(output);
            await fs.rename(path.join(work,'document.pdf'),pdfPath);
            return {pdfPath,validation,cacheHit:false};
        }catch(error){console.error('[DOCUMENT_EXPORT]',JSON.stringify({status:'failed',errorCode:'DOCUMENT_PDF_UNAVAILABLE',reasonCode:typeof error.code==='string'?error.code:error.name||'CONVERSION_FAILED',...(Number.isInteger(error.code)?{nativeExitCode:error.code}:{})}));throw Object.assign(unavailable(),{cause:error});}
        finally{release?.();if(work)await fs.rm(work,{recursive:true,force:true}).catch(()=>{});if(profile&&path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('ld-pdf-'))await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});}
    })();pending.set(directory,task);
    try{return await task;}finally{pending.delete(directory);}
}
