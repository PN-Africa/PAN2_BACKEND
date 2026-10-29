import {getTextClient} from '../ai/textProvider.mjs';
import {resolvePublicUrl} from './publicUrl.mjs';
import {sourceError} from './urlContent.mjs';
import {withinUrlBudget} from './urlBudget.mjs';
export function claudeUrlFetcher({env=process.env,client,resolve=resolvePublicUrl}={}){
 if(env.URL_CLAUDE_WEB_FETCH_ENABLED!=='true')return undefined;
 const domains=(env.URL_CLAUDE_WEB_FETCH_DOMAINS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 return async(value,{signal,timeoutMs})=>{
  const end=Date.now()+timeoutMs;
  const {url}=await withinUrlBudget(end,'web-fetch-validation',()=>resolve(value),signal);
  if(!domains.includes(url.hostname)||url.search||url.href.length>250)throw sourceError('CLAUDE_WEB_FETCH_UNAVAILABLE','Native fetching is disabled for this source by server policy.');
  const transport=client||getTextClient(env);
  if(!transport.fetchPublicSource)throw sourceError('CLAUDE_WEB_FETCH_UNAVAILABLE','Configured text transport does not expose native web fetching.');
  let response;try{response=await transport.fetchPublicSource({url:url.href,signal,timeoutMs:Math.max(1,end-Date.now())});}catch(error){if(error.status===400||error.code==='CLAUDE_WEB_FETCH_UNAVAILABLE')throw sourceError('CLAUDE_WEB_FETCH_UNAVAILABLE','The model/account rejected native web fetching.');throw sourceError('CLAUDE_WEB_FETCH_FAILED','The native web-fetch provider could not complete retrieval.');}
  const uses=response.content?.filter(b=>b.type==='server_tool_use'&&b.name==='web_fetch')||[];
  const blocks=response.content?.filter(b=>b.type==='web_fetch_tool_result')||[];
  if(uses.length!==1||uses[0].input?.url!==url.href||blocks.length!==1||blocks[0].tool_use_id!==uses[0].id)throw sourceError('CLAUDE_WEB_FETCH_FAILED','No verifiable exact-source tool result was returned.');
  const result=blocks[0].content;
  if(result?.type==='web_fetch_tool_result_error')throw sourceError('CLAUDE_WEB_FETCH_FAILED','The source could not be retrieved by the native tool.',{toolErrorCode:result.error_code});
  // Restrict native redirects: unlike direct HTTP, Ledify cannot pin each
  // provider-side redirect. A result for another URL is never substituted.
  if(result?.type!=='web_fetch_result'||result.url!==url.href||result.content?.source?.type!=='text'||result.content.source.media_type!=='text/plain')throw sourceError('CLAUDE_WEB_FETCH_FAILED','Native source content was absent, redirected or unsupported.');
  if(typeof result.content.source.data!=='string'||!result.content.source.data.trim())throw sourceError('CLAUDE_WEB_FETCH_FAILED','Native source text was empty or malformed.');
  await withinUrlBudget(end,'web-fetch-result-validation',()=>resolve(result.url),signal);
  return {text:result.content.source.data,title:typeof result.content.title==='string'?result.content.title.slice(0,240):'',contentType:'text/plain',finalUrl:url.href};
 };
}
