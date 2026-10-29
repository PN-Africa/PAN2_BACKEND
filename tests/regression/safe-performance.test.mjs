import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {PDFParse} from 'pdf-parse';
import {pdfSource} from '../fixtures/uploadFiles.mjs';
import {documentParagraph} from '../fixtures/documentFixtures.mjs';
import {validateDocumentPdf} from '../../Service/document/documentPdfService.mjs';
import {profileGeneration,beginAiAttempt,recordAiAttempt} from '../../Service/performance.mjs';

test('identical concurrent image work uses one worker with independent caller buffers; failures are retryable',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-coalesce-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const cp=createRequire(import.meta.url)('node:child_process'),original=cp.fork;let forks=0;
 cp.fork=(...args)=>{forks++;return original(...args);};syncBuiltinESMExports();
 t.after(()=>{cp.fork=original;syncBuiltinESMExports();});
 const {optimizeWebsiteImage}=await import('../../Service/webpage/imageOptimization.mjs');
 const bytes=await fs.readFile('assets/webpage/curated/laboratory.jpg');
 const [a,b]=await Promise.all([0,1].map(()=>optimizeWebsiteImage(bytes,{cacheRoot:root})));
 assert.equal(forks,1);assert.deepEqual(a,b);assert.notEqual(a.variants[0].buffer,b.variants[0].buffer);
 const originalByte=b.variants[0].buffer[0];a.variants[0].buffer[0]^=255;a.variants[0].width=1;
 assert.equal(b.variants[0].buffer[0],originalByte);assert.notEqual(b.variants[0].width,1);
 const cached=await optimizeWebsiteImage(bytes,{cacheRoot:root});assert.equal(cached.cacheHit,true);assert.equal(cached.variants[0].buffer[0],originalByte);
 await optimizeWebsiteImage(bytes,{cacheRoot:path.join(root,'other')});assert.equal(forks,2);
 const bad=Buffer.from('invalid raster');
 const failed=await Promise.allSettled([0,1].map(()=>optimizeWebsiteImage(bad,{cacheRoot:root})));
 assert.ok(failed.every(r=>r.status==='rejected'));assert.equal(forks,3);
 await assert.rejects(optimizeWebsiteImage(bad,{cacheRoot:root}));assert.equal(forks,4);
 const separated=await Promise.allSettled([1,12000].map(timeoutMs=>optimizeWebsiteImage(bytes,{cacheRoot:path.join(root,'timeouts'),timeoutMs})));
 assert.equal(separated[0].status,'rejected');assert.equal(separated[1].status,'fulfilled');assert.equal(forks,6);
});

test('document PDF summaries reuse only identical validated bytes and never expose shared metadata',async t=>{
 const original=PDFParse.prototype.getText;let parses=0;
 PDFParse.prototype.getText=async function(...args){parses++;return original.apply(this,args);};
 t.after(()=>{PDFParse.prototype.getText=original;});
 const bytes=pdfSource(documentParagraph+' Controlled cache proof.');
 const first=await validateDocumentPdf(bytes);first.pages=999;
 const second=await validateDocumentPdf(Buffer.from(bytes));assert.equal(parses,1);assert.notEqual(second.pages,999);
 await validateDocumentPdf(pdfSource(documentParagraph+' Different complete byte content.'));assert.equal(parses,2);
 const corrupt=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(120)]);
 await assert.rejects(validateDocumentPdf(corrupt));await assert.rejects(validateDocumentPdf(corrupt));assert.equal(parses,4);
 await assert.rejects(validateDocumentPdf(Buffer.alloc(150)));assert.equal(parses,4);
});

test('performance report records peak AI concurrency while final in-flight count returns to zero',async()=>{
 let report;
 await profileGeneration(async()=>{
  const a=beginAiAttempt({stage:'slide-content',attempt:1}),b=beginAiAttempt({stage:'slide-content',attempt:1});
  recordAiAttempt({stage:'slide-content',status:'completed'},a);recordAiAttempt({stage:'slide-content',status:'completed'},b);
 },{forceNew:true,onReport:r=>{report=r;},logger:()=>{}});
 assert.equal(report.ai.peakInFlightCalls,2);assert.equal(report.ai.stages['slide-content'].peakInFlightCalls,2);assert.equal(report.ai.inFlightCalls,0);
});

test('document validation metadata expires and retains at most 32 successful summaries',async t=>{
 const getText=PDFParse.prototype.getText,clock=Date.now;let parses=0,now=clock()+120000;
 Date.now=()=>now;PDFParse.prototype.getText=async function(...args){parses++;return getText.apply(this,args);};
 t.after(()=>{Date.now=clock;PDFParse.prototype.getText=getText;});
 const first=pdfSource(documentParagraph+' Expiring cache fixture.');
 await validateDocumentPdf(first);await validateDocumentPdf(first);assert.equal(parses,1);
 now+=60001;await validateDocumentPdf(first);assert.equal(parses,2);
 for(let i=0;i<32;i++)await validateDocumentPdf(pdfSource(documentParagraph+' Bounded cache fixture '+i));
 assert.equal(parses,34);await validateDocumentPdf(first);assert.equal(parses,35);
});
