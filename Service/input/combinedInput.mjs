import {validateUploadedFile} from './fileValidation.mjs';
import {requestedTopics} from '../ai/presentationQuality.mjs';
import {resolveSlideCount} from '../ai/slideCount.mjs';
import {MAX_SOURCE_CHARACTERS} from './sourceLimits.mjs';
import {validateTextPrompt} from './promptValidation.mjs';
import {unpackUrlSource} from './urlUnderstanding.mjs';

const invalid=message=>Object.assign(new Error(message),{code:'INVALID_REQUEST'});
function optionalText(value,name,max) {
    if(value==null)return '';
    if(typeof value!=='string'||value.length>max)throw invalid(`${name} must be text no longer than ${max} characters.`);
    return value.trim();
}
export async function combineGenerationInput({body,file,context,extractFile,extractUrl,signal}) {
    const prompt=validateTextPrompt(body.textPrompt,{optional:true}),url=optionalText(body.urlPrompt,'urlPrompt',2048);
    if(!prompt&&!url&&!file)throw invalid('Type a prompt, provide a public URL, or attach a PDF or DOCX file.');
    const extraInstructions=optionalText(context.instructions,'context.instructions',20000);
    if(url) {
        let target;try{target=new URL(url);}catch{throw invalid('Provide a valid public HTTP(S) URL.');}
        if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw invalid('Provide a public HTTP(S) URL without credentials.');
    }
    const instructions=[extraInstructions,prompt].filter(Boolean).join('\n\n');
    let resolvedContext={...context,...(instructions?{instructions}: {})};
    if(instructions){
        resolvedContext.keyInstructions=[...(Array.isArray(context.keyInstructions)?context.keyInstructions:[]),instructions];
        resolvedContext.requiredTopics=requestedTopics(instructions,context);
    }
    if(body.outputType==='presentation')resolveSlideCount('',resolvedContext);
    // Reject invalid instructions or a bad attachment before URL requests/AI.
    if(file)await validateUploadedFile(file);
    const results=await Promise.allSettled([file?extractFile(file):null,url?extractUrl(url,{context:resolvedContext,outputType:body.outputType,signal}):null]);
    const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    const [fileText,urlResult]=results.map(result=>result.value),sources=[];
    let urlText=urlResult;if(url){const source=unpackUrlSource(urlResult,url,resolvedContext);urlText=source.text;resolvedContext=source.context;}
    if(file){if(typeof fileText!=='string'||!fileText.trim())throw invalid('The attached file contains no readable text.');sources.push({type:'file',name:file.originalname});}
    if(url){if(typeof urlText!=='string'||!urlText.trim())throw invalid('The URL contains no readable text.');sources.push({type:'url',url});}
    if(prompt)sources.push({type:'prompt'});
    const inputType=file?'file':url?'url':'prompt';
    // Each source is explicitly delimited. Instructions remain separately
    // available in context; file/URL text remains untrusted source material.
    const input=!file&&!url?instructions:[instructions?`USER REQUEST\n${instructions}`:'',file?`ATTACHED FILE SOURCE (${JSON.stringify(file.originalname)})\n${fileText}`:'',url?`URL SOURCE (${JSON.stringify(url)})\n${urlText}`:''].filter(Boolean).join('\n\n');
    if(input.length>MAX_SOURCE_CHARACTERS)throw invalid('Combined source text exceeds 200,000 characters. Use shorter sources or split the request.');
    return {inputType,input,context:resolvedContext,sources,label:JSON.stringify({textPrompt:prompt,urlPrompt:url,fileName:file?.originalname})};
}
