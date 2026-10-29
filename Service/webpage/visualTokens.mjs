import {contrast,foreground} from '../webpageThemeService.mjs';
import {projectColorRoles} from '../design/colorSystem.mjs';
export const blend=(a,b,weight)=>'#'+a.slice(1).match(/../g).map((v,i)=>Math.round(parseInt(v,16)*(1-weight)+parseInt(b.slice(1+i*2,3+i*2),16)*weight).toString(16).padStart(2,'0')).join('');
function readable(preferred,backgrounds,threshold=4.5){
    if(backgrounds.every(background=>contrast(preferred,background)>=threshold))return preferred;
    return ['#000000','#ffffff'].sort((a,b)=>Math.min(...backgrounds.map(bg=>contrast(b,bg)))-Math.min(...backgrounds.map(bg=>contrast(a,bg))))[0];
}
export function completeVisualTokens(colors){
    const c={...colors,...projectColorRoles(colors)};
    c.alternateBackground=blend(c.background,c.primary,.1);c.elevatedSurface=blend(c.surface,c.primary,.04);c.cardSurface=c.surface;
    c.heading=c.text;c.body=c.text;c.buttonBackground=c.primary;c.buttonText=c.onPrimary;c.secondaryAccent=c.secondary;
    c.rule=blend(c.background,c.text,.13);
    for(let weight=.3;weight<=1;weight+=.05){c.border=blend(c.background,c.text,Math.min(weight,1));if([c.background,c.surface].every(bg=>contrast(c.border,bg)>=3))break;}
    return c;
}
export function sectionVisualTokens(root,treatment){
    let background=treatment==='tinted'?root.alternateBackground:treatment==='brand'?root.primary:treatment==='accent'?root.highlightSurface:treatment==='light'?root.lightSurface:['dark','gradient'].includes(treatment)?root.darkSurface:root.background;
    const surfaces=[background];
    if(treatment==='gradient')surfaces.push(root.gradientEnd);
    if(treatment==='texture')surfaces.push(blend(background,root.text,.03));
    if(treatment==='split')surfaces.push(root.surface);
    const text=readable(root.text,surfaces),muted=readable(root.muted,surfaces);
    const surface=blend(background,text,.035);
    const c={...root,background,surface,cardSurface:surface,text:readable(text,[...surfaces,surface]),muted:readable(muted,[...surfaces,surface])};
    c.primary=root.primary;c.onPrimary=foreground(c.primary);c.border=readable(root.border,[...surfaces,surface],3);c.focus=c.text;
    c.rule=blend(background,c.text,.15);
    c.heading=c.text;c.body=c.text;c.elevatedSurface=surface;
    return {colors:c,contrastPairs:[['text','background'],['muted','background'],['text','surface'],['muted','surface'],['onPrimary','primary'],['onAccent','accent'],['onPrimaryHover','primaryHover'],['border','background']].map(([front,back])=>({front,back,ratio:contrast(c[front],c[back]),minimum:front==='border'?3:4.5})),compositedBackgrounds:surfaces};
}
