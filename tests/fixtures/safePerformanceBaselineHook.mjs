// Test-only control: serve exact pre-optimization module bytes without editing
// the checkout. Relative imports still resolve from each module's original URL.
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve('generated/safe-performance-2026-10-29/snapshot');
const targets=new Map(['Service/webpage/imageOptimization.mjs','Service/document/documentPdfService.mjs','Service/performance.mjs'].map(file=>[pathToFileURL(path.resolve(file)).href,path.join(root,file)]));
registerHooks({load(url,context,nextLoad){
 if(targets.has(url))return {format:'module',source:readFileSync(targets.get(url),'utf8'),shortCircuit:true};
 return nextLoad(url,context);
}});
