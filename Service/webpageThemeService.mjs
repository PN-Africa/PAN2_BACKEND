import {completeVisualTokens,sectionVisualTokens} from './webpage/visualTokens.mjs';
import {websiteDesignProfile} from './webpage/designProfiles.mjs';
export const palettes = Object.freeze({
    editorial: { primary: '#25251f', accent: '#ce512a', background: '#f5f2e9', surface: '#fffdf7', text: '#25251f', muted: '#5f6058' },
    product: { primary: '#142d36', accent: '#c5f266', background: '#f5f8f7', surface: '#ffffff', text: '#17303a', muted: '#50656c' },
    classic: { primary: '#254c42', accent: '#e6c995', background: '#f7f5ef', surface: '#ffffff', text: '#20372f', muted: '#57675e' },
    academy: { primary: '#165f61', accent: '#fac09e', background: '#fbf8ef', surface: '#ffffff', text: '#173c3d', muted: '#586968' },
    table: { primary: '#702d23', accent: '#f2cd83', background: '#fbf3e7', surface: '#fffaf2', text: '#422a23', muted: '#756052' }
});
export function contrast(a, b) {
    const luminance = hex => {
        const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    };
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export const foreground = bg => contrast('#000000', bg) >= contrast('#ffffff', bg) ? '#000000' : '#ffffff';
const curated={
    'midnight-blue':{primary:'#a8c0ff',accent:'#b7a1ff',background:'#0b1121',surface:'#151f34',text:'#f4f7ff',muted:'#b0bdd5',secondary:'#5c7cfa'},
    'champagne-ivory':{primary:'#243e34',accent:'#dfc69a',background:'#f7f4ed',surface:'#fffefb',text:'#242d29',muted:'#626961',secondary:'#485b50'},
    'clinical-teal':{primary:'#115d6a',accent:'#b3e2d4',background:'#f7fbfc',surface:'#ffffff',text:'#19333f',muted:'#4b6570',secondary:'#306f90'},
    'scholar-blue':{primary:'#254f9b',accent:'#f0d3a6',background:'#fbf8f1',surface:'#ffffff',text:'#203049',muted:'#596579',secondary:'#426b91'},
    'emerald-ink':{primary:'#153f45',accent:'#a9d6bf',background:'#f6f8f7',surface:'#ffffff',text:'#183035',muted:'#56696a',secondary:'#263b61'},
    'moss-stone':{primary:'#31533d',accent:'#d5dfb4',background:'#f5f6ef',surface:'#fffef8',text:'#27382b',muted:'#5b6a57',secondary:'#4a706c'},
    'navy-jade':{primary:'#0b1f3a',accent:'#a4d7c9',background:'#f4f7f8',surface:'#ffffff',text:'#142635',muted:'#50616e'},
    'aubergine-sand':{primary:'#402b46',accent:'#d8c29d',background:'#f6f2ed',surface:'#ffffff',text:'#302b34',muted:'#635b66'},
    'charcoal-saffron':{primary:'#2b2118',accent:'#e8a33d',background:'#fcf5e9',surface:'#fffaf3',text:'#33271f',muted:'#746151'},
    'wine-linen':{primary:'#552d3e',accent:'#e7c390',background:'#f6f0e8',surface:'#fffdf8',text:'#352630',muted:'#715c65'},
    'forest-brass':{primary:'#1f4d3a',accent:'#d4b67f',background:'#f5f4ef',surface:'#ffffff',text:'#20372e',muted:'#56655b'},
    'ink-burgundy':{primary:'#14213d',accent:'#d7a5b6',background:'#f5f4f2',surface:'#ffffff',text:'#242b3b',muted:'#5b6170'},
    'cobalt-sand':{primary:'#2748b0',accent:'#f4b579',background:'#faf6ee',surface:'#ffffff',text:'#242f4c',muted:'#5d6577'},
    'graphite-lime':{primary:'#1a1a1a',accent:'#b6f23a',background:'#f4f5ef',surface:'#ffffff',text:'#232a25',muted:'#58615b'},
    'plum-ivory':{primary:'#3d244a',accent:'#e0b7dd',background:'#f8f4f8',surface:'#ffffff',text:'#31233c',muted:'#65576e'},
    'midnight-electric':{primary:'#c2b0ff',accent:'#b6f23a',background:'#14121e',surface:'#211d30',text:'#f6f2ff',muted:'#c3bbd6'},
    'ocean-night':{primary:'#8ee0ed',accent:'#f6c895',background:'#0b1c25',surface:'#142d38',text:'#edf9fc',muted:'#b3d0d9'},
    'terracotta':{primary:'#833c27',accent:'#f3c48e',background:'#faf1e7',surface:'#fffaf5',text:'#38271f',muted:'#72594c'},
    'sunflower':{primary:'#362856',accent:'#f3d85c',background:'#fff9dc',surface:'#fffdf2',text:'#30253f',muted:'#65566b'}
};
const blend=(a,b,weight)=>'#'+a.slice(1).match(/../g).map((v,i)=>Math.round(parseInt(v,16)*(1-weight)+parseInt(b.slice(1+i*2,3+i*2),16)*weight).toString(16).padStart(2,'0')).join('');
export function webpageThemeService(page, context = {}) {
    const profile=websiteDesignProfile(page,context);
    const categoryPreset = { portfolio: 'editorial', startup: 'product', product: 'product', education: 'academy', restaurant: 'table', event: 'table', business: 'classic', service: 'classic', nonprofit: 'academy', agency: 'editorial', informational: 'classic' };
    const aliases = { modern: 'product', nature: 'academy' };
    const requested = context.designPreferences?.preset || page.design?.preset;
    const preset = palettes[requested] ? requested : aliases[requested] || categoryPreset[page.pageType] || 'product';
    const industry=page.designBrief?.industry;
    const defaults={healthcare:'navy-jade',hospitality:'charcoal-saffron','real-estate':'forest-brass',legal:'ink-burgundy',finance:'aubergine-sand',fitness:'graphite-lime',education:'cobalt-sand',creative:'plum-ivory',retail:'forest-brass'};
    const requestedPalette=context.designPreferences?.paletteId || page.designSpec?.paletteId;
    if(requestedPalette && requestedPalette!=='auto' && !curated[requestedPalette])throw new Error('Unsupported website palette');
    const mood=[context.topic,context.websiteBrief?.brandPersonality,...(context.websiteBrief?.designAdjectives||[]),page.creativeDirection?.personality,page.visualDirection].filter(Boolean).join(' ');
    const inferred=/dark|night|futuristic/i.test(mood)?(/ocean|calm|nature/i.test(mood)?'ocean-night':'midnight-electric'):/playful|sunny|joyful/i.test(mood)?'sunflower':/earthy|terracotta|rustic/i.test(mood)?'terracotta':null;
    const callerPalette=context.designPreferences?.paletteId;
    const paletteId=callerPalette&&callerPalette!=='auto'?callerPalette:profile.palette||requestedPalette&&requestedPalette!=='auto'&&requestedPalette||inferred||defaults[industry];
    const colors = { ...(curated[paletteId] || palettes[preset]) };
    if(page.artifactDesign&&process.env.LEDIFY_DESIGN_ENGINE!=='legacy')Object.assign(colors,page.artifactDesign.theme.colors);
    for (const key of ['primary', 'secondary', 'accent','background','surface','text','muted']) {
        const value = context.designPreferences?.colors?.[key] || (!page.artifactDesign&&!profile.palette&&!curated[paletteId]?(page.design?.[key] || page.design?.colors?.[key]):null);
        if (value && !/^#[\da-f]{6}$/i.test(value)) throw new Error('Invalid design color: ' + key);
        if (value) colors[key] = value;
    }
    if(page.artifactDesign&&process.env.LEDIFY_DESIGN_ENGINE!=='legacy'&&!context.designPreferences?.colors?.secondary)colors.secondary=blend(colors.primary,colors.accent,.25);
    colors.secondary ||= blend(colors.primary,colors.accent,.25);
    colors.onPrimary = foreground(colors.primary); colors.onAccent = foreground(colors.accent);colors.onSecondary=foreground(colors.secondary);
    for(const key of ['text','muted'])if(['background','surface'].some(bg=>contrast(colors[key],colors[bg])<4.5))colors[key]=foreground(colors.background);
    // If supplied neutrals disagree, retain the brand background and choose a compatible surface.
    if(contrast(colors.text,colors.surface)<4.5)colors.surface=colors.background;
    if(contrast(colors.muted,colors.surface)<4.5)colors.muted=colors.text;
    colors.border=blend(colors.background,colors.text,.22);colors.primaryHover=blend(colors.primary,colors.text,.12);colors.onPrimaryHover=foreground(colors.primaryHover);colors.focus=colors.text;
    const pairs={humanist:{heading:"'Segoe UI',Arial,sans-serif",body:"'Segoe UI',Arial,sans-serif"},editorial:{heading:"Georgia,'Times New Roman',serif",body:"'Segoe UI',Arial,sans-serif"},technical:{heading:"Arial,Helvetica,sans-serif",body:"Arial,Helvetica,sans-serif"},classical:{heading:"'Palatino Linotype',Palatino,Georgia,serif",body:"Arial,Helvetica,sans-serif"},geometric:{heading:"'Century Gothic',Futura,'Trebuchet MS',sans-serif",body:"'Segoe UI',Arial,sans-serif"},display:{heading:"'Trebuchet MS','Arial Black',sans-serif",body:"'Segoe UI',Arial,sans-serif"},mono:{heading:"Consolas,'Courier New',monospace",body:"'Segoe UI',Arial,sans-serif"}};
    const fontPair=context.websiteBrief?.preferredTypography || context.designPreferences?.fontPair || page.artifactDesign?.theme.fontPair || profile.font || page.designSpec?.fontPair || 'humanist';
    if(!pairs[fontPair])throw new Error('Unsupported website font pair');
    const tokens=completeVisualTokens(colors);
    const sectionTokens=Object.fromEntries(page.sections.map(section=>[section.id,sectionVisualTokens(tokens,section.background||'plain')]));
    for(const value of Object.values(sectionTokens))if(value.contrastPairs.some(pair=>pair.ratio<pair.minimum))throw new Error('Unable to resolve accessible section colors');
    const dark=contrast(tokens.background,'#ffffff')>8;
    const contrastingSections=page.sections.some(section=>['brand','accent','dark'].includes(section.background));
    const rationale={emotionalQualities:page.creativeDirection?.personality||'clear and credible',associations:page.creativeDirection?.concept||page.designBrief?.visualTone||page.visualDirection||'content-led identity',selection:(requestedPalette&&requestedPalette!=='auto'?'Explicit design selection':inferred?'Brief personality and visual associations':'Contextual starting point with supplied brand overrides')+`; ${paletteId||preset} supports the requested concept: ${page.creativeDirection?.concept||page.title}. Text and surfaces are resolved separately for readability.`,mode:contrastingSections?'mixed':dark?'dark':'light',sectionTreatments:page.sections.map(section=>section.background)};
    return { ...page, designSpec:{...page.designSpec,paletteId:paletteId||preset,fontPair}, theme: { preset, profileId:profile.id,paletteId:paletteId||preset, colors:tokens,sectionTokens,rationale, typography:pairs[fontPair], density:page.designBrief?.density || 'comfortable',creativeDirection:page.creativeDirection } };
}
