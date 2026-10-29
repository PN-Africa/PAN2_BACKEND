import {createAnthropicService} from '../../Service/ai/textProvider.mjs';
// Native Messages protocol over deterministic fixtures. No API/network calls.
export function anthropicFixture(handler,{latencyMs=0}={}){
 const calls=[],model='claude-opus-5-5';let modelChecks=0;
 const client=createAnthropicService({env:{CLAUDE_MODEL:model},sdk:{models:{retrieve:async()=>{modelChecks++;return {id:model,capabilities:{structured_outputs:{supported:true},effort:{supported:true}}};}},messages:{create:async body=>{
  calls.push(body);if(latencyMs)await new Promise(resolve=>setTimeout(resolve,latencyMs));
  const message=body.messages[0].content,prompt=typeof message==='string'?message:message.find(block=>block.type==='text').text,marker='Required payload schema: ',envelope=prompt.includes(marker),schema=envelope?JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length)):body.output_config.format.schema;
  const value=await handler({prompt,schema,body});
  return {model,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(envelope?{payload:JSON.stringify(value)}:value)}],usage:{input_tokens:100,output_tokens:80}};
 }}}});
 return {client,calls,get modelChecks(){return modelChecks;}};
}
