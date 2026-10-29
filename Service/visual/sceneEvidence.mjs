// Evidence must describe the scene, not just the industry or material.
const cities=['Lagos','Abuja','London','Paris','New York','Dubai','Amsterdam','Singapore','Tokyo','Nairobi','Cape Town'];
export function geographicAnchors(query='',target={}){
 return [...new Set([...cities.filter(city=>new RegExp('\\b'+city+'\\b','i').test(query)),...(typeof target.location==='string'&&target.location.length<=80?[target.location]:[])])];
}
export function sceneEvidence(text,query='',target={}){
 const anchors=geographicAnchors(query,target);
 if(anchors.some(city=>!text.toLowerCase().includes(city.toLowerCase())))return {accepted:false,reason:'GEOGRAPHIC_EVIDENCE_MISSING'};
 const intent=query.toLowerCase();
 if(/\b(?:skyline|cityscape)\b/.test(intent)&&!/\b(?:skyline|cityscape|city view|high.rise|skyscrapers?)\b/i.test(text))return {accepted:false,reason:'SCENE_EVIDENCE_MISSING'};
 if(/\bkitchen\b/.test(intent)){
  if(/\b(?:samples?|swatches?|home improvement store|showroom display|countertop store)\b/i.test(text)||!/\bkitchen\b/i.test(text))return {accepted:false,reason:'KITCHEN_SCENE_MISMATCH'};
  if(/\b(?:luxury|luxurious|marble|brass)\b/.test(intent)&&!/\b(?:luxury|luxurious|marble|brass|designer|high.end)\b/i.test(text))return {accepted:false,reason:'KITCHEN_FINISH_EVIDENCE_MISSING'};
 }
 if(/\bkeys?\b/.test(intent)&&/\b(?:hand\w*|giv\w*|receiv\w*|client|advisor|agent)\b/.test(intent)){
  if(/\b(?:signboard|billboard|estate agent.s sign|real.estate.*sign|for sale sign)\b/i.test(text)||!/\bkeys?\b/i.test(text)||!/\b(?:hand\w*|giv\w*|receiv\w*|handover|exchange)\b/i.test(text))return {accepted:false,reason:'KEY_HANDOVER_SCENE_MISMATCH'};
 }
 return {accepted:true,reason:'SCENE_METADATA_SUPPORTED'};
}
