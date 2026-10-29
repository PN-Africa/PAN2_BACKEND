import { webpageLayoutService } from './webpageLayoutService.mjs';
import { webpageThemeService } from './webpageThemeService.mjs';
import { webpageRenderer } from '../renderer/webpage/webpageRenderer.mjs';
import { webpageArtifactService } from './webpageArtifactService.mjs';
import { acquireWebsiteImages } from './webpage/imagePipeline.mjs';
import { compileWebsiteBrief } from './webpage/websiteBrief.mjs';
import {inspectWebsite} from './webpage/qualityGate.mjs';
import {websiteSpecification} from './webpage/websiteSpecification.mjs';
import { planWebpageDesign } from './webpageDesignService.mjs';
import { aiService } from "./aiService.mjs";
import { resolvePresentationVisuals } from './visual/presentationVisuals.mjs';
import { createDiagramPlanner } from './visual/diagramPlanner.mjs';
import { documentArtifactService } from './document/documentArtifactService.mjs';
import {measureStage,profileGeneration,performanceReport,checkGenerationDeadline} from './performance.mjs';
import {presentationPrefetch} from './visual/presentationPrefetch.mjs';
import {resolveSlideCount} from './ai/slideCount.mjs';
import {withGenerationCapacity} from './generationCapacity.mjs';
import {webpageImageManifest} from './visual/assetBinding.mjs';
import {normalizeGenerationInput} from './input/generationInput.mjs';
import {createSpecification,compileDesign,applyPresentationDesign,setAssetRequirements} from './design/specification.mjs';
import {planWebsiteImages} from './webpage/imageStrategy.mjs';
import {renderInspectRepair,inspectPresentationPreview,repairPresentationComponents,discardRejectedPreview,presentationDesignTrace} from './design/quality.mjs';
import {resolveDesignVectors} from './design/safeSvg.mjs';
import {generationOutcome} from './generationOutcome.mjs';
import {createLayoutTextRepair} from './visual/layoutRecovery.mjs';

import {
    presentationLayoutService
} from "./presentationLayoutService.mjs";

import {
    presentationThemeService
} from "./presentationThemeService.mjs";

import {
    presentationRendererService
} from "./presentationRendererService.mjs";

import {
    previewRenderer
} from "../renderer/presentation/previewRenderer.mjs";


// =========================================================
// GENERATE SERVICE
// =========================================================

const generate = async (
    inputType,
    input,
    outputType,
    context = {},
    options = {}
) => {
    const started=performance.now(),timings={};
    let specification,designQuality;
    const finish=result=>{
        checkGenerationDeadline();
        const sourceWarnings=Array.isArray(context.sourceWarnings)?context.sourceWarnings:[];
        const status=sourceWarnings.length&&result.status==='completed'?'completed_with_warnings':result.status;
        return {...result,status,...(sourceWarnings.length?{warnings:[...(result.warnings||[]),...sourceWarnings]}:{}),outcome:generationOutcome({...result,status}),...(specification?{engineVersion:'2.0',designSpecification:specification,...(designQuality?{designQuality}:{})}:{}),timings:{...timings,totalMs:Math.round(performance.now()-started)},performance:performanceReport()};
    };
    const normalizedInput=await measureStage('input-normalization',()=>normalizeGenerationInput(inputType,input,outputType,context,performanceReport()?.requestId));

    // =====================================================
    // 1. GENERATE STRUCTURED CONTENT WITH AI
    // =====================================================

    const early=outputType==='presentation'&&options.prefetchImages!==false?presentationPrefetch({inputType,input,context,options:options.visuals}):null;
    const aiOptions={...options.ai,normalizedInput,
        onSlideReady:async(slide,deck)=>{
            await options.ai?.onSlideReady?.(slide,deck);
            // A locally validated later slide can start its image while an
            // earlier text call is still running. Durable checkpoints stay ordered.
            early?.update({...deck,slides:deck.slides.map(current=>current.slideNumber===slide.slideNumber?slide:current)});
        },
        onSlideCheckpoint:async deck=>{await options.ai?.onSlideCheckpoint?.(deck);early?.update(deck);}};
    let aiResult;
    try{aiResult = options.completedContent || await measureStage('content',()=>aiService(
        inputType,
        input,
        outputType,
        context, aiOptions
    ));}catch(error){early?.cancel();throw error;}
    try{
    aiResult=structuredClone(aiResult);
    if(outputType==='presentation'){const requested=resolveSlideCount(inputType==='prompt'?input:'',context);const actual=aiResult.generatedContent?.slides?.length;if(requested.source!=='default'&&actual!==requested.min)throw Object.assign(new Error(`Expected ${requested.min} slides; received ${actual}.`),{code:'AI_SCHEMA_VALIDATION_FAILED',stage:'presentation-validation',field:'slides',expectedSlides:requested.min,actualSlides:actual});}
    if(process.env.LEDIFY_DESIGN_ENGINE!=='legacy'){
        specification=await measureStage('design-specification',()=>createSpecification(aiResult.generatedContent,outputType,{requestId:normalizedInput.requestId,context:{...context,instructions:normalizedInput.instructions}}));
        aiResult.generatedContent=await measureStage('layout-compilation',()=>compileDesign(specification,aiResult.generatedContent));
    }else{delete aiResult.generatedContent.artifactDesign;for(const slide of aiResult.generatedContent.slides||[])delete slide.designComponent;}
    await options.onContentReady?.(aiResult);
    timings.aiMs=Math.round(performance.now()-started);
    const artifactStarted=performance.now();


    // =====================================================
    // 2. PRESENTATION-SPECIFIC PROCESSING
    // =====================================================

    if (outputType === 'webpage') {
        context={...context,instructions:[context.instructions,inputType==='prompt'?input:''].filter(Boolean).join('\n')};
        const normalized=webpageLayoutService(aiResult.generatedContent,{...context,topic:context.topic||input.slice(0,4000)});
        const requested=context.websiteBrief || {};
        if(requested.name)normalized.brandName=requested.name;
        if(requested.industry)normalized.designBrief.industry=requested.industry;
        if(context.designPreferences?.heroComposition)normalized.designSpec.heroComposition=context.designPreferences.heroComposition;
        const designed=await measureStage('website-design',()=>planWebpageDesign(normalized,context));
        designed.websiteBrief=compileWebsiteBrief(designed,input,context);
        if(specification)await measureStage('asset-planning',()=>setAssetRequirements(specification,planWebsiteImages(designed,context).map(target=>({contentId:target.sectionId||'@artifact',kind:target.visualIntent==='concept'?'illustration':'photo',required:target.required===true,subject:target.query}))));
        const resolved = await measureStage('website-images',()=>acquireWebsiteImages(webpageThemeService(designed, context), context, options.webpageAssets));
        const page = resolved.page;
        const source=context.sourceUnderstanding?.source;
        if(source?.retrievedSuccessfully&&/^https?:\/\//.test(source.canonicalUrl||''))page.sourceReferences=[{title:source.title||'Original source',url:source.canonicalUrl}];
        const rendered=await measureStage('website-html-css-js',()=>webpageRenderer(page,resolved.assets));
        const inspected = await measureStage('website-validation',()=>inspectWebsite(rendered,options.webpageQuality));
        page.quality={...page.quality,validation:inspected.report};
        page.websiteSpecification=websiteSpecification(page);
        const artifacts = await measureStage('website-packaging',()=>webpageArtifactService(inspected.files, {...options.artifacts,imageBindings:webpageImageManifest(page,inspected.files)}));
        if(artifacts.status!=='completed'&&page.imageStrategy.plan.some(p=>p.required))page.imageValidation={...page.imageValidation,status:'incomplete',export:'failed'};
        timings.renderMs=Math.round(performance.now()-artifactStarted);
        const needsReview=page.contentSpecification?.missingInformation.length||resolved.warnings.length||inspected.warnings.length||inspected.report.browser!=='passed';
        const imagesUnmet=page.imageValidation?.status==='incomplete';
        const strictImages=!!specification||(options.webpageAssets?.policy?.failureMode||process.env.WEBPAGE_IMAGE_FAILURE_MODE)==='strict';
        designQuality={status:imagesUnmet||inspected.report.browser==='failed'?'incomplete':inspected.report.browser==='passed'?'passed':'requires-review',inspection:inspected.report};
        return finish({ ...aiResult, generatedContent: page,imageValidation:page.imageValidation, status: imagesUnmet&&strictImages?'incomplete':imagesUnmet&&artifacts.status==='completed'?'partial_success':artifacts.status==='completed'&&needsReview?'completed_with_warnings':artifacts.status, artifacts,
            warnings: [...(page.warnings || []),...(page.limitations || []).map(message => ({ code: 'STATIC_SCOPE_LIMITATION', message })), ...resolved.warnings, ...inspected.warnings, ...artifacts.warnings,
                ...(imagesUnmet?[{code:'IMAGE_REQUIREMENTS_UNMET',stage:'image-validation',message:'Website files are available, but some requested images could not be acquired. Review the missing placements before publishing.',missingTargets:page.imageValidation.requiredMissing||[]}]:[])] });
    }
    if (outputType === 'document') {
        const document=aiResult.generatedContent;
        const artifacts=await documentArtifactService(document,{instructions:inputType==='prompt'?input:context.instructions,...context},options.document);
        designQuality={status:artifacts.status==='incomplete'?'incomplete':'validated',inspection:{word:artifacts.validation,pdf:artifacts.pdf.status,visualReview:'not-run',pagination:'Word renderer; HTML preview is not page-accurate'}};
        timings.renderMs=Math.round(performance.now()-artifactStarted);
        return finish({...aiResult,status:artifacts.status,...(artifacts.pdf.status==='failed'?{exportValidation:{status:'incomplete',errorCode:'DOCUMENT_PDF_UNAVAILABLE'}}:{}),documentId:artifacts.id,previewUrl:artifacts.previewUrl,downloadUrl:artifacts.downloadUrl,artifacts,warnings:[...(document.warnings||[]),...(artifacts.pdf.status==='failed'?[{code:'DOCUMENT_PDF_UNAVAILABLE',stage:'document-export',message:'PDF export failed. Word and HTML preview remain available; retry the PDF link.'}]:[])]});
    }

    if (outputType === "presentation") {
        const countPolicy=resolveSlideCount(inputType==='prompt'?input:'',context);
        const actualCount=aiResult.generatedContent?.slides?.length;
        if(countPolicy.source!=='default'&&actualCount!==countPolicy.min)throw Object.assign(new Error(`Expected ${countPolicy.min} slides; received ${actualCount}.`),{code:'AI_SCHEMA_VALIDATION_FAILED',stage:'presentation-validation',field:'slides',expectedSlides:countPolicy.min,actualSlides:actualCount});

        // -------------------------------------------------
        // GET AI-INFERRED CONTEXT
        // -------------------------------------------------

        const inferredContext =
            aiResult?.generatedContent?.inferredContext || {};


        // -------------------------------------------------
        // RESOLVE CONTEXT
        // -------------------------------------------------
        //
        // Explicit context wins when supplied.
        // Otherwise, use context inferred by the AI.
        // -------------------------------------------------

        const resolvedContext = {
            instructions:context.instructions||'',

            userRole:
                context?.userRole ||
                inferredContext?.userRole ||
                "",

            purpose:
                context?.purpose ||
                inferredContext?.purpose ||
                "",

            audience:
                context?.audience ||
                inferredContext?.audience ||
                "",

            topic:
                context?.topic ||
                inferredContext?.topic ||
                "",

            tone:
                context?.tone ||
                inferredContext?.tone ||
                "",

            keyInstructions:
                context?.keyInstructions ||
                inferredContext?.keyInstructions ||
                [],

            designPreferences:
                context?.designPreferences || {}

        };


        // =================================================
        // 3. SELECT SLIDE LAYOUTS
        // =================================================

        const presentationWithLayouts =
            presentationLayoutService(
                aiResult.generatedContent, resolvedContext
            );


        // =================================================
        // 4. SELECT PRESENTATION THEME
        // =================================================

        const presentationWithTheme =
            presentationThemeService(
                presentationWithLayouts,
                resolvedContext
            );


        // =================================================
        // 5. PREPARE PRESENTATION FOR RENDERING
        // =================================================
        //
        // Resolves the selected presentation design into
        // renderer-ready design tokens and normalizes the
        // slides for the PowerPoint rendering engine.
        //
        // =================================================

        let rendererReadyPresentation =
            presentationRendererService(
                presentationWithTheme
            );
        if(specification)rendererReadyPresentation=applyPresentationDesign(rendererReadyPresentation,specification,context);


        // =================================================
        // 6. GENERATE PRESENTATION PREVIEW
        // =================================================
        //
        // Pipeline:
        //
        // renderer-ready presentation
        //          ↓
        // PPTX
        //          ↓
        // PDF
        //          ↓
        // PNG preview images
        //
        // =================================================

        const visualStarted=performance.now();
        timings.layoutMs=Math.round(visualStarted-artifactStarted);
        const visualContext={...resolvedContext,instructions:[context.instructions,inputType==='prompt'?input:''].filter(Boolean).join('\n'),imageRequirementInstructions:[context.instructions,...(context.keyInstructions||[]),inputType==='prompt'?input:''].filter(Boolean).join('\n')};
        const vectorAssets=specification?await measureStage('svg-assets',()=>resolveDesignVectors(specification)):[];
        rendererReadyPresentation = await measureStage('presentation-images',()=>resolvePresentationVisuals(rendererReadyPresentation, visualContext,
            {diagramPlanner:createDiagramPlanner(options.ai),repairText:createLayoutTextRepair(options.ai),...options.visuals,...(vectorAssets.length?{userAssets:[...(options.visuals?.userAssets||[]),...vectorAssets]}:{}),prefetch:early}));
        if(specification)setAssetRequirements(specification,specification.assets.map(asset=>{
            const slide=rendererReadyPresentation.slides.find(s=>'slide-'+s.slideNumber===asset.contentId);
            return ['photo','illustration'].includes(asset.kind)&&slide?.imageRequirement?{...asset,required:slide.imageRequirement.required}:asset;
        }));
        timings.visualsMs=Math.round(performance.now()-visualStarted);
        const renderStarted=performance.now();

        const incomplete=rendererReadyPresentation.imageValidation?.status==='incomplete';
        const renderInput=incomplete?{...rendererReadyPresentation,imageCoveragePlan:{...rendererReadyPresentation.imageCoveragePlan,required:false}}:rendererReadyPresentation;
        let preview;
        if(specification){const checked=await renderInspectRepair({input:renderInput,render:value=>previewRenderer(value,options.preview),inspect:(result,value)=>inspectPresentationPreview(result,value,options.visualReview),repair:repairPresentationComponents,discard:value=>discardRejectedPreview(value,options.preview?.outputDirectory)});preview=checked.artifact;rendererReadyPresentation=checked.input;designQuality={...checked.quality,compilation:presentationDesignTrace(checked.input,specification)};}
        else preview=await previewRenderer(renderInput,options.preview);
        const imageValidation=rendererReadyPresentation.imageCoveragePlan.required&&(preview.stages.pdf!=='completed'||preview.stages.png!=='completed')?{...rendererReadyPresentation.imageValidation,status:'incomplete',rendering:'unverified'}:rendererReadyPresentation.imageValidation;
        // Image completeness describes quality, not whether usable artifacts can
        // be delivered. Best-effort requests retain that evidence as warnings.
        const imagesUnmet=imageValidation?.status==='incomplete';
        const strictImages=rendererReadyPresentation.imageCoveragePlan.enforcement==='strict';
        const warnings=[...rendererReadyPresentation.warnings,...preview.warnings];
        const optionalMissing=rendererReadyPresentation.slides.filter(s=>s.imageRequirement&&!s.imageRequirement.required&&!s.photoAsset).map(s=>s.slideNumber);
        const recoveredAiAttempts=performanceReport()?.ai?.failedCalls||0;
        const recovered=!imagesUnmet&&rendererReadyPresentation.visualValidation?.status!=='incomplete'&&designQuality?.status!=='incomplete'&&preview.status==='completed'&&(optionalMissing.length>0||recoveredAiAttempts>0||rendererReadyPresentation.slides.some(s=>s.layoutRecovery?.status==='repaired'||s.layoutRecovery?.status==='adapted'));
        if(imagesUnmet&&!warnings.some(w=>w.code==='IMAGE_REQUIREMENTS_UNMET'))warnings.push({
            code:'IMAGE_REQUIREMENTS_UNMET',stage:'image-validation',
            message:'Presentation delivered with image quality warnings. Review missing images and preview availability before use.',
            missingSlides:imageValidation.requiredMissing||[],
            ...(imageValidation.rendering?{rendering:imageValidation.rendering}:{})
        });


        // =================================================
        // 7. RETURN FINAL PRESENTATION RESULT
        // =================================================

        timings.renderMs=Math.round(performance.now()-renderStarted);
        return finish({

            ...aiResult,
            status: imagesUnmet||rendererReadyPresentation.visualValidation?.status==='incomplete'||designQuality?.status==='incomplete'?'incomplete':recovered?'completed':preview.status === 'completed' && warnings.length ? 'completed_with_warnings' : preview.status,
            ...(recovered?{recovery:{status:'completed_with_recovery',optionalImageSlides:optionalMissing,recoveredAiAttempts,layoutRepairedSlides:rendererReadyPresentation.slides.filter(s=>s.layoutRecovery).map(s=>s.slideNumber)}}:{}),
            imageValidation,
            visualValidation:rendererReadyPresentation.visualValidation,
            warnings,

            resolvedContext,

            generatedContent:
                rendererReadyPresentation,

            preview

        });

    }


    // =====================================================
    // 8. DOCUMENT / WEBPAGE
    // =====================================================
    //
    // Their own design/template pipelines will be built
    // separately.
    //
    // They do NOT enter the PowerPoint preview pipeline.
    //
    // =====================================================

    return finish(aiResult);
    }finally{early?.cancel();}

};
export const generateService=(...args)=>profileGeneration(()=>withGenerationCapacity(()=>generate(...args)),{outputType:args[2],...args[4]?.performance});
