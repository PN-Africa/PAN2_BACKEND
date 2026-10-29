import {createHash} from 'node:crypto';
import {fetchPublicResource} from '../input/publicUrl.mjs';
import {evaluateImageRelevance} from './imageRelevance.mjs';
import {measureStage,reservePerformanceBudget} from '../performance.mjs';
import {load} from 'cheerio';
import {reviewGeneratedImage} from './generatedImageReview.mjs';
import {validateImageBytes} from './imageAssetService.mjs';

export function licensedStock(record){
 if(!record.creator||!record.originalUrl||!record.licenseUrl)return false;
 if(record.source==='Pexels')return record.license==='Pexels License'&&record.licenseUrl==='https://www.pexels.com/license/';
 return /^(?:cc0|pdm|by|by-sa)$/i.test(record.license)&&/^https:\/\/creativecommons.org\//.test(record.licenseUrl);
}
async function jsonResponse(url,{headers,signal,fetcher}){
 const response=await fetcher(url,{headers,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
 if(!response.ok)throw Object.assign(new Error('Stock provider search unavailable'),{status:response.status,headers:response.headers});
 const chunks=[];let bytes=0;
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>512*1024)throw Object.assign(new Error('Stock metadata exceeds budget'),{code:'IMAGE_METADATA_TOO_LARGE'});chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function stockProviderAdapters(env=process.env,{fetcher=fetch,download=fetchPublicResource,reviewClient}={}){
 const adapters=[];let visionUsed=0;
 if(env.PEXELS_API_KEY)adapters.push({id:'pexels',cacheScope:createHash('sha256').update(env.PEXELS_API_KEY).digest('hex'),search:async request=>{
  const url=new URL('https://api.pexels.com/v1/search');url.search=new URLSearchParams({query:request.searchQuery||request.query,per_page:'8',orientation:request.aspectRatio==='3:4'?'portrait':request.aspectRatio==='1:1'?'square':'landscape',size:'large'});
  const body=await jsonResponse(url,{headers:{Authorization:env.PEXELS_API_KEY},signal:request.signal,fetcher});
  return (body.photos||[]).flatMap(p=>{
   if(!p.src?.large2x||new URL(p.src.large2x).hostname!=='images.pexels.com')return [];
   return [{assetId:String(p.id),source:'Pexels',description:p.alt||'',alt:p.alt||'',creator:p.photographer,creatorUrl:p.photographer_url,originalUrl:p.url,sourceUrl:p.url,downloadUrl:p.src.large2x,width:p.width,height:p.height,license:'Pexels License',licenseUrl:'https://www.pexels.com/license/',attributionRequired:true,attribution:`Photo by ${p.photographer} on Pexels — ${p.url}`}];
  });
 }});
 // Explicit opt-in: every Openverse result still needs its individual license.
 if(env.OPENVERSE_ENABLED==='true')adapters.push({id:'openverse',search:async request=>{
  const url=new URL('https://api.openverse.org/v1/images/');url.search=new URLSearchParams({q:request.searchQuery||request.query,license_type:'commercial',page_size:'8',extension:'jpg,png',size:'large'});
  const body=await jsonResponse(url,{headers:env.OPENVERSE_ACCESS_TOKEN?{Authorization:`Bearer ${env.OPENVERSE_ACCESS_TOKEN}`}:{},signal:request.signal,fetcher});
  return (body.results||[]).map(p=>({assetId:p.id,source:'Openverse',sourceType:'licensed-stock',title:p.title,alt:p.title,description:p.title,keywords:p.tags?.map(t=>t.name)||[],creator:p.creator,creatorUrl:p.creator_url,originalUrl:p.foreign_landing_url,sourceUrl:p.foreign_landing_url,downloadUrl:p.url,width:p.width,height:p.height,license:p.license,licenseUrl:p.license_url,attributionRequired:!['cc0','pdm'].includes(p.license),attribution:`${p.title} — ${p.creator} — ${p.license} ${p.license_url} — ${p.foreign_landing_url}. Changes: resized, cropped, compressed.`}));
 }});
 return adapters.map(adapter=>({...adapter,async acquire(request){
  const records=await measureStage('image-search-'+adapter.id,()=>adapter.search(request));
  const ratio=request.aspectRatio==='3:4'?.75:request.aspectRatio==='1:1'?1:16/9;
  const ranked=await measureStage('image-candidate-ranking',()=>records.filter(record=>licensedStock(record)&&record.width>=960&&record.height>=600&&record.width/record.height<3.5&&record.width/record.height>.4&&evaluateImageRelevance(record,request).accepted&&(!request.acceptCandidate||request.acceptCandidate(record))).sort((a,b)=>Math.abs(a.width/a.height-ratio)-Math.abs(b.width/b.height-ratio)));
  let lastError;
  for(const record of ranked.slice(0,2))try{
   if(adapter.id==='openverse'){
    // The index is not the licensor. Check the source page as well, and fail
    // closed when the indexed permission cannot be corroborated there.
    const {buffer:page}=await measureStage('image-license-source-check',()=>download(record.originalUrl,{signal:request.signal,maxBytes:512*1024,timeoutMs:8000,contentTypes:/^text\/html(?:;|$)/i,accept:'text/html'}));
    const $=load(page.toString('utf8')),expected=record.licenseUrl.replace(/^http:/,'https:').replace(/\/$/,'');
    const found=$('a[href],link[href]').toArray().some(node=>{try{return new URL($(node).attr('href'),record.originalUrl).href.replace(/^http:/,'https:').replace(/\/$/,'')===expected;}catch{return false;}});
    if(!found)continue;record.licenseVerification='source-page-link-matched';
   }
   const {buffer}=await measureStage('image-download',()=>download(record.downloadUrl,{signal:request.signal,maxBytes:12*1024*1024,timeoutMs:12000,contentTypes:/^image\/(jpeg|png|webp)(?:;|$)/i,accept:'image/jpeg,image/png,image/webp'}));
   const ambiguous=(record.description||'').length<160&&/\b(?:kitchen|handing|handover|advisor|villa)\b/i.test(request.searchQuery||request.query||'');
   if(env.AI_STOCK_SEMANTIC_REVIEW==='true'&&ambiguous){
    // At most one selected ambiguous candidate per request-scoped adapter set.
    // Exhaustion is explicit; it must not be mistaken for a visual pass.
    const ticket=reservePerformanceBudget('stock-vision',1);
    if(ticket===false||ticket===undefined&&visionUsed++)throw Object.assign(new Error('Stock visual review budget exhausted'),{code:'IMAGE_REVIEW_BUDGET_EXHAUSTED'});
    const metadata=await validateImageBytes(buffer);
    record.visualReview=await reviewGeneratedImage({buffer,mimeType:`image/${metadata.format}`,prompt:request.searchQuery||request.query,signal:request.signal,origin:'stock'},{env:{...env,AI_IMAGE_SEMANTIC_REVIEW:'true'},client:reviewClient});
   }
   return {...record,buffer,mediaKind:'photograph',sourceType:'licensed-stock',generationMethod:'licensed-search'};
  }catch(error){if(request.signal?.aborted)throw error;lastError=error;}
  if(lastError)throw lastError;return null;
 }}));
}
