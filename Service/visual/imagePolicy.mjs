const integer=(v,f,min,max)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Math.floor(Number(v)))):f;
const amount=(v,f)=>Number.isFinite(Number(v))?Math.max(0,Number(v)):f;
import {imageGenerationSettings,imageGenerationEstimate} from './imageGenerationService.mjs';
// Server settings only: clients cannot opt into billing or raise limits.
export function imagePolicy(env=process.env){
    return {
        enabled:env.PRESENTATION_IMAGES_ENABLED!=='false',
        failureMode:env.PRESENTATION_IMAGE_FAILURE_MODE==='strict'?'strict':'warn',
        stockProvider:env.PRESENTATION_STOCK_PROVIDER||'auto',
        allowGeneration:env.PRESENTATION_ALLOW_IMAGE_GENERATION==='true'&&imageGenerationSettings(env).ready,
        generationProvider:imageGenerationSettings(env).provider,
        generationStatus:env.PRESENTATION_ALLOW_IMAGE_GENERATION!=='true'?'GENERATION_DISABLED':imageGenerationSettings(env).ready?'CONFIGURED':imageGenerationSettings(env).reason,
        // This is paid attempts, not successful assets: leave recovery room for
        // twelve image-bearing slides while keeping maxImages separately bounded.
        maxGenerated:integer(env.PRESENTATION_MAX_GENERATED_IMAGES,24,0,36),
        maxImages:integer(env.PRESENTATION_MAX_IMAGES,12,0,12),
        concurrency:integer(env.PRESENTATION_IMAGE_CONCURRENCY,2,1,3),
        retries:integer(env.PRESENTATION_IMAGE_RETRIES,1,0,2),
        timeoutMs:integer(env.PRESENTATION_IMAGE_TIMEOUT_MS,60000,1000,60000),
        stockSearchTimeoutMs:integer(env.PRESENTATION_STOCK_SEARCH_TIMEOUT_MS,12000,1000,30000),
        deadlineMs:integer(env.PRESENTATION_IMAGE_DEADLINE_MS,180000,1000,300000),
        estimatedUnitCost:imageGenerationEstimate(env,env.PRESENTATION_IMAGE_RESOLUTION||'2K',env.PRESENTATION_IMAGE_ESTIMATED_UNIT_COST??env.AI_IMAGE_ESTIMATED_UNIT_COST),
        maxEstimatedCost:amount(env.PRESENTATION_IMAGE_MAX_ESTIMATED_COST??env.AI_IMAGE_MAX_ESTIMATED_COST,0),
        resolution:['1K','2K','4K'].includes(env.PRESENTATION_IMAGE_RESOLUTION)?env.PRESENTATION_IMAGE_RESOLUTION:'2K',
        quality:integer(env.PRESENTATION_IMAGE_JPEG_QUALITY,88,70,95),
        cacheDays:integer(env.PRESENTATION_IMAGE_CACHE_DAYS,7,0,30)
    };
}
export function generationBudget(policy){
    let requests=0,reservedCost=0;
    return {
        reserve(){
            if(!policy.allowGeneration||!policy.estimatedUnitCost||!policy.maxEstimatedCost||requests>=policy.maxGenerated||reservedCost+policy.estimatedUnitCost>policy.maxEstimatedCost+1e-9)return false;
            requests++;reservedCost+=policy.estimatedUnitCost;return true;
        },
        report:()=>({attempts:requests,estimatedReservedCost:Number(reservedCost.toFixed(6)),ceiling:policy.maxEstimatedCost,currency:'server-configured billing currency',actualCost:'not available; confirm provider billing'})
    };
}
