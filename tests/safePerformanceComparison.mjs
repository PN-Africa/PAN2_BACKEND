import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
const root=path.resolve('generated/safe-performance-2026-10-29');
const afterPhase=process.argv[2]||'after';
const phasePath=phase=>path.join(root,phase==='after'?afterPhase:phase);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const result={method:'Nearest-rank percentiles, three coarse samples per output; mocked AI, real native exports. CPU field cpuMs in raw harness files contains microseconds and is converted here.',pipelines:{},units:{},quality:{}};
for(const phase of ['before','after']){
 const rows=JSON.parse(await fs.readFile(path.join(phasePath(phase),'pipelines.json')));assert.equal(rows.length,9);
 result.pipelines[phase]={};
 for(const type of ['presentation','webpage','document']){
  const selected=rows.filter(r=>r.result.outputType===type),times=selected.map(r=>r.result.generationMs);
  result.pipelines[phase][type]={p50:percentile(times,.5),p90:percentile(times,.9),p95:percentile(times,.95),calls:selected.map(r=>r.result.aiCalls),peakNodeRss:selected.map(r=>r.peakRssBytes),nodeCpuMs:selected.map(r=>(r.cpuMs.user+r.cpuMs.system)/1000),downloadBytes:selected.map(r=>r.result.downloads.map(d=>d.bytes)),status:selected.map(r=>r.result.status)};
 }
 const units=JSON.parse(await fs.readFile(path.join(phasePath(phase),'units.json')));result.units[phase]={};
 for(const name of ['png','web-image-twins','document-pdf-validation']){const samples=units.filter(r=>r.name===name);result.units[phase][name]={p50:percentile(samples.map(r=>r.elapsedMs),.5),p90:percentile(samples.map(r=>r.elapsedMs),.9),p95:percentile(samples.map(r=>r.elapsedMs),.95),workers:samples.map(r=>r.result.workers),peakNodeRss:samples.map(r=>r.peakRssBytes)};}
}
const baselineUnits=JSON.parse(await fs.readFile(path.join(root,'before','units.json'))),afterUnits=JSON.parse(await fs.readFile(path.join(phasePath('after'),'units.json')));
for(let i=0;i<3;i++){
 assert.deepEqual(afterUnits.filter(r=>r.name==='png')[i].result,baselineUnits.filter(r=>r.name==='png')[i].result);
 assert.deepEqual(afterUnits.filter(r=>r.name==='web-image-twins')[i].result.hashes,baselineUnits.filter(r=>r.name==='web-image-twins')[i].result.hashes);
}
result.quality.exactPngFilesAndDecodedPixels=30;result.quality.exactResponsiveImageVariants=true;
try{
 const controls=JSON.parse(await fs.readFile(path.join(root,'control-current','units.json')));result.currentConditionControl={};
 for(const name of ['png','web-image-twins','document-pdf-validation']){
  const control=controls.filter(r=>r.name===name),optimized=afterUnits.filter(r=>r.name===name),summary=rows=>({p50:percentile(rows.map(r=>r.elapsedMs),.5),p90:percentile(rows.map(r=>r.elapsedMs),.9),p95:percentile(rows.map(r=>r.elapsedMs),.95),peakNodeRss:Math.max(...rows.map(r=>r.peakRssBytes)),workers:rows.map(r=>r.result.workers)});
  result.currentConditionControl[name]={original:summary(control),optimized:summary(optimized)};
  for(let i=0;i<3;i++)if(name==='png')assert.deepEqual(control[i].result,optimized[i].result);else if(name==='web-image-twins')assert.deepEqual(control[i].result.hashes,optimized[i].result.hashes);
 }
}catch(error){if(error.code!=='ENOENT')throw error;}
async function signatures(phase,folder,file,select){
 const values=[];for(const entry of await fs.readdir(path.join(phasePath(phase),folder),{withFileTypes:true}))if(entry.isDirectory()){
  try{
   const directory=path.join(phasePath(phase),folder,entry.name),zip=await JSZip.loadAsync(await fs.readFile(path.join(directory,file)));
   let signature=await select(zip);
   if(folder==='previews'){
    const names=(await fs.readdir(path.join(directory,'slides'))).filter(n=>/^slide-\d+\.png$/.test(n)).sort();assert.equal(names.length,10);
    signature=hash(JSON.stringify({content:signature,png:await Promise.all(names.map(async n=>hash(await fs.readFile(path.join(directory,'slides',n)))))}));
   }
   values.push(signature);
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }return values;
}
const ppt=async zip=>{
 const slides=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));assert.equal(slides.length,10);
 const text=(await Promise.all(slides.map(n=>zip.file(n).async('string')))).map(xml=>xml.match(/<a:t>.*?<\/a:t>/g));
 const media=await Promise.all(Object.keys(zip.files).filter(n=>/^ppt\/media\//.test(n)&&!zip.files[n].dir).map(async n=>hash(await zip.file(n).async('nodebuffer'))));
 return hash(JSON.stringify({text,media:media.sort()}));
};
const doc=async zip=>(await zip.file('word/document.xml').async('string')).match(/<w:t[^>]*>.*?<\/w:t>/g).join('');
const web=async zip=>{const entries=[];for(const n of Object.keys(zip.files).sort())if(!zip.files[n].dir){let bytes=await zip.file(n).async('nodebuffer');if(/\.(html|css|js)$/.test(n))bytes=Buffer.from(bytes.toString().replace(/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}/gi,'ARTIFACT_ID'));entries.push([n,hash(bytes)]);}return hash(JSON.stringify(entries));};
for(const [folder,file,select] of [['previews','presentation.pptx',ppt],['documents','document.docx',doc],['websites','website.zip',web]]){
 const before=await signatures('before',folder,file,select),after=await signatures('after',folder,file,select);
 assert.equal(after.length,3);for(const signature of after)assert.ok(before.includes(signature),folder+' content/media differs from baseline');result.quality[folder]={matched:after.length};
}
await fs.writeFile(path.join(root,afterPhase==='after'?'comparison.json':'comparison-final.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
