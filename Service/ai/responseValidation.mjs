export class AiGenerationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "AiGenerationError";
        this.code = code;
        Object.assign(this, details);
    }
}

export function validateSchema(value, schema, location = "$", strict = true) {
    const fail = (message,details={}) => { throw new AiGenerationError("AI_SCHEMA_VALIDATION_FAILED", `${location}: ${message}`, { field: location,validationRule:'SCHEMA_CONTRACT', repairHint: `${location}: ${message}`,...details }); };
    if(schema.anyOf) {
        const discriminated=schema.anyOf.find(branch=>branch.properties?.type?.enum?.includes(value?.type));
        if(discriminated)return validateSchema(value,discriminated,location,strict);
        for(const branch of schema.anyOf){try{validateSchema(value,branch,location,strict);return;}catch(error){if(error.code!=='AI_SCHEMA_VALIDATION_FAILED')throw error;}}
        fail('value does not match a supported schema variant');
    }
    if (value === null && schema.nullable) return;
    const type = schema.type?.toLowerCase();
    if (type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
        for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
        for (const [key, item] of Object.entries(value)) {
            if (Object.hasOwn(schema.properties || {}, key)) validateSchema(item, schema.properties[key], `${location}.${key}`, strict);
            else if (strict || schema.additionalProperties === false) fail(`unsupported property ${key}`);
        }
    } else if (type === "array") {
        if (!Array.isArray(value)) fail("expected array");
        if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail("array length outside allowed range");
        value.forEach((item, index) => validateSchema(item, schema.items, `${location}[${index}]`, strict));
    } else if (type === "string") {
        if (typeof value !== "string") fail("expected string");
        if(schema.minLength!=null&&value.trim().length<schema.minLength)fail(`text must contain at least ${schema.minLength} characters`);
        if(schema.maxLength!=null&&value.length>schema.maxLength)fail(`text must contain at most ${schema.maxLength} characters`,{maxCharacters:schema.maxLength});
    } else if (type === "integer" || type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) fail(`expected ${type}`);
        if(schema.minimum!=null&&value<schema.minimum)fail(`value must be at least ${schema.minimum}`);
        if(schema.maximum!=null&&value>schema.maximum)fail(`value must be at most ${schema.maximum}`);
    } else if (type === "boolean" && typeof value !== "boolean") fail("expected boolean");
    if (schema.enum && !schema.enum.includes(value)) fail("unsupported enum value");
}

export function validateTextSafety(value, outputType, location = "$", blockType) {
    if (typeof value === "string") {
        // Inspect text fields only: legitimate repeated numeric dataset values are allowed.
        const repeatedPattern = [...value.matchAll(/(.{1,20})\1{7,}/gu)].find(([pattern])=>pattern.length>=48&&!/^\s+$/.test(pattern)&&!(blockType==='code'&&/^[\s\-_=+|─│┌┐└┘┬┴┼]+$/u.test(pattern)));
        if (repeatedPattern || /\b([\p{L}]+(?:\s+[\p{L}]+){0,4})(?:\s+\1){7,}\b/iu.test(value)) {
            throw new AiGenerationError("AI_REPETITIVE_OUTPUT", `${location}: degenerate repeated text`, {field:location,validationRule:'REPEATED_TEXT',repairHint:'Replace repeated words or character sequences with a concise substantive explanation. For diagrams, use short labeled nodes and arrows in a code block, not long decorative separators.'});
        }
        const field = location.split(".").at(-1);
        const limit = /subtitle/i.test(field) ? 240 : /title|heading/i.test(field) ? 180
            : outputType === "presentation" ? (/body/i.test(field) ? 1200 : 1600) : 50000;
        if (value.length > limit) throw new AiGenerationError("AI_TEXT_TOO_LONG", `${location}: text exceeds ${limit} characters`, {field:location,maxCharacters:limit});
    } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) validateTextSafety(item, outputType, `${location}.${key}`,value.type||blockType);
    }
}

export function parseResponse(response, { schema, outputType, strict = true, collectErrors=false }) {
    const reason = response?.candidates?.[0]?.finishReason;
    if (reason === "MAX_TOKENS") throw new AiGenerationError("AI_RESPONSE_TRUNCATED", "AI response reached its output token limit");
    if (response?.promptFeedback?.blockReason || ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"].includes(reason)) {
        throw new AiGenerationError("AI_RESPONSE_BLOCKED", "AI response did not finish successfully", { finishReason: reason });
    }
    if (typeof response?.text !== "string" || !response.text.trim()) throw new AiGenerationError("AI_RESPONSE_EMPTY", "AI returned no response text");
    if (reason !== "STOP") throw new AiGenerationError("AI_RESPONSE_INCOMPLETE", "AI response has no successful finish reason");
    let value;
    try { value = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1")); }
    catch { throw new AiGenerationError("AI_JSON_PARSE_FAILED", "AI returned malformed JSON"); }
    try{validateSchema(value, schema, "$", strict);}catch(error){
        if(collectErrors){const errors=[];const walk=(v,s,p)=>{if(typeof v==='string'&&s.maxLength!=null&&v.length>s.maxLength)errors.push({field:p,maxCharacters:s.maxLength});if(v&&typeof v==='object'&&!s.anyOf){if(Array.isArray(v)&&s.items)v.forEach((child,i)=>walk(child,s.items,`${p}[${i}]`));else for(const [key,child] of Object.entries(v))if(s.properties?.[key])walk(child,s.properties[key],`${p}.${key}`);}};walk(value,schema,'$');if(error.maxCharacters&&errors.length)error.validationErrors=errors.slice(0,64);}
        throw error;
    }
    validateTextSafety(value, outputType);
    return value;
}
