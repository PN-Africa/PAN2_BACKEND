import { PRESENTATION_COLLECTION_LIMITS as limits } from '../../templates/presentation/slideContentSchemas.mjs';
import { getColors, getTypography } from './renderHelpers.mjs';
import { assertTextFits } from './contentFit.mjs';
import { validateSlideContent } from '../../Service/presentationContentValidator.mjs';
import { renderNativeDiagram } from './visuals/nativeDiagram.mjs';
import { validateDiagram } from './visuals/svgGraphics.mjs';
import { geometryRecorder } from './geometry.mjs';
import {renderPhotoComposition} from './photoCompositions.mjs';
import {photoCompositionFor} from '../../Service/visual/imageArtDirection.mjs';
import {presentationFontSize} from './typography.mjs';
import {isAutomaticImageLabel} from '../imageLabels.mjs';
import {visualCaptionBoxes} from './visualLayout.mjs';

const W = 13.333333, H = 7.5, M = .72, CW = W - M * 2;
const luminance = hex => {
    const rgb = hex.match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
};
function readable(fg, bg, minimum = 4.5) {
    const a = luminance(fg), b = luminance(bg);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= minimum ? fg : b > .4 ? '152536' : 'F5F7FA';
}

// All registered layouts consume the canonical schema. Geometry and density checks
// are shared with the AI repair stage, so no branch slices arrays or invents content.
export function renderProfessionalSlide(args) {
    const recorder=geometryRecorder(args.slide,args.slideData.slideNumber);
    renderSlide({...args,slide:recorder.slide});
    return recorder.validate();
}
function renderSlide({ slide, slideData: d, tokens = {}, pptx, validationErrors, onTextLayout, skipContentValidation=false }) {
    if (d.slideType === 'focused-explanation' && !d.content?.textContent?.body?.trim()) {
        throw Object.assign(new Error(`Slide ${d.slideNumber}: content.textContent.body must contain meaningful text`), { field: 'content.textContent.body', slideNumber: d.slideNumber });
    }
    if(!skipContentValidation)validateSlideContent({slideNumber:d.slideNumber,slideType:d.slideType,title:d.title,subtitle:d.subtitle,content:d.content});
    const c = getColors(tokens), t = getTypography(tokens);
    const ink = readable(c.textPrimary, c.background), muted = readable(c.textSecondary, c.background);
    const accent = readable(c.accent, c.background, 3);
    if(d.photoAsset&&renderPhotoComposition({slide,d,c,t,ink,muted,accent,validationErrors,onTextLayout}))return;
    slide.background = { color: c.background };
    if(d.surfaceArt)slide.addImage({data:d.surfaceArt,x:0,y:0,w:W,h:H,altText:''});
    if (d.backgroundAsset?.data) slide.addImage({data:d.backgroundAsset.data,x:0,y:0,w:W,h:H,altText:''});
    const rect = (x, y, w, h, color) => slide.addShape('rect', { x, y, w, h, line: { color, transparency: 100 }, fill: { color } });
    const text = (value, x, y, w, h, size = 22, extra = {}, field = 'content') => {
        if (value == null || value === '') return;
        if(field==='visual.caption'&&isAutomaticImageLabel(value))return;
        size=presentationFontSize(field,{bold:extra.bold});
        value = String(value);
        const {sourceOverhead=0,...drawExtra}=extra;
        onTextLayout?.({field,w,h,fontSize:size,overhead:sourceOverhead});
        try{assertTextFits(value, { w, h, fontSize: size }, field, d.slideNumber);}catch(error){if(sourceOverhead)error.maxCharacters=Math.max(1,error.maxCharacters-sourceOverhead);if(!validationErrors)throw error;validationErrors.push(error);}
        slide.addText(value, { x, y, w, h, fontFace: t.bodyFamily, fontSize: size, color: ink,
            margin: 0, breakLine: false, valign: 'top', paraSpaceAfterPt: 6, ...drawExtra, _field:field });
    };
    const rule = (x, y, w = .65) => rect(x, y, w, .045, accent);
    const max = (items, limit, field) => {
        if (!Array.isArray(items) || items.length > limit) throw Object.assign(new Error(`Slide ${d.slideNumber}: ${field} supports at most ${limit} entries at readable sizes. Restructure this slide.`), { code: 'PRESENTATION_CONTENT_TOO_DENSE', slideNumber: d.slideNumber, field });
        return items;
    };
    const title = (value = d.title) => text(value, M, .42, CW, 1.2, 34, { bold: true, fontFace: t.headingFamily }, 'title');
    const footer = () => text(String(d.slideNumber), W - M - .4, 7.05, .4, .25, 12, { color: muted, align: 'right' }, 'slideNumber');
    const content = d.content, type = d.slideType;
    footer();
    if (type === 'title' || type === 'section-divider') {
        const v = content.titleContent || content.sectionContent;
        if(d.layoutId==='title-editorial'){
            const bg=c.background,fg=ink,secondary=muted;
            slide.background={color:bg};
            text(v.title,M,1.25,CW-.35,2.5,44,{bold:true,fontFace:t.headingFamily,color:fg},'title.title');
            text(v.subtitle,M,4.18,CW-1,1.1,25,{color:secondary},'title.subtitle');
            text(v.supportingText,M,5.8,CW-1,.9,20,{color:secondary},'title.supportingText');
            // The page marker was rendered on the old canvas. Cover the footer and redraw it with contrast.
            rect(W-M-.45,7.0,.55,.35,bg);
            return;
        }
        rule(M, 1.48, 1.1);
        const split=!!d.coverArtwork;
        if(split) slide.addImage({data:d.coverArtwork.data,x:8.4,y:1.65,w:4.2,h:4.2,altText:''});
        text(v.title, M, split?1.8:1.95, split?7.3:CW - .7, split?2.5:2.2, type === 'title' ? (split?42:40) : 38, { bold: true, fontFace: t.headingFamily }, `${type}.title`);
        text(v.subtitle, M, 4.48, split?7.3:CW - 1.2, 1.12, 24, { color: muted }, `${type}.subtitle`);
        text(v.supportingText, M, 6.05, CW - 1.2, .85, 20, { color: muted }, 'titleContent.supportingText');
        return;
    }
    title();
    text(d.subtitle, M, 1.7, CW, .42, 18, { color: muted }, 'subtitle');
    rule(M, 2.17);
    const top = 2.4, bottom = 6.98, space = bottom - top;
    if(d.resolvedVisual && !content.visualContent && !content.process && !content.relationship && !content.chart && !content.table){
        const caption=d.resolvedVisual.caption,boxes=visualCaptionBoxes(caption,{wide:d.visualCaptionWide,slideNumber:d.slideNumber});
        const body=[];
        const collect=(value,key='')=>{if(['id','from','to','type','searchQuery'].includes(key))return;
            if(typeof value==='string' && value && value!==d.title)body.push(value);
            else if(Array.isArray(value))value.forEach(v=>collect(v));
            else if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>collect(v,k));};
        collect(content);
        text(body.join('\n'),M,top+.15,5.4,Math.min(3.95,boxes.bodyBottom-top-.15),20,{},'content.visualLayout');
        if(d.resolvedVisual.diagram) renderNativeDiagram({slide,diagram:d.resolvedVisual.diagram,box:boxes.visual,ink,accent,fontFace:t.bodyFamily,slideNumber:d.slideNumber,validationErrors,onTextLayout});
        else {
            const visual=d.resolvedVisual,scale=Math.min(6.15/visual.width,boxes.visual.h/visual.height),w=visual.width*scale,h=visual.height*scale;
            slide.addImage({data:visual.data,x:6.45+(6.15-w)/2,y:boxes.visual.y+(boxes.visual.h-h)/2,w,h,altText:visual.altText});
        }
        text(caption,boxes.caption.x,boxes.caption.y,boxes.caption.w,boxes.caption.h,18,{color:muted},'visual.caption');return;
    }
    const grid = (items, field, mode = 'cards') => {
        max(items, limits[field], field);
        const cols = mode==='cards' && d.layoutId==='cards-horizontal' && items.length<=3 ? items.length : items.length <= 2 ? items.length : items.length > 4 ? 3 : 2;
        const rows = Math.ceil(items.length / cols), gap = .32;
        const w = (CW - gap * (cols - 1)) / cols, h = Math.min(3, (space - gap * (rows - 1)) / rows);
        items.forEach((item, i) => {
            const x = M + (i % cols) * (w + gap), y = top + Math.floor(i / cols) * (h + gap);
            if (mode === 'cards') rect(x, y, w, h, c.surface);
            const inset = mode === 'cards' ? .22 : 0;
            const label = item.label ?? item.stepNumber;
            const heading = [label, item.title].filter(v => v != null && v !== '').join('  ·  ');
            text(heading, x + inset, y + .08, w - 2 * inset, .85, 24, { bold: true, color: readable(ink, mode === 'cards' ? c.surface : c.background) }, `${field}[${i}].title`);
            text(item.description, x + inset, y + 1.02, w - 2 * inset, h - 1.04, 20, { color: readable(muted, mode === 'cards' ? c.surface : c.background) }, `${field}[${i}].description`);
        });
    };
    if (content.items) return grid(content.items, 'items', 'list');
    if (content.cards) return grid(content.cards, 'cards');
    if (content.process) {
        const steps=max(content.process.steps,limits['process.steps'],'process.steps');
        if(d.layoutId === 'process-horizontal' && steps.length <= 4){
            const w=(CW-.3*(steps.length-1))/steps.length;
            steps.forEach((item,i)=>{const x=M+i*(w+.3);
                text(String(item.stepNumber),x,top+.1,w,.65,24,{color:accent,bold:true},`process.steps[${i}].stepNumber`);
                if(i<steps.length-1) slide.addShape('line',{x:x+.55,y:top+.36,w:w-.35,h:0,line:{color:accent,width:1.6,endArrowType:'triangle'}});
                text(item.title,x,top+1,w,1.3,24,{bold:true},`process.steps[${i}].title`);
                text(item.description,x,top+2.5,w,1.8,20,{color:muted},`process.steps[${i}].description`);
            }); return;
        }
        if(d.layoutId === 'process-vertical'){
            const h=space/steps.length;
            steps.forEach((item,i)=>{const y=top+i*h;
                text(String(item.stepNumber),M,y,.5,.48,22,{bold:true,color:accent},`process.steps[${i}].stepNumber`);
                text(item.title,M+.8,y,3.4,h-.12,22,{bold:true},`process.steps[${i}].title`);
                text(item.description,M+4.5,y,CW-4.5,h-.12,20,{color:muted},`process.steps[${i}].description`);
                if(i<steps.length-1) slide.addShape('line',{x:M+.18,y:y+.5,w:0,h:Math.max(.04,h-.55),line:{color:accent,width:1.2,endArrowType:'triangle'}});
            });return;
        }
        return grid(steps,'process.steps','list');
    }
    if (content.timeline && content.timeline.events.length>=4) {
        const events=max(content.timeline.events,limits['timeline.events'],'timeline.events'),gap=.1,cols=2,rows=Math.ceil(events.length/cols),w=(CW-gap)/cols,h=(space-gap*(rows-1))/rows;
        events.forEach((event,i)=>{const x=M+i%cols*(w+gap),y=top+Math.floor(i/cols)*(h+gap);
            text(event.label,x,y,1.6,.7,20,{bold:true,color:accent},`timeline.events[${i}].label`);
            text(event.title,x+1.8,y,w-1.8,.7,20,{bold:true},`timeline.events[${i}].title`);
            text(event.description,x,y+.74,w,h-.76,18,{},`timeline.events[${i}].description`);
        });return;
    }
    if (content.timeline && d.layoutId!=='timeline-horizontal') {
        const events=max(content.timeline.events,limits['timeline.events'],'timeline.events'),h=space/events.length;
        events.forEach((event,i)=>{const y=top+i*h;
            text(event.label,M,y,2.5,h-.1,22,{bold:true,color:accent},`timeline.events[${i}].label`);
            slide.addShape('line',{x:M+2.85,y:y+.12,w:0,h:h-.12,line:{color:accent,width:2}});
            text(event.title,M+3.15,y,3.4,h-.1,22,{bold:true},`timeline.events[${i}].title`);
            text(event.description,M+6.9,y,CW-6.9,h-.1,20,{},`timeline.events[${i}].description`);
        }); return;
    }
    if (content.roadmap || (content.timeline && d.layoutId==='timeline-horizontal')) return progression(content.roadmap?.phases || content.timeline.events,content.roadmap?'roadmap.phases':'timeline.events');
    if (content.textContent) {
        const v = content.textContent;
        if(d.layoutId==='explanation-editorial'){
            const sentences=v.body.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(s=>s.trim()).filter(Boolean)||[v.body];
            const lead=sentences[0],rest=sentences.slice(1).join(' ');
            if(rest){
                text(lead,M,top+.2,4.5,3.85,28,{bold:true},'textContent.lead');
                text(rest,M+5.15,top+.22,CW-5.15,3.85,23,{},'textContent.body');
            }else text(v.body,M,top+.35,CW-1,3.7,28,{},'textContent.body');
            if(v.heading&&v.heading!==d.title)text(v.heading,M,6.6,CW,.38,18,{color:muted},'textContent.heading');
            return;
        }
        if (v.heading && v.heading !== d.title) text(v.heading, M, top, CW, .9, 28, { bold: true }, 'textContent.heading');
        text(v.body, M, top + 1.15, CW - .4, 3.25, 24, {}, 'textContent.body'); return;
    }
    if (content.summary || content.conclusion) {
        const v = content.summary || content.conclusion, points = v.points || v.supportingPoints;
        if(d.layoutId==='closing-synthesis'){
            max(points,content.summary?limits['summary.points']:limits['conclusion.supportingPoints'],'supportingPoints');
            text(v.statement,M,top+.05,5.05,4.05,32,{bold:true,fontFace:t.headingFamily},'statement');
            const x=M+5.8,w=CW-5.8,h=4.2/points.length;
            points.forEach((p,i)=>{
                rule(x,top+i*h,w);
                text(p,x,top+i*h+.15,w,h-.24,22,{},`supportingPoints[${i}]`);
            });return;
        }
        text(v.statement, M, top, CW, 1.4, 28, { bold: true }, 'statement');
        max(points, content.summary ? limits['summary.points'] : limits['conclusion.supportingPoints'], 'supportingPoints');
        const h = (space - 1.65) / points.length;
        points.forEach((p, i) => text(`•  ${p}`, M, top + 1.65 + i * h, CW - .2, h - .1, 22, {}, `supportingPoints[${i}]`)); return;
    }
    if (content.comparison) {
        const items = max(content.comparison.items, limits['comparison.items'], 'comparison.items'), gap = .4, w = (CW - gap * (items.length - 1)) / items.length;
        if(items.length===3){const rh=space/3;
            items.forEach((v,i)=>{const y=top+i*rh;rule(M,y);text(v.label,M,y+.12,2.7,rh-.2,20,{bold:true},`comparison.items[${i}].label`);const points=max(v.points,limits['comparison.items.points'],'comparison.points'),ph=(rh-.12)/points.length;points.forEach((p,j)=>text(`• ${p}`,M+3.1,y+j*ph,CW-3.1,ph-.02,18,{},`comparison.items[${i}].points[${j}]`));});return;
        }
        items.forEach((v, i) => {
            const x = M + i * (w + gap);
            rule(x, top); text(v.label, x, top + .3, w, 1, 26, { bold: true }, `comparison.items[${i}].label`);
            const points = max(v.points, limits['comparison.items.points'], 'comparison.points'), h = 3 / points.length;
            points.forEach((p, j) => text(`• ${p}`, x, top + 1.5 + j * h, w, h - .12, 22, {}, `comparison.items[${i}].points[${j}]`));
        }); return;
    }
    if (content.statistics) {
        const values = max(content.statistics, limits['statistics'], 'statistics'), w = CW / values.length;
        values.forEach((v, i) => {
            const x = M + w * i;
            text(v.value, x, top + .3, w - .35, 1.2, 44, { bold: true, color: accent }, `statistics[${i}].value`);
            text(v.label, x, top + 1.8, w - .35, 1, 24, { bold: true }, `statistics[${i}].label`);
            text(v.context, x, top + 3.05, w - .35, 1.3, 20, { color: muted }, `statistics[${i}].context`);
        }); return;
    }
    if (content.table) {
        const v = content.table, cols = max(v.columns, limits['table.columns'], 'table.columns'), rows = max(v.rows, limits['table.rows'], 'table.rows');
        const w = CW / cols.length, h = Math.min(.9, space / (rows.length + 1));
        [cols, ...rows.map(r => r.cells)].forEach((cells, r) => cells.forEach((cell, col) => {
            const x = M + col * w, y = top + r * h, bg = r === 0 ? ink : r % 2 ? c.surface : c.background;
            rect(x, y, w, h - .025, bg);
            text(cell, x + .12, y + .1, w - .24, h - .16, 20, { bold: r === 0, color: readable(r === 0 ? c.background : ink, bg) }, `table[${r}][${col}]`);
        })); return;
    }
    if (content.chart) {
        const v = content.chart;
        max(v.labels, limits['chart.labels'], 'chart.labels'); max(v.datasets, limits['chart.datasets'], 'chart.datasets');
        const chartTypes = { bar: 'bar', column: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut', area: 'area' };
        const chartType = chartTypes[v.chartType.toLowerCase()];
        if (!chartType) throw new Error(`Slide ${d.slideNumber}: unsupported chart.chartType "${v.chartType}"`);
        const values=v.datasets.flatMap(ds=>ds.values),isBar=['bar','column'].includes(v.chartType);
        slide.addChart(chartType, v.datasets.map(ds => ({ name: ds.label, labels: v.labels, values: ds.values })), {
            x: M, y: top, w: d.layoutId==='chart-with-insight'?7.8:CW, h: d.layoutId==='chart-with-insight'?4.05:3.55, catAxisLabelFontSize: 18, valAxisLabelFontSize: 18,
            showLegend: true, legendFontSize: 18, showTitle: false,
            chartColors: [accent, ink, muted], showBorder: false, showValue: false,
            catAxisLabelColor: ink, valAxisLabelColor: ink, legendColor: ink,
            chartArea: { fill: { color: c.background } }, plotArea: { fill: { color: c.background } },
            ...(isBar&&values.every(v=>v>=0)?{valAxisMinVal:0}:{}),
            ...(isBar&&values.every(v=>v<=0)?{valAxisMaxVal:0}:{}),
            ...(v.chartType === 'bar' ? { barDir: 'bar' } : { barDir: 'col' })
        });
        if(d.layoutId==='chart-with-insight')text(v.insight,9.1,top+.6,W-M-9.1,3.65,26,{bold:true},'chart.insight');
        else text(v.insight, M, 6, CW, .76, 22, { bold: true }, 'chart.insight'); return;
    }
    if (content.quote) {
        const v = content.quote;
        text(`“${v.text}”`, M, top, CW - .4, 2.8, 30, { italic: true, fontFace: t.headingFamily }, 'quote.text');
        text(v.attribution, M, 5.3, CW, .6, 22, { bold: true }, 'quote.attribution');
        text(v.context, M, 6.12, CW, .6, 20, { color: muted }, 'quote.context'); return;
    }
    if (content.caseStudy) {
        const entries = Object.entries(content.caseStudy).filter(([, value]) => value?.trim());
        entries.forEach(([key, value], i) => {
            const y = top + i * .9;
            text(key[0].toUpperCase() + key.slice(1), M, y, 1.85, .7, 22, { bold: true }, `caseStudy.${key}.label`);
            text(value, M + 2.1, y, CW - 2.1, .8, 22, {}, `caseStudy.${key}`);
        }); return;
    }
    if (content.callToAction) {
        text(content.callToAction.action, M, top + .3, CW, 2.2, 36, { bold: true }, 'callToAction.action');
        text(content.callToAction.supportingText, M, 5.15, CW - 1, 1.4, 24, { color: muted }, 'callToAction.supportingText'); return;
    }
    if (content.relationship) {
        const v = content.relationship, nodes = max(v.nodes, limits['relationship.nodes'], 'relationship.nodes'), links = max(v.relationships, limits['relationship.relationships'], 'relationship.relationships');
        const roots=nodes.filter(n=>!links.some(r=>r.to===n.id));
        if(roots.length===1&&links.length===nodes.length-1&&links.every(r=>r.from===roots[0].id)){
            const root=roots[0],leaves=nodes.filter(n=>n!==root),gap=.35,w=(CW-gap*(leaves.length-1))/leaves.length;
            text(root.label,M+CW/2-2.2,top,4.4,.7,26,{bold:true,align:'center'},`relationship.nodes[${nodes.indexOf(root)}].label`);
            text(root.description,M+CW/2-3.2,top+.8,6.4,.7,20,{align:'center'},`relationship.nodes[${nodes.indexOf(root)}].description`);
            const busY=top+1.7;
            slide.addShape('line',{x:M+CW/2,y:top+1.45,w:0,h:.25,line:{color:accent,width:1.5}});
            const centers=leaves.map((n,i)=>M+i*(w+gap)+w/2);
            slide.addShape('line',{x:centers[0],y:busY,w:centers.at(-1)-centers[0],h:0,line:{color:accent,width:1.5}});
            leaves.forEach((node,i)=>{const x=M+i*(w+gap),edge=links.find(r=>r.to===node.id);
                slide.addShape('line',{x:centers[i],y:busY,w:0,h:.1,line:{color:accent,width:1.5}});
                slide.addShape('line',{x:centers[i],y:top+2.35,w:0,h:.18,line:{color:accent,width:1.5,endArrowType:'triangle'}});
                text(edge.label,x,top+1.85,w,.45,18,{align:'center',color:muted},`relationship.relationships[${links.indexOf(edge)}].label`);
                text(node.label,x,top+2.65,w,.9,24,{bold:true},`relationship.nodes[${nodes.indexOf(node)}].label`);
                text(node.description,x,top+3.68,w,.85,20,{},`relationship.nodes[${nodes.indexOf(node)}].description`);
            });return;
        }
        const starts=nodes.filter(n=>!links.some(r=>r.to===n.id));
        if(starts.length===1 && links.length===nodes.length-1 && nodes.every(n=>links.filter(r=>r.from===n.id).length<=1)){
            const ordered=[];let current=starts[0];
            while(current&&!ordered.some(n=>n.id===current.id)){ordered.push(current);current=nodes.find(n=>n.id===links.find(r=>r.from===current.id)?.to);}
            if(ordered.length===nodes.length){
                if(d.layoutId==='relationship-chain-vertical'){
                    const h=space/ordered.length;
                    ordered.forEach((node,i)=>{const y=top+i*h;
                        text(node.label,M+.45,y,3.15,h-.1,22,{bold:true},`relationship.nodes[${nodes.indexOf(node)}].label`);
                        text(node.description,M+3.9,y,5.2,h-.1,20,{},`relationship.nodes[${nodes.indexOf(node)}].description`);
                        const edge=links.find(r=>r.from===node.id);
                        if(edge){text(edge.label,M+9.45,y,2.4,h-.1,18,{color:muted},`relationship.relationships[${links.indexOf(edge)}].label`);
                            slide.addShape('line',{x:M+.15,y:y+.4,w:0,h:h-.42,line:{color:accent,width:1.4,endArrowType:'triangle'}});}
                    });return;
                }
                const gap=.28,w=(CW-gap*(nodes.length-1))/nodes.length;
                ordered.forEach((node,i)=>{const x=M+i*(w+gap);
                    rule(x,top+1.05,w-.15);
                    text(node.label,x,top+1.35,w,1.1,22,{bold:true},`relationship.nodes[${nodes.indexOf(node)}].label`);
                    text(node.description,x,top+2.65,w,1.45,18,{},`relationship.nodes[${nodes.indexOf(node)}].description`);
                    const edge=links.find(r=>r.from===node.id);
                    if(edge){text(edge.label,x,top+.05,w,.75,18,{color:muted},`relationship.relationships[${links.indexOf(edge)}].label`);
                        slide.addShape('line',{x:x+.15,y:top+.87,w:w+.05,h:0,line:{color:accent,width:1.5,endArrowType:'triangle'}});}
                });return;
            }
        }
        if (nodes.length > 3) {
            // Wider rows preserve scientific terms that cannot fit narrow columns.
            nodes.forEach((n, i) => {
                const y = top + i * .9;
                text(String(i+1),M,y,.35,.82,18,{color:muted},'relationship.nodeNumber');
                text(n.label, M+.45, y, 2.5, .82, 22, { bold: true }, `relationship.nodes[${i}].label`);
                text(n.description, M + 3.12, y, 3.35, .82, 20, {}, `relationship.nodes[${i}].description`);
            });
            // Endpoint names already appear in the numbered node list. Give
            // relationship text its own box: subtracting a long name prefix
            // from this box's budget previously clamped meaningful labels to 1.
            links.forEach((r, i) => {text(`${nodes.findIndex(n=>n.id===r.from)+1} → ${nodes.findIndex(n=>n.id===r.to)+1}`,7.45,top+i*.9,.9,.82,18,{color:muted},'relationship.endpointNumbers');text(r.label,8.5,top+i*.9,4.1,.82,18,{color:muted},`relationship.relationships[${i}].label`);});
            return;
        }
        const w = (CW - .3 * (nodes.length - 1)) / nodes.length;
        nodes.forEach((n, i) => {
            const x = M + i * (w + .3);
            text(String(i+1),x,top+.25,.35,.4,18,{color:muted},'relationship.nodeNumber');
            rule(x, top); text(n.label, x+.45, top + .25, w-.45, 1, 24, { bold: true }, `relationship.nodes[${i}].label`);
            text(n.description, x, top + 1.4, w, 1.35, 20, {}, `relationship.nodes[${i}].description`);
        });
        links.forEach((r, i) => {text(`${nodes.findIndex(n=>n.id===r.from)+1} → ${nodes.findIndex(n=>n.id===r.to)+1}`,M,5.12+i*.32,.9,.31,18,{color:muted},'relationship.endpointNumbers');text(r.label,M+1.1,5.12+i*.32,CW-1.1,.31,18,{color:muted},`relationship.relationships[${i}].label`);}); return;
    }
    if (content.visualContent) {
        const v = content.visualContent;
        const visual=d.resolvedVisual,diagram=visual?.diagram || v.visual.diagram;
        const caption=visual?.caption||diagram?.caption,boxes=visualCaptionBoxes(caption,{wide:d.visualCaptionWide,slideNumber:d.slideNumber});
        if(diagram) validateDiagram(diagram);
        // Dry validation accepts a declarative diagram before asset resolution.
        // Unresolved descriptions/search queries never become visible slide text.
        if(!visual && !diagram){text(v.text,M,top+.25,CW-.3,3.9,24,{},'visualContent.text');return;}
        text(v.text,M,top+.15,5.1,Math.min(3.95,boxes.bodyBottom-top-.15),22,{},'visualContent.text');
        if(diagram) renderNativeDiagram({slide,diagram,box:boxes.visual,ink,accent,fontFace:t.bodyFamily,slideNumber:d.slideNumber,validationErrors,onTextLayout});
        else if(visual?.data) {
            const scale=Math.min(6.15/visual.width,boxes.visual.h/visual.height),w=visual.width*scale,h=visual.height*scale;
            slide.addImage({data:visual.data,x:6.45+(6.15-w)/2,y:boxes.visual.y+(boxes.visual.h-h)/2,w,h,altText:visual.altText});
        }
        text(caption,boxes.caption.x,boxes.caption.y,boxes.caption.w,boxes.caption.h,18,{color:muted},'visual.caption');return;
    }
    throw new Error(`Slide ${d.slideNumber}: no canonical renderer for ${type}`);

    function progression(items,field){
        max(items,limits[field],field);
        if(items.length>3){
            const h=space/items.length;
            items.forEach((p,i)=>{const y=top+i*h;
                text(p.label,M,y,2.05,h-.1,20,{color:accent,bold:true},`${field}[${i}].label`);
                text(p.title,M+2.35,y,3.4,h-.1,22,{bold:true},`${field}[${i}].title`);
                text(p.description,M+6.1,y,CW-6.1,h-.1,20,{},`${field}[${i}].description`);
            });return;
        }
        const gap=.4,w=(CW-gap*(items.length-1))/items.length;
        items.forEach((p,i)=>{const x=M+i*(w+gap);
            text(p.label,x,top+.12,w,.7,20,{color:accent,bold:true},`${field}[${i}].label`);
            slide.addShape('line',{x,y:top+1,w:w+(i<items.length-1?gap:0),h:0,line:{color:accent,width:2,...(i<items.length-1?{endArrowType:'triangle'}:{})}});
            text(p.title,x,top+1.28,w,1.05,24,{bold:true},`${field}[${i}].title`);
            text(p.description,x,top+2.5,w,1.65,20,{},`${field}[${i}].description`);
        });
    }
}

export function validateRenderContent(slideData,options={}) {
    const mock = { addText() {}, addShape() {}, addChart() {}, addImage() {} };
    const validationErrors=[];
    renderProfessionalSlide({ slide: mock, slideData,...options,validationErrors });
    if(validationErrors.length)throw Object.assign(validationErrors[0],{validationErrors:validationErrors.map(({field,maxCharacters,repairHint})=>({field,maxCharacters,repairHint}))});
    return true;
}

// Pre-image stages must validate the same composition that will be rendered.
// This marker is used only by the no-output dry renderer, never saved as media.
export function validatePlannedRenderContent(slideData,options={}){
    return validateRenderContent(slideData.imageLayoutPlanned&&!slideData.photoAsset
        ?{...slideData,photoAsset:{data:'dry-layout-only'},photoComposition:photoCompositionFor(slideData)}
        :slideData,options);
}
