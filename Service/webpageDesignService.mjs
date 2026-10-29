import { COMPOSITIONS, INDUSTRIES, HERO_COMPOSITIONS, FONT_PAIRS, PALETTE_IDS } from '../templates/webpage/webpageSchema.mjs';
import { webpageError } from './webpageContentValidator.mjs';
import {directWebsite} from './webpage/creativeDirection.mjs';
import {websiteDesignProfile} from './webpage/designProfiles.mjs';

export function validateDesignBrief(brief) {
    if (!brief) return;
    if (!INDUSTRIES.includes(brief.industry) || !['comfortable','compact'].includes(brief.density) ||
        !HERO_COMPOSITIONS.includes(brief.heroComposition)) throw webpageError('Unsupported website design direction', 'designBrief');
    for (const key of ['audience','conversionGoal','visualTone','imageDirection']) {
        if (typeof brief[key] !== 'string' || brief[key].length > 300) throw webpageError('Keep design intent concise', `designBrief.${key}`);
    }
}

export function planWebpageDesign(page, context = {}) {
    validateDesignBrief(page.designBrief);
    const topic = `${page.title} ${page.hero.subheadline} ${page.visualDirection || ''} ${context.topic || ''}`;
    const categories = { restaurant:'hospitality', startup:'technology', product:'technology', portfolio:'creative', agency:'creative', education:'education', ecommerce:'retail' };
    const profile=websiteDesignProfile(page,context);
    const detected=/\b(?:pharma\w*|laborator\w*|healthcare|clinical|medical|biotech\w*)\b/i.test(topic)?'healthcare':/law firm|legal|solicitor|attorney/i.test(topic)?'legal':/financ|accountancy/i.test(topic)?'finance':/real estate|\bproperty\b|properties|residential/i.test(topic)?'real-estate':/fitness|wellness|gym/i.test(topic)?'fitness':null;
    const industry = context.websiteBrief?.industry || (profile.id!=='editorial'?profile.industry:null) || (page.designBrief?.industry&&!['general','professional'].includes(page.designBrief.industry)?page.designBrief.industry:detected || categories[page.pageType] || page.designBrief?.industry || 'professional');
    const inferredAiHero=!page.artifactDesign&&profile.id==='intelligence'&&page.designBrief?.industry==='education'?profile.hero:null;
    const heroComposition = context.designPreferences?.heroComposition || inferredAiHero || page.designSpec?.heroComposition || page.designBrief?.heroComposition || profile.hero || ({ creative:'editorial', education:'image-led', hospitality:'full-bleed', technology:'product', retail:'asymmetric','real-estate':'asymmetric',legal:'minimal',finance:'minimal',fitness:'full-bleed',healthcare:'split' })[industry] || 'split';
    const designBrief = { audience: page.inferredContext?.audience || '', conversionGoal:page.hero.actionLabel, visualTone:'considered', imageDirection:'', density:'comfortable', ...page.designBrief, industry, heroComposition };
    let previous;
    const sections = page.sections.map((section, index) => {
        if (section.composition && !COMPOSITIONS.includes(section.composition)) throw webpageError('Unsupported section composition', `sections[${index}].composition`);
        let composition = section.composition;
        const structural = { faq:'list', process:'timeline', menu:'list', schedule:'list', testimonials:'editorial', contact:'editorial', statistics:'grid', comparison:'grid', products:'showcase', projects:'showcase', gallery:'showcase', team:'showcase','case-studies':'editorial',about:'editorial' };
        if (!composition || composition === 'auto') {
            composition = structural[section.type] || (section.items.length >= 3 ? 'bento' : 'editorial');
            if (composition === previous && !['faq','process','menu','schedule','statistics','testimonials'].includes(section.type)) composition = section.items.length?'list':'image-text';
        }
        // Preserve component semantics even if an old or AI plan picks an unsuitable layout.
        if (['faq','process','menu','schedule','statistics','comparison','testimonials','contact'].includes(section.type)) composition = structural[section.type];
        const designFallback=page.artifactDesign&&section.composition&&composition!==section.composition?{requestedComponent:section.composition,selectedComponent:composition,reason:'Preserve the section semantic and interactive contract.'}:undefined;
        previous = composition;
        const words=(section.content+' '+section.items.map(item=>item.description).join(' ')).split(/\s+/).length;
        return { ...section, composition,...(designFallback?{designFallback}:{}),compact:!section.image&&words<65 };
    });
    const supplied=page.designSpec || {};
    if(supplied.fontPair&&!FONT_PAIRS.includes(supplied.fontPair)||supplied.paletteId&&!PALETTE_IDS.includes(supplied.paletteId)||!HERO_COMPOSITIONS.includes(heroComposition))throw webpageError('Unsupported design specification','designSpec');
    const fontPair=supplied.fontPair || ({healthcare:'humanist',technology:'technical',legal:'classical',finance:'classical',hospitality:'editorial',creative:'editorial','real-estate':'editorial',retail:'editorial'})[industry] || 'humanist';
    return directWebsite({ ...page, designBrief, designDirection:{industry,style:designBrief.visualTone||'premium-modern',typography:{headingStyle:fontPair,bodyStyle:'high-readability'},visualStrategy:{heroImageRequested:true,sectionImages:true,visualStorytelling:true,missingImageComposition:'topic-map'}},designSpec:{paletteId:'auto',motion:'restrained',navigation:'sticky',...supplied,fontPair,heroComposition}, sections },context);
}
