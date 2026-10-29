import path from 'node:path';
import {presentationThemeService} from '../presentationThemeService.mjs';
import {deriveVisualTheme} from './presentationVisuals.mjs';
import {planImageCoverage,photoSignature,photoSubjectSignature} from './imageArtDirection.mjs';
import {createImageAssetSession} from './presentationImageAssets.mjs';
import {configuredImageProviders} from './imageProviders.mjs';
import {imagePolicy} from './imagePolicy.mjs';
import {measureStage} from '../performance.mjs';
import {storageRoot} from '../storageRoot.mjs';
import {classifyImageError,imageDiagnostic} from './imageAssetService.mjs';

export function presentationContext(inferred={},context={}){
    return Object.fromEntries(['userRole','purpose','audience','topic','tone','keyInstructions','designPreferences'].map(key=>[key,context[key]||inferred[key]||(key==='keyInstructions'?[]:key==='designPreferences'?{}:'')]));
}
// Start pictures only for locally approved slide content. Later slides and the
// retained semantic review can run while network/image work is in flight.
export function presentationPrefetch({inputType,input,context,options={}}){
    const entries=new Map();let session;
    return {
        get session(){return session;},entries,
        update(deck){
            if(options.userAssets?.length||options.allowIncompleteImages||options.external===false)return;
            const resolved=presentationContext(deck.inferredContext,context);
            const visualContext={...resolved,instructions:[context.instructions,inputType==='prompt'?input:''].filter(Boolean).join('\n')};
            const planned=planImageCoverage(presentationThemeService(deck,resolved),visualContext);
            const vectorTargets=new Set((deck.artifactDesign?.vectors||[]).map(v=>v.contentId));
            const requested=planned.slides.filter(s=>!vectorTargets.has('slide-'+s.slideNumber)&&(s.content||s.isCover)&&s.imageRequirement&&!entries.has(s.slideNumber));
            if(!requested.length)return;
            const theme=deriveVisualTheme(planned,visualContext);
            session??=createImageAssetSession({providers:options.providers||configuredImageProviders(),policy:{...imagePolicy(),...options.policy,...(options.providerTimeoutMs?{timeoutMs:options.providerTimeoutMs}:{})},root:path.resolve(options.cacheRoot||storageRoot('visual-assets')),external:true,
                onDiagnostic:options.onImageDiagnostic||(({reason,...safe})=>console.info('[IMAGE]',JSON.stringify(safe)))});
            for(const slide of requested){
                const promise=measureStage(`presentation-image-${slide.slideNumber}`,()=>session.resolve(planned,slide,theme,visualContext)).catch(error=>{
                    imageDiagnostic({generationType:'presentation',provider:'prefetch',slideNumber:slide.slideNumber,status:'failed',...classifyImageError(error)});
                    return null;
                });
                entries.set(slide.slideNumber,{signature:photoSignature(slide,planned,visualContext),subjectSignature:photoSubjectSignature(slide,planned,visualContext),promise});
            }
        },
        cancel(){session?.cancel();}
    };
}
