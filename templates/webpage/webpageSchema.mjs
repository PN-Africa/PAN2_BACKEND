import {designPlanSchema} from '../../Service/design/designSchema.mjs';
const string = { type: 'string' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const PAGE_TYPES = ['portfolio', 'startup', 'business', 'education', 'restaurant', 'event', 'product', 'agency', 'nonprofit', 'service', 'informational', 'ecommerce'];
export const SECTION_TYPES = ['about', 'features', 'services', 'projects', 'process', 'topics', 'menu', 'schedule', 'faq', 'pricing', 'testimonials', 'contact', 'values', 'gallery', 'products', 'statistics', 'comparison', 'team', 'case-studies'];
export const PRESETS = ['editorial', 'product', 'classic', 'academy', 'table'];
export const COMPOSITIONS = ['auto', 'editorial', 'bento', 'showcase', 'timeline', 'list', 'grid', 'image-text', 'image-band'];
export const INDUSTRIES = ['healthcare', 'hospitality', 'technology', 'creative', 'education', 'retail', 'professional', 'general', 'real-estate', 'legal', 'finance', 'fitness'];
export const HERO_COMPOSITIONS=['split','editorial','image-led','product','full-bleed','asymmetric','minimal'];
export const FONT_PAIRS=['humanist','editorial','technical','classical','geometric','display','mono'];
export const PALETTE_IDS=['auto','navy-jade','aubergine-sand','charcoal-saffron','wine-linen','forest-brass','ink-burgundy','cobalt-sand','graphite-lime','plum-ivory','midnight-electric','ocean-night','terracotta','sunflower','midnight-blue','champagne-ivory','clinical-teal','scholar-blue','emerald-ink','moss-stone'];
export const BACKGROUNDS=['plain','tinted','brand','accent','dark','gradient','texture','split','light'];
export const creativeDirectionSchema=object({concept:string,personality:string,background:{type:'string',enum:BACKGROUNDS},spacing:{type:'string',enum:['compact','balanced','generous']},geometry:{type:'string',enum:['square','soft','round']},typeScale:{type:'string',enum:['restrained','balanced','expressive']},ctaStyle:{type:'string',enum:['solid','outline','pill']},interactions:{type:'array',maxItems:3,items:{type:'string',enum:['search','filter','gallery']}}});
const context = object({ userRole: string, purpose: string, audience: string, topic: string, tone: string, keyInstructions: { type: 'array', items: string, maxItems: 8 } });
export const webpagePlanSchema = object({
    pageType: { type: 'string', enum: PAGE_TYPES }, title: string, brandName: string, inferredContext: context,
    design: object({ preset: { type: 'string', enum: PRESETS }, primary: string, accent: string }),
    visualDirection: string,
    sections: { type: 'array', minItems: 2, maxItems: 8, items: object({ type: { type: 'string', enum: SECTION_TYPES }, heading: string, navLabel: string, purpose: string }) },
    limitations: { type: 'array', maxItems: 6, items: string }
});
// Optional additions preserve previously valid plans and saved generations.
webpagePlanSchema.properties.designBrief = object({
    industry: { type: 'string', enum: INDUSTRIES }, audience: string, conversionGoal: string,
    visualTone: string, imageDirection: string,
    density: { type: 'string', enum: ['comfortable', 'compact'] },
    heroComposition: { type: 'string', enum: HERO_COMPOSITIONS }
});
webpagePlanSchema.properties.sections.items.properties.composition = { type: 'string', enum: COMPOSITIONS };
webpagePlanSchema.properties.sections.items.properties.background={type:'string',enum:BACKGROUNDS};
webpagePlanSchema.properties.creativeDirection=creativeDirectionSchema;
webpagePlanSchema.properties.imagePlan={type:'array',maxItems:8,items:object({role:{type:'string',enum:['hero','section','item']},sectionIndex:{type:'integer'},itemIndex:{type:'integer'},subject:string,alt:string,aspectRatio:{type:'string',enum:['16:9','4:3','3:2','1:1','3:4']}})};
webpagePlanSchema.properties.designSpec=object({paletteId:{type:'string',enum:PALETTE_IDS},fontPair:{type:'string',enum:FONT_PAIRS},heroComposition:{type:'string',enum:HERO_COMPOSITIONS},motion:{type:'string',enum:['none','restrained']},navigation:{type:'string',enum:['sticky','static']}});
webpagePlanSchema.properties.pages={type:'array',minItems:1,maxItems:6,items:object({slug:{type:'string',enum:['home','about','services','products','portfolio','contact']},title:string,sectionIndexes:{type:'array',maxItems:8,items:{type:'integer'}}})};
// Keep saved-plan capabilities separate from the provider's grammar budget.
// Combined nested image plans + section backgrounds + direction were rejected
// by Gemini even though each extension alone was accepted. The image strategy
// compiles concrete targets from the returned content and photographic direction.
webpagePlanSchema.properties.artifactDesign=designPlanSchema('webpage');
export function webpagePlanningProviderSchema(){
    const schema=structuredClone(webpagePlanSchema);
    delete schema.properties.imagePlan;
    delete schema.properties.sections.items.properties.background;
    return schema;
}
const item = object({ title: string, description: string, detail: string, url: string });
const copy=(maxLength,minLength=1)=>({type:'string',minLength,maxLength});
webpagePlanSchema.properties.title=copy(80);
webpagePlanSchema.properties.brandName=copy(60);
webpagePlanSchema.properties.sections.items.properties.heading=copy(100);
webpagePlanSchema.properties.sections.items.properties.navLabel=copy(32,0);
for(const key of ['audience','conversionGoal','visualTone','imageDirection'])webpagePlanSchema.properties.designBrief.properties[key]=copy(300,0);
export function webpageContentSchema(plan) {
    return object({
        description: copy(240),
        hero: object({ headline: copy(120), subheadline: copy(320), actionLabel: copy(45) }),
        sections: { type: 'array', minItems: plan.sections.length, maxItems: plan.sections.length,
            items: object({ type: { type: 'string', enum: SECTION_TYPES }, heading: copy(100), content: copy(1400,0),
                items: { type: 'array', maxItems: 6, items: {...item,properties:{title:copy(90),description:copy(420),detail:copy(100,0),url:string}} } }) },
        contact: object({ email: string, phone: string, address: string }),
        callToAction: object({ heading: copy(120), text: copy(360), actionLabel: copy(45) })
    });
}
