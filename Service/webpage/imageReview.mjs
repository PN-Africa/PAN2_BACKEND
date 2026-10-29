import {evaluateImageRelevance,imageTopicDomains} from '../visual/imageRelevance.mjs';
import {isPhotographicStock} from '../visual/imageMedia.mjs';
import {requiresConceptImage,isConceptAsset} from './imageIntent.mjs';
import {matchesImageIdentity,matchesImageDetail} from '../visual/imageIdentity.mjs';
import {imageContextHash} from '../visual/assetBinding.mjs';
const concepts={
    space:/\b(?:spacecraft|astronauts?|rockets?|lunar|martian|mars|orbital|planetary|deep[ -]space)\b/i,
    literary:/\b(?:reading|literary|books?|library|stories|storytelling|chapters)\b/i,
    community:/\b(?:community|gathering|gatherings|conversation|conversations|shared experiences)\b/i,
    scientific:/\b(?:pharma\w*|laborator\w*|biotech\w*|scientific|pipett\w*|research|clinical|manufactur\w*)\b/i,
    food:/\b(?:food|salad|dish|dining|restaurant|kitchen|ingredients|meal|coffee|cafe|espresso|bakery|bread|pizza|jollof|pastry|dessert|fruit)\b/i,
    architecture:/\b(?:interior|interiors|property|residential|architecture|house|home)\b/i,
    legal:/\b(?:legal|law|courthouse|justice|attorney)\b/i,
    education:/\b(?:school|education|learning|classroom|library|curriculum)\b/i,
    fashion:/\b(?:fashion|garment|clothing|textile|apparel|linen|wardrobe)\b/i,
    travel:/\b(?:travel|destination|coast|mountain|landscape|tourism)\b/i,
    software:/\b(?:software|digital|workflow|dashboard|SaaS)\b/i,
    automotive:/\b(?:automotive|automobiles?|cars?|sedans?|vehicles?|showroom)\b/i,
    sports:/\b(?:sports?|fitness|gym|surfing|swimming|climbing|exercise)\b/i,
    music:/\b(?:music|musician|instruments?|piano|cello|guitar)\b/i,
    construction:/\b(?:construction|cranes?|building site)\b/i,
    logistics:/\b(?:logistics|shipping|container ship|cargo|maritime|transport)\b/i,
    craft:/\b(?:craft|pottery|ceramics?|artisan|clay)\b/i,
    environment:/\b(?:environment|conservation|forest|woodland|trees)\b/i
};
const groups=text=>concepts.space.test(text)?['space']:Object.entries(concepts).filter(([,pattern])=>pattern.test(text)).map(([name])=>name);
export function centralImageSubject(page){
    const central=[page.inferredContext?.topic,page.websiteBrief?.project.purpose,page.websiteBrief?.project.description,page.title,page.hero.headline,page.hero.subheadline].filter(Boolean).join('. ');
    let preferred=groups(central);
    const specific=imageTopicDomains([page.inferredContext?.topic,page.title].join(' '));
    if(specific.length)return {description:central,concepts:specific};
    const primary=groups([page.inferredContext?.topic,page.title].join(' '));
    if(page.pageType==='restaurant'||primary.includes('food')&&!primary.includes('literary'))preferred=['food'];
    else if(primary.includes('literary')||preferred.includes('community')&&!primary.includes('food'))preferred=preferred.filter(name=>!['food','architecture'].includes(name));
    if(!preferred.length)preferred=groups([page.title,page.hero.subheadline,page.designBrief?.imageDirection].join(' '));
    return {description:central,concepts:preferred};
}
export function reviewImageCandidate(record,target,{width,height}={}){
    if(record.source==='Lorem Picsum'&&record.raceValidation?.validated&&record.raceValidation.contextHash===imageContextHash(target)&&!target.identityLabel&&!requiresConceptImage(target))return {accepted:!!(record.licenseVerified&&record.creator&&(!width||width>=800&&height>=600&&width/height>=.6&&width/height<=3.2)),method:'validated-pixel-review-and-dimensions',reason:'PIXEL_REVIEW_MATCH'};
    // Generation uses the full requested scene/purpose as intent evidence;
    // it is not independent visual verification of the returned pixels.
    if(record.sourceType==='ai-generated'||record.generationMethod==='ai-generated'||record.source==='Google Gemini')record={...record,subject:[target.query,target.subjectContext||target.topic].filter(Boolean).join('. ')};
    if(requiresConceptImage(target))target={...target,topic:target.query,centralConcepts:undefined};
    const provenance=Boolean(record.creator?.trim()&&record.license?.trim());
    const stock=/Wikimedia|Pexels|curated catalog/i.test(record.source||'')||record.sourceType==='licensed-stock';
    const photographic=!stock||isPhotographicStock(record);
    const identityMatch=matchesImageIdentity(record,target)&&matchesImageDetail(record,target);
    const intentMatch=(!requiresConceptImage(target)||isConceptAsset(record))&&identityMatch;
    const candidate=groups([record.subject,record.alt,...(record.keywords||[])].join(' '));
    const desired=target.centralConcepts?.length?target.centralConcepts:groups(target.query);
    const compatible=desired.some(name=>candidate.includes(name)||(name==='community'&&candidate.includes('literary')));
    const queryWords=[...new Set((target.query||'').toLowerCase().match(/[a-z]{5,}/g)||[])].filter(word=>!['illustrative','editorial','imagery','photography','photograph','website','concept','image'].includes(word));
    const candidateText=[record.subject,record.alt,...(record.keywords||[])].join(' ').toLowerCase();
    const shared=queryWords.filter(word=>new RegExp('\\b'+word+'\\b').test(candidateText)).length;
    const subjectCoverage=shared/Math.max(1,queryWords.length);
    const configuredThreshold=Number(process.env.WEBPAGE_IMAGE_SUBJECT_COVERAGE_MIN||.3);
    const subjectThreshold=Number.isFinite(configuredThreshold)&&configuredThreshold>=.1&&configuredThreshold<=1?configuredThreshold:.3;
    if(target.strictSubject&&subjectCoverage<subjectThreshold)return {accepted:false,reason:'SECTION_SUBJECT_EVIDENCE_MISSING',subjectCoverage,subjectThreshold,method:'independent-section-metadata',limits:'Lexical evidence coverage, not visual confidence.'};
    const relevance=evaluateImageRelevance(record,target);
    const semanticScore=!relevance.accepted?0:relevance.desiredDomains.length?1:desired.length?(compatible?1:0):shared>=2&&shared/Math.max(queryWords.length,1)>=.45?1:0;
    const minimum=target.role==='hero'?800:400;
    const resolutionScore=width&&height?Math.min(1,Math.min(width,height*1.6)/minimum):1;
    const aspect=width&&height?width/height:1.5;
    const placementSuitability=aspect>=.6&&aspect<=3.2;
    return {accepted:intentMatch&&photographic&&provenance&&semanticScore>=.8&&resolutionScore>=.75&&placementSuitability,semanticScore,resolutionScore,placementSuitability,provenance,reason:!identityMatch?'IMAGE_IDENTITY_MISMATCH':!intentMatch?'CONCEPT_IMAGE_REQUIRED':!photographic?'NON_PHOTOGRAPHIC_STOCK':semanticScore>=.8?'METADATA_MATCH':relevance.reason==='METADATA_MATCH'?'TOPIC_MISMATCH':relevance.reason,method:'metadata-and-dimensions',limits:'No independent computer-vision or subjective aesthetic certification.'};
}
