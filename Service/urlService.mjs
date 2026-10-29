import {retrieveUrlSource} from "./input/urlRetrieval.mjs";
import {urlSourceByteLimit} from './input/urlBudget.mjs';

import { MAX_SOURCE_CHARACTERS } from './input/sourceLimits.mjs';

export const MAX_URL_TEXT_CHARACTERS=MAX_SOURCE_CHARACTERS;
export function sourceUrlByteLimit() {
    return urlSourceByteLimit();
}
export const urlService = async (url, options = {}) => {

    try {

        return (await retrieveUrlSource(url,{...options,maxBytes:sourceUrlByteLimit()})).text;

    } catch (error) {throw normalizeUrlError(error);}
};
export function normalizeUrlError(error){
        if(/^(AI_|CLAUDE_|ANTHROPIC_)/.test(error.code||''))return error;
        const codes={401:'SOURCE_URL_AUTH_REQUIRED',402:'SOURCE_URL_PAYWALL',403:'SOURCE_URL_ACCESS_DENIED',404:'SOURCE_URL_UNREACHABLE',410:'SOURCE_URL_UNREACHABLE',429:'SOURCE_URL_RATE_LIMITED'};
        const code=codes[error.status]||(error.status>=500?'SOURCE_URL_UNREACHABLE':/^E(?:CONN|HOST|NET)|ENOTFOUND|EAI_AGAIN/.test(error.code||'')?'SOURCE_URL_UNREACHABLE':error.code==='ETIMEDOUT'?'SOURCE_URL_TIMEOUT':error.code==='ERR_INVALID_URL'?'INVALID_SOURCE_URL':error.code||'SOURCE_URL_FAILED');
        const messages={SOURCE_URL_AUTH_REQUIRED:'This page requires sign-in. Use a public article or upload an authorized PDF/DOCX copy.',SOURCE_URL_PAYWALL:'This source requires a subscription or payment. Use a public article or upload an authorized PDF/DOCX copy.',SOURCE_URL_ACCESS_DENIED:'The source website denied automated access. Use another public article or upload an authorized PDF/DOCX copy.',SOURCE_URL_UNREACHABLE:'The source page could not be reached or no longer exists. Check the URL or use another public source.',SOURCE_URL_TIMEOUT:'The source website took too long to respond. Retry or use another public source.',SOURCE_URL_RATE_LIMITED:'The source website is limiting requests. Wait and retry or use another public source.'};
        const message=error.code==='SOURCE_URL_TOO_LARGE'?`The source page exceeds the ${error.maxBytes?error.maxBytes/1024/1024:sourceUrlByteLimit()/1024/1024} MB download limit. Use a shorter article URL or upload the relevant content as PDF/DOCX.`:error.message;
        return Object.assign(new Error(`URL processing failed: ${messages[code]||message}`), { code, stage: 'input-extraction',maxBytes:error.maxBytes,maxCharacters:error.maxCharacters,failurePhase:error.failurePhase });
}
