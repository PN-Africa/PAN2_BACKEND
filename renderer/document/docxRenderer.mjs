import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle,
    Header, Footer, PageNumber, AlignmentType, PageOrientation, SectionType, ImageRun, ExternalHyperlink, LevelFormat,LineRuleType } from 'docx';
import JSZip from 'jszip';
import { load } from 'cheerio';
import { loadImage } from '@napi-rs/canvas';
import { imageDimensions } from '../../Service/visual/presentationVisuals.mjs';
import { blockText } from '../../Service/document/documentValidation.mjs';

const fonts=['Aptos','Calibri','Arial','Cambria','Georgia','Times New Roman'];
const crcTable=Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function pngCrc(buffer) {let crc=0xffffffff;for(const byte of buffer)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function validPngChunks(data) {
    let offset=8,header=false,pixels=false;
    while(offset+12<=data.length) {
        const length=data.readUInt32BE(offset),end=offset+12+length;
        if(end>data.length)return false;
        const type=data.toString('ascii',offset+4,offset+8);
        if(!header&&(type!=='IHDR'||length!==13))return false;
        if(pngCrc(data.subarray(offset+4,offset+8+length))!==data.readUInt32BE(offset+8+length))return false;
        header=true;if(type==='IDAT')pixels=true;
        if(type==='IEND')return length===0&&pixels&&end===data.length;
        offset=end;
    }
    return false;
}
export function documentStyle(document,context={}) {
    const format=context.documentFormatting||{};
    const academic=/academic|research|essay/i.test(document.documentType),simple=/letter|resume/i.test(document.documentType);
    const long=document.length?.requestedPages>=8;
    const instructions=context.instructions||'';
    const recommended=process.env.LEDIFY_DESIGN_ENGINE==='legacy'?undefined:{humanist:'Calibri',editorial:'Georgia',technical:'Arial',classical:'Times New Roman',geometric:'Arial'}[document.artifactDesign?.theme.fontPair];
    const font=format.fontFamily||fonts.find(font=>instructions.toLowerCase().includes(font.toLowerCase()))||recommended||(academic?'Times New Roman':'Calibri');
    const size=format.fontSize??Number(instructions.match(/\b(1[0-6])[- ](?:pt|point)\b/i)?.[1]||(academic?12:11)),lineSpacing=format.lineSpacing??(/double[- ]spac/i.test(instructions)?2:/single[- ]spac/i.test(instructions)?1:long?1:document.artifactDesign&&process.env.LEDIFY_DESIGN_ENGINE!=='legacy'?({compact:1.15,balanced:1.35,spacious:1.5}[document.artifactDesign.theme.spacing]):academic?1.35:1.15),margin=format.marginInches??(long?.75:1);
    if(!fonts.includes(font)||!Number.isFinite(size)||size<10||size>16||!Number.isFinite(lineSpacing)||lineSpacing<1||lineSpacing>2.5||!Number.isFinite(margin)||margin<0.5||margin>1.5||!['A4','Letter'].includes(format.paperSize||'A4')) throw Object.assign(new Error('Unsupported document formatting. Choose a supported font, 10–16 pt, 1–2.5 line spacing, 0.5–1.5 inch margins, and A4 or Letter.'),{code:'INVALID_DOCUMENT_FORMATTING'});
    const explicitCover=/\b(?:include|with|add|separate) (?:a |an )?(?:cover|title) page\b/i.test(instructions);
    const cover=(format.coverPage??(document.coverPage&&(!long||explicitCover)))&&!simple;
    if(format.coverPage!=null&&typeof format.coverPage!=='boolean')throw Object.assign(new Error('coverPage must be a boolean.'),{code:'INVALID_DOCUMENT_FORMATTING'});
    return {font,size,lineSpacing,margin:Math.round(margin*1440),paper:format.paperSize||(/\bLetter (?:paper|size)\b/i.test(instructions)?'Letter':'A4'),simple,long,cover};
}
function imageAsset(asset) {
    if(!asset||typeof asset.base64!=='string'||asset.base64.length>16*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(asset.base64)) throw Object.assign(new Error('Invalid authorized document image.'),{code:'INVALID_DOCUMENT_IMAGE'});
    const data=Buffer.from(asset.base64,'base64'),dimensions=imageDimensions(data);
    if(!dimensions||dimensions.width>8192||dimensions.height>8192||dimensions.width*dimensions.height>32000000) throw Object.assign(new Error('Document image exceeds safe dimensions.'),{code:'INVALID_DOCUMENT_IMAGE'});
    const type=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':data[0]===255&&data[1]===216?'jpg':null;
    if(!type) throw Object.assign(new Error('Document images must be PNG or JPEG.'),{code:'INVALID_DOCUMENT_IMAGE'});
    if(type==='png'&&!validPngChunks(data)||type==='jpg'&&(data.at(-2)!==255||data.at(-1)!==217))throw Object.assign(new Error('Document image is truncated or has invalid content checksums.'),{code:'INVALID_DOCUMENT_IMAGE'});
    return {data,type,...dimensions};
}
export async function validateDocumentAssets(assets=[]) {
    if(!Array.isArray(assets)||assets.length>10) throw Object.assign(new Error('Supply no more than ten authorized document images.'),{code:'INVALID_DOCUMENT_IMAGE'});
    const ids=new Set();
    for(const asset of assets){
        if(!/^[a-zA-Z0-9_-]{1,60}$/.test(asset.id)||ids.has(asset.id)||!asset.alt?.trim()) throw Object.assign(new Error('Images need unique IDs and meaningful alternative text.'),{code:'INVALID_DOCUMENT_IMAGE'});
        ids.add(asset.id);const image=imageAsset(asset);
        let timer;
        try{const decoded=await Promise.race([loadImage(image.data),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Image decode timed out')),5000);})]);if(decoded.width!==image.width||decoded.height!==image.height)throw new Error('Image dimensions do not match');}
        catch{throw Object.assign(new Error('Unable to decode the authorized PNG or JPEG image.'),{code:'INVALID_DOCUMENT_IMAGE'});}
        finally{clearTimeout(timer);}
    }
    return assets;
}
export async function renderDocumentDocx(document,context={}) {
    const style=documentStyle(document,context),assets=await validateDocumentAssets(document.assets||[]),references=document.references||[];
    const pageSize=orientation=>({width:style.paper==='Letter'?12240:11906,height:style.paper==='Letter'?15840:16838,orientation:orientation==='landscape'?PageOrientation.LANDSCAPE:PageOrientation.PORTRAIT});
    // Explicit automatic line units are essential for wrapped 24 pt titles.
    // Without lineRule, Writer can interpret the inherited 276 as fixed twips.
    const bodySpacing={after:style.long?100:160,line:Math.round(style.lineSpacing*240),lineRule:LineRuleType.AUTO};
    const text=(value,options={})=>new TextRun({text:value,...options});
    let component='prose';
    const para=(value,options={})=>new Paragraph({children:String(value).split(/\r?\n/).flatMap((line,i)=>[...(i?[new TextRun({break:1})]:[]),text(line)]),widowControl:true,spacing:{...bodySpacing,...(component==='reference'?{after:100}:component==='report'?{after:220}:{})},...options});
    const heading=(value,level=1)=>para(value,{heading:[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3][level-1],keepNext:true});
    const caption=value=>para(value,{style:'Caption',keepNext:false});
    const header=new Header({children:[para(document.title,{style:'Header',spacing:{after:0}})]});
    const footer=new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[text('Page '),new TextRun({children:[PageNumber.CURRENT]})],style:'Footer'})]});
    const sections=[];let children=[],orientation='portrait';let listIndex=0;const numbering=[];
    const flush=()=>{if(children.length)sections.push({properties:{type:SectionType.NEXT_PAGE,page:{size:pageSize(orientation),margin:{top:style.margin,bottom:style.margin,left:style.margin,right:style.margin,header:500,footer:500}}},...(!style.simple?{headers:{default:header},footers:{default:footer}}:{}),children});children=[];};
    children.push(para(document.title,{heading:HeadingLevel.TITLE}));
    if(document.subtitle&&!/letter/i.test(document.documentType)) children.push(para(document.subtitle,{style:'Subtitle'}));
    if(typeof context.author==='string'&&context.author.trim()) children.push(para(context.author));
    if(style.cover) { // Separate cover section keeps its footer empty without hiding page numbers on body pages.
        sections.push({properties:{page:{size:pageSize('portrait'),margin:{top:style.margin,bottom:style.margin,left:style.margin,right:style.margin}}},children});children=[];
    }
    for(const section of document.sections) {
        component=section.designComponent||'prose';
        if(!/letter/i.test(document.documentType))children.push(heading(section.heading));
        for(const block of section.blocks) {
            const citations=(block.referenceIds||[]).map(id=>references.findIndex(ref=>ref.id===id)+1).filter(n=>n>0);
            const suffix=citations.length?' '+citations.map(n=>references[n-1].citationText||`[${n}]`).join(' '):'';
            switch(block.type) {
                case 'paragraph':children.push(para(block.text+suffix));break;
                case 'heading':children.push(heading(block.text,block.level));break;
                case 'caption':children.push(caption(block.text));break;
                case 'quote':children.push(para('“'+block.text+'”'+suffix,{indent:{left:360,right:360},style:'Quote'}));break;
                case 'code':children.push(para(block.text,{style:'Code',spacing:{before:120,after:180,line:240}}));break;
                case 'list': {
                    const reference=`list-${++listIndex}`;
                    numbering.push({reference,levels:[{level:0,format:block.ordered?LevelFormat.DECIMAL:LevelFormat.BULLET,text:block.ordered?'%1.':'•',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:360,hanging:240}}}}]});
                    block.items.forEach((item,i)=>children.push(para(item+(i===block.items.length-1?suffix:''),{numbering:{reference,level:0}})));break;
                }
                case 'table': {
                    if(block.caption)children.push(para(block.caption,{style:'Caption',keepNext:true}));
                    const available=(orientation==='landscape'?pageSize('portrait').height:pageSize('portrait').width)-2*style.margin;
                    const weights=block.columns.map((column,i)=>{
                        const values=[column,...block.rows.map(row=>row.cells[i])];
                        const longestWord=Math.max(...values.flatMap(value=>value.split(/\s+/).map(word=>word.length)));
                        return Math.max(12,Math.min(35,Math.max(...values.map(value=>value.length))),Math.min(35,longestWord*1.2+4));
                    });
                    const widths=weights.map(weight=>Math.floor(available*weight/weights.reduce((a,b)=>a+b,0)));
                    const border={style:BorderStyle.SINGLE,size:4,color:'D9D9D9'};
                    const compact=block.rows.length<=5&&block.rows.flatMap(row=>row.cells).join(' ').split(/\s+/).length<(style.long?80:140);
                    const row=(cells,index)=>new TableRow({tableHeader:index===0,cantSplit:true,children:cells.map((cell,i)=>new TableCell({width:{size:widths[i],type:WidthType.DXA},margins:{top:110,bottom:110,left:120,right:120},verticalAlign:'center',shading:{fill:index===0?'E6EDF2':index%2?'FFFFFF':'F4F7F9'},children:[para(cell,{keepNext:index===0||(compact&&index<block.rows.length),spacing:{after:0,line:260},children:[text(cell,{bold:index===0,size:20})],alignment:/^[-\d\s.,%$₦]+$/.test(cell)?AlignmentType.CENTER:AlignmentType.LEFT})]}))});
                    children.push(new Table({width:{size:available,type:WidthType.DXA},columnWidths:widths,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:[row(block.columns,0),...block.rows.map((value,i)=>row(value.cells,i+1))]}));children.push(para(suffix,{spacing:{after:160}}));break;
                }
                case 'image': {
                    const asset=assets.find(asset=>asset.id===block.assetId),image=imageAsset(asset);
                    const available=((orientation==='landscape'?pageSize('portrait').height:pageSize('portrait').width)-2*style.margin)/15;
                    const scale=Math.min(available/image.width,420/image.height,1);
                    children.push(new Paragraph({alignment:AlignmentType.CENTER,keepNext:!!block.caption,children:[new ImageRun({data:image.data,type:image.type,transformation:{width:Math.round(image.width*scale),height:Math.round(image.height*scale)},altText:{title:asset.alt,description:asset.alt,name:asset.id}})]}));
                    if(block.caption)children.push(caption(block.caption+suffix));
                    if(asset.attribution)children.push(caption(asset.attribution));break;
                }
                case 'pageBreak':children.push(new Paragraph({pageBreakBefore:true}));break;
                case 'sectionBreak':flush();orientation=block.orientation;break;
                default:throw Object.assign(new Error('Unsupported document content block.'),{code:'DOCUMENT_RENDER_FAILED'});
            }
        }
    }
    if(references.length) {
        children.push(heading('References'));
        const authorStyle=/^(APA|MLA|Chicago|Harvard)(?:\s*\d+)?$/i.test(document.citationStyle||'');
        const ordered=references.map((ref,i)=>({ref,index:i+1}));
        if(authorStyle&&references.every(ref=>ref.formattedText&&ref.citationText))ordered.sort((a,b)=>a.ref.formattedText.localeCompare(b.ref.formattedText));
        for(const {ref,index} of ordered) {
            const numbered=!(authorStyle&&ref.formattedText&&ref.citationText),entry=ref.formattedText||ref.title;
            const start=entry.indexOf(ref.url),before=start<0?entry+' ':entry.slice(0,start),after=start<0?'':entry.slice(start+ref.url.length);
            children.push(new Paragraph({spacing:bodySpacing,indent:{left:numbered?360:720,hanging:numbered?360:720},children:[text((numbered?`[${index}] `:'')+before),new ExternalHyperlink({link:ref.url,children:[text(ref.url,{style:'Hyperlink'})]}),text(after)]}));
        }
    }
    flush();
    const black={color:process.env.LEDIFY_DESIGN_ENGINE!=='legacy'&&document.artifactDesign?document.artifactDesign.theme.colors.text.slice(1):'000000'};
    const doc=new Document({creator:typeof context.author==='string'?context.author:'Ledify',title:document.title,description:document.purpose||'',styles:{default:{document:{run:{font:style.font,size:style.size*2,...black},paragraph:{spacing:bodySpacing,widowControl:true}},title:{run:{font:style.font,size:/letter/i.test(document.documentType)?24:48,bold:true,...black},paragraph:{spacing:{before:0,after:200},keepNext:true}},heading1:{run:{font:style.font,size:32,bold:true,...black},paragraph:{spacing:{before:260,after:120},keepNext:true}},heading2:{run:{font:style.font,size:26,bold:true,...black},paragraph:{spacing:{before:200,after:100},keepNext:true}},heading3:{run:{font:style.font,size:24,bold:true,...black},paragraph:{spacing:{before:160,after:80},keepNext:true}}},paragraphStyles:[{id:'Subtitle',name:'Subtitle',basedOn:'Normal',run:{size:26,...black},paragraph:{spacing:{after:200}}},{id:'Caption',name:'Caption',basedOn:'Normal',run:{size:19,...black},paragraph:{spacing:{before:80,after:140}}},{id:'Code',name:'Code',basedOn:'Normal',run:{font:'Courier New',size:19,...black}},{id:'Header',name:'Header',basedOn:'Normal',run:{size:18,...black}},{id:'Footer',name:'Footer',basedOn:'Normal',run:{size:18,...black}},{id:'Quote',name:'Quote',basedOn:'Normal',run:{italics:true}}]},numbering:{config:numbering},sections});
    return Packer.toBuffer(doc);
}
export async function validateDocxArtifact(buffer,document) {
    try {
        const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
        for(const part of ['[Content_Types].xml','_rels/.rels','word/document.xml','word/styles.xml'])if(!zip.file(part))throw new Error('Missing required package part');
        const xml=load(await zip.file('word/document.xml').async('string'),{xml:true});
        const paragraphs=xml('w\\:p').toArray().map(el=>xml(el).find('w\\:t,w\\:br').toArray().map(t=>t.name==='w:br'?'\n':xml(t).text()).join(''));
        const joined=paragraphs.join('\n');
        for(const text of [document.title,...(/letter/i.test(document.documentType)?[]:[document.subtitle]),...document.sections.flatMap(section=>[...(/letter/i.test(document.documentType)?[]:[section.heading]),...section.blocks.flatMap(block=>[block.text,...(block.items||[]),...(block.columns||[]),...(block.rows||[]).flatMap(row=>row.cells),block.caption])])].filter(Boolean)) if(!joined.includes(text))throw new Error('Essential text missing from Word package');
        const styles=load(await zip.file('word/styles.xml').async('string'),{xml:true});if(!styles('w\\:style[w\\:styleId="Heading1"]').length)throw new Error('Missing Word heading styles');
        for(const relFile of Object.values(zip.files).filter(entry=>/^word\/.*\.rels$/.test(entry.name))) {
            const rels=load(await relFile.async('string'),{xml:true});
            for(const el of rels('Relationship').toArray())if(/\/image$/.test(rels(el).attr('Type')||'')){const target=rels(el).attr('Target');if(!zip.file('word/'+target)?.name)throw new Error('Missing embedded image');}
        }
        return {valid:true,paragraphs:paragraphs.length,tables:xml('w\\:tbl').length,embeddedImages:Object.keys(zip.files).filter(name=>/^word\/media\/[^/]+$/.test(name)).length,paginationVerified:false};
    } catch(error) {throw Object.assign(new Error('Generated Word document failed package validation.'),{code:'DOCUMENT_ARTIFACT_INVALID',stage:'document-validation',cause:error});}
}
