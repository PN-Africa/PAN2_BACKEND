import {layoutContentSchema} from '../../Service/ai/presentationLayoutBudget.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {imageSlideSchema,contentBudgetPrompt} from '../../Service/ai/presentationContentBudget.mjs';
import {diagramSchema} from '../../templates/presentation/visualSchemas.mjs';
import {validateRenderContent,validatePlannedRenderContent} from '../../renderer/presentation/professionalLayouts.mjs';
import {presentationLayoutService} from '../../Service/presentationLayoutService.mjs';
import {publicGenerationResult} from '../../Service/publicGenerationResult.mjs';
import {photoCompositionFor} from '../../Service/visual/imageArtDirection.mjs';

const schema={type:'object',properties:{visualContent:{type:'object',properties:{text:{type:'string'},visual:{type:'object',properties:{diagram:diagramSchema}}}}}};
test('photo-diagram constraints reach the provider before any retry and do not mutate shared schemas',()=>{
    const bounded=layoutContentSchema(imageSlideSchema(schema),{slideNumber:2,slideType:'text-visual',title:'Mission systems',imageLayoutPlanned:true}),v=bounded.properties.visualContent.properties;
    assert.equal(v.text.maxLength,120);
    assert.equal(v.visual.properties.diagram.properties.nodes.maxItems,4);
    assert.ok(v.visual.properties.diagram.properties.nodes.items.properties.label.maxLength>=12);assert.ok(v.visual.properties.diagram.properties.nodes.items.properties.label.maxLength<=54);
    assert.match(contentBudgetPrompt(bounded),/visualContent.text: at most 120 characters/);
    assert.ok(v.visual.properties.diagram.properties.nodes.items.properties.description.maxLength>=33);assert.match(contentBudgetPrompt(bounded),/nodes\[\].description: Layout target: aim for about 40 characters/);
    assert.equal(schema.properties.visualContent.properties.text.maxLength,undefined);
    assert.equal(diagramSchema.properties.nodes.maxItems,8);
});
test('a four-node space diagram and explanatory prose fit the actual image composition together',()=>{
    const slide={slideNumber:5,slideType:'text-visual',title:'From orbit to Mars',subtitle:'Complementary mission systems',content:{visualContent:{
        text:'Mission systems combine propulsion, navigation, life support and radiation protection for sustained exploration.',
        visual:{type:'diagram',description:'Simplified mission systems',searchQuery:'Mars mission systems',diagram:{kind:'flowchart',nodes:[
            {id:'a',label:'Propulsion',description:'Moves the spacecraft'},
            {id:'b',label:'Navigation',description:'Tracks position and trajectory'},
            {id:'c',label:'Life support',description:'Maintains habitable conditions'},
            {id:'d',label:'Protection',description:'Reduces radiation exposure'}
        ],edges:[{from:'a',to:'b',label:'Coordinates'},{from:'a',to:'c',label:'Supports'},{from:'a',to:'d',label:'Complements'}],caption:'Simplified overview'}}}}};
    assert.equal(photoCompositionFor(slide),'photo-technical');
    assert.equal(validateRenderContent({...slide,photoAsset:{data:'dry-layout-only'},photoComposition:photoCompositionFor(slide)}),true);
    assert.equal(validatePlannedRenderContent({...slide,imageLayoutPlanned:true}),true);
    const selected=presentationLayoutService({title:'Mission systems',slides:[{...slide,imageLayoutPlanned:true}]});
    assert.ok(selected.slides[0].layoutId);
    assert.equal(selected.slides[0].photoAsset,undefined,'Dry-run markers must never become saved assets');
    assert.equal(publicGenerationResult(selected).slides[0].imageLayoutPlanned,undefined);
});
