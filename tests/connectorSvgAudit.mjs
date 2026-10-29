import fs from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import assert from 'node:assert/strict';
import {diagramSvg} from '../renderer/presentation/visuals/svgGraphics.mjs';
const root='generated/connector-artifacts/final',diagram={kind:'flowchart',nodes:['a','b','c','d'].map((id,i)=>({id,label:['Observe','Model','Review','Decide'][i],description:i===1?'Models relationships.':'Check evidence'})),edges:[{from:'a',to:'b',label:''},{from:'b',to:'c',label:''},{from:'c',to:'d',label:''}],caption:'Simplified model.'};
const after=diagramSvg(diagram,{textPrimary:'18242E',background:'F8F5EF',accent:'A56B3A'});
const before=after.replace(/<path data-arrowhead="\d+"[^>]+\/>/g,'').replace(/(<path data-connector="\d+"[^>]+)\/>/g,'$1 marker-end="url(#arrow)"/>').replace('<rect','<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="#A56B3A"/></marker></defs><rect');
const head=after.match(/data-arrowhead="0" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) Z/),[x,y,a,b,c,d]=head.slice(1).map(Number),px=Math.round(.1*x+.8*a+.1*c),py=Math.round(.1*y+.8*b+.1*d),report={samplePoint:{x:px,y:py}};
await fs.mkdir(root,{recursive:true});
for(const [name,svg] of [['before-marker',before],['after-explicit',after]]){const img=await loadImage(Buffer.from(svg)),canvas=createCanvas(1200,1000),context=canvas.getContext('2d');context.drawImage(img,0,0);const pixel=[...context.getImageData(px,py,1,1).data];report[name]={pixel,arrowheadVisible:pixel[0]<200&&pixel[2]<150};await fs.writeFile(root+'/'+name+'.svg',svg);await fs.writeFile(root+'/'+name+'.png',canvas.toBuffer('image/png'));}
assert.equal(report['before-marker'].arrowheadVisible,false);assert.equal(report['after-explicit'].arrowheadVisible,true);await fs.writeFile(root+'/svg-arrowhead-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
