import {metadataSubjectEvidence} from './subjectEvidence.mjs';
import {createHash} from 'node:crypto';
import {sceneEvidence,geographicAnchors} from './sceneEvidence.mjs';
// A matching request is not evidence about the returned image's contents.
const domains={
    automotive:/\b(?:automotive|automobiles?|cars?|supercars?|hypercars?|vehicles?|sedans?|SUVs?|motorsport|powertrains?|cockpits?|headlamps?|headlights?|alloy wheels?)\b/i,
    space:/\b(?:spacecraft|astronauts?|rockets?|lunar|martian|mars|orbits?|orbital|planetary|planets?|exoplanets?|galax(?:y|ies)|spaceflight|spacewalks?|space exploration|space telescopes?|International Space Station|ISS|atmospheric limb|Earth(?:['’]s)? limb|deep[ -]space)\b/i,
    computing:/\b(?:artificial intelligence|machine learning|neural networks?|robot(?:s|ic|ics)?|comput(?:er|ing|ation)|servers?|data cent(?:er|re)s?|processors?|microchips?|AI)\b/i,
    architecture:/\b(?:real estate|propert(?:y|ies)|architectur\w*|mansions?|villas?|penthouses?|residential|interiors?|housing|gated estates?|house interior|wooden house|modern house|luxury homes?)\b/i,
    marine:/\b(?:marine|ocean|sea turtles?|coral|whales?|dolphins?|sharks?|dugongs?|vaquitas?|reefs?)\b/i,
    agriculture:/\b(?:agricultur\w*|farm\w*|crops?|tractors?|irrigation|harvest\w*|agronom\w*)\b/i,
    renewable:/\b(?:renewable|solar|photovoltaic|wind (?:energy|power|turbines?)|hydroelectric|geothermal|clean energy)\b/i,
    finance:/\b(?:financ\w*|banking|investment|portfolio diversification|financial planning|business district)\b/i,
    medicalTechnology:/\b(?:healthcare technology|medical technolog\w*|medical devices?|MRI|CT scanner|ultrasound|radiolog\w*|diagnostic imaging|surgical robot|telemedicine|patient monitor\w*)\b/i,
    laboratory:/\b(?:laborator\w*|pipett\w*|biotech\w*|pharmaceutical)\b/i
};
const scenes={
    solar:/\b(?:solar|photovoltaic)\b/i,wind:/\bwind (?:energy|power|turbines?)\b/i,
    turtle:/\b(?:sea turtles?|hawksbill|leatherback)\b/i,whale:/\bwhales?\b/i,coral:/\b(?:coral|reefs?)\b/i,
    irrigation:/\birrigation\b/i,harvest:/\bharvest\w*\b/i,
    interior:/\b(?:interiors?|living rooms?|bedrooms?|kitchens?)\b/i,mansion:/\b(?:mansions?|villas?)\b/i,
    mri:/\bMRI\b/i,ultrasound:/\bultrasound\b/i,
    robot:/\b(?:robot(?:s|ic|ics)?|rovers?)\b/i,server:/\b(?:servers?|data cent(?:er|re)s?)\b/i
};
export function imageTopicDomains(value){
    const text=String(value||'');
    if(domains.space.test(text))return ['space'];
    let names=Object.entries(domains).filter(([,pattern])=>pattern.test(text)).map(([name])=>name);
    // Neural-network architecture is not residential architecture.
    if(names.includes('computing')&&!/\b(?:real estate|residential|mansions?|villas?|penthouses?|houses?|interiors?)\b/i.test(text))names=names.filter(name=>name!=='architecture');
    return names;
}
export function imageContextExclusions(context={}){
    const text=[context.instructions,...(Array.isArray(context.keyInstructions)?context.keyInstructions:[])].join(' ');
    const explicit=Array.isArray(context.imageExclusions)?context.imageExclusions.filter(value=>typeof value==='string'):[];
    const found=[...text.matchAll(/\b(?:no|without|avoid|exclude|do not (?:use|include|show))\s+(?:(?:any|all|images? of|photos? of|photographs? of)\s+)?(laboratory|interior|people|portrait|food|cartoon|illustration|diagram|logo)s?\b/gi)].map(match=>match[1].toLowerCase());
    return [...new Set([...explicit,...found])].slice(0,12);
}
export function candidateImageText(record={}){
    let fileTitle='';try{fileTitle=decodeURIComponent(String(record.originalUrl||record.sourceUrl||'').split('File:')[1]?.split(/[?#]/)[0]||'').replace(/_/g,' ');}catch{}
    return [record.title,fileTitle,record.industry,record.subject,record.alt,record.description,record.categories,...(Array.isArray(record.keywords)?record.keywords:[])].filter(Boolean).join(' ');
}
export function evaluateImageRelevance(record,target={}){
    const overall=target.subjectContext||target.topic||target.subject||'',local=target.sectionTopic||target.slideTitle||'';
    const query=target.query||target.searchQuery||'';
    const declaredDomains=imageTopicDomains(target.primaryTopic||'');
    const localDomains=imageTopicDomains(local),primaryDomains=declaredDomains.length?declaredDomains:imageTopicDomains(overall),queryDomains=imageTopicDomains(query);
    const medicalScene=localDomains.length===1&&localDomains[0]==='computing'&&queryDomains.includes('medicalTechnology');
    const metaphoricalArchitecture=localDomains.includes('architecture')&&primaryDomains.length&&!primaryDomains.includes('architecture')&&!/\b(?:houses?|homes?|buildings?|skyscrapers?|mansions?|villas?|penthouses?|residential|real estate)\b/i.test(local+' '+query);
    const placementDomains=metaphoricalArchitecture?localDomains.filter(name=>name!=='architecture'):localDomains;
    // A style/setting query must not redefine an explicit subject that falls
    // outside this legacy taxonomy. The general evidence gate handles it.
    const desired=medicalScene?['medicalTechnology']:placementDomains.length?placementDomains:primaryDomains.length?primaryDomains:target.primaryTopic?[]:queryDomains;
    const text=candidateImageText(record),actual=imageTopicDomains(text);
    const scene=sceneEvidence(text,query,target);
    if(!scene.accepted)return {...scene,applicable:true,method:'independent-scene-metadata',limits:'Metadata evidence cannot certify actual pixels.'};
    const localWords=local.toLowerCase().match(/[\p{L}]{4,}/gu)||[];
    const namedSubjectMatch=!localDomains.length&&!primaryDomains.length&&localWords.length>0&&localWords.every(word=>text.toLowerCase().includes(word));
    const domainMatch=!desired.length||desired.some(name=>actual.includes(name))||namedSubjectMatch;
    const campusOnly=desired.includes('medicalTechnology')&&/\b(?:university|college|campus|facade|entrance|building)\b/i.test(text)&&! /\b(?:MRI|scanner|ultrasound|medical device|patient monitor|surgical robot)\b/i.test(text)&&! /\b(?:campus|university|college|building|exterior)\b/i.test(local||query);
    // Use the specific placement rather than a paragraph listing many subjects.
    const sceneText=target.sectionTopic||target.slideTitle||overall||query;
    const requestedScenes=Object.entries(scenes).filter(([,pattern])=>pattern.test(sceneText));
    const sceneMatch=!requestedScenes.length||requestedScenes.some(([,pattern])=>pattern.test(text));
    const exclusions=(Array.isArray(target.exclusions)?target.exclusions:[]).filter(value=>typeof value==='string'&&value.length>=3);
    const excluded=exclusions.some(value=>text.toLowerCase().includes(value.toLowerCase()));
    const evidence=metadataSubjectEvidence(text,target);
    const lexicalMatch=declaredDomains.length>0||!target.primaryTopic&&primaryDomains.length>0||evidence.supported;
    return {accepted:domainMatch&&sceneMatch&&lexicalMatch&&!excluded&&!campusOnly,applicable:true,
        desiredDomains:desired,candidateDomains:actual,reason:excluded?'EXCLUDED_SUBJECT':campusOnly?'INSTITUTION_EXTERIOR_NOT_TECHNOLOGY':!domainMatch||!lexicalMatch?'TOPIC_MISMATCH':!sceneMatch?'SECTION_MISMATCH':'METADATA_MATCH',
        method:'independent-metadata',limits:'Metadata relevance is not a visual or factual certification.'};
}
export function relevantSearchQuery(target={}){
    const explicit=target.query||target.searchQuery||'';
    if(geographicAnchors(explicit,target).length)return explicit.slice(0,160);
    if(target.identityLabel)return (String(target.identityLabel).replace(/[^\p{L}\p{N}\s-]/gu,' ').trim()+(imageTopicDomains(target.topic).includes('automotive')?' car exterior':'')).slice(0,160);
    const local=target.sectionTopic||target.slideTitle||'';
    const topic=target.topic||target.subject||target.query||target.searchQuery||'';
    const names=imageTopicDomains(topic+' '+local);
    if(names.includes('renewable')){
        const direction=local||target.query||target.searchQuery||topic;
        if(/\b(?:solar|photovoltaic)\b/i.test(direction))return 'solar farm photovoltaic panels landscape';
        if(/\bwind\b/i.test(direction))return 'wind turbines wind farm landscape';
        if(/\bhydro(?:power|electric)?\b/i.test(direction))return 'hydroelectric dam power station';
        if(/\bgeothermal\b/i.test(direction))return 'geothermal power station';
    }
    const anchors={automotive:'sports car supercar',computing:'artificial intelligence computer',architecture:'residential architecture',marine:'marine wildlife',agriculture:'agriculture farming',renewable:'renewable energy',medicalTechnology:'medical technology',finance:'financial planning'};
    return [local,anchors[names[0]]||topic].filter(Boolean).join(' ').replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim().slice(0,160);
}
const safe=value=>String(value||'').replace(/https?:\/\/\S+/gi,'[URL]').replace(/(?:api[_-]?key|password|token)\s*[:=]\s*\S+/gi,'[REDACTED]').replace(/[\r\n]/g,' ').slice(0,240);
export function relevanceDiagnostic(record,target,review,logger=entry=>console.info('[IMAGE_RELEVANCE]',JSON.stringify(entry))){
    const digest=value=>createHash('sha256').update(String(value||'')).digest('hex').slice(0,16);
    const entry={contextHash:digest(JSON.stringify([target.topic||target.subject,target.purpose,target.query||target.searchQuery,target.sectionTopic||target.slideTitle])),role:target.role||'slide',slideNumber:target.slideNumber,
        candidate:{source:safe(record.source),metadataHash:digest(candidateImageText(record))},
        accepted:review.accepted,reason:review.reason||'RELEVANCE_REJECTED',method:review.method};
    logger(entry);return entry;
}
