import {
    getThemesForStrategy,
    presentationThemes
} from "../templates/presentation/presentationThemes.mjs";

import {
    getPresentationDesignTokens
} from "../templates/presentation/presentationDesignTokens.mjs";
import {topicColorPalette} from './design/colorSystem.mjs';
import {wantsTextOnly} from './visual/imageArtDirection.mjs';


// =========================================================
// PRESENTATION THEME SERVICE
// =========================================================

export const presentationThemeService = (
    generatedContent,
    context = {}
) => {

    // =====================================================
    // 1. VALIDATE PRESENTATION CONTENT
    // =====================================================

    if (!generatedContent) {
        throw new Error(
            "Generated presentation content is required"
        );
    }


    const strategyId =
        generatedContent.strategyId;


    if (!strategyId) {
        throw new Error(
            "Presentation strategyId is required for theme selection"
        );
    }


    // =====================================================
    // 2. READ OPTIONAL DESIGN PREFERENCES
    // =====================================================

    const designPreferences =
        context?.designPreferences || {};


    const requestedTheme =
        designPreferences.theme;


    const requestedVariant =
        designPreferences.variant;


    const requestedAppearance =
        designPreferences.appearance || (()=>{
            const direction=[context.instructions,...(context.keyInstructions||[]),...(generatedContent.inferredContext?.keyInstructions||[])].join(' ');
            if(/\b(?:dark (?:backgrounds?|theme|appearance|mode|visual style)|cinematic dark)\b/i.test(direction))return 'dark';
            if(/\blight (?:backgrounds?|theme|appearance|mode|visual style)\b/i.test(direction))return 'light';
        })();


    // =====================================================
    // 3. GET THEMES COMPATIBLE WITH STRATEGY
    // =====================================================

    const compatibleThemes =
        getThemesForStrategy(
            strategyId
        );


    if (
        !Array.isArray(compatibleThemes) ||
        compatibleThemes.length === 0
    ) {

        throw new Error(
            `No presentation theme found for strategy: ${strategyId}`
        );

    }


    // =====================================================
    // 4. SELECT THEME
    // =====================================================

    const themeId =
        selectTheme({

            strategyId,

            compatibleThemes,

            requestedTheme,

            context

        });


    // =====================================================
    // 5. SELECT VARIANT
    // =====================================================

    const variantId =
        selectVariant({

            themeId,

            requestedVariant,

            requestedAppearance,

            context,

            generatedContent

        });


    // =====================================================
    // 6. VALIDATE / RESOLVE DESIGN TOKENS
    // =====================================================
    //
    // This ensures that the selected theme + variant
    // actually exists in our design-token system.
    //
    // =====================================================

    const designTokens =
        getPresentationDesignTokens(
            themeId,
            variantId
        );


    // =====================================================
    // 7. RETURN PRESENTATION WITH DESIGN INFORMATION
    // =====================================================

    const automaticPalette=!requestedTheme&&!requestedVariant&&!requestedAppearance&&!generatedContent.artifactDesign?topicColorPalette(generatedContent.inferredContext?.topic||generatedContent.title):null;
    return {

        ...generatedContent,

        design: {
            uniformBackground:designPreferences.uniformBackground===true||/\b(?:all|every)\s+slides?[^.!?\n]{0,35}\b(?:plain white|same background|uniform background)\b/i.test(context.instructions||''),
            noRasterBackground:wantsTextOnly(context),

            themeId:
                designTokens.themeId,

            variantId:
                designTokens.variantId,

            tokens:
                automaticPalette?{...designTokens,colors:{...designTokens.colors,...automaticPalette.colors}}:designTokens

        }

    };

};


// =========================================================
// SELECT THEME
// =========================================================

const selectTheme = ({
    strategyId,
    compatibleThemes,
    requestedTheme,
    context
}) => {

    // =====================================================
    // USER-SPECIFIED THEME
    // =====================================================

    if (
        requestedTheme &&
        requestedTheme !== "auto"
    ) {

        const requestedThemeExists =
            presentationThemes.find(
                (theme) =>
                    theme.id === requestedTheme
            );


        if (!requestedThemeExists) {

            throw new Error(
                `Unknown presentation theme "${requestedTheme}"`
            );

        }


        return requestedThemeExists.id;

    }


    // =====================================================
    // AUTOMATIC THEME SELECTION
    // =====================================================

    const purpose =
        normalizeText(
            context?.purpose
        );


    const audience =
        normalizeText(
            context?.audience
        );


    const userRole =
        normalizeText(
            context?.userRole
        );


    // -----------------------------------------------------
    // EXECUTIVE COMMUNICATION
    // -----------------------------------------------------

    if (
        containsAny(
            `${purpose} ${audience}`,
            [
                "executive",
                "executives",
                "senior management",
                "senior leadership",
                "board",
                "board members",
                "decision makers",
                "decision-makers"
            ]
        )
    ) {

        const executiveTheme =
            findCompatibleTheme(
                compatibleThemes,
                "executive-minimal"
            );


        if (executiveTheme) {
            return executiveTheme.id;
        }

    }


    // -----------------------------------------------------
    // ANALYTICAL / DATA-HEAVY COMMUNICATION
    // -----------------------------------------------------

    if (
        containsAny(
            purpose,
            [
                "analysis",
                "analytics",
                "performance analysis",
                "data analysis",
                "reporting",
                "performance report"
            ]
        )
    ) {

        const analyticalTheme =
            findCompatibleTheme(
                compatibleThemes,
                "analytical-data"
            );


        if (analyticalTheme) {
            return analyticalTheme.id;
        }

    }


    // -----------------------------------------------------
    // ACADEMIC / RESEARCH
    // -----------------------------------------------------

    if (
        containsAny(
            `${purpose} ${audience} ${userRole}`,
            [
                "research",
                "academic",
                "seminar",
                "lecture",
                "lecturer",
                "lecturers",
                "examiner",
                "examiners",
                "scientific",
                "student researcher"
            ]
        )
    ) {

        const scholarlyTheme =
            findCompatibleTheme(
                compatibleThemes,
                "scholarly-clean"
            );


        if (scholarlyTheme) {
            return scholarlyTheme.id;
        }

    }


    // -----------------------------------------------------
    // STARTUP / INVESTOR
    // -----------------------------------------------------

    if (
        containsAny(
            `${purpose} ${audience}`,
            [
                "startup",
                "investor",
                "investors",
                "fundraising",
                "venture capital",
                "pitch"
            ]
        )
    ) {

        const startupTheme =
            findCompatibleTheme(
                compatibleThemes,
                "startup-bold"
            );


        if (startupTheme) {
            return startupTheme.id;
        }

    }


    // -----------------------------------------------------
    // SALES / PROPOSAL
    // -----------------------------------------------------

    if (
        containsAny(
            purpose,
            [
                "sales",
                "proposal",
                "client proposal",
                "customer proposal",
                "business proposal"
            ]
        )
    ) {

        const proposalTheme =
            findCompatibleTheme(
                compatibleThemes,
                "proposal-persuasive"
            );


        if (proposalTheme) {
            return proposalTheme.id;
        }

    }


    // -----------------------------------------------------
    // PROJECT / PLANNING
    // -----------------------------------------------------

    if (
        containsAny(
            purpose,
            [
                "project",
                "project kickoff",
                "project status",
                "roadmap",
                "planning",
                "implementation"
            ]
        )
    ) {

        const projectTheme =
            findCompatibleTheme(
                compatibleThemes,
                "project-structured"
            );


        if (projectTheme) {
            return projectTheme.id;
        }

    }


    // -----------------------------------------------------
    // CREATIVE
    // -----------------------------------------------------

    if (
        containsAny(
            purpose,
            [
                "portfolio",
                "creative",
                "campaign",
                "showcase",
                "design presentation"
            ]
        )
    ) {

        const creativeTheme =
            findCompatibleTheme(
                compatibleThemes,
                "creative-editorial"
            );


        if (creativeTheme) {
            return creativeTheme.id;
        }

    }


    // =====================================================
    // DEFAULT COMPATIBLE THEME
    // =====================================================

    return compatibleThemes[0].id;

};


// =========================================================
// SELECT VARIANT
// =========================================================

const selectVariant = ({
    themeId,
    requestedVariant,
    requestedAppearance,
    context,
    generatedContent
}) => {

    // =====================================================
    // USER-SPECIFIED VARIANT
    // =====================================================

    if (
        requestedVariant &&
        requestedVariant !== "auto"
    ) {

        // getPresentationDesignTokens validates whether
        // the requested variant actually exists.

        getPresentationDesignTokens(
            themeId,
            requestedVariant
        );


        return requestedVariant;

    }


    // =====================================================
    // APPEARANCE PREFERENCE
    // =====================================================

    if (
        requestedAppearance === "dark"
    ) {

        const darkVariant =
            getDarkVariant(
                themeId
            );


        if (darkVariant) {

            // Validate before returning.
            getPresentationDesignTokens(
                themeId,
                darkVariant
            );


            return darkVariant;

        }

    }


    if (
        requestedAppearance === "light"
    ) {

        const lightVariant =
            getLightVariant(
                themeId
            );


        if (lightVariant) {

            // Validate before returning.
            getPresentationDesignTokens(
                themeId,
                lightVariant
            );


            return lightVariant;

        }

    }


    // =====================================================
    // CONTEXT-AWARE VARIANT SELECTION
    // =====================================================

    const purpose =
        normalizeText(
            context?.purpose
        );


    const audience =
        normalizeText(
            context?.audience
        );


    // -----------------------------------------------------
    // SCHOLARLY CLEAN
    // -----------------------------------------------------

    if (
        themeId ===
        "scholarly-clean"
    ) {

        if (
            containsAny(
                `${purpose} ${audience}`,
                [
                    "research defense",
                    "thesis defense",
                    "dissertation defense",
                    "scientific conference",
                    "technical conference"
                ]
            )
        ) {

            return "midnight-research";

        }


        return "ivory-journal";

    }


    // -----------------------------------------------------
    // EXECUTIVE MINIMAL
    // -----------------------------------------------------

    if (
        themeId ===
        "executive-minimal"
    ) {

        if (
            containsAny(
                `${purpose} ${audience}`,
                [
                    "board",
                    "executive",
                    "investor",
                    "leadership"
                ]
            )
        ) {

            return "obsidian-gold";

        }


        return "ivory-charcoal";

    }


    // -----------------------------------------------------
    // STARTUP BOLD
    // -----------------------------------------------------

    if (
        themeId ===
        "startup-bold"
    ) {

        const slides =
            generatedContent?.slides || [];


        const hasDataHeavySlides =
            slides.some(
                (slide) =>
                    slide.slideType ===
                        "data-chart" ||
                    slide.slideType ===
                        "statistics"
            );


        if (hasDataHeavySlides) {
            return "midnight-cyan";
        }


        return "electric-violet";

    }


    // =====================================================
    // DEFAULT VARIANT
    // =====================================================

    const defaultTokens =
        getPresentationDesignTokens(
            themeId
        );


    return defaultTokens.variantId;

};


// =========================================================
// DARK VARIANT MAPPING
// =========================================================

const getDarkVariant = (
    themeId
) => {

    const darkVariants = {

        "scholarly-clean":
            "midnight-research",

        "executive-minimal":
            "obsidian-gold",

        "startup-bold":
            "electric-violet"

    };


    return (
        darkVariants[themeId] ||
        null
    );

};


// =========================================================
// LIGHT VARIANT MAPPING
// =========================================================

const getLightVariant = (
    themeId
) => {

    const lightVariants = {

        "scholarly-clean":
            "ivory-journal",

        "corporate-modern":
            "slate-blue",

        "executive-minimal":
            "ivory-charcoal",

        "proposal-persuasive":
            "warm-confidence",

        "project-structured":
            "modular-teal",

        "analytical-data":
            "precision-light",

        "creative-editorial":
            "coral-ink",

        "professional-neutral":
            "graphite-sage"

    };


    return (
        lightVariants[themeId] ||
        null
    );

};


// =========================================================
// FIND COMPATIBLE THEME
// =========================================================

const findCompatibleTheme = (
    compatibleThemes,
    themeId
) => {

    return compatibleThemes.find(
        (theme) =>
            theme.id === themeId
    );

};


// =========================================================
// NORMALIZE TEXT
// =========================================================

const normalizeText = (
    value
) => {

    if (!value) {
        return "";
    }


    return String(value)
        .trim()
        .toLowerCase();

};


// =========================================================
// CHECK TEXT FOR KEYWORDS
// =========================================================

const containsAny = (
    text,
    keywords
) => {

    if (!text) {
        return false;
    }


    const normalizedText =
        normalizeText(text);


    return keywords.some(
        (keyword) =>
            normalizedText.includes(
                keyword.toLowerCase()
            )
    );

};
