export function creativeStyles(theme){
    const direction=theme.creativeDirection||{};
    const radius={square:'0px',soft:'14px',round:'28px'}[direction.geometry]||'14px';
    const spacing={compact:'clamp(40px,5vw,64px)',balanced:'clamp(60px,7vw,100px)',generous:'clamp(76px,9vw,124px)'}[direction.spacing]||'clamp(60px,7vw,100px)';
    const heading={restrained:'clamp(2.4rem,4vw,3.8rem)',balanced:'clamp(2.5rem,4.6vw,4.5rem)',expressive:'clamp(2.8rem,5.4vw,5.1rem)'}[direction.typeScale]||'clamp(2.5rem,4.6vw,4.5rem)';
    const sections=Object.entries(theme.sectionTokens||{}).map(([id,value])=>`#${id}{${Object.entries(value.colors).map(([key,color])=>`--${key}:${color}`).join(';')};background-color:${value.colors.background};color:${value.colors.text}}`).join('\n');
    return `:root{--radius:${radius};--section:${spacing}}.hero h1{font-size:${heading}}
.hero.headline-long h1{font-size:clamp(2.2rem,3.7vw,3.4rem);overflow-wrap:normal;hyphens:auto}
.background-brand{background:var(--primary);--text:var(--onPrimary);--muted:var(--onPrimary);--surface:var(--primary);color:var(--text)}
.background-accent{background:var(--accent);--text:var(--onAccent);--muted:var(--onAccent);--surface:var(--accent);color:var(--text)}
.background-dark{background:var(--darkSurface);color:var(--text)}
.background-gradient{background:linear-gradient(120deg,var(--gradientStart),var(--gradientEnd));color:var(--text)}
.background-texture{background-color:var(--background);background-image:repeating-linear-gradient(120deg,transparent 0px,transparent 8px,color-mix(in srgb,var(--text) 3%,transparent) 9px,transparent 10px)}
.background-split{background:linear-gradient(90deg,var(--background) 50%,var(--surface) 50%)}
.background-brand .project,.background-accent .project{border-color:currentColor}
.cta-outline .hero .button,.cta-outline .cta .button{background:transparent;color:inherit;border-color:currentColor}
.cta-pill .button{border-radius:999px}.cta-solid .button{border-radius:var(--radius)}
.collection-controls{display:flex;flex-wrap:wrap;gap:16px;align-items:end;margin-bottom:24px}.collection-controls label{display:grid;gap:8px;min-width:0;max-width:100%;font-weight:600}.collection-controls input,.collection-controls select{font:inherit;color:var(--text);background:var(--surface);border:1px solid currentColor;border-radius:6px;padding:12px;min-height:48px;max-width:100%;width:260px}.collection-status{min-height:28px;color:var(--muted)}
.collection-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.collection-item{min-width:0;border-bottom:1px solid currentColor;padding-bottom:24px}.collection-item .section-image{margin-bottom:18px}.collection-item h3{font-size:1.35rem}.collection-item p{max-width:60ch;color:var(--muted)}
.gallery-open{padding:0;border:0;background:transparent;width:100%;color:inherit;cursor:zoom-in;text-align:left}.gallery-open img{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:var(--radius)}.gallery-open span{display:block;font-size:.875rem;text-decoration:underline;padding-block:8px}
.image-dialog{border:1px solid var(--border);background:var(--background);color:var(--text);padding:24px;max-width:min(960px,calc(100vw - 32px));max-height:90vh;border-radius:var(--radius)}.image-dialog::backdrop{background:#000c}.image-dialog img{width:auto;max-height:68vh;margin-inline:auto;object-fit:contain}.image-dialog button{display:block;margin:0 0 16px auto;min-height:44px;padding:8px 16px;color:var(--text);background:var(--surface);border:1px solid currentColor;border-radius:6px}.image-dialog p{margin-top:16px}
input:focus-visible,select:focus-visible{outline:3px solid currentColor;outline-offset:3px}
.button{border-color:var(--text)}a:focus-visible,button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline-color:var(--focus)}
.content-section.section-compact{padding-block:clamp(36px,4vw,64px)}.content-section.section-compact .section-body{padding-top:8px}.content-section .card,.content-section .project{border-color:var(--border);box-shadow:0 6px 20px #00000009}.content-section.composition-editorial .section-layout{grid-template-columns:1fr}.content-section.composition-editorial .section-heading{max-width:900px}.content-section.composition-editorial .section-body{max-width:900px;padding-top:8px}.composition-image-text .section-body{display:grid;grid-template-columns:1fr 1fr;align-items:start;gap:28px}.composition-image-text .section-body>.section-image{grid-row:span 2}.composition-image-text.image-reverse .section-image{order:2}.composition-image-band .section-image{margin-inline:calc((min(1200px,100vw - 64px) - 100vw)/2)}.composition-image-band .section-image img{border-radius:0}.composition-image-text .section-layout{display:block}.composition-image-text .section-heading{max-width:800px}.composition-timeline .section-layout{display:block}.composition-timeline .process-list{grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.composition-timeline .process-list li{padding:56px 0 20px}.composition-timeline .process-list p{max-width:44ch}
${sections}
@media(max-width:820px){.collection-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.background-split{background:var(--surface)}}
@media(max-width:820px){.composition-image-text .section-body,.composition-timeline .process-list{grid-template-columns:1fr}.composition-image-text.image-reverse .section-image{order:0}.composition-image-band .section-image{margin-inline:-32px}}
@media(max-width:560px){.collection-grid{grid-template-columns:1fr}.hero h1{font-size:clamp(2.4rem,9.7vw,3rem)}.hero.headline-long h1{font-size:2.2rem}.collection-controls,.collection-controls label{width:100%}.collection-controls input,.collection-controls select{width:100%}.composition-image-band .section-image{margin-inline:-18px}}
`;
}
export const collectionScript=`
for(const collection of document.querySelectorAll('[data-collection]')){
 for(const control of collection.querySelectorAll('[data-enhanced]'))control.hidden=false;
 const search=collection.querySelector('[data-search]'),filter=collection.querySelector('[data-filter]'),status=collection.querySelector('[data-status]'),items=[...collection.querySelectorAll('[data-collection-item]')];
 function update(){let visible=0;for(const item of items){const match=(!search||item.textContent.toLowerCase().includes(search.value.toLowerCase().trim()))&&(!filter||!filter.value||item.dataset.category===filter.value);item.hidden=!match;if(match)visible++;}status.textContent=visible+' of '+items.length+' items shown'+(visible?'':'. Try another search or filter.');}
 search?.addEventListener('input',update);filter?.addEventListener('change',update);update();
}
const imageDialog=document.querySelector('#image-dialog');let galleryTrigger;
for(const trigger of document.querySelectorAll('[data-gallery-open]'))trigger.addEventListener('click',event=>{event.preventDefault();galleryTrigger=trigger;const source=trigger.querySelector('img'),image=document.createElement('img');image.src=source.currentSrc||source.src;image.alt=source.alt;imageDialog.querySelector('[data-dialog-media]').replaceChildren(image);imageDialog.querySelector('p').textContent=trigger.dataset.caption||source.alt;imageDialog.showModal();});
imageDialog?.querySelector('button').addEventListener('click',()=>imageDialog.close());
imageDialog?.addEventListener('close',()=>galleryTrigger?.focus());
`;
