import { validateDiagram } from './svgGraphics.mjs';
import { assertTextFits } from '../contentFit.mjs';
import {routeDiagramConnectors} from './connectorRouting.mjs';

export function renderNativeDiagram({ slide, diagram, box, ink, accent, fontFace, slideNumber,validationErrors,onTextLayout }) {
    validateDiagram(diagram);
    const { x,y,w,h }=box,cols=['labeled','cycle'].includes(diagram.kind)||diagram.nodes.length>Math.floor(h/1.15)?2:1,rows=Math.ceil(diagram.nodes.length/cols),rowH=h/rows;
    const gap=.35,nodeW=cols===2?(w-gap)/2:w*.65;
    const cycleSlots=Array.from({length:rows},(_,i)=>[1,i]).concat(Array.from({length:rows},(_,i)=>[0,rows-1-i]));
    // Cycle order follows the perimeter; a closing edge returns to the start.
    const positions=diagram.nodes.map((node,i)=>{const slot=diagram.kind==='cycle'?cycleSlots[(i+cycleSlots.length-1)%cycleSlots.length]:[i%cols,Math.floor(i/cols)];return {...node,x:x+slot[0]*(nodeW+gap),y:y+slot[1]*rowH};});
    const byId=Object.fromEntries(positions.map(n=>[n.id,n])),nodeBoxes=[],labelBoxes=[];
    // Branches can share source/target rows. Give every relationship a distinct
    // numbered legend slot instead of drawing several labels at one anchor.
    const labeledEdges=diagram.edges.filter(edge=>edge.label);
    const originalAnchors=labeledEdges.map(edge=>{
        const a=byId[edge.from],b=byId[edge.to];
        return {x:a.x,y:a.x===b.x?Math.min(a.y,b.y):a.y};
    });
    const branchLegend=cols===2&&new Set(originalAnchors.map(a=>`${a.x}:${a.y}`)).size<labeledEdges.length;
    const legendRows=cols===2?Math.ceil(labeledEdges.length/positions.length):0;
    for(const [i,edge] of labeledEdges.entries()){
        const from=positions.findIndex(n=>n.id===edge.from)+1,to=positions.findIndex(n=>n.id===edge.to)+1;
        const anchor=branchLegend?positions[i%positions.length]:originalAnchors[i],lane=branchLegend?Math.floor(i/positions.length):0;
        const value=branchLegend?`${from}→${to}: ${edge.label}`:edge.label;
        const labelW=cols===2?nodeW-.3:w-nodeW-.25,labelH=cols===2?.35:Math.min(.7,rowH-.1);
        const field=`visual.diagram.edges[${diagram.edges.indexOf(edge)}].label`;
        const overhead=value.length-edge.label.length;
        onTextLayout?.({field,w:labelW,h:labelH,fontSize:18,overhead});
        try{assertTextFits(value,{w:labelW,h:labelH,fontSize:18},field,slideNumber);}catch(error){if(overhead)error.maxCharacters=Math.max(1,error.maxCharacters-overhead);if(!validationErrors)throw error;validationErrors.push(error);}
        const textBox={x:cols===2?anchor.x:x+nodeW+.25,y:cols===2?anchor.y+rowH-.35*legendRows+lane*.35:anchor.y+rowH*.6,w:labelW,h:labelH};labelBoxes.push(textBox);
        slide.addText(value,{...textBox,fontFace,fontSize:18,color:ink,margin:0,_field:field});
    }
    for(const [i,node] of positions.entries()){
        const size=20,labelH=cols===2?Math.max(.4,Math.min(.8,rowH*.26)):.38,descH=Math.min(.8,rowH-labelH-(cols===2?.2+.35*legendRows:.2));
        nodeBoxes.push({id:node.id,x:node.x,y:node.y+.08,w:nodeW-.3,h:node.description?labelH+.02+Math.max(.01,descH):labelH});
        const add=(value,yy,hh,fs,bold,field)=>{
            if(!value) return;const overhead=field.endsWith('.label')&&branchLegend?String(i+1).length+2:0;onTextLayout?.({field,w:nodeW-.3,h:hh,fontSize:fs,overhead});try{assertTextFits(value,{w:nodeW-.3,h:hh,fontSize:fs},field,slideNumber);}catch(error){if(overhead)error.maxCharacters=Math.max(1,error.maxCharacters-overhead);if(!validationErrors)throw error;validationErrors.push(error);}
            slide.addText(value,{x:node.x,y:yy,w:nodeW-.3,h:hh,fontSize:fs,fontFace,color:ink,bold,margin:0,breakLine:false,valign:'top',_field:field});
        };
        add(branchLegend?`${i+1}. ${node.label}`:node.label,node.y+.08,labelH,size,true,`visual.diagram.nodes[${i}].label`);
        if(node.description) add(node.description,node.y+labelH+.1,Math.max(.01,descH),18,false,`visual.diagram.nodes[${i}].description`);
    }
    // Invalid dry-run text is already collected for repair. Never mask those
    // actionable density errors with a route error from the same invalid boxes.
    if(validationErrors?.length)return;
    const routes=routeDiagramConnectors(nodeBoxes,diagram.edges,box,{obstacles:labelBoxes}),ports=new Set();
    for(const route of routes){
        for(const point of [route.points[0],route.points.at(-1)]){const key=`${point.x}:${point.y}`;if(ports.has(key))continue;ports.add(key);slide.addShape('ellipse',{x:point.x-.025,y:point.y-.025,w:.05,h:.05,line:{color:accent,transparency:100},fill:{color:accent}});}
        for(const [i,s] of route.segments.entries()){
            const backwards=s.x2<s.x1||s.y2<s.y1,terminal=i===route.segments.length-1;
            slide.addShape('line',{x:Math.min(s.x1,s.x2),y:Math.min(s.y1,s.y2),w:Math.abs(s.x2-s.x1),h:Math.abs(s.y2-s.y1),line:{color:accent,width:1.4,transparency:0,...(terminal?backwards?{beginArrowType:'triangle'}:{endArrowType:'triangle'}:{})}});
        }
    }
}
