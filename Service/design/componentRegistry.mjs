import {presentationLayouts} from '../../templates/presentation/presentationLayouts.mjs';
// Capability contracts, not topic-to-template assignments. AI chooses IDs;
// the compiler checks the actual content with the existing native renderer.
const entries=[...presentationLayouts.map(layout=>({id:layout.id,artifactType:'presentation',supports:layout.slideTypes,geometry:{width:13.333333,height:7.5,margin:.72},minBodyPt:18,spacing:'renderer-managed',assets:'optional except required cover',renderer:'native-pptx',validation:'content-fit and geometry'})),
 ...['editorial','grid','bento','showcase','timeline','list','image-text','image-band'].map(id=>({id,artifactType:'webpage',supports:['section'],geometry:{responsive:true},minBodyPt:12,spacing:'responsive',assets:/image/.test(id)?'image':'optional',renderer:'trusted-html-components',validation:'static and responsive browser checks'})),
 ...['prose','reference','report'].map(id=>({id,artifactType:'document',supports:['section'],geometry:{paginated:true},minBodyPt:10,spacing:'document-style',assets:'optional',renderer:'native-docx',validation:'block schema and package checks'}))];
export const componentRegistry=Object.freeze(entries.map(entry=>Object.freeze({...entry,supports:Object.freeze([...entry.supports]),geometry:Object.freeze(entry.geometry)})));
export const componentsFor=type=>componentRegistry.filter(component=>component.artifactType===type);
export const componentById=(type,id)=>componentRegistry.find(component=>component.artifactType===type&&component.id===id);
export function componentCatalog(type){return componentsFor(type).map(({id,supports,assets})=>({id,supports,assets}));}
