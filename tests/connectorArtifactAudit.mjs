import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import sharp from 'sharp';
import {generateService} from '../Service/generateService.mjs';
import {stakeholderDeck,stakeholderCases} from './fixtures/stakeholderCases.mjs';
import {fixtures} from './fixtures/presentationContent.mjs';
import {segmentOverlap} from '../renderer/presentation/visuals/connectorRouting.mjs';
const root=path.resolve(process.argv[2]||'generated/connector-artifacts'),reports=[];await fs.mkdir(root,{recursive:true});
export async function pptxLines(file,slide=4){
 const zip=await JSZip.loadAsync(await fs.readFile(file)),xml=await zip.file(`ppt/slides/slide${slide}.xml`).async('string');
 const shapes=[...xml.matchAll(/<p:(sp|cxnSp)\b[\s\S]*?<\/p:\1>/g)].map(m=>m[0]),lines=[];
 for(const shape of shapes){if(!/<a:prstGeom prst="line"/.test(shape))continue;const origin=shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"/),extent=shape.match(/<a:ext cx="(\d+)" cy="(\d+)"/);if(!origin||!extent)continue;const [x,y,w,h]=[origin[1],origin[2],extent[1],extent[2]].map(n=>Number(n)/914400);lines.push({x1:x,y1:y,x2:x+w,y2:y+h});}
 let overlaps=0;for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++)if(segmentOverlap(lines[i],lines[j])>1e-5)overlaps++;
 return {segments:lines.length,overlappingPairs:overlaps,xml,zip};
}
const before=await pptxLines(path.resolve('generated/connector-artifacts/before.pptx'));assert.ok(before.overlappingPairs>0,'Existing reproduction must exhibit overlapping source PPTX lines');
const photos=await Promise.all(['computing-cern.jpg','computing-electronics.jpg'].map(async(file,i)=>({slideNumber:i+1,buffer:await fs.readFile('assets/webpage/curated/'+file),description:'Computing research and electronic systems',source:'Controlled licensed fixture',creator:'Regression fixture',license:'Local test fixture'})));
for(const appearance of ['dark','light']){
 const deck=stakeholderDeck(stakeholderCases.ai);deck.slides[0].content.titleContent.supportingText='Learning from examples.';
 deck.slides[3]={slideNumber:4,slideType:'text-visual',title:'Evidence and conceptual models',subtitle:'',objective:'Explain an illustrative evidence pathway',content:{visualContent:{text:'An illustrative pathway links evidence and review.',visual:{type:'diagram',description:'A conceptual evidence pathway',searchQuery:'',diagram:{kind:'flowchart',nodes:['a','b','c','d'].map((id,i)=>({id,label:['Observe','Model','Review','Decide'][i],description:i===1?'Models relationships.':'Check evidence'})),edges:[{from:'a',to:'b',label:''},{from:'b',to:'c',label:''},{from:'c',to:'d',label:''}],caption:'Simplified model.'}}}}};
 for(const [i,type,key] of [[6,'timeline','timeline'],[7,'data-chart','chart'],[8,'statistics','statistics']])deck.slides[i]={slideNumber:i+1,slideType:type,title:type==='data-chart'?'Illustrative comparison':type==='timeline'?'A review timeline':'Illustrative review figures',subtitle:'',content:{[key]:structuredClone(fixtures[key])}};
 const start=performance.now(),r=await generateService('prompt','Create a professional ten-slide briefing using the supplied illustrative review figures: 12 files, 8 reviewed.','presentation',{slideCount:10,designPreferences:{appearance,noImageSlideNumbers:[3,4,5,6,7,8,9,10]}},{completedContent:{outputType:'presentation',generatedContent:deck},prefetchImages:false,visuals:{external:false,providers:{},userAssets:photos,diagramPlanner:false,cacheRoot:path.join(root,'assets'),layoutLogger:()=>{}},preview:{outputDirectory:path.join(root,'previews')}});
 assert.ok(['completed','completed_with_warnings'].includes(r.status),r.status);assert.equal(r.preview.stages.pdf,'completed');assert.equal(r.preview.stages.png,'completed');assert.equal(r.preview.slides.length,10);
 const files=r.preview.files;for(const [name,source] of [['pptx',files.pptxPath],['pdf',files.pdfPath],['png',path.join(files.slidesDirectory,'slide-4.png')]])await fs.copyFile(source,path.join(root,appearance+'.'+name));
 const source=await pptxLines(files.pptxPath);assert.equal(source.overlappingPairs,0);assert.ok(Object.keys(source.zip.files).some(name=>name.startsWith('ppt/charts/')));assert.ok(source.xml.includes('Models relationships.'));
 const thumbs=await Promise.all(Array.from({length:10},async(_,i)=>({input:await sharp(path.join(files.slidesDirectory,`slide-${i+1}.png`)).resize(480,270).png().toBuffer(),left:i%2*480,top:Math.floor(i/2)*270})));await sharp({create:{width:960,height:1350,channels:3,background:'#fff'}}).composite(thumbs).png().toFile(path.join(root,appearance+'-contact.png'));
 reports.push({appearance,status:'passed',elapsedMs:Math.round(performance.now()-start),slides:10,pptxLineSegments:source.segments,pptxOverlappingLinePairs:source.overlappingPairs,pdf:r.preview.stages.pdf,png:r.preview.stages.png,previewId:r.preview.previewId});
}
await fs.writeFile(path.join(root,'report.json'),JSON.stringify({before:{pptxLineSegments:before.segments,pptxOverlappingLinePairs:before.overlappingPairs},after:reports},null,2));console.log('[CONNECTOR_AUDIT]',JSON.stringify(reports));
