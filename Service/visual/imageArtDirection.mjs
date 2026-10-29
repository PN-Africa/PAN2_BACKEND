import {imageContextExclusions} from './imageRelevance.mjs';
export function wantsTextOnly(context={}){
    const clauses=[context.instructions,...(Array.isArray(context.keyInstructions)?context.keyInstructions:[])].filter(Boolean).flatMap(value=>String(value).split(/[.!?;\n]+/));
    return clauses.some(clause=>{
        if(!/\b(?:text[ -]only|image[ -]free|photo[ -]free|(?:no|without|avoid)\s+(?:any\s+)?(?:photos?|photographs?|photography|images?|pictures?))\b/i.test(clause))return false;
        // A local exclusion must not erase imagery requested elsewhere. Explicit
        // numbered exclusions remain enforced by the per-slide layout policy.
        const scoped=/\b(?:slides?\s*\d|(?:first|second|third|last|remaining|other|supporting)\s+(?:slides?|sections?)|rest|except|hero|cover|footer)\b/i.test(clause)||/\bsection\b/i.test(clause)&&!/\b(?:all|every|entire)\b/i.test(clause);
        return !scoped;
    });
}
export function requiresAuthenticPhotography(context={}){
    const text=[context.instructions,...(Array.isArray(context.keyInstructions)?context.keyInstructions:[])].join(' ');
    return /\b(?:authentic|real|actual)\b[^.!?\n]{0,60}\b(?:photo(?:graph(?:ic|y|s)?)?s?|images?|pictures?)\b|\b(?:no|without|never|do not use|avoid)\s+AI[- ]generated\s+(?:images|scenes|photos|pictures)/i.test(text);
}
export function slidePhotoPolicy(context,slide){
    const text=[context.instructions,...(Array.isArray(context.keyInstructions)?context.keyInstructions:[])].join(' ');
    const conceptImage=/\bconcept (?:imagery|images?|illustrations?|vehicles?)\b/i.test(text)&&/\bconcept\b/i.test([slide.title,slide.objective,slide.visualRequirement?.description].join(' '))&&!/\b(?:no|without|never|do not use|avoid)\s+AI[- ]generated/i.test(text);
    const authenticPhotoOnly=requiresAuthenticPhotography(context)&&!conceptImage;
    return {authenticPhotoOnly,conceptImage,sourceStrategy:authenticPhotoOnly?'licensed-search-first':conceptImage?'generate-first':slide.visualRequirement?.sourceStrategy||(slide.visualRequirement?.kind==='photo'?'licensed-search-first':'generate-first')};
}
export function photoCompositionFor(slide){
    if(slide.isCover)return 'hero-full-bleed';
    if(slide.slideType==='title')return 'hero-full-bleed';
    if(slide.slideType==='section-divider')return 'photo-divider';
    if(slide.slideType==='focused-explanation'&&slide.contentFallback?.to==='focused-explanation')return 'photo-technical';
    if(slide.slideType==='timeline'||slide.content?.chart||slide.content?.table||slide.content?.relationship||slide.content?.timeline||slide.content?.visualContent?.visual?.diagram)return 'photo-technical';
    return slide.content?.comparison?'photo-comparison':slide.slideNumber%3===0?'photo-panel':'photo-editorial';
}
export const photoSignature=(slide,presentation={},context={})=>JSON.stringify([presentation.title,presentation.inferredContext?.topic,slide.title,slide.objective,slide.visualRequirement,photoCompositionFor(slide),imageContextExclusions(context),requiresAuthenticPhotography(context)]);
export const photoSubjectSignature=(slide,presentation={},context={})=>JSON.stringify([presentation.title,presentation.inferredContext?.topic,slide.title,slide.objective,slide.visualRequirement,imageContextExclusions(context),requiresAuthenticPhotography(context)]);
export function imageBrief(presentation,slide,theme,context={}){
    const request=slide.imageRequirement||slide.visualRequirement||{};
    const point=context.designPreferences?.imageFocalPoints?.[slide.slideNumber]||context.designPreferences?.imageFocalPoint||{x:.5,y:.5};
    const coordinate=v=>Number.isFinite(Number(v))?Math.max(0,Math.min(1,Number(v))):.5;
    const composition=photoCompositionFor(slide);
    return {...request,exclusions:imageContextExclusions(context),slideNumber:slide.slideNumber,slideTitle:slide.title,subject:presentation.title,message:slide.objective||slide.title,
        audience:context.audience||presentation.inferredContext?.audience||'general audience',
        description:request.description||`${slide.title}; illustrative context for ${presentation.title}`,
        searchQuery:request.searchQuery||[presentation.title,slide.title].join(' ').slice(0,160),
        purpose:request.role==='background'?'opening context':slide.objective||slide.title,
        theme:theme.family,palette:theme.palette,style:theme.style,
        composition,aspectRatio:composition.startsWith('hero-')?'16:9':'4:3',preferredPlacement:composition,cropStrategy:'cover-with-focal-point',
        ...slidePhotoPolicy(context,slide),qualityRequirements:{minWidth:800,minHeight:600,minEffectivePpi:90,maxBytes:12*1024*1024},
        lighting:'natural, restrained contrast, consistent daylight',perspective:'editorial eye-level or subject-appropriate wide view',
        focalPoint:{x:coordinate(point.x),y:coordinate(point.y)},
        textSpace:'Text sits on a separate opaque theme panel; preserve the subject in the image area.',
        syntheticDisclosure:slidePhotoPolicy(context,slide).conceptImage?'Illustrative vehicle concept; not a manufactured product.':'Illustrative AI-generated artwork; not a photograph of an actual person, event, product or facility.',
        scientificAccuracy:'No invented diagnostic findings, anatomical structures, certifications, logos or real-world evidence.'};
}
export function generationPrompt(brief){
    // RGB dictionaries can be mistaken for instructions to draw a brand board.
    // Translate colors to atmosphere words; keep exact RGB tokens in slide CSS.
    const colors=[...new Set(Object.values(brief.palette||{}).filter(v=>typeof v==='string'&&/^#?[a-f\d]{6}$/i.test(v)).map(value=>{
        const rgb=value.replace('#','').match(/../g).map(v=>parseInt(v,16)/255),max=Math.max(...rgb),min=Math.min(...rgb),light=(max+min)/2;
        if(light<.13)return 'near black';if(light>.88)return 'soft white';if(max-min<.1)return light<.4?'charcoal gray':'neutral gray';
        const [r,g,b]=rgb,delta=max-min,hue=((max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60+360)%360;
        return (light<.35?'deep ':'muted ')+(hue<30?'red':hue<65?'warm ochre':hue<155?'green':hue<195?'teal':hue<260?'blue':hue<320?'violet':'rose');
    }))].slice(0,5).join(', ');
    return `Return exactly one uninterrupted, edge-to-edge editorial scene, not a presentation slide, moodboard, design sheet or brand guide. No text, typography, legends, palette strips, color swatches, captions, UI, borders or labels anywhere in the image. Subject: ${brief.subject}. Slide message is context only: ${brief.message}. Audience: ${brief.audience}. Specific scene: ${brief.description}. Aspect ratio ${brief.aspectRatio}; focal point ${JSON.stringify(brief.focalPoint)}. Lighting: ${brief.lighting}. Perspective: ${brief.perspective}. Visual tone: ${brief.style}. Color atmosphere: ${colors}; use these tones only for the scene, never display samples or codes. ${brief.textSpace} ${brief.scientificAccuracy} No text, logos, watermarks or charts. ${brief.syntheticDisclosure} Only depict the subject, with absolutely no presentation copy or design annotations.`;
}
export function planImageCoverage(presentation,context={}){
    const noPhotos=wantsTextOnly(context);
    const slides=presentation.slides.map((s,index)=>({...s,isCover:index===0}));
    const cover=slides[0];
    if(cover&&!noPhotos){
        const visual=['photo','illustration'].includes(cover.visualRequirement?.kind)?cover.visualRequirement:{};
        const subject=presentation.inferredContext?.topic||context.topic||presentation.title||cover.title;
        cover.visualRequirement={...visual,role:'background',kind:visual.kind||'photo',required:true,
            description:visual.description||`A relevant editorial scene representing ${subject}`,
            searchQuery:visual.searchQuery||subject,altText:visual.altText||`Illustrative context for ${subject}`,
            sourceStrategy:visual.sourceStrategy||'licensed-search-first'};
    }
    const excluded=new Set(Array.isArray(context.designPreferences?.noImageSlideNumbers)?context.designPreferences.noImageSlideNumbers:[]);
    if(cover)excluded.delete(cover.slideNumber);
    for(const s of slides)if(!s.isCover&&excluded.has(s.slideNumber)&&['photo','illustration','texture'].includes(s.visualRequirement?.kind))s.visualRequirement={role:'none',kind:'none',required:false,description:'',searchQuery:'',altText:''};
    // Inferred planner instructions are not evidence of a user's requirement.
    const instructions=context.imageRequirementInstructions??[context.instructions,...(Array.isArray(context.keyInstructions)?context.keyInstructions:[])].join(' ');
    const all=/\b(?:every|each|all)\s+(?:single\s+)?slides?\b[^.!?\n]{0,120}\b(?:images?|pictures?|photo(?:graph(?:y|s|ic)?)?)\b|\b(?:images?|pictures?|photographs?)\b[^.!?\n]{0,70}\b(?:every|each|all)\s+slides?\b/i.test(instructions);
    let eligible=slides.filter(s=>!noPhotos&&(s.isCover||!excluded.has(s.slideNumber)&&(all||['photo','illustration'].includes(s.visualRequirement?.kind))));
    const selective=/\b(?:images?|pictures?|photographs?|photos?|imagery)\b[^.!?\n]{0,50}\b(?:selectively|sparingly)\b|\b(?:selective|sparse)\s+(?:images?|pictures?|photographs?|photos?|imagery)\b/i.test(instructions);
    const explicitCount=/\b(?:exactly|at least|minimum(?: of)?)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:\w+\s+){0,2}(?:images?|pictures?|photographs?|photos?)\b/i.test(instructions);
    if(selective&&!all&&!explicitCount){
        const limit=Math.max(1,Math.ceil(slides.length/3));
        // Preserve the cover, then spread supporting pictures across the deck.
        const cover=eligible.find(s=>s.slideType==='title')||eligible[0];
        const chosen=cover?[cover]:[];
        while(chosen.length<Math.min(limit,eligible.length)){
            const remaining=eligible.filter(s=>!chosen.includes(s));
            remaining.sort((a,b)=>Math.min(...chosen.map(s=>Math.abs(b.slideNumber-s.slideNumber)))-Math.min(...chosen.map(s=>Math.abs(a.slideNumber-s.slideNumber))));
            chosen.push(remaining[0]);
        }
        eligible=chosen;
        for(const s of slides)if(!eligible.includes(s)&&['photo','illustration','texture'].includes(s.visualRequirement?.kind))s.visualRequirement={role:'none',kind:'none',required:false,description:'',searchQuery:'',altText:''};
    }
    const target=eligible.length;
    for(const s of slides){
        if(!eligible.includes(s)){delete s.imageRequirement;delete s.photoAsset;delete s.photoAssets;delete s.photoComposition;continue;}
        const supplied=['photo','illustration'].includes(s.visualRequirement?.kind)?s.visualRequirement:{};
        const policy=slidePhotoPolicy(context,s);
        const peers=slides.filter(p=>p.slideNumber!==s.slideNumber&&p.visualRequirement?.kind==='photo'&&p.visualRequirement.searchQuery);
        const supporting=policy.authenticPhotoOnly&&peers.length?peers[(s.slideNumber-1)%peers.length].visualRequirement:null;
        // A supporting photo is independent of the slide's editable chart or
        // precise diagram. Never replace scientific evidence with AI imagery.
        const explicit=all||context.designPreferences?.requiredImageSlideNumbers?.includes(s.slideNumber)||instructions.split(/[.!?;\n]+/).some(clause=>{
            if(!/\b(?:must|require|include|show|use|add|feature|contain)\b[^.!?\n]{0,120}\b(?:photo(?:graph(?:y|s)?)?s?|images?|pictures?|illustrations?)\b/i.test(clause))return false;
            if(/\b(?:where|when|if)\s+(?:available|appropriate|possible)|\b(?:optional|selectively|sparingly)\b/i.test(clause)&&!/\b(?:must|required|mandatory)\b/i.test(clause))return false;
            const scoped=[...clause.matchAll(/\bslides?\s+(\d+)\b/gi)].map(m=>Number(m[1]));
            return !scoped.length||scoped.includes(s.slideNumber);
        });
        if(['photo','illustration'].includes(s.visualRequirement?.kind))s.visualRequirement={...s.visualRequirement,required:s.isCover||!!explicit};
        s.imageRequirement={...supplied,role:s.isCover||s.slideType==='title'?'background':'foreground',kind:supplied.kind||'illustration',required:s.isCover||!!explicit,requirementOrigin:s.isCover?'mandatory-cover':explicit?'user':'planner',
            description:supplied.description||`Contextual editorial illustration supporting ${s.title}. ${s.objective||''} Illustrative context, not evidence of actual events or a named organization's facilities.`,
            searchQuery:supplied.searchQuery||supporting?.searchQuery||[presentation.title,s.title].join(' '),altText:supplied.altText||`Illustrative context for ${s.title}`,...policy};
    }
    if(noPhotos)for(const s of slides)if(!s.isCover&&['photo','illustration','texture'].includes(s.visualRequirement?.kind))s.visualRequirement={role:'none',kind:'none',required:false,description:'',searchQuery:'',altText:''};
    const requiredSlideNumbers=slides.filter(s=>s.imageRequirement?.required).map(s=>s.slideNumber);
    return {...presentation,slides,imageCoveragePlan:{required:requiredSlideNumbers.length>0,coverRequired:!noPhotos,coverSlideNumber:cover?.slideNumber,target,requiredSlideNumbers,eligibleSlides:eligible.length,totalSlides:slides.length,reason:noPhotos?'Explicit image-free request; no cover image is required':'Cover background is mandatory; supporting pictures follow the requested plan'}};
}
export function imageCoverage(presentation,diagnostics=[],budget={}){
    const counts={photographs:0,illustrations:0,diagrams:0,charts:0,tables:0,textOnly:0};const sources={};
    for(const slide of presentation.slides){
        const photo=slide.photoAsset||slide.resolvedVisual?.kind==='photo'&&slide.resolvedVisual;
        if(photo){counts[photo.generationMethod==='ai-generated'?'illustrations':'photographs']++;sources[photo.sourceType||photo.source]=(sources[photo.sourceType||photo.source]||0)+1;}
        else if(slide.resolvedVisual?.diagram||slide.content?.process||slide.content?.relationship||slide.content?.timeline||slide.content?.roadmap)counts.diagrams++;
        else if(slide.content?.chart)counts.charts++;
        else if(slide.content?.table)counts.tables++;
        else counts.textOnly++;
    }
    const actual=counts.photographs+counts.illustrations,target=presentation.imageCoveragePlan?.target||0;
    const required=presentation.imageCoveragePlan?.requiredSlideNumbers||[];
    const missingAssets=presentation.slides.filter(s=>required.includes(s.slideNumber)&&!s.photoAsset).map(s=>s.slideNumber);
    return {totalSlides:presentation.slides.length,target,actual,requiredComplete:missingAssets.length===0,meetsTarget:missingAssets.length===0&&actual>=target,distribution:counts,sourceTypes:sources,diagnostics,failedRequests:diagnostics.filter(d=>d.status==='failed'),missingAssets,perSlide:presentation.slides.map(s=>({slideNumber:s.slideNumber,required:required.includes(s.slideNumber),hasPicture:!!s.photoAsset,assetId:s.photoAsset?.id})),budget,aestheticReview:'requires rendered human review'};
}
