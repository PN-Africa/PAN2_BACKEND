import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "node:url";
import {
    trackedExecFile as execFile
} from "../../Service/renderProcesses.mjs";

import {
    promisify
} from "util";


// =========================================================
// PROMISIFIED PROCESS EXECUTION
// =========================================================

const execFileAsync =
    promisify(
        execFile
    );


// =========================================================
// DEFAULT LIBREOFFICE EXECUTABLE
// =========================================================
//
// Development environment:
//
// Windows:
// C:\Program Files\LibreOffice\program\soffice.exe
//
// Later, when Ledify is deployed, this can be supplied
// through an environment variable:
//
// LIBREOFFICE_PATH=/usr/bin/libreoffice
//
// This prevents the production deployment from depending
// on a Windows-specific path.
//
// =========================================================

const DEFAULT_LIBREOFFICE_PATH =
    process.platform === "win32"
        ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
        : "libreoffice";


// =========================================================
// PPTX TO PDF CONVERTER
// =========================================================
//
// Responsibility:
//
// Converts an existing PowerPoint file into a PDF using
// LibreOffice in headless mode.
//
// Input:
//
// {
//     pptxPath,
//     pdfPath,
//     workingDirectory
// }
//
// Output:
//
// {
//     pdfPath
// }
//
// =========================================================

export const convertPptxToPdf = async ({
    pptxPath,
    pdfPath,
    workingDirectory
}) => {

    // =====================================================
    // 1. VALIDATE INPUT
    // =====================================================

    if (
        !pptxPath ||
        typeof pptxPath !== "string"
    ) {

        throw new Error(
            "PowerPoint file path is required"
        );

    }


    if (
        !pdfPath ||
        typeof pdfPath !== "string"
    ) {

        throw new Error(
            "PDF output file path is required"
        );

    }


    if (
        !workingDirectory ||
        typeof workingDirectory !== "string"
    ) {

        throw new Error(
            "Preview working directory is required"
        );

    }


    // =====================================================
    // 2. VERIFY PPTX EXISTS
    // =====================================================

    try {

        await fs.access(
            pptxPath
        );

    } catch {

        throw new Error(
            `PowerPoint file does not exist: ${pptxPath}`
        );

    }


    // =====================================================
    // 3. ENSURE WORKING DIRECTORY EXISTS
    // =====================================================

    await fs.mkdir(
        workingDirectory,
        {
            recursive: true
        }
    );


    // =====================================================
    // 4. RESOLVE LIBREOFFICE EXECUTABLE
    // =====================================================

    const libreOfficePath =
        process.env.LIBREOFFICE_PATH ||
        DEFAULT_LIBREOFFICE_PATH;


    // =====================================================
    // 5. VERIFY LIBREOFFICE ON WINDOWS
    // =====================================================
    //
    // When an absolute Windows executable path is being
    // used, verify it before attempting conversion.
    //
    // On Linux deployment, "libreoffice" may instead be
    // resolved through PATH.
    //
    // =====================================================

    if (
        process.platform === "win32"
    ) {

        try {

            await fs.access(
                libreOfficePath
            );

        } catch {

            throw new Error(
                `LibreOffice executable was not found: ${libreOfficePath}`
            );

        }

    }


    // =====================================================
    // 6. BUILD LIBREOFFICE COMMAND ARGUMENTS
    // =====================================================
    //
    // Equivalent command:
    //
    // soffice.exe
    //     --headless
    //     --convert-to pdf
    //     --outdir <workingDirectory>
    //     <pptxPath>
    //
    // We use execFile instead of constructing one shell
    // command string.
    //
    // This avoids quoting problems with Windows paths such
    // as "Program Files".
    //
    // =====================================================

    const argumentsList = [
        `-env:UserInstallation=${pathToFileURL(path.join(path.resolve(workingDirectory), "libreoffice-profile")).href}`,

        "--headless",

        "--convert-to",
        "pdf",

        "--outdir",
        workingDirectory,

        pptxPath

    ];


    // =====================================================
    // 7. RUN LIBREOFFICE
    // =====================================================

    let stdout = "";
    let stderr = "";


    try {

        const result =
            await execFileAsync(
                libreOfficePath,
                argumentsList,
                {
                    windowsHide: true,

                    timeout:
                        120000,

                    maxBuffer:
                        1024 * 1024 * 10
                }
            );


        stdout =
            result.stdout || "";


        stderr =
            result.stderr || "";


    } catch (error) {

        const processMessage =
            error.stderr ||
            error.stdout ||
            error.message;


        throw new Error(
            `LibreOffice failed to convert PowerPoint to PDF: ${processMessage}`
        );

    }


    // =====================================================
    // 8. DETERMINE GENERATED PDF PATH
    // =====================================================
    //
    // LibreOffice uses the source filename when creating
    // the PDF.
    //
    // Example:
    //
    // presentation.pptx
    //
    // becomes:
    //
    // presentation.pdf
    //
    // =====================================================

    const generatedPdfPath =
        path.join(
            workingDirectory,
            `${
                path.parse(
                    pptxPath
                ).name
            }.pdf`
        );


    // =====================================================
    // 9. VERIFY PDF WAS GENERATED
    // =====================================================

    try {

        await fs.access(
            generatedPdfPath
        );

    } catch {

        const details =
            [
                stdout.trim(),
                stderr.trim()
            ]
                .filter(Boolean)
                .join(" | ");


        throw new Error(
            details
                ? `LibreOffice completed but no PDF was generated. ${details}`
                : "LibreOffice completed but no PDF was generated"
        );

    }


    // =====================================================
    // 10. NORMALIZE PDF PATH
    // =====================================================
    //
    // Normally generatedPdfPath and pdfPath are identical
    // because previewRenderer uses:
    //
    // presentation.pptx
    // presentation.pdf
    //
    // But keeping this normalization makes the converter
    // reusable if different filenames are used later.
    //
    // =====================================================

    const normalizedGeneratedPath =
        path.resolve(
            generatedPdfPath
        );


    const normalizedRequestedPath =
        path.resolve(
            pdfPath
        );


    if (
        normalizedGeneratedPath !==
        normalizedRequestedPath
    ) {

        await fs.copyFile(
            generatedPdfPath,
            pdfPath
        );


        await fs.rm(
            generatedPdfPath,
            {
                force: true
            }
        );

    }


    // =====================================================
    // 11. FINAL VERIFICATION
    // =====================================================

    try {

        const pdfStats =
            await fs.stat(
                pdfPath
            );


        if (
            !pdfStats.isFile() ||
            pdfStats.size === 0
        ) {

            throw new Error(
                "Generated PDF is empty"
            );

        }


    } catch (error) {

        throw new Error(
            `Generated PDF could not be verified: ${error.message}`
        );

    }


    // =====================================================
    // 12. RETURN RESULT
    // =====================================================

    return {

        pdfPath,

        stdout:
            stdout.trim(),

        stderr:
            stderr.trim()

    };

};
