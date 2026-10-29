// A reviewer's inability to verify an optional source is not proof of a defect.
// This policy never certifies a citation, fetches a URL, or overrides a factual
// issue. Concrete reference defects remain blocking even if labeled warning.
export function referenceWarningPolicy(issue, {input='', context={}}={}) {
    if (issue.code !== 'REFERENCE' || issue.severity !== 'warning') return {nonBlocking:false,reason:'NOT_REFERENCE_WARNING'};
    const required=context.requireReferences===true || context.requireCitations===true ||
        /\b(?:include|provide|add|require|with|must have)\s+(?:(?:a|an|the|verified|verifiable|authoritative|academic|supporting|proper|full|source)\s+)*(?:citations?|references?|bibliography|source links)\b/i.test(String(input)) ||
        /\b(?:cite|reference)\s+(?:all|every|your|the|each)\s+(?:sources?|claims?|statistics?|facts?)\b/i.test(String(input)) ||
        /\b(?:use|include|provide|add)\s+(?:APA|MLA|Chicago|Harvard|IEEE)(?:[- ]style)?\s+(?:citations?|references?)\b/i.test(String(input));
    if(required)return {nonBlocking:false,reason:'REFERENCES_EXPLICITLY_REQUIRED'};
    const reason=String(issue.message||'')+' '+String(issue.repairInstruction||'');
    // Missing evidence for a concrete claim needs repair, as do invalid sources.
    // Do not interpret the word "unverified" alone as evidence of fabrication.
    const defect=/\b(?:fabricat\w*|invented|nonexistent|non-existent|misattribut\w*|retracted|broken|invalid|incorrect|inaccurate|misleading|contradict\w*|unsupported|unsubstantiated|untraceable|does not (?:exist|support)|cannot be traced|wrong (?:author|source|date|title)|(?:claim|statistic|figure|percentage|quotation|quote)\s+(?:is |has |lacks |needs |requires )?(?:unverified|unreferenced|uncited|evidence|verification|support|a citation))\b/i.test(reason);
    const missingClaimEvidence=/(?:\b(?:claim|statistic|figure|percentage|quotation|quote)\b|\d+(?:\.\d+)?%)/i.test(reason)&&/\b(?:without (?:a )?(?:source|evidence|citation)|(?:no|missing) (?:supporting )?(?:source|evidence|citation)|(?:lacks?|needs?|requires?) (?:supporting )?(?:evidence|a citation|a source))\b/i.test(reason);
    if(defect||missingClaimEvidence)return {nonBlocking:false,reason:'CONCRETE_REFERENCE_OR_CLAIM_DEFECT'};
    const limitation=/\b(?:verif\w*|optional|further reading|recommend\w*|source limitations?|not (?:supplied|provided)|external (?:review|check)|citation|reference)\b/i.test(reason);
    return {nonBlocking:limitation,reason:limitation?'OPTIONAL_REFERENCE_LIMITATION':'UNCLASSIFIED_REFERENCE_CONCERN'};
}
