import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutNumericFacts,fallbackFactLedger,missingFallbackFacts} from '../../Service/ai/numericFacts.mjs';
import {fieldRepairPlan,preservesLayoutMeaning} from '../../Service/ai/fieldRepair.mjs';
import {aiService} from '../../Service/aiService.mjs';
import {failingFixture} from '../fixtures/slideFallback.mjs';
import {hypertensionPrompt} from '../fixtures/hypertensionRecovery.mjs';

test('29a94238: the old raw-JSON guard protects structural IDs and misreads goals as grams',()=>{
 const legacy=value=>[...value.matchAll(/\b\d+(?:\.\d+)?\s*(?:%|mmHg|mg|kg|g|mL|ml|L|cm|mm|km|Hz|kW|MW|°C)?/g)].map(m=>m[0].replace(/\s+/g,''));
 assert.deepEqual(legacy(JSON.stringify({id:'phase-1',label:'2030 goals'})),['1','2030g']);
 const ledger=fallbackFactLedger({roadmap:{phases:[{id:'phase-1',label:'Phase 1',title:'2030 goals',description:'Review evidence.'}]}});
 assert.deepEqual(ledger.map(f=>f.value),['2030']);assert.equal(missingFallbackFacts(ledger,{textContent:{body:'Review evidence by 2030.'}}).length,0);
});

test('visible facts exclude IDs, phase ordinals, visual instructions and numeric endpoint IDs',()=>{
 const content={roadmap:{phases:[{id:'p-4',label:'1',title:'Prepare',description:'Prepare carefully.'},{id:'p-7',label:'2',title:'2035',description:'Use 25 mmHg as the supplied example.'}]},visualContent:{text:'An example.',visual:{description:'Use 8 assets',searchQuery:'1000 pixels',diagram:{kind:'labeled',nodes:[{id:'node-99',label:'Source',description:'Observe carefully.'},{id:'node-100',label:'Target',description:'Compare carefully.'}],edges:[{from:'node-99',to:'node-100',label:'informs'}],caption:'Simplified model.'}}}};
 const values=fallbackFactLedger(content).map(f=>f.value);assert.deepEqual(values,['2035','25mmHg']);
});

test('equivalent formatting is accepted while changes of value, sign and units remain rejected',()=>{
 assert.deepEqual(layoutNumericFacts('2030 goals, 2040 growth and 2050 milestones.'),['2030','2040','2050']);
 assert.deepEqual(layoutNumericFacts('25.00 mm Hg; +001,000.0 kilograms; 10 per cent; −5 milligrams.'),['25mmHg','1000kg','10%','-5mg']);
 assert.equal(preservesLayoutMeaning('25.0 mm Hg','25 mmHg'),true);assert.equal(preservesLayoutMeaning('25 mg','25 kg'),false);assert.equal(preservesLayoutMeaning('-5 mg','5 mg'),false);
 const ledger=fallbackFactLedger({textContent:{body:'Use 25 mmHg and 10% in the supplied example.'}});assert.equal(missingFallbackFacts(ledger,{textContent:{body:'Use 25 millimeters of mercury and 10 percent in the supplied example.'}}).length,0);
});

test('a roadmap date remains protected and only specific factual feedback can authorize its removal',()=>{
 const content={roadmap:{phases:[{label:'2030',title:'Proposed milestone',description:'A possible transition.'}]}};
 const ledger=fallbackFactLedger(content);assert.equal(ledger[0].value,'2030');assert.equal(missingFallbackFacts(ledger,{textContent:{body:'A possible transition.'}}).length,1);
 assert.equal(fallbackFactLedger(content,[{code:'CLARITY',message:'The 2030 plan needs clarification.',repairInstruction:'Explain the scope.'}]).length,1);
 assert.equal(fallbackFactLedger(content,[{code:'FACTUAL',message:'The asserted 2030 deadline is unsupported.',repairInstruction:'Remove the unsupported deadline; the source gives no deadline.'}]).length,0);
});

test('the existing field repair can restore a required fact without admitting unrelated numbers',()=>{
 const draft={textContent:{heading:'Preserved heading',body:'Review the proposed transition.'}},error={field:'textContent.body',maxCharacters:200,requiredFacts:['2030'],repairHint:'The source labels the proposed transition as 2030.'};
 const plan=fieldRepairPlan(JSON.stringify(draft),error);assert.match(plan.prompt,/2030/);
 const assessment=plan.assess({value:'Review the proposed transition in 2030.'});assert.equal(assessment.errors.length,0);assert.equal(JSON.parse(plan.apply(assessment.accepted)).textContent.heading,'Preserved heading');
 assert.equal(plan.assess({value:'Review it in 2040.'}).errors.length,1);assert.equal(plan.assess({value:'Review the proposed transition.'}).errors.length,1);
});

test('a source-authorized fact repair can correct a wrong fallback unit without weakening ordinary unit protection',()=>{
 const draft={textContent:{heading:'Preserve this heading',body:'The supplied example may use 25 mg.'}};
 const plan=fieldRepairPlan(JSON.stringify(draft),{field:'textContent.body',maxCharacters:160,requiredFacts:['25mmHg'],approvedFacts:['25mmHg'],repairHint:'The supplied source says 25 mmHg, not 25 mg.'});
 const fixed=plan.assess({value:'The supplied example may use 25 mm Hg.'});assert.equal(fixed.errors.length,0);assert.equal(JSON.parse(plan.apply(fixed.accepted)).textContent.heading,draft.textContent.heading);
 assert.equal(plan.assess({value:'The supplied example may use 250 mmHg.'}).errors.length,1);assert.equal(plan.assess({value:'The supplied example may use 25 mg.'}).errors.length,1);assert.equal(preservesLayoutMeaning('25 mg','25 mmHg'),false);
});

test('short historical years and timeline labels are not mistaken for phase numbering',()=>{
 const ledger=fallbackFactLedger({timeline:{events:[{label:'1',title:'A historical year',description:'The first documented event.'},{label:'2',title:'Another year',description:'A subsequent event.'}]}});
 assert.deepEqual(ledger.map(f=>f.value),['1','2']);
});

test('the fallback receives an explicit ledger, then a single body-only repair can restore an omission',async()=>{
 const f=failingFixture([8],false,'Review the supplied pressure example.','Review the supplied pressure example: 25 mm Hg.');
 f.deck.slides[7].content.visualContent.text+=' Supplied value: 25.0 mmHg.';f.deck.slides[7].content.visualContent.visual.diagram.nodes[0].id='node-817'; // topology remains invalid; the ID is not a fact
 const logs=[];const result=await aiService('prompt',hypertensionPrompt+' Supplied example: 25 mmHg.','presentation',f.context,{client:f.mock.client,logger:e=>logs.push(e),qualityLogger:()=>{},layoutLogger:()=>{},sleep:async()=>{}});
 assert.equal(f.fallbacks.length,1);assert.equal(result.generatedContent.slides[7].content.textContent.heading,'Related factors');assert.match(result.generatedContent.slides[7].content.textContent.body,/25 mm Hg/);
 const attempts=logs.filter(e=>e.stage==='slide-fallback-generation');assert.equal(attempts.length,2);assert.equal(attempts[0].factPreservation.missingCount,1);assert.ok(attempts[0].factPreservation.missing.every(f=>f.valueHash&&!('value' in f)));assert.deepEqual(attempts[1].repairFields,['textContent.body']);assert.equal(attempts[1].status,'completed');
 const wire=JSON.stringify(f.mock.calls);assert.match(wire,/Protected facts to retain explicitly/);assert.match(wire,/Required values\/units/);assert.ok(!attempts[0].factPreservation.missing.some(f=>f.fields.some(p=>p.endsWith('.id'))));
});

test('an omission that survives the bounded patch remains a controlled failure',async()=>{
 const f=failingFixture([8],false,'Review the supplied example.','The example remains incomplete.');f.deck.slides[7].content.visualContent.text+=' Supplied value: 25 mmHg.';const logs=[];
 await assert.rejects(aiService('prompt',hypertensionPrompt+' Supplied example: 25 mmHg.','presentation',f.context,{client:f.mock.client,logger:e=>logs.push(e),qualityLogger:()=>{},layoutLogger:()=>{},sleep:async()=>{}}),e=>e.stage==='slide-fallback-generation'&&e.validationRule==='FALLBACK_FACT_PRESERVATION');assert.equal(logs.filter(e=>e.stage==='slide-fallback-generation').length,2);assert.equal(f.fallbacks.length,1);
});
