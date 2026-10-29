export function incompleteFailure(result){
 if(result.visualValidation?.status==='incomplete')return {httpStatus:422,errorCode:'VISUAL_REQUIREMENTS_UNMET',stage:'visual-validation',message:'Required diagrams remain unresolved. Available artifacts are incomplete; retry the missing visual requirements.'};
 if(result.exportValidation?.status==='incomplete')return {httpStatus:503,errorCode:'DOCUMENT_PDF_UNAVAILABLE',stage:'document-export',message:'PDF export is unavailable; Word download and preview remain available.'};
 if(result.designQuality?.inspection?.reason==='EXPORT_INCOMPLETE')return {httpStatus:503,errorCode:'PRESENTATION_PREVIEW_UNAVAILABLE',stage:'presentation-export',message:'Presentation exports are incomplete. Available draft files remain downloadable.'};
 if(result.designQuality?.inspection?.browser==='failed')return {httpStatus:422,errorCode:'VISUAL_QUALITY_FAILED',stage:'visual-quality',message:'Rendered layout checks failed. Available files require repair before publication.'};
 return {httpStatus:422,errorCode:'IMAGE_REQUIREMENTS_UNMET',stage:'image-validation',message:'Required images are missing. Available artifacts are incomplete; retry or provide authorized assets.'};
}
