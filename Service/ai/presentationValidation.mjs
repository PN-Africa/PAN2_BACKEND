import {validatePresentationContent} from '../presentationContentValidator.mjs';
import {AiGenerationError} from './responseValidation.mjs';
import {recoverableSlideFailure} from './presentationRepairBudget.mjs';
import {canonicalTitles} from './presentationQuality.mjs';
import {presentationLayoutService} from '../presentationLayoutService.mjs';
import {generateIndependent,generationConcurrency} from './concurrency.mjs';
import {measureStage} from '../performance.mjs';

export function validateCompletedPresentation(presentation,source) {
    validatePresentationContent({
        outputType:presentation.outputType,title:presentation.title,subtitle:presentation.subtitle,
        strategyId:presentation.strategyId,inferredContext:presentation.inferredContext,
        slides:presentation.slides.map(({slideNumber,slideType,title,subtitle,content})=>({slideNumber,slideType,title,subtitle,content}))
    },source);
    presentationLayoutService(presentation,source?.context||{});
    return true;
}

export async function repairPresentationValidation({presentation,source,requestId,repairSlide,fallbackSlide,concurrency=2}) {
    for(let round=0;round<=2;round++){
        try{await measureStage('presentation-schema-validation',()=>validateCompletedPresentation(presentation,source));return;}
        catch(error){
            const issues=(error.validationErrors||[error.message]).map(issue=>typeof issue==='string'?issue:`Slide ${error.slideNumber||''}: ${issue.field||'content'} ${Number.isInteger(issue.maxCharacters)?'maximum '+issue.maxCharacters+' characters. ':''}${issue.repairHint||''}`);
            const targets=new Map();
            for(const issue of issues){
                const numbers=[...issue.matchAll(/\bSlide (\d+)/g)].map(match=>Number(match[1]));
                numbers.push(...[...issue.matchAll(/slides\[(\d+)\]/g)].map(match=>Number(match[1])+1));
                if(/Presentation averages approximately/i.test(issue)) numbers.push(...presentation.slides.map((_,index)=>index+1));
                if(/Presentation (?:title|subtitle)/i.test(issue))numbers.push(1);
                for(const number of numbers)if(presentation.slides[number-1]){
                    if(!targets.has(number))targets.set(number,[]);
                    targets.get(number).push(issue);
                }
            }
            if(round===2||!targets.size)throw new AiGenerationError('AI_SCHEMA_VALIDATION_FAILED','Presentation still fails content validation',{
                requestId,stage:'presentation-validation',validationRule:'PRESENTATION_CONTENT',slideNumber:targets.keys().next().value,validationErrors:issues,cause:error
            });
            const snapshot=structuredClone(presentation.slides),approved=[];
            await generateIndependent([...targets],generationConcurrency(concurrency,2),async([number,requirements])=>{
                const slide=presentation.slides[number-1];
                const planned=source?.plannedSlides?.find(item=>item.slideNumber===number);
                const instructions=[...requirements,
                    'Resolve these exact validation failures in the visible content. Preserve the slide number, semantic type and approved objective.',
                    `Approved objective: ${JSON.stringify(planned || {title:slide.title})}`,
                    `Other slides (avoid duplicating their title or body): ${JSON.stringify(snapshot.filter(item=>item.slideNumber!==number).map(({slideNumber,title,content})=>({slideNumber,title,content})))}`];
                if(requirements.some(issue=>/drifted away/i.test(issue))) instructions.push('Make the connection to the presentation topic explicit in the visible body, and explain the approved subtopic using its specific terminology.');
                if(requirements.some(issue=>/Presentation averages/i.test(issue))) instructions.push('Reduce visible text to fewer than 100 words while preserving essential facts.');
                let repaired;
                try{repaired=await repairSlide(structuredClone(slide),instructions.join('\n'));}catch(failure){if(!fallbackSlide||!recoverableSlideFailure(failure))throw failure;repaired=await fallbackSlide(structuredClone(slide),instructions.join('\n'));if(!repaired)throw failure;}
                // Callbacks may return either complete slide metadata or canonical content.
                const candidate=repaired?.content?{...slide,...repaired}:{...slide,content:repaired};
                candidate.slideNumber=slide.slideNumber;
                candidate.slideType=candidate.contentFallback?.to==='focused-explanation'?'focused-explanation':slide.slideType;
                presentationLayoutService({title:presentation.title,subtitle:presentation.subtitle,slides:[candidate]},source?.context||{});
                return {slide,candidate};
            },value=>{approved.push(value);});
            for(const {slide,candidate} of approved)Object.assign(slide,candidate);
            canonicalTitles(presentation);
        }
    }
}
