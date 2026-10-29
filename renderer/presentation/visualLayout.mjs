import {assertTextFits} from './contentFit.mjs';
export const CAPTION_LAYOUT=Object.freeze({fontSize:18,maxHeight:1.9,gap:.12,bottom:6.98});
// The narrowest supported caption band: also used by the content schema.
export const CAPTION_MAX_CHARACTERS=Math.floor(6*6.15*72/18/.6*.85);
export function visualCaptionBoxes(caption,{x=6.45,y=2.3,w=6.15,h=3.9,wide=false,slideNumber}={}){
 const cx=wide?.72:x,cw=wide?11.89:w;
 let height=0;
 if(caption){
  for(height=.3225;height<CAPTION_LAYOUT.maxHeight;height+=.3125){try{assertTextFits(caption,{w:cw,h:height,fontSize:18},'visual.caption',slideNumber);break;}catch{}}
  height=Math.min(height,CAPTION_LAYOUT.maxHeight);
  assertTextFits(caption,{w:cw,h:height,fontSize:18},'visual.caption',slideNumber);
 }
 const cy=CAPTION_LAYOUT.bottom-height;
 return {visual:{x,y,w,h:Math.min(h,cy-CAPTION_LAYOUT.gap-y)},caption:{x:cx,y:cy,w:cw,h:height},bodyBottom:wide?cy-CAPTION_LAYOUT.gap:6.35};
}
