import test from 'node:test';
import assert from 'node:assert/strict';
import {renderNativeDiagram} from '../../renderer/presentation/visuals/nativeDiagram.mjs';
import {segmentOverlap,segmentHitsRect,routeDiagramConnectors} from '../../renderer/presentation/visuals/connectorRouting.mjs';
import {diagramSvg} from '../../renderer/presentation/visuals/svgGraphics.mjs';
import {createCanvas,loadImage} from '@napi-rs/canvas';
const base={kind:'flowchart',nodes:['a','b','c','d'].map((id,i)=>({id,label:['Observe','Model','Review','Decide'][i],description:'Check evidence'})),edges:[{from:'a',to:'b',label:''},{from:'b',to:'c',label:''},{from:'c',to:'d',label:''}],caption:'Simplified model.'};
export function captureDiagram(diagram=base){const texts=[],shapes=[];renderNativeDiagram({slide:{addText:(value,o)=>texts.push({value,...o}),addShape:(type,o)=>shapes.push({type,...o})},diagram,box:{x:6.45,y:2.3,w:6.15,h:3.9},ink:'FFFFFF',accent:'9A83E8',fontFace:'Arial',slideNumber:4});return {texts,shapes};}
const segments=shapes=>shapes.filter(s=>s.type==='line').map(s=>({x1:s.x,y1:s.y,x2:s.x+s.w,y2:s.y+s.h}));
test('four-node serpentine flow has no duplicate/overlapping line segments or text intersections',()=>{
 const {texts,shapes}=captureDiagram(),lines=segments(shapes);assert.ok(lines.length>=3);for(let i=0;i<lines.length;i++){for(let j=i+1;j<lines.length;j++)assert.equal(segmentOverlap(lines[i],lines[j]),0);for(const text of texts)assert.equal(segmentHitsRect(lines[i],text),false,JSON.stringify({line:lines[i],text:text._field}));}
 assert.equal(shapes.filter(s=>s.line?.beginArrowType==='triangle'||s.line?.endArrowType==='triangle').length,base.edges.length);
 for(const s of shapes)assert.ok(s.x>=0&&s.y>=0&&s.x+s.w<=13.334&&s.y+s.h<=7.5);
});
for(const kind of ['cycle','labeled'])test(`${kind} graph retains each logical edge without stray or repeated segments`,()=>{
 const d=structuredClone(base);d.kind=kind;if(kind==='cycle')d.edges.push({from:'d',to:'a',label:''});else d.edges=[{from:'a',to:'b',label:'informs'},{from:'a',to:'c',label:'supports'},{from:'d',to:'b',label:'checks'}];const {shapes,texts}=captureDiagram(d),lines=segments(shapes);assert.equal(shapes.filter(s=>s.line?.beginArrowType||s.line?.endArrowType).length,d.edges.length);for(const s of lines)for(const text of texts)assert.equal(segmentHitsRect(s,text),false);for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++)assert.equal(segmentOverlap(lines[i],lines[j]),0);
});
test('SVG connectors are open routed paths, retaining intentional node rules and arrowheads',()=>{
 const svg=diagramSvg(base,{textPrimary:'FFFFFF',background:'14243A',accent:'9A83E8'});const paths=[...svg.matchAll(/<path data-connector="\d+" d="([^"]+)"/g)];assert.equal(paths.length,base.edges.length);for(const p of paths)assert.doesNotMatch(p[1],/[zZ]/);assert.equal((svg.match(/h 470/g)||[]).length,base.nodes.length);assert.match(svg,/fill="none"/);assert.equal((svg.match(/data-arrowhead=/g)||[]).length,base.edges.length);
});
test('actual SVG rasterization retains visible arrowhead wings beyond the line stroke',async()=>{
 const svg=diagramSvg(base,{textPrimary:'FFFFFF',background:'14243A',accent:'9A83E8'}),image=await loadImage(Buffer.from(svg)),canvas=createCanvas(1200,1000),context=canvas.getContext('2d');context.drawImage(image,0,0);
 const arrow=[...svg.matchAll(/data-arrowhead="\d+" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) Z/g)][0];assert.ok(arrow);
 const [x,y,a,b,c,d]=arrow.slice(1).map(Number),px=Math.round(.1*x+.8*a+.1*c),py=Math.round(.1*y+.8*b+.1*d),rgba=context.getImageData(px,py,1,1).data;
 assert.ok(rgba[0]>120&&rgba[2]>180,'Arrowhead must be filled accent pixels in the rendered image');
});
test('router uses bounded whitespace and preserves reverse arrow direction in its ordered points',()=>{
 const nodes=[{id:'a',x:1,y:1,w:2,h:1},{id:'b',x:4,y:1,w:2,h:1}],routes=routeDiagramConnectors(nodes,[{from:'b',to:'a'}],{x:.5,y:.5,w:6,h:3});assert.equal(routes.length,1);assert.ok(routes[0].points[0].x>routes[0].points.at(-1).x);for(const s of routes[0].segments)for(const r of nodes)assert.equal(segmentHitsRect(s,r),false);
});
