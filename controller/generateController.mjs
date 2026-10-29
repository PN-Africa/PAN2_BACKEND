import {incompleteFailure} from '../Service/incompleteFailure.mjs';
import {generationOutcome} from '../Service/generationOutcome.mjs';
import { resolveSlideCount } from '../Service/ai/slideCount.mjs';
import generateModel from '../model/generateModel.mjs';
import { fileService } from '../Service/fileService.mjs';
import {urlSourceService,unpackUrlSource} from '../Service/input/urlUnderstanding.mjs';
import { generateService } from '../Service/generateService.mjs';
import { publicGenerationResult, compactOptionalContext } from '../Service/publicGenerationResult.mjs';
import { validateUploadedFile } from '../Service/input/fileValidation.mjs';
import { combineGenerationInput } from '../Service/input/combinedInput.mjs';
import { addPresentationPublicUrls } from '../Service/presentationPublicUrls.mjs';
import {prepareInputImageAssets,validateVisualAssetInputs} from '../Service/visual/inputImageAssets.mjs';
import {profileGeneration,measureStage,performanceReport,generationSignal} from '../Service/performance.mjs';
import {generationJobs} from '../Service/generationJobs.mjs';
import {validateTextPrompt} from '../Service/input/promptValidation.mjs';
import {withGenerationCapacity} from '../Service/generationCapacity.mjs';
import {inputAdmission} from '../Service/input/admission.mjs';

export function createGenerationHandlers({ model = generateModel, generator = generateService, extractFile = fileService, extractUrl = urlSourceService,jobRoot,jobOptions={},deliveryLogger=event=>console.info('[GENERATION_DELIVERY]',JSON.stringify(event)) } = {}) {
    const handle = inputType => (req, res) => profileGeneration(async() => {
        const deliveryStarted=performance.now(),deliveryRequestId=performanceReport()?.requestId;
        res.once?.('finish',()=>{
            try{deliveryLogger({requestId:deliveryRequestId,status:'response-finished',httpStatus:res.statusCode,elapsedMs:Math.round(performance.now()-deliveryStarted),outputType:['presentation','webpage','document'].includes(req.body?.outputType)?req.body.outputType:'unknown'});}catch{}
        });
        res.once?.('close',()=>{
            if(!res.writableFinished)try{deliveryLogger({requestId:deliveryRequestId,status:'client-disconnected',elapsedMs:Math.round(performance.now()-deliveryStarted),outputType:['presentation','webpage','document'].includes(req.body?.outputType)?req.body.outputType:'unknown'});}catch{}
        });
        let record;
        const signal=req[inputAdmission]?.signal?AbortSignal.any([req[inputAdmission].signal,generationSignal()]):generationSignal();
        try {
            if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw invalid('Provide a JSON object for text or URL requests, or a multipart form for the file endpoint.');
            const { outputType, slideCount } = req.body;
            if (!['presentation', 'document', 'webpage'].includes(outputType)) throw invalid('outputType must be presentation, document or webpage');
            let context = req.body.context;
            if (['file','combined'].includes(inputType) && typeof context === 'string') {
                try { context = JSON.parse(context); } catch { throw Object.assign(new Error('Context must be valid JSON'), { code: 'INVALID_CONTEXT' }); }
            }
            context = requestContext(context, slideCount);
            const exportFormat=req.body.exportFormat??context.exportFormat;
            if(exportFormat!=null){
                if(outputType!=='document'||!['docx','pdf'].includes(exportFormat))throw Object.assign(new Error('exportFormat must be docx or pdf and is supported for document output.'),{code:'INVALID_EXPORT_FORMAT',field:'exportFormat'});
                context.exportFormat=exportFormat;
            }
            if(outputType==='presentation')validateVisualAssetInputs(context);
            if (outputType === 'presentation') resolveSlideCount('', context);
            let input, label,kind=inputType,sources;
            if(inputType==='combined') {
                const combined=await measureStage('input-extraction',()=>combineGenerationInput({body:req.body,file:req.file,context,extractFile,extractUrl,signal}));
                ({input,label,sources}=combined);kind=combined.inputType;context=combined.context;
            } else if (inputType === 'file') {
                if (!req.file) throw invalid('File is required');
                await validateUploadedFile(req.file);
                input = await measureStage('input-extraction',()=>extractFile(req.file)); label = req.file.originalname;
            } else {
                const field = inputType === 'prompt' ? 'textPrompt' : 'urlPrompt';
                if (typeof req.body[field] !== 'string' || !req.body[field].trim()) throw invalid(field + ' and outputType are required');
                label = inputType==='prompt'?validateTextPrompt(req.body[field]):req.body[field];
                if(inputType==='url'){
                    const extracted=await measureStage('input-extraction',()=>extractUrl(label,{context,outputType,signal}));
                    const source=unpackUrlSource(extracted,label,context);input=source.text;context=source.context;
                }else input=label;
            }
            const visualInput=outputType==='presentation'?await prepareInputImageAssets(context,req.file):null;
            if(visualInput)context=visualInput.context;
            if(outputType==='presentation')resolveSlideCount(kind==='prompt'?input:'',context);
            // Extracted text and explicitly selected image buffers now own the
            // input; do not retain a large original upload while waiting for AI.
            if(req.file)delete req.file.buffer;
            req[inputAdmission]?.release();
            record = await databaseOperation('database-create',()=>model.create({ inputType:kind, input: label, outputType, status: 'processing' }));
            if(req.get?.('Prefer')?.split(',').some(value=>value.trim()==='respond-async')){
                const job=await generationJobs({...jobOptions,generator,model,root:jobRoot}).enqueue({kind,input,outputType,context,recordId:String(record._id),options:visualInput?.assets.length?{visuals:{userAssets:visualInput.assets}}:{}});
                res.set?.('Preference-Applied','respond-async');res.set?.('Location',job.statusUrl);res.set?.('Retry-After','2');
                return res.status(202).json({message:'Generation queued',data:job});
            }
            let result = await withGenerationCapacity(()=>generator(kind, input, outputType, context,visualInput?.assets.length?{visuals:{userAssets:visualInput.assets}}:{}));
            if(sources)result={...result,sources};
            result=await measureStage('response-preparation',()=>{
                const projected=addPresentationPublicUrls(publicGenerationResult(result),req);
                for(const key of ['context','resolvedContext']) projected[key]=compactOptionalContext(projected[key]);
                if(projected.generatedContent?.inferredContext)projected.generatedContent.inferredContext=compactOptionalContext(projected.generatedContent.inferredContext);
                return projected;
            });
            result.outcome=generationOutcome(result);
            record.status = result.status==='incomplete'?'failed':'completed'; record.outcome=result.outcome; record.generatedContent = result.generatedContent;
            if (result.artifacts || result.preview) record.artifacts = result.artifacts || result.preview;
            await databaseOperation('database-save',()=>record.save());
            const legacy=req.get?.('X-Ledify-Response-Version')==='1';
            const request=legacy?(record.toObject?.() || {...record}):Object.fromEntries(['_id','inputType','outputType','status','outcome','createdAt','updatedAt'].filter(k=>record[k]!=null).map(k=>[k,record[k]]));
            const status=result.status || 'completed';
            if(status==='incomplete'){
                const failure=incompleteFailure(result);
                const pdfFailed=failure.httpStatus===503;
                if(pdfFailed)res.set?.('Retry-After','15');
                return res.status(failure.httpStatus).json({message:failure.message,errorCode:failure.errorCode,stage:failure.stage,data:{responseVersion:2,request:publicGenerationResult(request),result}});
            }
            res.set?.('X-Ledify-Response-Version',legacy?'1':'2');
            if(result.timings) {
                const entries=Object.entries(result.timings).filter(([name,duration])=>/^[a-z]+Ms$/i.test(name)&&Number.isFinite(duration)&&duration>=0);
                if(entries.length)res.set?.('Server-Timing',entries.map(([name,duration])=>`${name.slice(0,-2)};dur=${duration}`).join(', '));
            }
            if(legacy) res.set?.('Warning','299 Ledify "Response v1 duplicates generated content; migrate to data.result.generatedContent"');
            const message=status==='partial_success'?'Generation partially completed; review warnings':status==='completed_with_warnings'?'Generated with quality warnings; review before use':`${outputType === 'presentation' ? 'Presentation' : outputType === 'webpage' ? 'Webpage' : 'Document'} generated successfully`;
            return res.status(201).json({ message, data: { responseVersion:legacy?1:2,request:publicGenerationResult(request),result } });
        } catch (error) {
            if(res.destroyed)return;
            if (record && error.code!=='DATABASE_UNAVAILABLE') { record.status = 'failed';record.outcome=generationOutcome({status:'failed'}); try { await record.save(); } catch {} }
            if(signal?.reason?.code==='GENERATION_TIMEOUT'||error.code==='GENERATION_TIMEOUT'||error.code==='AI_PROVIDER_TIMEOUT'||error.code==='AI_RETRY_EXHAUSTED'&&error.lastErrorCode==='AI_PROVIDER_TIMEOUT')console.error('[GENERATION]',JSON.stringify({requestId:error.requestId||deliveryRequestId,outputType:req.body?.outputType,stage:signal?.reason?.code==='GENERATION_TIMEOUT'?'generation':error.stage||'generation',status:'failed',errorCode:signal?.reason?.code==='GENERATION_TIMEOUT'?'GENERATION_TIMEOUT':error.code,providerReason:error.providerReason,model:error.model}));
            if(signal?.reason?.code==='GENERATION_TIMEOUT'||error.code==='GENERATION_TIMEOUT')return res.status(504).json({message:'The overall generation time budget was exhausted.',errorCode:'GENERATION_TIMEOUT',stage:'generation',requestId:deliveryRequestId});
            if(error.code==='AI_PROVIDER_TIMEOUT'||error.code==='AI_RETRY_EXHAUSTED'&&error.lastErrorCode==='AI_PROVIDER_TIMEOUT')return res.status(504).json({message:error.stage==='url-content-understanding'?'AI content understanding timed out.':'AI generation request timed out.',errorCode:'AI_PROVIDER_TIMEOUT',stage:error.stage||'generation',requestId:error.requestId||deliveryRequestId,providerReason:'PROVIDER_TIMEOUT',model:error.model});
            if(error.code==='SOURCE_CONTENT_INSUFFICIENT')return res.status(422).json({message:error.message,errorCode:error.code,stage:error.stage||'input-extraction'});
            if(/^CLAUDE_WEB_FETCH_/.test(error.code||''))return res.status(502).json({message:'The public source could not be retrieved using the enabled methods.',errorCode:error.code,stage:'input-extraction'});
            const code = error.code || 'GENERATION_FAILED';
            if(code==='PRESENTATION_QUALITY_FAILED'){console.error('[GENERATION]',JSON.stringify({requestId:error.requestId,status:'failed',errorCode:code,stage:error.stage,slideNumber:error.slideNumber,stopReason:error.stopReason,recoveryReason:error.recoveryReason,repairBudget:error.repairBudget,issues:error.qualityIssues}));return res.status(422).json({message:'Presentation content did not pass quality review.',errorCode:code,stage:error.stage,slideNumber:error.slideNumber,requestId:error.requestId,issues:error.qualityIssues,stopReason:error.stopReason,repairHistory:error.repairHistory,recoveryReason:error.recoveryReason,repairBudget:error.repairBudget});}
            if(['DESIGN_SPEC_INVALID','UNSAFE_DESIGN_SVG','VISUAL_QUALITY_FAILED'].includes(code))return res.status(422).json({message:'The design could not meet validated rendering requirements.',errorCode:code,stage:error.stage,field:error.field});
            if(/^(?:ANTHROPIC_|CLAUDE_|AI_TEXT_)/.test(code))return res.status(503).json({message:'The configured text provider is not ready.',errorCode:code,stage:'text-provider',error:'Verify the configured Anthropic API key and exact Claude model. No alternative provider was selected.'});
            if(code==='DATABASE_UNAVAILABLE'){
                res.set?.('Retry-After','15');
                console.error('[DATABASE]',JSON.stringify({errorCode:code,stage:error.stage,errorType:error.databaseErrorType}));
                return res.status(503).json({message:'Database is temporarily unavailable',error:'The server could not save the generation request. Check MongoDB connectivity and retry.',errorCode:code,stage:error.stage});
            }
            if(['GENERATION_QUEUE_FULL','GENERATION_CAPACITY_BUSY','AI_PROVIDER_BUSY','PRESENTATION_RENDER_BUSY'].includes(code)){res.set?.('Retry-After','15');return res.status(503).json({message:'Generation capacity is occupied. Retry shortly.',errorCode:code});}
            if(error.validationErrors?.length) console.error('[GENERATION_VALIDATION]',JSON.stringify({requestId:error.requestId,stage:error.stage,validationErrors:error.validationErrors}));
            console.error('[GENERATION]',JSON.stringify({errorCode:code,stage:error.stage||'generation',requestId:error.requestId,slideNumber:error.slideNumber,sectionId:error.sectionId,validationRule:error.validationRule,field:error.field,maxCharacters:error.maxCharacters,lastErrorCode:error.lastErrorCode,providerStatus:error.providerStatus,providerReason:error.providerReason,model:error.model}));
            if(['PRESENTATION_IMAGES_UNAVAILABLE','PRESENTATION_IMAGE_LAYOUT_FAILED','PPTX_REQUIRED_IMAGE_MISSING'].includes(code))return res.status(code==='PRESENTATION_IMAGES_UNAVAILABLE'?503:422).json({message:'Presentation image requirements could not be completed',error:error.message,errorCode:code,stage:error.stage,missingSlides:error.missingSlides,
                imageFailures:error.imageDiagnostics?.filter(d=>d.status!=='resolved').map(({slideNumber,method,status,attempt,reasonCode})=>({slideNumber,method,status,attempt,reasonCode}))});
            if(code==='AI_PROVIDER_ERROR'||code==='AI_PROVIDER_TRANSIENT'||code==='AI_RETRY_EXHAUSTED'&&error.lastErrorCode==='AI_PROVIDER_TRANSIENT'){
                const reasons={
                    INVALID_API_KEY:'The configured text provider rejected the API key. Verify the server credentials.',
                    API_KEY_RESTRICTED:'The configured text provider key restrictions block this service. Verify the account permissions.',
                    PERMISSION_DENIED:'The configured text provider denied access. Verify the deployed account permissions.',
                    MODEL_NOT_FOUND:'The configured text model is unavailable. Verify the exact identifier and account access.',
                    REGION_UNSUPPORTED:'The configured text provider is unavailable from this service region. Use a supported deployment region.',
                    QUOTA_OR_BILLING:'Text-provider quota or billing currently prevents generation. Check the server project quota and billing.',
                    REQUEST_REJECTED:'The text provider rejected the generation request. Check the server model configuration and request schema.',
                    PROVIDER_UNAVAILABLE:'The text provider is temporarily unavailable. Please retry shortly.',
                    PROVIDER_CONNECTION_FAILED:'The server could not connect to its text provider. Check service network connectivity and retry.'
                };
                const providerMessage=reasons[error.providerReason]||'The AI provider could not complete generation. Check the server provider configuration.';
                const unavailable=code!=='AI_PROVIDER_ERROR'||error.providerReason==='QUOTA_OR_BILLING';
                if(unavailable)res.set?.('Retry-After','30');
                return res.status(unavailable?503:502).json({message:'AI provider could not complete generation',error:providerMessage,errorCode:code,stage:error.stage||'generation',requestId:error.requestId,providerStatus:error.providerStatus,providerReason:error.providerReason,model:error.model,lastErrorCode:error.lastErrorCode});
            }
            if (code === 'UNSUPPORTED_FILE_FORMAT') return res.status(415).json({ message: 'Unsupported file format', error: error.message, errorCode: code });
            if(code==='PRESENTATION_RENDER_BUSY'){
                res.set?.('Retry-After','15');
                return res.status(503).json({message:'Presentation rendering is busy. Retry shortly.',errorCode:code,stage:'presentation-rendering'});
            }
            if(['SOURCE_URL_TOO_LARGE','SOURCE_URL_TEXT_TOO_LARGE'].includes(code))return res.status(413).json({message:error.message,error:error.message,errorCode:code,stage:error.stage,maxBytes:error.maxBytes,maxCharacters:error.maxCharacters});
            if(/^SOURCE_URL_(?:AUTH_REQUIRED|ACCESS_DENIED|PAYWALL|UNREACHABLE|TIMEOUT|RATE_LIMITED)$/.test(code)){
                const status=code==='SOURCE_URL_TIMEOUT'?504:code==='SOURCE_URL_UNREACHABLE'?502:code==='SOURCE_URL_RATE_LIMITED'?429:422;
                if(status===429)res.set?.('Retry-After','30');
                return res.status(status).json({message:error.message,error:error.message,errorCode:code,stage:'input-extraction'});
            }
            if(code==='AI_RETRY_EXHAUSTED'||code==='AI_SCHEMA_VALIDATION_FAILED')return res.status(502).json({message:'Generated content did not pass validation. No invalid artifact was published.',errorCode:code,stage:error.stage||'content-validation',field:error.field,validationRule:error.validationRule,requestId:error.requestId,lastErrorCode:error.lastErrorCode,validationErrors:error.validationErrors?.map(({field,maxCharacters})=>({field,maxCharacters})),stopReason:error.stopReason,retryable:false});
            const clientError = /^(INVALID_|SOURCE_URL|WEBPAGE_VALIDATION|WEBPAGE_STATIC)/.test(code);
            return res.status(clientError ? 400 : 500).json({ message: clientError ? error.message : 'Generation failed; see errorCode and stage', error: clientError ? error.message : 'Unable to complete generation',
                errorCode: code, stage: error.stage||'generation', slideNumber: error.slideNumber,sectionId:error.sectionId,validationRule:error.validationRule, field: error.field, minCharacters:error.minCharacters,maxCharacters:error.maxCharacters, requestId: error.requestId, lastErrorCode: error.lastErrorCode });
        }
    },{outputType:['presentation','webpage','document'].includes(req.body?.outputType)?req.body.outputType:'unknown'});
    return { userText: handle('prompt'), userUrl: handle('url'), userFile: handle('file'),userCombined:handle('combined') };
}
function invalid(message) { return Object.assign(new Error(message), { code: 'INVALID_REQUEST' }); }
async function databaseOperation(stage,operation){
    try{return await measureStage(stage,operation);}catch(cause){
        // Validation/programming errors must not be disguised as connectivity failures.
        if(!/^(?:MongoNetworkError|MongoNetworkTimeoutError|MongoServerSelectionError|MongooseServerSelectionError|MongoNotConnectedError|MongoTopologyClosedError|MongoPoolClearedError)$/.test(cause.name||'')&&!/buffering timed out|connection.*closed|server selection timed out/i.test(cause.message||''))throw cause;
        throw Object.assign(new Error('Database is temporarily unavailable',{cause}),{code:'DATABASE_UNAVAILABLE',stage,databaseErrorType:cause.name});
    }
}
function requestContext(context, slideCount) {
    if (context != null && (typeof context !== 'object' || Array.isArray(context))) throw Object.assign(new Error('Context must be an object'), { code: 'INVALID_CONTEXT' });
    return { ...(context || {}), ...(slideCount == null ? {} : { slideCount }) };
}
export const { userText, userUrl, userFile, userCombined } = createGenerationHandlers();
