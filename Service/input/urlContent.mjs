import * as cheerio from 'cheerio';
import {MAX_SOURCE_CHARACTERS} from './sourceLimits.mjs';
import {measureStage} from '../performance.mjs';
export const sourceError=(code,message,extra={})=>Object.assign(new Error(message),{code,stage:'input-extraction',...extra});
export function normalizeSourceText(value){
 const text=String(value).replace(/\r\n?/g,'\n').replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(!text)throw sourceError('INVALID_SOURCE_URL_CONTENT','No readable source content was found.');
 if(text.length>MAX_SOURCE_CHARACTERS)throw sourceError('SOURCE_URL_TEXT_TOO_LARGE','The source contains more than 200,000 readable characters. Use an authorized shorter excerpt.',{maxCharacters:MAX_SOURCE_CHARACTERS});
 return text;
}
export async function extractRetrievedContent({text:html,title='',contentType,finalUrl},requestedUrl,method='direct-http'){
 if(typeof html!=='string')throw sourceError('INVALID_SOURCE_URL_CONTENT','Source did not return readable text.');
 const canonical=finalUrl||requestedUrl;
 if(contentType?.startsWith('text/plain'))return {schemaVersion:'1.0',requestedUrl,canonicalUrl:canonical,title:typeof title==='string'?title.slice(0,240):'',retrievalMethod:method,retrievedSuccessfully:true,text:await measureStage('url-normalization',()=>normalizeSourceText(html)),headings:[...html.matchAll(/^#{1,4}\s+(.{1,200})$/gm)].map(match=>match[1].trim()).slice(0,100),references:[],warnings:[]};
 const $=await measureStage('url-html-parsing',()=>cheerio.load(html));
 const articleText=$('article,main').first().text().trim();
 if($('input[type="password"]').length&&articleText.length<500)throw sourceError('SOURCE_URL_AUTH_REQUIRED','The source requires sign-in. Use a public or authorized uploaded source.');
 const paywall=$('script[type="application/ld+json"]').toArray().some(n=>/"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test($(n).text()))||$('[data-paywall],#paywall,.paywall').toArray().some(n=>/subscribe|subscription|purchase|pay to|members.only|unlock/i.test($(n).text()));
 if(paywall)throw sourceError('SOURCE_URL_PAYWALL','The source requires a subscription. Use an authorized public source.');
 const result=await measureStage('url-text-extraction',()=>{
  const title=($('h1').first().text()||$('title').first().text()).replace(/\s+/g,' ').trim().slice(0,240);
  const references=[];
  $('.references a.external,a[rel~=citation]').each((i,node)=>{if(references.length>=24)return;try{const url=new URL($(node).attr('href'),canonical);if(url.protocol==='https:'&&!url.username&&!url.password)references.push({title:$(node).text().trim().slice(0,160)||'Source reference',url:url.href});}catch{}});
  $('script,style,noscript,nav,footer,aside,form,[role=banner],[role=navigation],.references,.reflist,.mw-references-wrap,.navbox,.vertical-navbox,.sidebar,.mw-editsection,.catlinks,.mw-footer,.mw-portlet,.noprint,.reference,.mw-empty-elt').remove();
  const primary=$('article').first().length?$('article').first():$('main').first();
  const root=primary.length&&primary.text().trim()?primary:$('body');
  const headings=root.find('h1,h2,h3,h4').toArray().map(node=>$(node).text().replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,100);
  root.find('h1,h2,h3,h4,p,li,tr,section').append('\n');
  return {title,headings,references,text:root.text()};
 });
 return {schemaVersion:'1.0',requestedUrl,canonicalUrl:canonical,title:result.title,retrievalMethod:method,retrievedSuccessfully:true,text:await measureStage('url-normalization',()=>normalizeSourceText(result.text)),headings:result.headings,references:result.references,warnings:[]};
}
