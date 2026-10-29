import fs from 'node:fs/promises';
import path from 'node:path';
import {generateJsonWithRetry} from '../ai/generateJsonWithRetry.mjs';
import {getTextClient,textModel} from '../ai/textProvider.mjs';
import {getLayoutsForSlideType} from '../../templates/presentation/presentationLayouts.mjs';
import {validatePlannedRenderContent} from '../../renderer/presentation/professionalLayouts.mjs';
import {measureStage} from '../performance.mjs';
import {presentationStorageRoot} from '../presentationStorage.mjs';
import {cloneSharedAsset} from '../visual/imageAssetService.mjs';
import {prepareSlideSurfaces} from '../../renderer/presentation/backgrounds.mjs';
import {colorContrast} from './colorSystem.mjs';

export async function discardRejectedPreview(preview,rootOverride){
 if(!/^[a-f\d-]{36}$/i.test(preview.previewId||''))return;
 const root=presentationStorageRoot(rootOverride),target=path.resolve(root,preview.previewId);
 if(!target.startsWith(root+path.sep)||path.resolve(preview.files?.previewDirectory||'')!==target)throw new Error('Invalid rejected-preview path');
 const real=await fs.realpath(target);if(!real.startsWith((await fs.realpath(root))+path.sep))throw new Error('Rejected preview escapes storage');await fs.rm(target,{recursive:true,force:true});
}

export async function renderInspectRepair({input,render,inspect,repair,discard=async()=>{},maxRepairs=1}){
 if(!Number.isInteger(maxRepairs)||maxRepairs<0||maxRepairs>1)throw new Error('At most one visual repair is supported');
 // Keep immutable base64 strings shared while isolating mutable metadata and
 // buffers. structuredClone needlessly copies every large image string.
 let value=cloneSharedAsset(input);const repairs=[];
 for(let attempt=0;attempt<=maxRepairs;attempt++){
  const artifact=await measureStage('artifact-render',()=>render(value));
  const report=await measureStage('visual-quality',()=>inspect(artifact,value));
  if(!report.issues?.length)return {artifact,input:value,quality:{status:report.status||'passed',inspection:report,repairs}};
  await discard(artifact);
  if(attempt===maxRepairs||!repair)throw Object.assign(new Error('Rendered artifact failed the bounded visual quality gate.'),{code:'VISUAL_QUALITY_FAILED',stage:'visual-quality',issues:report.issues});
  const next=await repair(cloneSharedAsset(value),report.issues);if(!next)throw Object.assign(new Error('No safe content-preserving visual repair is available.'),{code:'VISUAL_QUALITY_FAILED',stage:'visual-quality',issues:report.issues});
  repairs.push({attempt:attempt+1,reasons:report.issues.map(issue=>({unitId:issue.unitId,code:issue.code}))});value=next;
 }
}
export function repairPresentationComponents(presentation,issues){
 for(const issue of issues){const slide=presentation.slides.find(s=>'slide-'+s.slideNumber===issue.unitId);if(!slide||slide.photoAsset)return null;
  const candidates=getLayoutsForSlideType(slide.slideType).filter(c=>c.id!==slide.layoutId&&(!issue.component||c.id===issue.component));let selected;
  for(const candidate of candidates)try{validatePlannedRenderContent({...slide,layoutId:candidate.id});selected=candidate.id;break;}catch{}
  if(!selected)return null;slide.layoutId=selected;
 }return presentation;
}
export function presentationDesignTrace(presentation,spec){return {units:presentation.slides.map(slide=>({contentId:'slide-'+slide.slideNumber,requested:spec.design.units.find(unit=>unit.contentId==='slide-'+slide.slideNumber)?.component,selected:slide.layoutId,...(slide.photoComposition?{imageComposition:slide.photoComposition}:{}),fontRoles:'backend semantic type scale'})),spacing:{requested:spec.design.theme.spacing,applied:'registered component geometry',reason:'Native components retain safe margins and readable text bounds.'}};}
export async function inspectPresentationPreview(preview,presentation,options={}){
 if(preview.stages?.pdf!=='completed'||preview.stages?.png!=='completed')return {issues:[],status:'incomplete',reason:'EXPORT_INCOMPLETE',method:'deterministic-export'};
 const views=presentation.design?.tokens?await prepareSlideSurfaces(presentation,presentation.design.tokens):[],backgrounds=views.map(view=>({slideNumber:view.slideData.slideNumber,treatment:view.slideData.surfaceTreatment,textContrast:colorContrast(view.tokens.colors.text,view.tokens.colors.background)}));
 const issues=backgrounds.filter(b=>b.textContrast<4.5).map(b=>({unitId:'slide-'+b.slideNumber,code:'UNREADABLE'}));
 if(issues.length)return {issues,backgrounds,method:'resolved-background-contrast'};
 if(process.env.LEDIFY_VISUAL_REVIEW!=='true'&&!options.client)return {issues:[],backgrounds,method:'native-package-geometry-and-pixel-validation',aiReview:'not-run'};
 const selected=presentation.slides.filter(s=>s.slideType==='relationship'||s.content?.visualContent?.visual?.diagram||s.slideType==='comparison').slice(0,2);
 if(!selected.length)return {issues:[],method:'native-validation',aiReview:'not-required'};
 const images=await Promise.all(selected.map(async slide=>{const data=await fs.readFile(path.join(preview.files.slidesDirectory,`slide-${slide.slideNumber}.png`));if(data.length>8*1024*1024)throw new Error('Visual review image exceeds its budget');return {mimeType:'image/png',data:data.toString('base64')};}));
 const schema={type:'object',properties:{issues:{type:'array',maxItems:4,items:{type:'object',properties:{unitId:{type:'string'},code:{type:'string',enum:['OVERLAP','CLIPPING','CONFUSING_CONNECTOR','UNREADABLE']},component:{type:'string'}},required:['unitId','code','component'],additionalProperties:false}}},required:['issues'],additionalProperties:false};
 const result=await generateJsonWithRetry({client:options.client||getTextClient(),stage:'rendered-visual-review',schema,outputType:'presentation',logger:options.logger,request:{model:textModel('rendered-visual-review'),contents:`Review these actual rendered slides, in the supplied order, for critical clipping, text overlap, unreadable copy or connectors with confusing endpoints. Do not rewrite content. Recommend only compatible alternative IDs. Return issues only for these units: ${JSON.stringify(selected.map(s=>({unitId:'slide-'+s.slideNumber,current:s.layoutId,alternatives:getLayoutsForSlideType(s.slideType).map(c=>c.id)})))}`,images,config:{responseJsonSchema:schema,maxOutputTokens:1000}},validate:value=>{for(const issue of value.issues){const slide=selected.find(s=>'slide-'+s.slideNumber===issue.unitId);if(!slide||!getLayoutsForSlideType(slide.slideType).some(c=>c.id===issue.component))throw new Error('Visual review must reference a sampled slide and a compatible component');}}});
 return {...result,method:'sampled-claude-vision',sampledUnits:selected.map(s=>'slide-'+s.slideNumber),coverage:'at most two complex slides; not exhaustive'};
}
