// Visible copy must be constrained before generation, not discovered one field
// at a time by the renderer after a paid request. Clone per slide: the original
// schema is shared by parallel generation calls.
import {textCharacterBudget} from '../../renderer/presentation/contentFit.mjs';
import {PHOTO_TECHNICAL_TEXT_BOX} from '../../renderer/presentation/photoCompositions.mjs';
export function imageSlideSchema(schema,{recoveryText=false}={}) {
    // Schemas reuse the same string-node object for unrelated fields. JSON
    // cloning deliberately breaks those aliases as well as copying the schema.
    const result=JSON.parse(JSON.stringify(schema));
    const limits={
        'titleContent.supportingText':45,
        'textContent.heading':38,'textContent.body':recoveryText?textCharacterBudget(PHOTO_TECHNICAL_TEXT_BOX):280,
        'visualContent.text':120,
        'visualContent.visual.diagram.nodes':4,
        'visualContent.visual.diagram.edges':4,
        'relationship.nodes':4,
        'relationship.relationships':4,
        'comparison.items':3,'comparison.items.label':28,
        'comparison.items.points':3,'comparison.items.points.*':38,
        'items':4,'items.title':28,'items.description':50,
        'cards':4,'cards.title':28,'cards.description':50,
        'process.steps':4,'process.steps.title':24,'process.steps.description':48,
        'timeline.events':4,'timeline.events.label':12,
        'timeline.events.title':26,'timeline.events.description':50,
        'summary.statement':65,'summary.points':4,'summary.points.*':48,
        'chart.insight':80
    };
    for(const [path,maximum] of Object.entries(limits)){
        let node=result;
        for(const key of path.split('.')){
            if(!node)break;
            if(String(node.type).toLowerCase()==='array')node=node.items;
            node=key==='*'?node:node.properties?.[key];
        }
        if(!node)continue;
        const attribute=String(node.type).toLowerCase()==='array'?'maxItems':'maxLength';
        node[attribute]=Math.min(node[attribute]??maximum,maximum);
    }
    return result;
}

export function contentBudgetPrompt(schema){
    const limits=[];
    function visit(node,path){
        if(node.maxLength!==undefined)limits.push(`${path}: at most ${node.maxLength} characters`);
        if(node.description?.startsWith('Layout target:'))limits.push(`${path}: ${node.description}`);
        if(node.maxItems!==undefined)limits.push(`${path}: at most ${node.maxItems} items`);
        for(const [key,child] of Object.entries(node.properties||{}))visit(child,path?`${path}.${key}`:key);
        if(node.items)visit(node.items,`${path}[]`);
    }
    visit(schema,'');
    return `\nLayout-specific limits override generic word-count guidance. Fit every field on the FIRST attempt. Preserve accuracy; express detail in complementary diagram labels rather than duplicating it in prose. Never truncate terms or invent facts.${schema.properties?.table?' Tables: use short column labels and terse factual cell phrases, ideally under 24 characters. If exact terminology or necessary detail needs more space, use fewer columns and rows rather than abbreviating scientific terms or omitting facts. Tables are rendered with readable type, not paragraph-sized cells.':''}\n${limits.join('\n')}`;
}
