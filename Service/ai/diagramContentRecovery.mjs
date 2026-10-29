import {recoverSlideLayout,createLayoutTextRepair} from '../visual/layoutRecovery.mjs';
import {photoCompositionFor} from '../visual/imageArtDirection.mjs';
import {getLayoutsForSlideType} from '../../templates/presentation/presentationLayouts.mjs';

// Only recover text-fit errors in a structurally complete native diagram.
// Topology, facts, required imagery and unrelated content remain mandatory.
export async function recoverDiagramContent(content,error,{slide,client,logger,sleep,layoutLogger,claim=()=>true}={}){
 const issues=error.validationErrors?.length?error.validationErrors:[error];
 if(!['text-visual','relationship'].includes(slide.slideType)||!issues.length||issues.some(issue=>!Number.isInteger(issue.maxCharacters)||!/^visual\.diagram\.(?:nodes\[\d+\]\.(?:label|description)|edges\[\d+\]\.label)$|^relationship\.(?:nodes\[\d+\]\.(?:label|description)|relationships\[\d+\]\.label)$/.test(issue.field||'')))return;
 if(!content.visualContent?.visual?.diagram&&!content.relationship)return;
 if(!claim())return;
 const candidate={...slide,content:structuredClone(content),layoutId:getLayoutsForSlideType(slide.slideType)[0]?.id};
 if(slide.imageLayoutPlanned){candidate.photoAsset={data:'dry-layout-only'};candidate.photoComposition=photoCompositionFor(candidate);}
 const repaired=await recoverSlideLayout(candidate,{repairText:createLayoutTextRepair({client,logger,sleep}),logger:layoutLogger});
 return repaired.content;
}
