import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {aiService} from '../Service/aiService.mjs';
import {anthropicFixture} from './fixtures/anthropicTransport.mjs';
import {fixtures,fixturePlan,fixtureDraft} from './webpage/fixtures.mjs';
import {designPlan} from './fixtures/designPlan.mjs';
import {createSpecification,compileDesign} from '../Service/design/specification.mjs';
import {webpageLayoutService} from '../Service/webpageLayoutService.mjs';
import {webpageThemeService} from '../Service/webpageThemeService.mjs';
import {webpageRenderer} from '../renderer/webpage/webpageRenderer.mjs';
import {inspectWebsite} from '../Service/webpage/qualityGate.mjs';
process.env.WEBPAGE_BROWSER_QA='true';process.env.LEDIFY_RETAIN_QA_ARTIFACTS='true';
const root=path.resolve('generated/v2-browser');await fs.mkdir(root,{recursive:true});const reports=[];
for(const name of ['fashion','restaurant','business','school']){
 const fixture=fixtures[name],plan=fixturePlan(fixture);plan.artifactDesign=designPlan({sections:plan.sections},'webpage');
 const mock=anthropicFixture(({schema})=>schema.properties.pageType?plan:fixtureDraft(fixture));
 const result=await aiService('prompt',fixture.source,'webpage',{instructions:'Create an image-free website.'},{client:mock.client,logger:()=>{}});
 const spec=createSpecification(result.generatedContent,'webpage'),page=webpageThemeService(webpageLayoutService(compileDesign(spec,result.generatedContent)));
 const output=await inspectWebsite(webpageRenderer(page),{root:path.join(root,name)});reports.push({name,...output.report});
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify(reports,null,2));
 assert.equal(output.report.browser,'passed',JSON.stringify(output.report));console.log('[V2_BROWSER]',JSON.stringify({name,status:output.report.browser,checks:output.report.checks?.length}));
}
