import {assertTextFits} from './contentFit.mjs';
import {renderNativeDiagram} from './visuals/nativeDiagram.mjs';
import {presentationFontSize} from './typography.mjs';
import {visualCaptionBoxes} from './visualLayout.mjs';
export const PHOTO_TECHNICAL_TEXT_BOX=Object.freeze({x:.72,y:2.45,w:8.05,h:4,fontSize:18});

export const PHOTO_FRAMES={
    'hero-full-bleed':{x:0,y:0,w:13.333333,h:7.5},
    'hero-photo':{x:5.75,y:0,w:7.583333,h:7.5},
    'photo-divider':{x:0,y:0,w:13.333333,h:4.05},
    'photo-panel':{x:0,y:0,w:5.3,h:7.5},
    'photo-editorial':{x:.72,y:2.4,w:6.15,h:4.5},
    'photo-grid':{x:.72,y:2.4,w:6.15,h:2.08},
    'photo-comparison':{x:7.7,y:2.4,w:4.91,h:4.5},
    'photo-technical':{x:9.4,y:2.4,w:3.21,h:4.0}
};
export const PHOTO_VISIBLE_FRAMES={'hero-full-bleed':{x:0,y:0,w:13.333333,h:3.3}};
export function renderPhotoComposition({slide,d,c,t,ink,muted,accent,validationErrors,onTextLayout}){
    const mode=d.photoComposition||'photo-editorial',frame=PHOTO_FRAMES[mode]||PHOTO_FRAMES['photo-editorial'],asset=d.photoAsset;
    if(!asset?.data)return false;
    d.photoFrame={...frame};
    const rect=(x,y,w,h,color,transparency=0)=>slide.addShape('rect',{x,y,w,h,line:{color,transparency:100},fill:{color,transparency}});
    const text=(value,x,y,w,h,size,bold=false,color=ink,field='content.photo')=>{
        if(!value)return;
        size=presentationFontSize(field,{bold});
        onTextLayout?.({field,w,h,fontSize:size});
        try{assertTextFits(String(value),{w,h,fontSize:size},field,d.slideNumber);}catch(error){
            if(field==='content.photo')error.repairHint=`The combined visible text from all content fields must fit at most ${error.maxCharacters} characters. Shorten prose and item descriptions together; content.photo is a layout diagnostic, not a JSON property. Preserve essential facts.`;
            if(!validationErrors)throw error;validationErrors.push(error);
        }
        slide.addText(String(value),{x,y,w,h,fontSize:size,bold,color,fontFace:bold?t.headingFamily:t.bodyFamily,margin:0,valign:'top',breakLine:false,_field:field});
    };
    slide.background={color:c.background};
    slide.addImage({data:asset.data,...frame,altText:asset.altText});
    if(mode==='photo-grid'&&d.photoAssets?.[1])slide.addImage({data:d.photoAssets[1].data,...frame,y:4.8,altText:d.photoAssets[1].altText});
    // Provenance remains in asset metadata and required source credits.
    const disclosure='';
    if(mode==='hero-full-bleed'){
        const channels=c.background.match(/../g).map(n=>parseInt(n,16));
        const darkCanvas=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722<128;
        const dark=darkCanvas?c.background:ink,light=darkCanvas?ink:c.background;
        // The photo remains full slide; the translucent lower panel provides
        // a stable, high-contrast text area without an opaque split cover.
        if(d.surfaceArt)slide.addImage({data:d.surfaceArt,x:0,y:3.3,w:13.333333,h:4.2,altText:''});else rect(0,3.3,13.333333,4.2,dark,6);
        const v=d.content.titleContent||d.content.sectionContent||{title:d.title,subtitle:d.subtitle,
            supportingText:d.content.textContent?.body||d.content.visualContent?.text||''};
        text(v.title,.72,3.65,11.89,1.45,32,true,light,'title.photo');
        text(v.subtitle,.72,5.3,11.89,.9,21,false,light,'title.subtitle');
        text(v.supportingText,.72,6.35,11.89,.8,18,false,light,'title.supporting');
        return true;
    }
    if(mode==='hero-photo'||mode==='hero-full-bleed'){
        const canvasChannels=c.background.match(/../g).map(n=>parseInt(n,16));
        const darkCanvas=canvasChannels[0]*.2126+canvasChannels[1]*.7152+canvasChannels[2]*.0722<128;
        const dark=darkCanvas?c.background:ink,light=darkCanvas?ink:c.background;
        rect(0,0,5.75,7.5,dark);
        const v=d.content.titleContent||d.content.sectionContent;
        text(v.title,.65,.8,4.48,2.9,30,true,light,'title.photo');
        text(v.subtitle,.65,3.95,4.48,1.8,21,false,light,'title.subtitle');
        text(v.supportingText,.65,6.05,4.48,.65,18,false,light,'title.supporting');
        text(disclosure,.65,6.96,4.48,.42,17,false,light,'visual.caption');return true;
    }
    if(mode==='photo-divider'){
        const v=d.content.sectionContent||d.content.titleContent;
        text(v.title,.72,4.4,11.89,1.25,34,true,ink,'title.photo');
        text(v.subtitle,.72,5.83,11.89,.7,23,false,muted,'title.subtitle');
        text(v.supportingText,.72,6.6,11.89,.4,18,false,muted,'title.supporting');
        text(disclosure,.72,7.06,11.89,.4,17,false,muted,'visual.caption');return true;
    }
    const panel=mode==='photo-panel',x=panel?5.95:.72,w=panel?6.65:11.89;
    text(d.title,x,.42,w,1.2,32,true,ink,'title');
    text(d.subtitle,x,1.7,w,.68,18,false,muted,'subtitle');
    if(mode==='photo-technical'){
        const content=d.content,{x:bx,y:by,w:bw,h:bh}=PHOTO_TECHNICAL_TEXT_BOX;
        if(content.chart){
            const v=content.chart,types={bar:'bar',column:'bar',line:'line',pie:'pie',doughnut:'doughnut',area:'area'};
            slide.addChart(types[v.chartType],v.datasets.map(ds=>({name:ds.label,labels:v.labels,values:ds.values})),{x:bx,y:by,w:bw,h:3.5,catAxisLabelFontSize:18,valAxisLabelFontSize:18,showLegend:true,legendFontSize:18,showTitle:false,chartColors:[accent,ink,muted],catAxisLabelColor:ink,valAxisLabelColor:ink,legendColor:ink,chartArea:{fill:{color:c.background}},plotArea:{fill:{color:c.background}},barDir:v.chartType==='bar'?'bar':'col'});
            text(v.insight,bx,6.1,bw,.62,20,true,ink,'chart.insight');
        }else if(content.table){
            const v=content.table,rows=[v.columns,...v.rows.map(r=>r.cells)],rh=bh/rows.length,cw=bw/v.columns.length;
            rows.forEach((row,r)=>row.forEach((cell,col)=>{const xx=bx+col*cw,yy=by+r*rh;if(r===0)rect(xx,yy,cw,rh,ink);else slide.addShape('line',{x:xx,y:yy,w:cw,h:0,line:{color:accent,width:.5}});text(cell,xx+.1,yy+.07,cw-.2,rh-.12,18,r===0,r===0?c.background:ink,`table[${r}][${col}]`);}));
        }else{
            const relation=content.relationship;
            const diagram=content.visualContent?.visual?.diagram||d.resolvedVisual?.diagram||d.visualPlan||(relation?{kind:'labeled',nodes:relation.nodes,edges:relation.relationships,caption:''}:null);
            if(diagram){
                if(diagram.nodes.length>4)throw Object.assign(new Error('The image-and-diagram layout supports at most four concise nodes. Consolidate accurately, preserve essential facts in the explanatory text, or use a simpler content structure.'),{field:'visual.diagram.nodes',slideNumber:d.slideNumber});
                const prose=content.visualContent?.text;
                let proseHeight=0;
                if(prose){for(proseHeight=.3225;proseHeight<1.05;proseHeight+=.3125){try{assertTextFits(prose,{w:bw,h:proseHeight,fontSize:18},'visualContent.text',d.slideNumber);break;}catch{}}proseHeight=Math.min(1.05,proseHeight);text(prose,bx,by,bw,proseHeight,18,false,ink,'visualContent.text');}
                const diagramY=prose?by+proseHeight+.15:by;
                const caption=diagram.caption,boxes=visualCaptionBoxes(caption,{x:bx,y:diagramY,w:bw,h:6.85-diagramY,slideNumber:d.slideNumber});
                renderNativeDiagram({slide,diagram,box:boxes.visual,ink,accent,fontFace:t.bodyFamily,slideNumber:d.slideNumber,validationErrors,onTextLayout});
                text(caption,boxes.caption.x,boxes.caption.y,boxes.caption.w,boxes.caption.h,18,false,muted,'visual.caption');
            }else if(content.timeline){
                const events=content.timeline.events,rh=bh/events.length;
                events.forEach((event,i)=>{const yy=by+i*rh;rect(bx,yy,.04,rh-.08,accent);text(event.label,bx+.2,yy,1.5,.35,20,true,accent,`timeline.events[${i}].label`);text(event.title,bx+1.9,yy,bw-2,.35,20,true,ink,`timeline.events[${i}].title`);text(event.description,bx+.2,yy+.4,bw-.3,rh-.43,18,false,ink,`timeline.events[${i}].description`);});
            }else{
                const body=content.visualContent?.text||content.textContent?.body;
                if(!body)throw Object.assign(new Error('Technical image layout needs its approved diagram, chart, table or explanatory text'),{field:'content',slideNumber:d.slideNumber});
                text(body,bx,by,bw,bh,22,false,ink,'content.photo');
            }
        }
        text(disclosure,9.4,6.55,3.21,.55,17,false,muted,'visual.caption');return true;
    }
    const tx=panel?5.95:mode==='photo-comparison'?.72:7.47,tw=panel?6.65:mode==='photo-comparison'?6.3:5.14;
    const content=d.content;
    if(content.comparison){
        const values=content.comparison.items,h=4.25/values.length;
        values.forEach((item,i)=>{
            const y=2.4+i*h;text(item.label,tx,y,tw,.35,20,true,ink,`comparison.items[${i}].label`);
            const ph=(h-.38)/item.points.length;item.points.forEach((point,j)=>text('• '+point,tx,y+.38+j*ph,tw,ph-.02,18,false,muted,`comparison.items[${i}].points[${j}]`));
        });
    }else if(content.process){
        const steps=content.process.steps,h=4.25/steps.length;
        steps.forEach((s,i)=>{const y=2.4+i*h;
            if(steps.length>=4){text(`${s.stepNumber}. ${s.title}: ${s.description}`,tx,y,tw,h-.05,18,false,ink,`process.steps[${i}]`);return;}
            text(`${s.stepNumber}. ${s.title}`,tx,y,tw,.5,22,true,ink,`process.steps[${i}].title`);
            text(s.description,tx,y+.6,tw,h-.71,20,false,muted,`process.steps[${i}].description`);
            if(i<steps.length-1)slide.addShape('line',{x:tx+tw-.12,y:y+.45,w:0,h:Math.max(.02,h-.5),line:{color:accent,width:1.5,endArrowType:'triangle'}});
        });
    }else{
        const blocks=[];
        const collect=(v,key='')=>{
            if(['id','from','to','type','visual','searchQuery'].includes(key))return;
            if(typeof v==='string'&&v&&v!==d.title)blocks.push(v);
            else if(typeof v==='number'&&Number.isFinite(v))blocks.push(String(v));
            else if(Array.isArray(v))v.forEach(n=>collect(n));
            else if(v&&typeof v==='object'){
                const entries=Object.entries(v).filter(([k])=>!['id','from','to','type','visual','searchQuery'].includes(k));
                if(entries.length&&entries.every(([,n])=>typeof n==='string'||typeof n==='number')){
                    const group=entries.map(([,n])=>String(n)).filter(n=>n&&n!==d.title).join(': ');if(group)blocks.push(group);
                }else entries.forEach(([k,n])=>collect(n,k));
            }
        };
        collect(content);
        text(blocks.join('\n'),tx,2.52,tw,4.25,18,false,ink,'content.photo');
    }
    text(disclosure,tx,6.96,tw,.42,17,false,muted,'visual.caption');return true;
}
