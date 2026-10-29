import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {aiService} from '../../Service/aiService.mjs';
import {anthropicFixture} from '../fixtures/anthropicTransport.mjs';
import {designPlan} from '../fixtures/designPlan.mjs';
import {imagerySamples} from '../fixtures/presentationImagery.mjs';
import {fixtures,fixturePlan,fixtureDraft} from '../webpage/fixtures.mjs';
import {documentFixtureClient} from '../fixtures/documentFixtures.mjs';
import {createSpecification,compileDesign,applyPresentationDesign} from '../../Service/design/specification.mjs';
import {presentationLayoutService} from '../../Service/presentationLayoutService.mjs';
import {presentationThemeService} from '../../Service/presentationThemeService.mjs';
import {presentationRendererService} from '../../Service/presentationRendererService.mjs';
import {resolvePresentationVisuals} from '../../Service/visual/presentationVisuals.mjs';
import {generatePresentationBuffer} from '../../renderer/presentation/pptxRenderer.mjs';
import {webpageLayoutService} from '../../Service/webpageLayoutService.mjs';
import {webpageThemeService} from '../../Service/webpageThemeService.mjs';
import {webpageRenderer} from '../../renderer/webpage/webpageRenderer.mjs';
import {validateStaticWebsite} from '../../Service/webpageStaticValidator.mjs';
import {renderDocumentDocx} from '../../renderer/document/docxRenderer.mjs';
import {renderDocumentPreview} from '../../renderer/document/documentPreview.mjs';
import {aviationV2} from '../fixtures/aviationV2.mjs';
const compile=(content,type,context={})=>{const spec=createSpecification(content,type,{context});return {spec,content:compileDesign(spec,content)};};

for(const [category,index] of [['aviation',-1],['healthcare',0],['scientific manufacturing research',4],['business strategy',2],['environmental conservation',1]])test(`AI-directed ${category}: planning, canonical content and actual editable PPTX`,async()=>{
 const deck=index<0?aviationV2():structuredClone(imagerySamples[index].presentation);deck.inferredContext={userRole:'',purpose:'Explain '+deck.title,audience:'Students',topic:deck.title,tone:'educational',keyInstructions:[]};deck.slides[0].content.titleContent.supportingText='An evidence-aware educational overview.';if(deck.slides.at(-1).content.summary)deck.slides.at(-1).content.summary.statement='Connect the subject to evidence and responsible decisions.';deck.artifactDesign=designPlan(deck);
 const mock=anthropicFixture(({prompt,schema})=>schema.properties.slides?{...deck,slides:deck.slides.map(({content,layoutId,...slide})=>slide)}:deck.slides[Number(prompt.match(/Current slide: \{"slideNumber":(\d+)/)?.[1])-1].content);
 const count=deck.slides.length,context={instructions:'Create an image-free presentation.'},result=await aiService('prompt',`Create exactly ${count} educational slides about ${deck.title}.`,'presentation',context,{client:mock.client,qualityReview:false,logger:()=>{}});
 const {spec,content}=compile(result.generatedContent,'presentation',context),ready=applyPresentationDesign(presentationRendererService(presentationThemeService(presentationLayoutService(content))),spec),visual=await resolvePresentationVisuals(ready,context,{external:false,providers:{},diagramPlanner:false});
 const rendered=await generatePresentationBuffer(visual),zip=await JSZip.loadAsync(rendered.buffer);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,count);assert.equal(spec.provenance,'ai-directed');assert.equal(mock.calls.length,count+1);
});

const automotive={title:'APEX Automotive Concepts',pageType:'ecommerce',preset:'editorial',source:'Create a fictional automotive concept website called APEX Automotive Concepts. Describe illustrative electric sedan and touring coupe concepts, not actual inventory, specifications, prices or availability. Explain vehicle design choices and invite exploration. No contact details are supplied.',hero:{headline:'Explore considered automotive design',subheadline:'Illustrative vehicle concepts for exploring design choices, not actual inventory.',actionLabel:'Explore the concepts'},sections:[{type:'products',heading:'Vehicle concepts',content:'Illustrative design examples.',items:[{title:'Electric sedan',description:'A concept balancing cabin comfort and electric vehicle packaging.',detail:'',url:''},{title:'Touring coupe',description:'A concept exploring proportions and comfortable travel.',detail:'',url:''}]},{type:'about',heading:'Design with purpose',content:'Vehicle design balances usability, engineering and visual expression.',items:[]},{type:'contact',heading:'Explore the design choices',content:'Consider how each concept responds to different driving needs.',items:[]}],contact:{email:'',phone:'',address:''},cta:{heading:'Consider the next design choice',text:'Explore the illustrative concepts.',actionLabel:'Explore the concepts'}};
for(const name of ['fashion','automotive','restaurant','business','school','portfolio'])test(`AI-directed ${name} website: versioned plan reaches safe responsive HTML/CSS`,async()=>{
 const fixture=name==='automotive'?automotive:fixtures[name],plan=fixturePlan(fixture);plan.artifactDesign=designPlan({sections:plan.sections},'webpage');
 const mock=anthropicFixture(({schema})=>schema.properties.pageType?plan:fixtureDraft(fixture));
 const result=await aiService('prompt',fixture.source,'webpage',{instructions:'Create an image-free website.'},{client:mock.client,logger:()=>{}}),{spec,content}=compile(result.generatedContent,'webpage');
 const page=webpageThemeService(webpageLayoutService(content)),files=webpageRenderer(page);validateStaticWebsite(files);assert.equal(spec.provenance,'ai-directed');assert.equal(page.theme.typography.heading,"Georgia,'Times New Roman',serif");assert.ok(files['index.html'].includes('<main'));assert.equal(mock.calls.length,2);
});

for(const type of ['academic-report','business-report','technical-documentation'])test(`AI-directed ${type}: document styles and content survive real Word packaging`,async()=>{
 const legacy=documentFixtureClient();
 const mock=anthropicFixture(async({schema,prompt})=>{const value=JSON.parse((await legacy.models.generateContent({contents:prompt,config:{responseJsonSchema:schema}})).text);if(value.documentType){value.documentType=type;value.artifactDesign=designPlan(value,'document');value.artifactDesign.units[0].component=type==='technical-documentation'?'reference':'report';}return value;});
 const result=await aiService('prompt','Write a 100-word report explaining REST API resource interfaces.','document',{}, {client:mock.client,logger:()=>{}}),{spec,content}=compile(result.generatedContent,'document');
 const rendered=await renderDocumentDocx(content),zip=await JSZip.loadAsync(rendered.buffer);assert.ok((await zip.file('word/styles.xml').async('string')).includes('Georgia'));assert.ok((await renderDocumentPreview(content)).includes('class="'+content.sections[0].designComponent+'"'));assert.equal(spec.provenance,'ai-directed');assert.equal(mock.calls.length,3);
});
