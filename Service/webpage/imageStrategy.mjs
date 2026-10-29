import {centralImageSubject} from './imageReview.mjs';
import {imageContextExclusions} from '../visual/imageRelevance.mjs';
import {wantsTextOnly,requiresAuthenticPhotography} from '../visual/imageArtDirection.mjs';
import {requestedLabels} from '../ai/requestedLabels.mjs';
import {imageIdentityLabel} from '../visual/imageIdentity.mjs';
import {imageGenerationEstimate} from '../visual/imageGenerationService.mjs';
const bounded=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Math.floor(Number(value)))):fallback;
export function imagePolicy(env=process.env){
    const amount=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
    return {estimatedUnitCost:imageGenerationEstimate(env,env.GOOGLE_IMAGE_RESOLUTION||'1K'),maxEstimatedCost:amount(env.AI_IMAGE_MAX_ESTIMATED_COST),maxAssets:bounded(env.WEBPAGE_IMAGE_MAX_ASSETS,8,1,8),maxGenerated:bounded(env.WEBPAGE_IMAGE_MAX_GENERATED,2,0,4),timeoutMs:bounded(env.WEBPAGE_IMAGE_TIMEOUT_MS,30000,1000,60000),totalMs:bounded(env.WEBPAGE_IMAGE_TOTAL_MS,60000,1000,120000),retries:bounded(env.WEBPAGE_IMAGE_RETRIES,0,0,1),concurrency:bounded(env.WEBPAGE_IMAGE_CONCURRENCY,2,1,2)};
}
export function planWebsiteImages(page,context={}){
    if(wantsTextOnly(context))return [];
    const instructions=[context.instructions,...(Array.isArray(context.keyInstructions)?context.keyInstructions:[])].join(' ');
    const requestedHero=instructions.match(/\bhero(?:\s+section)?\b[^.!?\n]{0,35}\b(?:featuring|showing|depicting)\s+([^.!?\n]{5,300})/i)?.[1]?.trim();
    const conceptualPage=/\b(?:futuristic|speculative|future civilization)\b/i.test([page.inferredContext?.topic,page.designBrief?.imageDirection,...(page.imagePlan||[]).filter(image=>image.role==='hero').map(image=>image.subject)].filter(Boolean).join(' '));
    const conceptImagery=(conceptualPage||/\b(?:futuristic|speculative)\b[^.!?\n]{0,35}\b(?:imagery|images?|scenes?|renderings?)\b/i.test(instructions))&&!requiresAuthenticPhotography(context);
    const exactObjects=/\b(?:every|each|all)\b[^.!?\n]{0,50}\b(?:photographs?|photos?|images?)\b[^.!?\n]{0,60}\bmatch\b/i.test(instructions);
    const namedLabels=requestedLabels(instructions);
    const requireImages=/\b(?:images?|imagery|photographs?|photography|pictures?)\b/i.test(instructions)&&! /\b(?:no|without|avoid)\s+(?:images?|pictures?|photographs?|photography)\b/i.test(instructions);
    const everySection=/\b(?:every|each|all)\s+(?:content\s+)?sections?\b[^.!?\n]{0,100}\b(?:images?|pictures?|photographs?)\b|\b(?:images?|pictures?|photographs?)\b[^.!?\n]{0,70}\b(?:every|each|all)\s+sections?\b/i.test(instructions);
    const style=[page.websiteBrief?.photography.style,page.websiteBrief?.photography.lighting,page.websiteBrief?.photography.temperature].filter(Boolean).join('; ')||'natural editorial';
    let subjects=page.websiteBrief?.photography.subjects||[];
    const central=centralImageSubject(page);
    let direction=page.designBrief.imageDirection||'';
    if(central.concepts.includes('finance')&&/geometric|architectural forms|abstract/i.test(direction)&&! /\b(?:abstract|geometric)[^.!?\n]{0,45}\b(?:imagery|images?|hero)\b/i.test(instructions)){
        direction='Financial planning workspace with a calculator and organized anonymized planning documents. No readable account details, fabricated returns or geometric placeholder blocks.';subjects=[direction];
    }
    const names=central.concepts.map(name=>name==='medicalTechnology'?'medical technology':name);
    const altSubject=(direction.split(/[.!?]/)[0]||page.inferredContext?.topic||page.title).slice(0,150);
    const hero={role:'hero',query:names.length?names.join(' ')+' '+direction:central.description+' '+direction,centralConcepts:central.concepts,alt:`Illustrative ${altSubject}`,aspectRatio:'16:9',style,purpose:'Communicate the central subject: '+central.description,lighting:page.websiteBrief?.photography.lighting||'natural',temperature:page.websiteBrief?.photography.temperature||'neutral',focalPoint:page.websiteBrief?.photography.crop||'center',method:'authorized-source-or-configured-generation'};
    const planned=(page.imagePlan||[]).flatMap(image=>{
        const section=page.sections[image.sectionIndex],item=section?.items[image.itemIndex];
        if(image.role!=='hero'&&!section||image.role==='item'&&!item)return [];
        return [{role:image.role,required:image.required,sectionType:section?.type||'',sectionId:section?.id||'',itemTitle:item?.title||'',query:image.subject,alt:image.alt,aspectRatio:image.aspectRatio,style}];
    });
    if(!planned.some(image=>image.role==='hero'))planned.unshift(hero);
    for(const section of page.sections){
        if(section.type==='gallery'||exactObjects&&['products','projects'].includes(section.type))for(const item of section.items){
            if(!planned.some(image=>image.sectionId===section.id&&image.itemTitle===item.title))planned.push({role:'item',sectionType:section.type,sectionId:section.id,itemTitle:item.title,query:`${item.title}. ${item.description}`,alt:`Illustrative ${item.title}`,aspectRatio:'3:2',style});
        }
        else if(['image-text','image-band'].includes(section.composition)&&!planned.some(image=>image.sectionId===section.id))planned.push({role:'section',sectionType:section.type,sectionId:section.id,query:`${section.heading}. ${subjects.join(', ')}`,alt:`Illustrative imagery: ${section.heading}`,aspectRatio:'16:9',style});
    }
    // Purposeful supporting scenes by default, even for a short legacy AI plan.
    for(const section of page.sections.filter(s=>!['contact','faq','statistics','testimonials','pricing'].includes(s.type)).slice(0,2))if(!planned.some(image=>image.sectionId===section.id))planned.push({role:'section',sectionType:section.type,sectionId:section.id,query:`${section.heading}. ${section.content.slice(0,180)}`,alt:section.heading,aspectRatio:'3:2',strictSubject:true,...(/\b(?:learning methods|model training|reasoning|neural networks?|algorithm|evaluation|learning workflow)\b/i.test(section.heading+' '+section.content)?{visualIntent:'concept'}:{}),style});
    const seen=new Set();return planned.filter(image=>{const key=[image.role,image.sectionId,image.itemTitle].join(':');if(seen.has(key))return false;seen.add(key);return true;}).map(image=>({...image,
        ...(conceptImagery?{visualIntent:'concept'}:{}),
        ...(!conceptImagery&&/\b(?:photographs?|photography|photographed)\b/i.test(instructions)?{visualIntent:'photograph'}:{}),
        ...(requiresAuthenticPhotography(context)?{authenticOnly:true}:{}),
        ...(exactObjects&&image.role==='item'&&['products','projects'].includes(image.sectionType)?{identityLabel:imageIdentityLabel(image.itemTitle,namedLabels)}:{}),
        ...(image.role==='hero'&&requestedHero?{query:requestedHero,centralConcepts:undefined,alt:requestedHero}:{}),
        topic:page.inferredContext?.topic||page.title,subjectContext:central.description,primaryTopic:page.inferredContext?.topic||page.title,sectionTopic:image.itemTitle||page.sections.find(section=>section.id===image.sectionId)?.heading||'',
        exclusions:imageContextExclusions(context),
        required:image.required??(image.role==='item'||image.role==='section'&&everySection||image.role==='hero'&&(requireImages||['full-bleed','image-led'].includes(page.designBrief.heroComposition))),purpose:image.purpose||image.sectionType+' content: '+(image.itemTitle||image.query),lighting:image.lighting||page.websiteBrief?.photography.lighting||'natural',temperature:image.temperature||page.websiteBrief?.photography.temperature||'neutral',focalPoint:image.focalPoint||page.websiteBrief?.photography.crop||'center',method:image.method||'authorized-source-or-configured-generation'}));
}
