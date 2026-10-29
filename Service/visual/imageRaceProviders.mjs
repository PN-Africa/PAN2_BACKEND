import {randomUUID,createHash} from 'node:crypto';
import {fetchPublicResource} from '../input/publicUrl.mjs';
import {raceImages} from './imageRace.mjs';
import {validateImageBytes} from './imageAssetService.mjs';
import {evaluateImageRelevance} from './imageRelevance.mjs';
import {imageContextHash} from './assetBinding.mjs';
import {geographicAnchors} from './sceneEvidence.mjs';
import {reviewGeneratedImage} from './generatedImageReview.mjs';
import {pixabayAdapter} from './pixabayProvider.mjs';
const fail=code=>Object.assign(new Error(code),{code});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const referral=value=>{try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='unsplash.com')return '';url.searchParams.set('utm_source','ledify');url.searchParams.set('utm_medium','referral');return url.href;}catch{return '';}};
export function raceProviderAdapters(env=process.env,{commonsAcquire,geminiAcquire,fetcher=fetch,download=fetchPublicResource,visionReview,reviewClient,cacheRoot}={}){
 let visionCalls=0;
 const json=async(url,signal,headers)=>{
  const response=await fetcher(url,{signal,headers,redirect:'error'});if(!response.ok)throw fail('IMAGE_PROVIDER_HTTP_'+response.status);
   let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>512*1024)throw fail('IMAGE_METADATA_TOO_LARGE');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());
 };
 const bytes=async(url,signal)=>(await download(url,{signal,maxBytes:12*1024*1024,timeoutMs:20000,contentTypes:/^image\/(jpeg|png|webp)(?:;|$)/i,accept:'image/jpeg,image/png,image/webp'})).buffer;
 return [
  {id:'commons',acquire:r=>commonsAcquire({...r,searchQuery:r.searchQuery||r.query,maxSearchQueries:1})},
  {id:'unsplash',acquire:async r=>{
   if(!env.UNSPLASH_ACCESS_KEY)throw fail('UNSPLASH_CREDENTIALS_REQUIRED');
   const headers={Authorization:'Client-ID '+env.UNSPLASH_ACCESS_KEY,'Accept-Version':'v1'},url=new URL('https://api.unsplash.com/search/photos');url.search=new URLSearchParams({query:r.searchQuery||r.query,per_page:'5',orientation:'landscape'});
   const response=await json(url,r.signal,headers);
   // Ledify embeds downloads and bundles responsive copies. Standard API
   // hotlinking terms do not authorize claiming that this is compliant.
   if(env.UNSPLASH_BUNDLED_EXPORT_APPROVED!=='true')throw fail('UNSPLASH_EXPORT_PERMISSION_REQUIRED');
   for(const p of response.results||[]){
    if(p.premium||p.plus||!p.urls?.regular||!p.links?.download_location||!p.user?.name)continue;
    const imageUrl=new URL(p.urls.regular),tracking=new URL(p.links.download_location);
    if(imageUrl.protocol!=='https:'||imageUrl.hostname!=='images.unsplash.com'||tracking.protocol!=='https:'||tracking.hostname!=='api.unsplash.com'||!/^\/photos\/[^/]+\/download$/.test(tracking.pathname))continue;
    const record={source:'Unsplash',sourceType:'licensed-stock',mediaKind:'photograph',creator:p.user.name,creatorUrl:referral(p.user.links?.html),originalUrl:referral(p.links.html),sourceUrl:referral(p.links.html),license:'Unsplash License',licenseUrl:'https://unsplash.com/license',licenseVerified:true,usagePermission:'server-confirmed-bundled-export',description:p.description||p.alt_description||'',alt:p.alt_description||p.description||'',attributionRequired:true,attribution:`Photo by ${p.user.name} (${referral(p.user.links?.html)}) on Unsplash (${referral(p.links.html)})`,hotlinkUrl:imageUrl.href,width:p.width,height:p.height,generationMethod:'licensed-search'};
    if(!evaluateImageRelevance(record,r).accepted)continue;
    // This server-side acquisition is a download-like action, even if the
    // validated contender later loses. Never expose access credentials in URLs.
    await json(tracking,r.signal,headers);return {...record,buffer:await bytes(imageUrl.href,r.signal)};
   }return null;
  }},
  {id:'picsum',kind:'vision-stock',acquire:async r=>{
   const seed=randomUUID(),info=await json('https://picsum.photos/seed/'+seed+'/info',r.signal);
   if(!/^[\w-]+$/.test(String(info.id))||!info.author||!/^https:\/\/unsplash.com\/photos\//.test(info.url||''))throw fail('PICSUM_PROVENANCE_UNVERIFIED');
   const source=await download(info.url,{signal:r.signal,maxBytes:512*1024,timeoutMs:10000,contentTypes:/^text\/html(?:;|$)/i,accept:'text/html'});
   const html=source.buffer.toString();if(!/https:\/\/unsplash.com\/license/.test(html)||/Unsplash\+|"premium":true|"plus":true/.test(html))throw fail('PICSUM_LICENSE_UNVERIFIED');
   const buffer=await bytes('https://picsum.photos/id/'+info.id+'/1920/1080',r.signal);
   if(r.identityLabel||geographicAnchors(r.query||r.searchQuery,r).length)throw fail('PICSUM_IDENTITY_OR_LOCATION_UNVERIFIED');
   if(visionCalls>=Math.max(0,Number(env.IMAGE_RACE_MAX_VISION_REVIEWS??4)))throw fail('IMAGE_REVIEW_BUDGET_EXHAUSTED');visionCalls++;
   if(!visionReview&&!reviewClient&&!env.ANTHROPIC_API_KEY)throw fail('PICSUM_VISUAL_REVIEW_NOT_CONFIGURED');
   const metadata=await validateImageBytes(buffer,{minWidth:800,minHeight:600});
   const review=await (visionReview||((request)=>reviewGeneratedImage(request,{env:{...env,AI_IMAGE_SEMANTIC_REVIEW:'true'},client:reviewClient,maxAttempts:1})))({buffer,mimeType:'image/'+metadata.format,prompt:r.query||r.searchQuery||r.description,signal:r.signal,origin:'stock'});
   if(review?.status!=='passed')throw fail('IMAGE_SEMANTIC_REJECTED');
   return {source:'Lorem Picsum',sourceType:'licensed-stock',mediaKind:'photograph',creator:info.author,license:'Unsplash License',licenseUrl:'https://unsplash.com/license',licenseVerified:true,originalUrl:info.url,sourceUrl:info.url,attributionRequired:true,attribution:`Photo by ${info.author} via Lorem Picsum / Unsplash`,description:'Visually verified photograph',alt:r.alt||r.altText||r.description||r.query,buffer,generationMethod:'licensed-search',visualVerification:{status:'passed',contextHash:imageContextHash(r),sha256:hash(buffer)}};
  }},
  {id:'gemini',kind:'generation',model:env.AI_IMAGE_MODEL||env.GOOGLE_IMAGE_MODEL||'gemini-nano-banana-2.1',acquire:r=>{
   if(!geminiAcquire)throw fail('GEMINI_IMAGE_NOT_CONFIGURED');return geminiAcquire(r);
  }},
  pixabayAdapter(env,{fetcher,download,cacheRoot})
 ];
}
export async function acquireRacingImage(providers,request,{reserveGeneration=()=>false,validate,logger,timeoutMs=30000,signal=request.signal}={}){
 const normalized={...request,query:request.query||request.searchQuery||request.description,searchQuery:request.searchQuery||request.query||request.description};
 const contenders=providers.map(provider=>({...provider,acquire:async r=>{if(provider.kind==='generation'&&!reserveGeneration())throw fail('GENERATION_BUDGET_UNAVAILABLE');return provider.acquire(r);}}));
 return raceImages(contenders,normalized,{signal,timeoutMs,logger,validate:async(asset,provider,context)=>{
  if(!asset.creator||!asset.license||!asset.source||asset.attributionRequired&&!asset.attribution)throw fail('IMAGE_LICENSE_UNVERIFIED');
  if(provider.id==='commons'&&!/^(?:CC0|Public domain|CC BY(?:-SA)? [1-4])/i.test(asset.license))throw fail('IMAGE_LICENSE_UNVERIFIED');
  if(['picsum','unsplash','pixabay'].includes(provider.id)&&!asset.licenseVerified)throw fail('IMAGE_LICENSE_UNVERIFIED');
  const generated=asset.generationMethod==='ai-generated'||asset.sourceType==='ai-generated';
  if(generated&&(request.authenticPhotoOnly||request.authenticOnly||request.visualIntent==='photograph'||request.identityLabel))throw fail('AUTHENTIC_PHOTOGRAPH_REQUIRED');
  const dimensions=await validateImageBytes(asset.buffer,{minWidth:800,minHeight:request.generationType==='presentation'?600:400,requireVariance:true});
  if(dimensions.width/dimensions.height<.6||dimensions.width/dimensions.height>3.2)throw fail('IMAGE_ASPECT_UNSUITABLE');
  const pixels=asset.visualVerification?.status==='passed'&&asset.visualVerification.contextHash===imageContextHash(normalized)&&asset.visualVerification.sha256===hash(asset.buffer);
  if(provider.id==='picsum'&&!pixels)throw fail('PICSUM_VISUAL_VERIFICATION_REQUIRED');
  if(!generated&&!pixels&&!evaluateImageRelevance(asset,normalized).accepted)throw fail('IMAGE_RELEVANCE_REJECTED');
  asset.raceValidation={contextHash:imageContextHash(request),sha256:hash(asset.buffer),provider:provider.id,validated:true};
  return validate?validate(asset,provider,{...context,dimensions}):true;
 }});
}
