import {load} from 'cheerio';
// Objective completeness checks. These do not certify subjective aesthetics.
export function inspectDesignCompleteness(files){
 const issues=[],pages=[];
 for(const [file,html] of Object.entries(files).filter(([file])=>file.endsWith('.html'))){
  const $=load(html),hero=$('.hero'),sections=$('main>.content-section'),signatures=new Set(),compositions=new Set();
  const visual=hero.find('.hero-art img,.hero-story,.product-preview,.hero-panel').length>0;
  if(!visual)issues.push({code:'HERO_COMPOSITION_MISSING',file});
  sections.each((_,node)=>{const section=$(node),copy=section.clone();copy.find('.section-number').remove();const signature=copy.text().replace(/\s+/g,' ').trim();if(signatures.has(signature))issues.push({code:'DUPLICATE_SECTION',file});signatures.add(signature);const composition=(section.attr('class')||'').match(/composition-([\w-]+)/)?.[1];if(composition)compositions.add(composition);});
  if(sections.length>3&&compositions.size<2)issues.push({code:'REPEATED_COMPOSITION',file});
  for(const node of $('.hero-art,.section-image').toArray())if(!$(node).find('img').length)issues.push({code:'EMPTY_VISUAL_CONTAINER',file});
  pages.push({file,heroComposition:visual?'present':'missing',heroAsset:hero.find('img').length?'present':'not-present',sectionCount:sections.length,compositionCount:compositions.size});
 }
 return {status:issues.length?'review-required':'passed',pages,issues,scope:'objective DOM completeness only; browser and subjective visual review are separate'};
}
