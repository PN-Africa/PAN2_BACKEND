import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createAnthropicService,textModel,textProvider,structuredOutputPlan} from '../../Service/ai/textProvider.mjs';
import {generateJsonWithRetry} from '../../Service/ai/generateJsonWithRetry.mjs';
import {generateImage,imageGenerationSettings} from '../../Service/visual/imageGenerationService.mjs';
import {websiteImageProviders} from '../../Service/webpage/imageProviders.mjs';
import {configuredImageProviders} from '../../Service/visual/imageProviders.mjs';
import {containerResources} from '../../Service/runtimeResources.mjs';
import {reviewGeneratedImage} from '../../Service/visual/generatedImageReview.mjs';
const model='claude-opus-5-5',env={CLAUDE_MODEL:model},schema={type:'object',properties:{title:{type:'string',maxLength:12}},required:['title'],additionalProperties:false};
const info={id:model,capabilities:{structured_outputs:{supported:true},effort:{supported:true}}};
const response=title=>({model,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({title})}],usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:12,cache_creation_input_tokens:4}});
const request={model,contents:'Private source used only for this request.',config:{responseJsonSchema:schema,maxOutputTokens:512}};
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ledify-migration-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('all primary stages select the exact requested Claude model and Google is explicit rollback only',()=>{
 for(const stage of ['presentation-outline','slide-content-generation','presentation-quality-review','webpage-planning','webpage-content','document-outline','document-section','document-quality-review','visual-diagram-planning','image-prompt-planning'])assert.equal(textModel(stage,{}),model);
 assert.equal(textProvider({GEMINI_API_KEY:'old-key'}),'anthropic');assert.equal(imageGenerationSettings({GEMINI_API_KEY:'old-key',GOOGLE_IMAGE_MODEL:'old-model',WEBPAGE_ALLOW_IMAGE_GENERATION:'true'}).ready,false);
 assert.throws(()=>textProvider({AI_TEXT_PROVIDER:'google-rollback'}),{code:'AI_TEXT_PROVIDER_NOT_CONFIGURED'});
 assert.equal(textModel('presentation-outline',{AI_TEXT_PROVIDER:'google-rollback',AI_ALLOW_GOOGLE_ROLLBACK:'true'}),'gemini-3.7-flash');
});
test('model access is verified before messages; concurrent checks deduplicate without substituting models',async()=>{
 const seen=[];let checks=0;const sdk={models:{retrieve:async id=>{assert.equal(id,model);checks++;await new Promise(r=>setTimeout(r,10));return info;}},messages:{create:async(body,options)=>{seen.push(body);assert.equal(options.maxRetries,0);return response('Valid');}}};
 const service=createAnthropicService({env,sdk});const results=await Promise.all([service.generateStructured(request),service.generateStructured({...request,contents:'A different request source.'})]);
 assert.equal(checks,1);assert.equal(seen.length,2);assert.notEqual(seen[0].messages[0].content,seen[1].messages[0].content);
 assert.ok(seen.every(body=>body.model===model&&body.max_tokens===512&&body.output_config.format.type==='json_schema'));
 assert.equal(results[0].usageMetadata.promptTokenCount,100);assert.equal(results[0].usageMetadata.cacheReadInputTokens,12);
 await assert.rejects(service.generateStructured({...request,model:'unapproved-model'}),{code:'CLAUDE_MODEL_MISMATCH'});
});
test('missing credentials and unavailable exact model fail closed without any fallback message calls',async()=>{
 await assert.rejects(createAnthropicService({env:{}}).verifyModel(),{code:'ANTHROPIC_NOT_CONFIGURED'});
 let messages=0;const service=createAnthropicService({env,sdk:{models:{retrieve:async()=>{throw Object.assign(new Error('Unavailable'),{status:404});}},messages:{create:async()=>{messages++;}}}});
 await assert.rejects(service.generateStructured(request),{code:'CLAUDE_MODEL_UNAVAILABLE'});assert.equal(messages,0);
});
test('official schema transformation retains original local constraints and bounds malformed-response repairs',async()=>{
 let calls=0;const events=[];const client=createAnthropicService({env,sdk:{models:{retrieve:async()=>info},messages:{create:async()=>response(++calls===1?'This is too long to fit the original schema':'Valid')}}});
 const value=await generateJsonWithRetry({client,request,schema,stage:'migration-test',outputType:'presentation',logger:event=>events.push(event),sleep:async()=>{}});
 assert.equal(value.title,'Valid');assert.equal(calls,2);assert.equal(schema.properties.title.maxLength,12);assert.equal(events[0].errorCode,'AI_SCHEMA_VALIDATION_FAILED');assert.equal(events[0].usage.promptTokenCount,100);assert.equal(events[0].provider,'anthropic');
});
test('complex schemas use a private JSON envelope while the original response contract remains exact',async()=>{
 const large={type:'object',properties:Object.fromEntries(Array.from({length:25},(_,i)=>['field'+i,{type:'string',maxLength:3}])),required:[],additionalProperties:false};assert.equal(structuredOutputPlan(large).mode,'validated-json-envelope');
 const sdk={models:{retrieve:async()=>info},messages:{create:async body=>{
  assert.ok(body.messages[0].content.includes('Required payload schema'));
  return {...response('unused'),content:[{type:'text',text:JSON.stringify({payload:JSON.stringify({field0:'yes'})})}]};
 }}};
 const client=createAnthropicService({env,sdk});
 const result=await generateJsonWithRetry({client,request:{...request,config:{responseJsonSchema:large}},schema:large,stage:'complex-test',outputType:'webpage',logger:()=>{}});assert.deepEqual(result,{field0:'yes'});
});
test('old Google settings cannot activate generated imagery and a separate approval/key is mandatory',()=>{
 const old={GEMINI_API_KEY:'legacy',GOOGLE_IMAGE_MODEL:'legacy-image',PRESENTATION_ALLOW_IMAGE_GENERATION:'true',WEBPAGE_ALLOW_IMAGE_GENERATION:'true'};
 assert.equal(configuredImageProviders(old).generate,undefined);assert.ok(!websiteImageProviders(old).some(provider=>provider.kind==='generation'));
 assert.equal(imageGenerationSettings({AI_IMAGE_PROVIDER:'bfl',AI_IMAGE_MODEL:'flux-2-pro',ANTHROPIC_API_KEY:'text-only',AI_IMAGE_PROVIDER_APPROVED:'true'}).ready,false);
});
test('dedicated image adapter validates real raster bytes, caches by prompt and never forwards text credentials',async t=>{
 const root=await temporary(t),buffer=await fs.readFile('assets/webpage/curated/laboratory.jpg'),calls=[];
 const imageEnv={AI_IMAGE_PROVIDER:'bfl',AI_IMAGE_MODEL:'flux-2-pro',AI_IMAGE_PROVIDER_APPROVED:'true',AI_IMAGE_API_KEY:'separate-test-image-key',ANTHROPIC_API_KEY:'private-text-key'};
 const fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(options?.method==='POST'?{polling_url:'https://api.eu1.bfl.ai/v1/get_result?id=fixture'}:{status:'Ready',result:{sample:'https://images.example/generated.jpg'}}),{status:200});};
 const options={env:imageEnv,cacheRoot:root,fetch,download:async()=>({buffer})},input={prompt:'A laboratory workbench with research equipment',aspectRatio:'16:9'};
 const a=await generateImage(input,options),b=await generateImage(input,options);assert.equal(calls.length,2);assert.equal(a.cacheHit,false);assert.equal(b.cacheHit,true);assert.deepEqual(a.buffer,buffer);
 assert.equal(calls[0].options.headers['x-key'],imageEnv.AI_IMAGE_API_KEY);assert.equal(calls[1].options.headers,undefined);assert.ok(!JSON.stringify(calls).includes(imageEnv.ANTHROPIC_API_KEY));
 await generateImage({...input,prompt:'Another independent laboratory scene'},options);assert.equal(calls.length,4);
});
test('a submitted image task resumes after an uncertain result without another paid submission',async t=>{
 const root=await temporary(t),buffer=await fs.readFile('assets/webpage/curated/laboratory.jpg');let posts=0,ready=false;
 const options={env:{AI_IMAGE_PROVIDER:'bfl',AI_IMAGE_MODEL:'flux-2-pro',AI_IMAGE_PROVIDER_APPROVED:'true',AI_IMAGE_API_KEY:'image-test'},cacheRoot:root,fetch:async(url,options)=>{if(options.method==='POST'){posts++;return new Response(JSON.stringify({polling_url:'https://api.bfl.ai/v1/get_result?id=resume'}));}return new Response(JSON.stringify(ready?{status:'Ready',result:{sample:'https://images.example/result.jpg'}}:{status:'Pending'}));},sleep:async()=>{throw new Error('Controlled polling interruption');},download:async()=>({buffer})};
 await assert.rejects(generateImage({prompt:'Independent laboratory scene'},options),{code:'IMAGE_RESULT_UNAVAILABLE'});ready=true;await generateImage({prompt:'Independent laboratory scene'},options);assert.equal(posts,1);
});
test('container diagnostics distinguish unobservable host resources from measured cgroup counters',async()=>{
 assert.equal((await containerResources({platform:'win32'})).available,false);
 const values={'memory.current':'12345','memory.max':'536870912','cpu.stat':'usage_usec 1000\nthrottled_usec 42','cpu.max':'50000 100000','io.stat':'8:0 rbytes=12 wbytes=34'};
 const result=await containerResources({platform:'linux',read:async file=>values[path.basename(file)]});assert.equal(result.cpuQuotaCores,.5);assert.equal(result.memoryLimitBytes,536870912);assert.equal(result.ioWriteBytes,34);
});

test('optional Claude vision review sends actual raster bytes and rejects unrelated generated scenes',async()=>{
 let accepted=true,calls=0;const buffer=await fs.readFile('assets/webpage/curated/laboratory.jpg');
 const client=createAnthropicService({env,sdk:{models:{retrieve:async()=>info},messages:{create:async body=>{
  calls++;assert.equal(body.messages[0].content[1].source.media_type,'image/jpeg');assert.equal(body.messages[0].content[1].source.data,buffer.toString('base64'));
  return {...response('unused'),content:[{type:'text',text:JSON.stringify({accepted,reason:accepted?'MATCH':'SUBJECT_MISMATCH'})}]};
 }}}});
 const input={buffer,mimeType:'image/jpeg',prompt:'Laboratory research equipment'};
 assert.equal((await reviewGeneratedImage(input,{env:{},client})).status,'not-run');assert.equal(calls,0);
 assert.equal((await reviewGeneratedImage(input,{env:{AI_IMAGE_SEMANTIC_REVIEW:'true'},client,logger:()=>{}})).status,'passed');accepted=false;
 await assert.rejects(reviewGeneratedImage(input,{env:{AI_IMAGE_SEMANTIC_REVIEW:'true'},client,logger:()=>{}}),{code:'IMAGE_SEMANTIC_REJECTED'});
});

test('a lost paid POST receipt cannot cause automatic duplicate image submissions',async t=>{
 const root=await temporary(t);let posts=0;
 const options={env:{AI_IMAGE_PROVIDER:'bfl',AI_IMAGE_MODEL:'flux-2-pro',AI_IMAGE_PROVIDER_APPROVED:'true',AI_IMAGE_API_KEY:'test'},cacheRoot:root,fetch:async()=>{posts++;throw new Error('Connection lost after submission');}};
 for(let i=0;i<2;i++)await assert.rejects(generateImage({prompt:'A laboratory scene'},options),{code:'IMAGE_RESULT_UNAVAILABLE'});
 assert.equal(posts,1);
});

test('a confirmed BFL authentication rejection preserves its HTTP status without polling or hidden retries',async t=>{
 const root=await temporary(t);let calls=0;
 await assert.rejects(generateImage({prompt:'A laboratory scene'},{env:{AI_IMAGE_PROVIDER:'bfl',AI_IMAGE_MODEL:'flux-2-pro',AI_IMAGE_PROVIDER_APPROVED:'true',AI_IMAGE_API_KEY:'invalid-test'},cacheRoot:root,fetch:async()=>{calls++;return new Response('{}',{status:401});}}),error=>error.code==='IMAGE_PROVIDER_HTTP_ERROR'&&error.status===401);
 assert.equal(calls,1);
});
