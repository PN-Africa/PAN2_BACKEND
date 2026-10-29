import sharp from 'sharp';
import {projectColorRoles,colorForeground,mixColor,hexColor,colorContrast,slideSurfacePlan} from '../../Service/design/colorSystem.mjs';
const cache=new Map();
export async function prepareSlideSurfaces(presentation,tokens){
 const c=tokens.colors,roles=projectColorRoles(c),plan=slideSurfacePlan(presentation.slides,{uniform:presentation.design?.uniformBackground===true});
 const rootDark=colorContrast(c.canvas||c.background,'#ffffff')>8;
 return Promise.all(plan.map(async({treatment},index)=>{
  const background=treatment==='light'?(rootDark?roles.darkSurface:roles.lightSurface):['gradient','dark'].includes(treatment)?roles.darkSurface:treatment==='highlight'?(rootDark?mixColor(roles.darkSurface,c.accent,.15):roles.highlightSurface):treatment==='brand-tint'?mixColor(c.canvas||c.background,c.primary,.14):hexColor(c.canvas||c.background);
  const text=colorForeground(background),candidateSurface=mixColor(background,text,.035),surface=colorContrast(text,candidateSurface)>=4.5?candidateSurface:background,accent=colorContrast(c.accent,background)>=3?c.accent:text;
  const derived={...tokens,colors:{...c,canvas:background,background,surface,surfaceAlt:surface,text,textMuted:text,accent}};let surfaceArt;
  if(treatment==='gradient'&&!presentation.design?.noRasterBackground){
   const key=roles.gradientStart+roles.gradientEnd;
   if(!cache.has(key)){if(cache.size>24)cache.clear();const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${roles.gradientStart}"/><stop offset="1" stop-color="${roles.gradientEnd}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/></svg>`;cache.set(key,sharp(Buffer.from(svg)).png().toBuffer());}
   surfaceArt='image/png;base64,'+(await cache.get(key)).toString('base64');
  }
  return {slideData:{...presentation.slides[index],surfaceTreatment:treatment,...(surfaceArt?{surfaceArt}:{})},tokens:derived,roles};
 }));
}
