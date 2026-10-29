// A bounded index for the OPTIONAL analysis call, never a replacement for the
// complete validated source passed into the actual generation pipeline.
export function selectUnderstandingEvidence(source,maxCharacters=24000){
 if(!Number.isInteger(maxCharacters)||maxCharacters<1000||maxCharacters>100000)throw Object.assign(new Error('URL_UNDERSTANDING_MAX_CHARACTERS must be an integer from 1000 to 100000.'),{code:'URL_SOURCE_CONFIGURATION_ERROR'});
 const original=source.text;
 if(original.length<=maxCharacters)return {text:original,sourceCharacters:original.length,selectedCharacters:original.length,partial:false,ranges:[{start:0,end:original.length}]};
 const starts=[0];
 for(const heading of source.headings||[]){const pos=original.indexOf('\n'+heading+'\n');if(pos>=0)starts.push(pos+1);}
 if(starts.length===1)for(let i=1;i<8;i++)starts.push(Math.floor(original.length*i/8));
 const positions=[...new Set(starts)].sort((a,b)=>a-b),tail=Math.min(2000,Math.floor(maxCharacters/8));
 const allowance=Math.floor((maxCharacters-tail-positions.length*4-4)/positions.length),ranges=[];
 for(let i=0;i<positions.length;i++){
  let start=positions[i],end=Math.min(original.length,positions[i+1]??original.length,start+allowance);
  if(i&&starts.length===1){const next=original.indexOf(' ',start);if(next>=0&&next<end)start=next+1;}
  const boundary=original.lastIndexOf(' ',end);if(boundary>start+30)end=boundary;
  if(end>start)ranges.push({start,end});
 }
 ranges.push({start:original.length-tail,end:original.length});ranges.sort((a,b)=>a.start-b.start);
 const merged=[];for(const range of ranges){const previous=merged.at(-1);if(previous&&range.start<=previous.end)previous.end=Math.max(previous.end,range.end);else merged.push({...range});}
 const text=merged.map(r=>original.slice(r.start,r.end)).join('\n\n');
 return {text,sourceCharacters:original.length,selectedCharacters:text.length,partial:true,ranges:merged};
}
