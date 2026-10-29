import {load} from 'cheerio';
import sharp from 'sharp';
const tags={svg:['xmlns','viewBox','width','height'],g:['fill','stroke','stroke-width','opacity'],rect:['x','y','width','height','rx','fill','stroke','stroke-width','opacity'],circle:['cx','cy','r','fill','stroke','stroke-width','opacity'],ellipse:['cx','cy','rx','ry','fill','stroke','stroke-width','opacity'],line:['x1','y1','x2','y2','stroke','stroke-width','opacity'],path:['d','fill','stroke','stroke-width','opacity'],text:['x','y','fill','font-size','text-anchor']};
const unsafe=()=>Object.assign(new Error('SVG contains unsupported markup, attributes or geometry.'),{code:'UNSAFE_DESIGN_SVG',stage:'svg-validation'});
export function sanitizeDesignSvg(source){
 if(typeof source!=='string'||source.length>20000||/<!|<\?|&(?:#|[a-z])/i.test(source))throw unsafe();
 const $=load(source,{xmlMode:true,decodeEntities:true}),roots=$.root().children();if(roots.length!==1||roots[0].name!=='svg')throw unsafe();let nodes=0;
 $('*').each((_,node)=>{if(++nodes>100||!tags[node.name])throw unsafe();for(const [key,value] of Object.entries(node.attribs||{})){
  if(!tags[node.name].includes(key)||key!=='xmlns'&&/url\s*\(|https?:|data:|javascript:|[<>]/i.test(value))throw unsafe();
  if(key==='xmlns'){if(value!=='http://www.w3.org/2000/svg')throw unsafe();}
  else if(['fill','stroke'].includes(key)){if(!/^(?:#[a-f\d]{6}|none)$/i.test(value))throw unsafe();}
  else if(key==='d'){if(value.length>4000||! /^[MmLlHhVvCcSsQqTtAaZz\d\s.,+\-]+$/.test(value))throw unsafe();}
  else if(key==='text-anchor'){if(!['start','middle','end'].includes(value))throw unsafe();}
  else if(key==='viewBox'){const values=value.trim().split(/[\s,]+/).map(Number);if(values.length!==4||values.some(v=>!Number.isFinite(v))||values[0]!==0||values[1]!==0||values[2]<1||values[3]<1||values[2]>4000||values[3]>4000)throw unsafe();}
  else if(!/^-?\d+(?:\.\d+)?$/.test(value)||Math.abs(Number(value))>4000||['width','height','r','rx','ry','stroke-width','font-size'].includes(key)&&Number(value)<0||key==='opacity'&&(Number(value)<0||Number(value)>1))throw unsafe();
 }if(node.name==='text'&&($(node).text().length>120||node.children.some(child=>child.type!=='text')))throw unsafe();});
 if(!$('svg').attr('viewBox'))throw unsafe();$('svg').attr({xmlns:'http://www.w3.org/2000/svg',width:'1600',height:'900'});return $.xml();
}
export async function rasterizeDesignSvg(source){return sharp(Buffer.from(sanitizeDesignSvg(source)),{limitInputPixels:32000000}).png().toBuffer();}
export async function resolveDesignVectors(spec){return Promise.all((spec.design.vectors||[]).map(async vector=>({slideNumber:Number(vector.contentId.slice(6)),buffer:await rasterizeDesignSvg(vector.svg),description:vector.description,source:'Claude structured vector design',creator:'AI generated',license:'Generated design from configured planning model',sourceType:'ai-generated',generationMethod:'ai-generated',assetId:spec.requestId+':'+vector.contentId})));}
