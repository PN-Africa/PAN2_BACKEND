import {createHash} from 'node:crypto';
// Never log arbitrary provider prose: it can echo submitted source or keys.
// These recognized provider messages contain configuration facts only.
export function sanitizedProviderDiagnostic(error){
 const detail=error?.error?.error||error?.error||{};
 const raw=String(detail.message||error?.message||'');
 const type=/^[a-z_]{1,64}$/.test(detail.type||'')?detail.type:undefined;
 const known=[[/schema is too complex for compilation/i,'Schema is too complex for compilation.'],[/too many optional parameters/i,'Too many optional parameters in structured output schema.'],[/max_tokens.*(?:greater|less|maximum|limit)/i,'Output token limit rejected; check model limits.'],[/invalid.*(?:schema|output_config)|(?:schema|output_config).*invalid/i,'Structured output schema or output_config was rejected.'],[/invalid.*api.?key|authentication/i,'Provider authentication rejected.'],[/overload/i,'Provider overloaded.']].find(([pattern])=>pattern.test(raw));
 const safe=value=>/^[a-zA-Z0-9_]{1,80}$/.test(String(value||''))?String(value):undefined;
 return {providerErrorType:type,providerErrorMessage:known?.[1]||'Unrecognized provider message withheld to protect user data.',providerErrorHash:createHash('sha256').update(raw).digest('hex').slice(0,16),exceptionName:safe(error?.constructor?.name)||safe(error?.name),exceptionCode:safe(error?.code),causeName:safe(error?.cause?.constructor?.name)||safe(error?.cause?.name),causeCode:safe(error?.cause?.code)};
}
