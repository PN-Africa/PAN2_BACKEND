import { getLayoutsForSlideType } from '../templates/presentation/presentationLayouts.mjs';
import { validatePlannedRenderContent } from '../renderer/presentation/professionalLayouts.mjs';
import { canonicalTitles } from './ai/presentationQuality.mjs';
import { visualIntent } from './ai/presentationIntent.mjs';

export function presentationLayoutService(generatedContent, context = {}) {
    if (!generatedContent?.slides?.length) throw new Error('Presentation slides are required');
    const slides=[],warnings=[...(generatedContent.warnings || [])];
    canonicalTitles(generatedContent);
    for(const [index,original] of generatedContent.slides.entries()){
        const slide={...original,slideNumber:original.slideNumber || index+1};
        slide.visualIntent=visualIntent(slide);
        delete slide.layoutId; // A stale caller-supplied ID must never bypass candidate validation.
        const available=getLayoutsForSlideType(slide.slideType).map(l=>l.id);
        if(!available.length) throw new Error('No presentation layout found for slide type: '+slide.slideType);
        let preferred=available[0];
        if(slide.slideType==='title')preferred='title-editorial';
        if(['summary','conclusion'].includes(slide.slideType))preferred='closing-synthesis';
        if(slide.slideType==='focused-explanation')preferred='explanation-editorial';
        if(slide.slideType==='process') preferred=slide.content.process.steps.length<=4?'process-horizontal':'process-vertical';
        if(slide.slideType==='cards') preferred=slide.content.cards.length<=3?'cards-horizontal':'cards-grid';
        if(slide.slideType==='comparison') preferred=slide.content.comparison.items.length===2?'comparison-two-column':'comparison-multi-column';
        if(slide.slideType==='data-chart') preferred=slide.content.chart.insight?.length>=40?'chart-with-insight':'chart-primary';
        if(slide.slideType==='relationship') preferred='relationship-network';
        if(slide.slideType==='relationship' && slides.length>=2 && slides.slice(-2).every(s=>s.layoutId==='process-horizontal')) preferred='relationship-chain-vertical';
        const repeat=slides.length>=2 && slides.at(-1).layoutId===preferred && slides.at(-2).layoutId===preferred;
        const intentional=slide.slideType==='comparison' && context.designPreferences?.consistentComparisonSeries===true;
        const recommendation=slide.designComponent;
        const candidates=[...(available.includes(recommendation)?[recommendation]:[]),preferred,...available.filter(id=>id!==preferred&&id!==recommendation)];
        if(repeat&&!intentional&&!recommendation&&available.length>1) candidates.push(candidates.shift());
        let error;
        for(const layoutId of candidates){try{validatePlannedRenderContent({...slide,layoutId});slide.layoutId=layoutId;break;}catch(e){if(!error||(e.validationErrors?.length||1)<(error.validationErrors?.length||1))error=e;}}
        if(!slide.layoutId) throw error;
        if(recommendation&&slide.layoutId!==recommendation)warnings.push({code:'DESIGN_COMPONENT_FALLBACK',stage:'layout-compilation',slideNumber:slide.slideNumber,requestedComponent:recommendation,selectedComponent:slide.layoutId,reason:available.includes(recommendation)?'Content does not fit the requested component at readable typography.':'The requested component does not support this semantic content.',message:'A compatible layout preserved the complete content.'});
        if(repeat&&!intentional&&slide.layoutId===preferred) warnings.push({code:'LAYOUT_REPETITION',stage:'layout-selection',slideNumber:slide.slideNumber,message:'This composition repeats because alternate compatible layouts could not preserve readable content.'});
        slides.push(slide);
    }
    return {...generatedContent,slides,warnings};
}
