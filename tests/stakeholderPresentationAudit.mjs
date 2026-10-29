import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import sharp from 'sharp';
import {stakeholderCases,stakeholderDeck} from './fixtures/stakeholderCases.mjs';
import {presentationLayoutService} from '../Service/presentationLayoutService.mjs';
import {presentationThemeService} from '../Service/presentationThemeService.mjs';
import {presentationRendererService} from '../Service/presentationRendererService.mjs';
import {resolvePresentationVisuals} from '../Service/visual/presentationVisuals.mjs';
import {previewRenderer} from '../renderer/presentation/previewRenderer.mjs';
import {slideSurfacePlan} from '../Service/design/colorSystem.mjs';
import {prepareSlideSurfaces} from '../renderer/presentation/backgrounds.mjs';
import {profileGeneration} from '../Service/performance.mjs';
const mode=process.argv[2]||'after',root=path.resolve('generated/stakeholder-presentations',mode);await fs.mkdir(root,{recursive:true});const reports=[];
for(const [name,c] of Object.entries(stakeholderCases)){
 const started=performance.now(),deck=stakeholderDeck(c),context={instructions:'Use a cover photograph and text-only supporting slides.',designPreferences:{noImageSlideNumbers:[2,3,4,5,6,7,8,9,10]}};
 let metrics;
 const result=await profileGeneration(async()=>{
  let presentation=presentationRendererService(presentationThemeService(presentationLayoutService(deck),context));
  if(mode==='baseline')presentation.design.uniformBackground=true;
  presentation=await resolvePresentationVisuals(presentation,context,{external:false,cacheRoot:path.join(root,'cache'),userAssets:[{slideNumber:1,buffer:await fs.readFile('assets/webpage/curated/'+c.image),description:c.topic,source:'Controlled licensed fixture',creator:'Regression fixture',license:'Local test fixture'}]});
  const preview=await previewRenderer(presentation,{outputDirectory:path.join(root,'artifacts')});return {presentation,preview};
 },{outputType:'presentation',logger:()=>{},stageLogger:()=>{},onReport:value=>{metrics=value;}});
 const {presentation,preview}=result;assert.equal(preview.stages.pdf,'completed');assert.equal(preview.stages.png,'completed');assert.equal(preview.slides.length,10);
 const directory=preview.files.previewDirectory,pptxPath=path.join(directory,'presentation.pptx');
 const files=await fs.readdir(directory),pptx=await fs.readFile(path.join(directory,files.find(file=>file.endsWith('.pptx')))),zip=await JSZip.loadAsync(pptx);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,10);
 const slidesDirectory=preview.files.slidesDirectory;const cover=path.join(slidesDirectory,'slide-1.png');await fs.copyFile(cover,path.join(root,name+'-cover.png'));await fs.copyFile(path.join(slidesDirectory,'slide-10.png'),path.join(root,name+'-closing.png'));
 const views=await prepareSlideSurfaces(presentation,presentation.design.tokens),pixelEvidence=[];
 for(const [index,view] of views.entries()){const image=sharp(path.join(slidesDirectory,`slide-${index+1}.png`)),info=await image.metadata();const rgb=[...(await image.extract({left:Math.floor(info.width*.015),top:Math.floor(info.height*.7),width:1,height:1}).removeAlpha().raw().toBuffer())];const expected=view.tokens.colors.background.replace('#','').match(/../g).map(v=>parseInt(v,16));if(!view.slideData.surfaceArt&&!view.slideData.photoAsset)assert.ok(rgb.every((value,i)=>Math.abs(value-expected[i])<16),`Slide ${index+1} background differs from its resolved surface`);pixelEvidence.push({slideNumber:index+1,sampledRgb:rgb,expectedSolidRgb:expected,treatment:view.slideData.surfaceTreatment});}
 const thumbs=await Promise.all(Array.from({length:10},async(_,i)=>({input:await sharp(path.join(slidesDirectory,`slide-${i+1}.png`)).resize(480,270).png().toBuffer(),left:i%2*480,top:Math.floor(i/2)*270})));
 await sharp({create:{width:960,height:1350,channels:3,background:'#ffffff'}}).composite(thumbs).png().toFile(path.join(root,name+'-contact.png'));
 reports.push({name,title:c.title,status:'passed',slideCount:10,palette:presentation.design.tokens.colors,backgrounds:slideSurfacePlan(presentation.slides,{uniform:mode==='baseline'}),pixelEvidence,elapsedMs:Math.round(performance.now()-started),metrics,files:{cover:path.join(root,name+'-cover.png'),contact:path.join(root,name+'-contact.png')}});await fs.writeFile(path.join(root,'report.json'),JSON.stringify(reports,null,2));console.log('[STAKEHOLDER_PRESENTATION]',JSON.stringify({name,status:'passed',elapsedMs:reports.at(-1).elapsedMs}));
}
