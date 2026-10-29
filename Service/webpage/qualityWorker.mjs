import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {checkWebsiteBrowser} from './browserChecks.mjs';
process.once('message',async({directory,pages})=>{
    let browser,server;
    try{
        const {chromium}=await import('playwright');
        const {default:AxeBuilder}=await import('@axe-core/playwright');
        browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'}:{}),timeout:12000});
        const app=express();app.use(express.static(path.join(directory,'site')));
        server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
        const base=`http://127.0.0.1:${server.address().port}`,failures=[],checks=[];
        for(const file of pages)for(const width of [320,390,768,1024,1440]){
            const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
            await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
            page.on('pageerror',()=>failures.push({code:'script-error',file,width}));
            await page.goto(base+'/'+file,{timeout:8000});await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>{image.loading='eager';return Promise.race([image.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);})));
            const result=await page.evaluate(()=>{
                const failures=[];
                if(document.documentElement.scrollWidth>innerWidth+1)failures.push({code:'overflow'});
                for(const image of document.images)if(!image.complete||!image.naturalWidth)failures.push({code:'broken-image'});
                for(const node of document.querySelectorAll('h1,h2,h3,p'))if(node.scrollHeight>node.clientHeight+2&&['hidden','clip'].includes(getComputedStyle(node).overflowY))failures.push({code:'clipped'});
                for(const section of document.querySelectorAll('main>section'))if(section.getBoundingClientRect().height>900&&section.textContent.trim().length<140&&!section.querySelector('img'))failures.push({code:'empty-region'});
                const nodes=[...document.querySelectorAll('.hero h1,.hero-description,.hero-actions,.header .brand,.header .nav a,.menu-toggle')].filter(node=>node.getClientRects().length);
                for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i].getBoundingClientRect(),b=nodes[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)failures.push({code:'overlap'});}
                return {failures,images:document.images.length};
            });
            failures.push(...result.failures.map(failure=>({...failure,file,width})));checks.push({file,width,images:result.images});
            const interactions=await checkWebsiteBrowser(page);failures.push(...interactions.failures.map(failure=>({...failure,file,width})));
            if(width!==768){const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).options({preload:false}).analyze();for(const violation of accessibility.violations)failures.push({code:violation.id==='color-contrast'?'contrast':'accessibility',rule:violation.id,file,width});}
            await page.screenshot({path:path.join(directory,file.replace('.html','')+'-'+width+'.png'),fullPage:true});await context.close();
        }
        await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({checks,failures},null,2));process.send({checks,failures});
    }catch{process.send({error:'Browser QA unavailable'});}
    finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
});
