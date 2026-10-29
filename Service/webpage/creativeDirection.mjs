import {creativeDirectionSchema,BACKGROUNDS} from '../../templates/webpage/webpageSchema.mjs';
import {validateSchema} from '../ai/responseValidation.mjs';
import {webpageError} from './errors.mjs';

// Dedicated direction resolution, using AI planning without another model call.
export function directWebsite(page,context={}){
    const given=page.creativeDirection||{};
    if(page.creativeDirection)validateSchema(given,creativeDirectionSchema);
    const preferences=context.designPreferences||{};
    const words=[context.instructions,context.topic,context.websiteBrief?.brandPersonality,...(context.websiteBrief?.designAdjectives||[]),page.visualDirection].filter(Boolean).join(' ');
    const expressive=/expressive|playful|vibrant|maximal|festival/i.test(words);
    const restrained=/minimal|restrained|quiet|understated/i.test(words);
    const defaults={concept:page.visualDirection||page.title+' — a visual introduction',personality:context.websiteBrief?.brandPersonality||page.designBrief.visualTone||'clear',background:/gradient/i.test(words)?'gradient':/textur/i.test(words)?'texture':restrained?'plain':'gradient',spacing:page.designBrief.density==='compact'?'compact':'balanced',geometry:expressive?'round':restrained?'square':'soft',typeScale:expressive?'expressive':restrained?'restrained':'balanced',ctaStyle:expressive?'pill':'solid',interactions:[]};
    const direction={...defaults,...given,...(page.artifactDesign?{spacing:page.artifactDesign.theme.spacing==='spacious'?'generous':page.artifactDesign.theme.spacing}:{})};
    for(const key of ['background','spacing','geometry','typeScale','ctaStyle','interactions'])if(preferences[key]!==undefined)direction[key]=preferences[key];
    validateSchema(direction,creativeDirectionSchema);
    if(direction.concept.length>500||direction.personality.length>200)throw webpageError('Keep creative direction concise','creativeDirection');
    const features=(context.websiteBrief?.features||[]).join(' ');
    if(/\bsearch\b/i.test(features)&&!direction.interactions.includes('search'))direction.interactions.push('search');
    if(/\bfilter/i.test(features)&&!direction.interactions.includes('filter'))direction.interactions.push('filter');
    if(page.sections.some(s=>s.type==='gallery'&&s.items.length)&&!direction.interactions.includes('gallery'))direction.interactions.push('gallery');
    direction.interactions=[...new Set(direction.interactions)];
    const quiet=restrained||/minimal|quiet|restrained/i.test(direction.personality);
    const explicitBackgrounds=preferences.sectionBackgrounds||{};
    const sections=page.sections.map((section,index)=>{
        const semantic={process:'dark',statistics:'brand',comparison:'accent',values:'dark',contact:'gradient',faq:'tinted',gallery:'plain',projects:'plain',about:'light',features:'tinted',services:'gradient',topics:'accent'};
        const background=explicitBackgrounds[section.id]||(preferences.uniformBackground?'plain':section.background||preferences.background||(quiet?'plain':semantic[section.type]||'plain'));
        if(!BACKGROUNDS.includes(background))throw webpageError('Unsupported section background',`sections[${index}].background`);
        return {...section,background};
    });
    // Repair an accidentally uniform automatic plan using a meaningful focal
    // section, never a fixed alternating color cycle or an explicit user override.
    if(!quiet&&!preferences.background&&!preferences.uniformBackground&&!Object.keys(explicitBackgrounds).length&&sections.length>=3&&!sections.some(s=>['brand','dark','gradient'].includes(s.background))){
        const focal=sections.find(s=>['process','comparison','features','topics','values'].includes(s.type))||sections.at(-1);focal.background=direction.background==='plain'?'brand':'gradient';
    }
    return {...page,creativeDirection:direction,sections};
}
