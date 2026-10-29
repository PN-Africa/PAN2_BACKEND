// Controlled render/browser audit. No AI calls, remote images or live services.
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {fixtures,fixturePlan,fixtureDraft} from './webpage/fixtures.mjs';
import {webpageLayoutService} from '../Service/webpageLayoutService.mjs';
import {webpageThemeService} from '../Service/webpageThemeService.mjs';
import {webpageRenderer} from '../renderer/webpage/webpageRenderer.mjs';
import {validateStaticWebsite} from '../Service/webpageStaticValidator.mjs';
import {checkWebsiteBrowser} from '../Service/webpage/browserChecks.mjs';
import {acquireWebsiteImages} from '../Service/webpage/imagePipeline.mjs';
import {stakeholderCases} from './fixtures/stakeholderCases.mjs';
const phase=process.argv[2]||'after',root=path.resolve('generated/webpage-overhaul',phase);await fs.mkdir(root,{recursive:true});
const cases={ai:structuredClone(fixtures.education),property:structuredClone(fixtures.business),healthcare:fixtures.pharmaceutical,startup:fixtures.startup,fashion:fixtures.fashion,school:fixtures.school||fixtures.education};
cases.ai.title='Artificial intelligence';cases.ai.hero={headline:'Understand the intelligence shaping tomorrow',subheadline:'Explore learning, reasoning and the questions surrounding artificial intelligence.',actionLabel:'Explore the concepts'};cases.ai.sections=cases.ai.sections.filter(s=>s.type!=='contact');
cases.ai.sections[0]={type:'topics',heading:'Ways machines learn',navLabel:'Methods',content:'Learning methods organize how systems use data.',items:[{title:'Supervised learning',description:'Learn relationships from labeled examples.',detail:'',url:''},{title:'Unsupervised learning',description:'Explore structure in unlabeled data.',detail:'',url:''},{title:'Reinforcement learning',description:'Learn through interactions and feedback.',detail:'',url:''}]};
cases.ai.sections[1]={type:'process',heading:'From examples to evaluation',navLabel:'Process',content:'A simplified learning workflow, with evaluation kept distinct from training.',items:[{title:'Prepare examples',description:'Organize data for a clearly defined task.',detail:'',url:''},{title:'Train a model',description:'Adjust the model using the training examples.',detail:'',url:''},{title:'Evaluate carefully',description:'Check performance and limitations on separate examples.',detail:'',url:''}]};
cases.ai.sections[2]={type:'faq',heading:'Questions worth asking',navLabel:'Questions',content:'Consider the limits as well as the possibilities.',items:[{title:'Does fluent output establish accuracy?',description:'A fluent response can still contain errors. Check important claims against reliable sources.',detail:'',url:''},{title:'Why examine training data?',description:'Data selection can shape model behavior and its limitations.',detail:'',url:''}]};cases.ai.cta={heading:'Explore with a critical eye',text:'Connect the methods, their applications and their limitations.',actionLabel:'Explore the concepts'};
cases.property.title='Élite Havens';cases.property.hero={headline:'A considered approach to exceptional homes',subheadline:'Explore an illustrative residential property concept. Listings do not represent available inventory.',actionLabel:'Explore the approach'};
cases.property.sections=[{type:'features',heading:'Spaces to imagine',navLabel:'Homes',content:'Illustrative residential concepts for exploring different ways of living.',items:[{title:'Waterfront villa',description:'A concept for an open residence oriented toward a water view.',detail:'',url:''},{title:'Urban penthouse',description:'A concept pairing private interiors with an elevated terrace.',detail:'',url:''},{title:'Garden residence',description:'A concept connecting living spaces with a landscaped courtyard.',detail:'',url:''}]},{type:'about',heading:'Consider every detail',navLabel:'Interiors',content:'Explore proportion, natural light and material texture as elements of residential design.',items:[]},{type:'process',heading:'A thoughtful property journey',navLabel:'Journey',content:'An illustrative process for considering a property purchase.',items:[{title:'Define priorities',description:'Clarify location, space and lifestyle requirements.',detail:'',url:''},{title:'Review the property',description:'Inspect available information and seek independent professional advice.',detail:'',url:''},{title:'Make an informed decision',description:'Consider verified documentation, suitability and costs.',detail:'',url:''}]}];cases.property.contact={email:'',phone:'',address:''};cases.property.cta={heading:'Begin with what matters to you',text:'Explore these illustrative residential ideas.',actionLabel:'Explore the concepts'};
if(phase==='stakeholder'){
 delete cases.fashion;const c=stakeholderCases.strategy;cases.strategy={...structuredClone(fixtures.business),title:c.title,hero:{headline:'Make the choices that matter',subheadline:c.facts[0],actionLabel:'Explore the approach'},contact:{email:'',phone:'',address:''},cta:{heading:'Choose a clear next step',text:c.facts[4],actionLabel:'Review the approach'},sections:[{type:'about',heading:'Start with a clear objective',navLabel:'Purpose',content:c.facts[0],items:[]},{type:'features',heading:'Make assumptions explicit',navLabel:'Priorities',content:c.facts[1],items:[{title:'Priorities',description:c.facts[2],detail:'',url:''},{title:'Execution',description:c.facts[3],detail:'',url:''}]},{type:'process',heading:'Review and adapt',navLabel:'Review',content:c.facts[4],items:[{title:'Frame the question',description:'State the objective and constraints.',detail:'',url:''},{title:'Review evidence',description:'Identify assumptions and alternatives.',detail:'',url:''},{title:'Choose a next step',description:'Make responsibilities and feedback clear.',detail:'',url:''}]}]};
}
const reports=[];let browser,server;
try{
 for(const [name,fixture] of Object.entries(cases)){
  const started=performance.now(),context=name==='fashion'?{designPreferences:{paletteId:'plum-ivory',fontPair:'editorial'}}:{};
  const input={outputType:'webpage',...fixturePlan(fixture),...fixtureDraft(fixture)};input.inferredContext.topic=name==='property'?'Luxury real estate':name==='ai'?'Artificial intelligence':fixture.title;
  if(name==='property')input.designBrief={industry:'real-estate',audience:'Homebuyers',conversionGoal:'Explore',visualTone:'luxurious',imageDirection:'Contemporary residential interiors',density:'comfortable',heroComposition:'full-bleed'};
  let page=webpageThemeService(webpageLayoutService(input,context),context);let assets={};
  if(['media','stakeholder'].includes(phase)){const resolved=await acquireWebsiteImages(page,context,{external:false,logger:()=>{},relevanceLogger:()=>{}});page=resolved.page;assets=resolved.assets;}
  const files=webpageRenderer(page,assets),directory=path.join(root,name);await fs.mkdir(directory,{recursive:true});
  for(const [file,bytes] of Object.entries(files)){const destination=path.join(directory,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);}
  validateStaticWebsite(files);reports.push({name,palette:page.theme.paletteId,hero:page.designBrief.heroComposition,heroAsset:!!page.visualAssets?.hero,assetCount:Object.keys(assets).length,compositions:page.sections.map(s=>s.composition),renderMs:performance.now()-started,checks:[]});
 }
 if(phase==='before'){await fs.writeFile(path.join(root,'report.json'),JSON.stringify(reports,null,2));console.log('Saved six baseline sites.');}
 else assert.ok(new Set(reports.map(r=>r.palette)).size>=4,'Topic palettes must vary');
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const app=express();app.use(express.static(root));server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});const base=`http://127.0.0.1:${server.address().port}`;
 for(const report of reports)for(const width of [1440,1024,768,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  await page.goto(`${base}/${report.name}/index.html`);await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>{image.loading='eager';return image.decode().catch(()=>{});})));const check=await checkWebsiteBrowser(page);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).options({preload:false}).analyze();
  const violations=axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));
  await page.screenshot({path:path.join(root,report.name,`${width}.png`),fullPage:true});report.checks.push({width,...check,violations});await context.close();
 }
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify(reports,null,2));
 if(phase!=='before')assert.ok(reports.every(r=>r.checks.every(c=>!c.failures.length&&!c.violations.length)),JSON.stringify(reports.flatMap(r=>r.checks.filter(c=>c.failures.length||c.violations.length).map(c=>({name:r.name,...c})))));
 console.log(JSON.stringify({phase,sites:reports.length,viewports:reports.reduce((n,r)=>n+r.checks.length,0),failures:reports.flatMap(r=>r.checks).filter(c=>c.failures.length||c.violations.length).length}));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
