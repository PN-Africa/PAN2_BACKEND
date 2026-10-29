import pptxgen from "pptxgenjs";
import {validatePresentationBindings} from '../../Service/visual/assetBinding.mjs';
import {prepareSlideSurfaces} from './backgrounds.mjs';


import {
    renderLayout,
    hasLayoutRenderer
} from "./layoutRegistry.mjs";


// =========================================================
// PPTX RENDERER
// =========================================================
//
// Converts a fully prepared presentation object into
// an actual PowerPoint document.
//
// By the time data reaches this layer, upstream services
// should already have decided:
//
// - presentation strategy
// - semantic slide types
// - layout IDs
// - theme
// - variant
// - design tokens
//
// This renderer's job is execution, not strategy.
//
// It does NOT:
//
// - call the AI
// - choose semantic slide types
// - choose presentation strategy
// - choose themes
// - choose variants
// - choose layout IDs
// - generate speaker notes
//
// =========================================================


export const pptxRenderer = async (
    presentation
) => {
    validatePresentationBindings(presentation);

    // =====================================================
    // 1. VALIDATE PRESENTATION
    // =====================================================

    validatePresentation(
        presentation
    );


    // =====================================================
    // 2. RESOLVE DESIGN TOKENS
    // =====================================================

    const tokens =
        presentation?.design?.tokens;


    if (!tokens) {

        throw new Error(
            "Presentation design tokens are missing"
        );

    }


    // =====================================================
    // 3. CREATE POWERPOINT DOCUMENT
    // =====================================================

    const pptx =
        new pptxgen();


    // =====================================================
    // 4. PRESENTATION SIZE
    // =====================================================
    //
    // All layout coordinates are designed around
    // PowerPoint widescreen dimensions:
    //
    // 13.333 × 7.5 inches
    //
    // =====================================================

    pptx.layout =
        "LAYOUT_WIDE";


    // =====================================================
    // 5. DOCUMENT METADATA
    // =====================================================

    configureMetadata(
        pptx,
        presentation
    );


    // =====================================================
    // 6. POWERPOINT FONT THEME
    // =====================================================

    configureFontTheme(
        pptx,
        tokens
    );


    // =====================================================
    // 7. RENDER EVERY SLIDE
    // =====================================================

    const surfaces=await prepareSlideSurfaces(presentation,tokens);
    surfaces.forEach(
        (
            view,
            index
        ) => {

            renderPresentationSlide({

                pptx,

                slideData:view.slideData,

                index,

                tokens:view.tokens

            });

        }
    );


    // =====================================================
    // 8. RETURN POWERPOINT DOCUMENT
    // =====================================================
    //
    // We deliberately do NOT save the file here.
    //
    // This keeps the renderer reusable:
    //
    // pptxRenderer
    //      ↓
    // PowerPoint object
    //
    // Another layer can then:
    //
    // - write it to disk
    // - generate a Buffer
    // - send it through Express
    // - upload it to cloud storage
    // - use it as part of the preview/download pipeline
    //
    // =====================================================

    return pptx;

};


// =========================================================
// RENDER ONE PRESENTATION SLIDE
// =========================================================

const renderPresentationSlide = ({

    pptx,
    slideData,
    index,
    tokens

}) => {

    // =====================================================
    // 1. VALIDATE SLIDE
    // =====================================================

    if (
        !slideData ||
        typeof slideData !== "object"
    ) {

        throw new Error(
            `Slide ${index + 1} is invalid`
        );

    }


    if (!slideData.layoutId) {

        throw new Error(
            `Slide ${index + 1} does not have a layoutId`
        );

    }


    // =====================================================
    // 2. CREATE POWERPOINT SLIDE
    // =====================================================

    const slide =
        pptx.addSlide();


    // =====================================================
    // 3. NORMALIZE SLIDE METADATA
    // =====================================================

    const normalizedSlideData = {

        ...slideData,

        slideNumber:
            slideData.slideNumber ||
            index + 1

    };


    // =====================================================
    // 4. CHECK REGISTERED LAYOUT
    // =====================================================
    //
    // Reject unsupported layouts before creating misleading placeholder content.

    if (
        !hasLayoutRenderer(
            normalizedSlideData.layoutId
        )
    ) {

        throw new Error(`Slide ${index + 1}: unsupported layout "${normalizedSlideData.layoutId}"`);

    }


    // =====================================================
    // 5. EXECUTE LAYOUT RENDERER
    // =====================================================

    try {

        renderLayout({

            slide,

            slideData:
                normalizedSlideData,

            tokens,

            pptx

        });

        const notes = [normalizedSlideData.speakerNotes,
            ...(normalizedSlideData.references || []).map(ref => `${ref.title || 'Source'}: ${ref.url}`),
            normalizedSlideData.resolvedVisual?.altText ? `Diagram description: ${normalizedSlideData.resolvedVisual.altText}` : '',
            ...(normalizedSlideData.resolvedVisual?.references || []).map(url => `Diagram factual reference: ${url}`),
            normalizedSlideData.backgroundAsset?.attribution,
            normalizedSlideData.backgroundAsset?.originalUrl].filter(Boolean);
        if(normalizedSlideData.resolvedVisual?.attribution) notes.push(normalizedSlideData.resolvedVisual.attribution,normalizedSlideData.resolvedVisual.originalUrl || '');
        for(const a of normalizedSlideData.photoAssets||[normalizedSlideData.photoAsset].filter(Boolean))notes.push(a.attribution||'',a.originalUrl||'',a.license,a.licenseUrl||'',a.changes||'',a.disclosure||'');
        if (notes.length) slide.addNotes(notes.join('\n'));
        const credited=[normalizedSlideData.backgroundAsset,normalizedSlideData.resolvedVisual,...(normalizedSlideData.photoAssets||[normalizedSlideData.photoAsset])].filter(a=>a?.attributionRequired);
        const unique=[...new Map(credited.map(a=>[a.assetId||a.originalUrl||a.attribution,a])).values()];
        if(unique.length){
            // License credits must survive PDF/PNG exports, where speaker
            // notes are unavailable. They are not technical image labels.
            slide.addText(unique.map((a,i)=>({text:(i?'  |  ':'')+(a.creator?`${a.creator} / ${a.source||''} / ${a.license||''} (cropped/resized)`:a.attribution||'Source credits in notes'),options:{...(/^https:\/\//.test(a.originalUrl||a.licenseUrl||'')?{hyperlink:{url:a.originalUrl||a.licenseUrl}}:{})}})),{x:.72,y:7.23,w:11.89,h:.21,fontSize:9,fontFace:'Arial',color:'FFFFFF',fill:{color:'172536'},margin:0,breakLine:false,_field:'source.credits'});
        }

    } catch (error) {

        throw Object.assign(new Error(
            `Failed to render slide ${
                index + 1
            } with layout "${
                normalizedSlideData.layoutId
            }": ${error.message}`,{cause:error}
        ),{code:error.code||'PRESENTATION_RENDER_FAILED',stage:'presentation-rendering',slideNumber:index+1,field:error.field,maxCharacters:error.maxCharacters});

    }

};


// =========================================================
// VALIDATE PRESENTATION
// =========================================================

const validatePresentation = (
    presentation
) => {

    if (!presentation) {

        throw new Error(
            "Renderer-ready presentation is required"
        );

    }


    if (
        typeof presentation !==
        "object"
    ) {

        throw new Error(
            "Presentation must be an object"
        );

    }


    if (
        !Array.isArray(
            presentation.slides
        )
    ) {

        throw new Error(
            "Presentation slides must be an array"
        );

    }


    if (
        presentation.slides.length === 0
    ) {

        throw new Error(
            "Presentation contains no slides"
        );

    }


    // =====================================================
    // VALIDATE EACH SLIDE
    // =====================================================

    presentation.slides.forEach(
        (
            slide,
            index
        ) => {

            if (
                !slide ||
                typeof slide !== "object"
            ) {

                throw new Error(
                    `Slide ${index + 1} is invalid`
                );

            }


            if (!slide.layoutId) {

                throw new Error(
                    `Slide ${index + 1} is missing layoutId`
                );

            }

        }
    );

};


// =========================================================
// CONFIGURE DOCUMENT METADATA
// =========================================================

const configureMetadata = (
    pptx,
    presentation
) => {

    const title =
        resolvePresentationTitle(
            presentation
        );


    pptx.author =
        presentation.author ||
        "Ledify";


    pptx.company =
        presentation.company ||
        "Ledify";


    pptx.subject =
        presentation.subject ||
        presentation.description ||
        title;


    pptx.title =
        title;


    pptx.lang =
        presentation.language ||
        "en-US";


    pptx.comments =
        "Generated by Ledify";

};


// =========================================================
// CONFIGURE POWERPOINT FONT THEME
// =========================================================
//
// Individual layout renderers still explicitly use
// typography tokens.
//
// This document-level theme gives PowerPoint a consistent
// native heading/body font definition as well.
//
// =========================================================

const configureFontTheme = (
    pptx,
    tokens
) => {

    const typography =
        tokens?.typography || {};


    const headingFont =
        typography.headingFamily ||
        typography.displayFamily ||
        typography.bodyFamily ||
        "Arial";


    const bodyFont =
        typography.bodyFamily ||
        typography.headingFamily ||
        "Arial";


    pptx.theme = {

        headFontFace:
            headingFont,

        bodyFontFace:
            bodyFont,

        lang:
            "en-US"

    };

};


// =========================================================
// RESOLVE PRESENTATION TITLE
// =========================================================

const resolvePresentationTitle = (
    presentation
) => {

    const candidates = [

        presentation.title,

        presentation.presentationTitle,

        presentation?.metadata?.title,

        presentation?.slides?.[0]?.title

    ];


    for (
        const candidate
        of candidates
    ) {

        if (
            typeof candidate ===
                "string" &&
            candidate.trim()
        ) {

            return candidate.trim();

        }

    }


    return "Generated Presentation";

};


// =========================================================
// WRITE PRESENTATION TO FILE
// =========================================================
//
// File creation remains separate from the core renderer.
//
// This function can be used when Ledify actually needs
// a physical .pptx file.
//
// Example:
//
// await writePresentationFile(
//     presentation,
//     "./generated/my-presentation.pptx"
// );
//
// =========================================================

export const writePresentationFile = async (
    presentation,
    filePath
) => {

    if (
        !filePath ||
        typeof filePath !== "string"
    ) {

        throw new Error(
            "PowerPoint output file path is required"
        );

    }


    const pptx =
        await pptxRenderer(
            presentation
        );


    await pptx.writeFile({

        fileName:
            filePath

    });


    return {

        filePath,

        title:
            resolvePresentationTitle(
                presentation
            ),

        slideCount:
            presentation.slides.length

    };

};


// =========================================================
// GENERATE PRESENTATION BUFFER
// =========================================================
//
// This is useful for the API and eventual download flow.
//
// Example architecture:
//
// frontend
//    ↓
// generation request
//    ↓
// AI generation
//    ↓
// presentation processing
//    ↓
// pptxRenderer
//    ↓
// PowerPoint Buffer
//    ↓
// preview/download infrastructure
//
// The renderer itself remains independent from the
// transport mechanism.
//
// =========================================================

export const generatePresentationBuffer = async (
    presentation
) => {

    const pptx =
        await pptxRenderer(
            presentation
        );


    const buffer =
        await pptx.write({

            outputType:
                "nodebuffer"

        });


    return {

        buffer,

        title:
            resolvePresentationTitle(
                presentation
            ),

        slideCount:
            presentation.slides.length

    };

};
