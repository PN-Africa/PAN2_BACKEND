import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fetchPublicResource} from '../input/publicUrl.mjs';
import {storageRoot} from '../storageRoot.mjs';
import {atomicImageJson,shareImageWork} from './imageAssetService.mjs';
import {evaluateImageRelevance} from './imageRelevance.mjs';
const windows=new Map(),hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
// API metadata is cached for 24 hours as required by Pixabay. Downloaded photos
// are bundled by the output pipeline; permanent CDN hotlinks are never emitted.
export function pixabayAdapter(env=process.env,{fetcher=fetch,download=fetchPublicResource,cacheRoot}={}){
 return {id:'pixabay',acquire:async request=>{
  if(!env.PIXABAY_API_KEY)throw fail('PIXABAY_CREDENTIALS_REQUIRED');
  const query=String(request.searchQuery||request.query||'').trim().slice(0,100);if(!query)throw fail('IMAGE_QUERY_REQUIRED');
  const account=hash(env.PIXABAY_API_KEY),key=hash(JSON.stringify([account,query,'photo-horizontal-safe-v1'])),root=path.resolve(cacheRoot||env.PIXABAY_CACHE_DIR||storageRoot('pixabay-search-cache')),file=path.join(root,key+'.json');
  const payload=await shareImageWork('pixabay-metadata:'+root+':'+key,async signal=>{
   try{const cached=JSON.parse(await fs.readFile(file,'utf8'));if(cached.key===key&&Date.now()-cached.createdAt<86400000)return cached.payload;}catch{}
   const now=Date.now(),window=windows.get(account);if(windows.size>128)windows.clear();const rate=window&&now-window.start<60000?window:{start:now,count:0};windows.set(account,rate);if(++rate.count>Math.min(100,Math.max(1,Number(env.PIXABAY_REQUESTS_PER_MINUTE)||90)))throw fail('PIXABAY_RATE_LIMITED');
   const url=new URL('https://pixabay.com/api/');url.search=new URLSearchParams({key:env.PIXABAY_API_KEY,q:query,image_type:'photo',orientation:'horizontal',safesearch:'true',per_page:'5',min_width:'800',min_height:'600'});
   const response=await fetcher(url,{signal,redirect:'error'});if(!response.ok)throw fail('PIXABAY_HTTP_ERROR',response.status);
   let length=0;const chunks=[];for await(const chunk of response.body){length+=chunk.length;if(length>512*1024)throw fail('IMAGE_METADATA_TOO_LARGE');chunks.push(chunk);}const payload=JSON.parse(Buffer.concat(chunks).toString());
   await fs.mkdir(root,{recursive:true});await atomicImageJson(file,{key,createdAt:Date.now(),payload});return payload;
  },{signal:request.signal});
  for(const photo of (payload.hits||[]).slice(0,5)){
   if(photo.type!=='photo'||photo.isAiGenerated||!photo.user||!/^https:\/\/pixabay.com\//.test(photo.pageURL||''))continue;
   const record={source:'Pixabay',sourceType:'licensed-stock',mediaKind:'photograph',creator:photo.user,creatorUrl:`https://pixabay.com/users/${encodeURIComponent(photo.user)}-${photo.user_id}/`,license:'Pixabay Content License',licenseUrl:'https://pixabay.com/service/license-summary/',licenseVerified:true,originalUrl:photo.pageURL,sourceUrl:photo.pageURL,description:photo.tags,alt:photo.tags,keywords:String(photo.tags||'').split(',').map(tag=>tag.trim()),attributionRequired:false,attribution:`${photo.user} / Pixabay — Pixabay Content License`,width:photo.imageWidth,height:photo.imageHeight,generationMethod:'licensed-search'};
   if(!evaluateImageRelevance(record,request).accepted)continue;
   const location=new URL(photo.fullHDURL||photo.largeImageURL||'https://invalid.invalid');if(location.protocol!=='https:'||!['pixabay.com','cdn.pixabay.com'].includes(location.hostname))continue;
   const {buffer}=await download(location.href,{signal:request.signal,maxBytes:12*1024*1024,timeoutMs:20000,contentTypes:/^image\/(jpeg|png|webp)(?:;|$)/i,accept:'image/jpeg,image/png,image/webp'});return {...record,buffer};
  }return null;
 }};
}
