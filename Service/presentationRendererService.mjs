import {
    getPresentationDesignTokens
} from "../templates/presentation/presentationDesignTokens.mjs";


// =========================================================
// PRESENTATION RENDERER SERVICE
// =========================================================
//
// This service prepares a fully resolved presentation for
// the actual rendering engine.
//
// At this stage we already have:
//
// - generated presentation content
// - semantic slide types
// - layout IDs
// - theme ID
// - variant ID
//
// This service resolves the selected design system and
// produces one renderer-ready presentation object.
//
// It does NOT create the PowerPoint file yet.
// =========================================================


export const presentationRendererService = (
    presentation
) => {

    // =====================================================
    // 1. VALIDATE PRESENTATION
    // =====================================================

    if (!presentation) {

        throw new Error(
            "Presentation content is required for rendering"
        );

    }


    // =====================================================
    // 2. VALIDATE PRESENTATION DESIGN
    // =====================================================

    if (!presentation.design) {

        throw new Error(
            "Presentation design information is missing"
        );

    }


    const {
        themeId,
        variantId
    } = presentation.design;


    if (!themeId) {

        throw new Error(
            "Presentation themeId is required"
        );

    }


    if (!variantId) {

        throw new Error(
            "Presentation variantId is required"
        );

    }


    // =====================================================
    // 3. RESOLVE DESIGN TOKENS
    // =====================================================

    const designTokens = presentation.design.tokens ||
        getPresentationDesignTokens(
            themeId,
            variantId
        );


    // =====================================================
    // 4. VALIDATE SLIDES
    // =====================================================

    if (
        !Array.isArray(presentation.slides) ||
        presentation.slides.length === 0
    ) {

        throw new Error(
            "Presentation must contain at least one slide"
        );

    }


    // =====================================================
    // 5. PREPARE SLIDES FOR RENDERING
    // =====================================================

    const rendererSlides =
        presentation.slides.map(
            (slide, index) => {

                return prepareSlideForRenderer(
                    slide,
                    index
                );

            }
        );


    // =====================================================
    // 6. RETURN RENDERER-READY PRESENTATION
    // =====================================================

    return {

        ...presentation,

        // ---------------------------------------------
        // PRESENTATION IDENTITY
        // ---------------------------------------------

        outputType:
            presentation.outputType,

        title:
            presentation.title,

        subtitle:
            presentation.subtitle || "",

        strategyId:
            presentation.strategyId,


        // ---------------------------------------------
        // CONTEXT
        // ---------------------------------------------

        inferredContext:
            presentation.inferredContext || {},


        // ---------------------------------------------
        // DESIGN
        // ---------------------------------------------

        design: {
            ...presentation.design,

            themeId,

            variantId,

            tokens:
                designTokens

        },


        // ---------------------------------------------
        // PRESENTATION METADATA
        // ---------------------------------------------

        metadata: {

            slideCount:
                rendererSlides.length,

            strategyId:
                presentation.strategyId,

            themeId,

            variantId

        },


        // ---------------------------------------------
        // RENDERER-READY SLIDES
        // ---------------------------------------------

        slides:
            rendererSlides

    };

};


// =========================================================
// PREPARE INDIVIDUAL SLIDE
// =========================================================

const prepareSlideForRenderer = (
    slide,
    index
) => {

    // =====================================================
    // VALIDATE SLIDE
    // =====================================================

    if (!slide) {

        throw new Error(
            `Slide at index ${index} is invalid`
        );

    }


    if (!slide.slideType) {

        throw new Error(
            `Slide ${index + 1} does not have a slideType`
        );

    }


    if (!slide.layoutId) {

        throw new Error(
            `Slide ${index + 1} does not have a layoutId`
        );

    }


    // =====================================================
    // NORMALIZE SLIDE
    // =====================================================

    return {

        ...slide,

        slideNumber:
            slide.slideNumber ||
            index + 1,

        slideType:
            slide.slideType,

        layoutId:
            slide.layoutId,

        title:
            slide.title || "",

        subtitle:
            slide.subtitle || "",

        content:
            slide.content || {},

        speakerNotes:
            slide.speakerNotes || ""

    };

};
