// Shared color roles for HTML and native presentations; no AI calls.
export const hexColor=value=>/^#?[a-f\d]{6}$/i.test(value||'')?'#'+value.replace('#','').toLowerCase():null;
export const mixColor=(a,b,weight)=>'#'+hexColor(a).slice(1).match(/../g).map((v,i)=>Math.round(parseInt(v,16)*(1-weight)+parseInt(hexColor(b).slice(1+i*2,3+i*2),16)*weight).toString(16).padStart(2,'0')).join('');
const luminance=value=>{const c=hexColor(value).slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
export const colorContrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
export const colorForeground=bg=>colorContrast('#000000',bg)>=colorContrast('#ffffff',bg)?'#000000':'#ffffff';
export function projectColorRoles(input){
 const primary=hexColor(input.primary)||'#233b58',accent=hexColor(input.accent)||'#c3a36b';
 const darkSurface=mixColor(primary,'#080e18',.8),lightSurface=mixColor(primary,'#ffffff',.97),highlightSurface=mixColor(lightSurface,accent,.2);
 return {secondary:hexColor(input.secondary)||mixColor(primary,accent,.3),darkSurface,lightSurface,highlightSurface,textDark:colorForeground(lightSurface),textLight:colorForeground(darkSurface),gradientStart:darkSurface,gradientEnd:mixColor(darkSurface,accent,.22)};
}
export function slideSurfacePlan(slides,{uniform=false}={}){
 return slides.map((slide,index)=>({slideNumber:slide.slideNumber,treatment:uniform?'plain':slide.backgroundTreatment||
  (index===0||index===slides.length-1?'gradient':['section-divider','summary','conclusion'].includes(slide.slideType)?'dark':slide.content?.chart||slide.content?.table?'light':slide.content?.comparison?'highlight':slide.content?.process||slide.content?.timeline?'brand-tint':slide.content?.quote||slide.content?.statement?'dark':'plain')}));
}
export function topicColorPalette(topic=''){
 const family=/artificial intelligence|machine learning|neural/i.test(topic)?'intelligence':/real estate|residential|property/i.test(topic)?'property':/healthcare|medical|clinical/i.test(topic)?'healthcare':/school|education|learning institution/i.test(topic)?'education':/startup|software product/i.test(topic)?'startup':/business strategy|strategic planning/i.test(topic)?'strategy':null;
 const colors={intelligence:['#0c142b','#18243b','#a8c0ff','#9a83e8'],property:['#f7f2e8','#fffdf8','#243f34','#d6bb86'],healthcare:['#f6fbfc','#ffffff','#075d6b','#9acfc9'],education:['#fbf8f1','#ffffff','#204b91','#e7b865'],startup:['#141225','#201b36','#c2b0ff','#bde487'],strategy:['#f6f7fa','#ffffff','#223a49','#d2ab69']}[family];
 if(!colors)return null;const [background,surface,primary,accent]=colors,text=colorForeground(background);return {family,colors:{canvas:background,background,surface,surfaceAlt:surface,primary,accent,text,textMuted:text}};
}
