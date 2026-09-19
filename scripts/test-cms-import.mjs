import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { importPublishedCms, googleJson, validateExportUrl, driveId, MAX_ASSET_BYTES } from './lib/cms-import.mjs';
import { writeCmsSnapshot } from './sync-cms.mjs';

const endpoint = 'https://script.google.com/macros/s/example_deployment/exec';
const headers = ['id','slug','nombre','categoria','descripcion','caracteristicas','imagen','publicar','destacado','orden','contacto_id','ficha_tecnica','modelo_3d','poster_3d','galeria'];
const csv = rows => rows.map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\n');
const product = (id = 'P01', image = '/images/example.webp') => [id,id.toLowerCase(),'Equipo','linea-fria','Detalle','AISI 304',image,'TRUE','FALSE','1','ventas','','','',''];
const contactsCsv = 'id,nombre,whatsapp,telefono,correo,mensaje,activo\nventas,Ventas,51964270406,,,Hola,TRUE\nprivado,Privado,51912345678,,,Privado,FALSE';
const settingsCsv = 'clave,valor,descripcion\nempresa,INOX 304,Nombre\ncontacto_principal,ventas,Principal';
const exportData = rows => ({ version: 1, catalogCsv: csv([headers, ...rows]), contactsCsv, settingsCsv });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type':'application/json; charset=utf-8' } });
const asset = (bytes, mimeType = 'image/png', name = 'equipo.png') => ({ base64: bytes.toString('base64'), mimeType, name });
const image = await sharp({ create: { width: 1800, height: 20, channels: 4, background: { r: 180, g: 210, b: 240, alpha: .4 } } }).png().toBuffer();
const transport = (payload, media, seen = []) => async url => { seen.push(url); const id = new URL(url).searchParams.get('asset'); return json(id ? media[id] : payload); };

test('imports 20 products, filters drafts, deduplicates Drive references and preserves transparent images', async () => {
  const driveUrl = 'https://drive.google.com/file/d/PUBLISHED_IMAGE_001/view?usp=sharing';
  const rows = Array.from({length:20},(_,i) => product(`P${String(i+1).padStart(2,'0')}`,driveUrl));
  rows[0][13] = driveUrl; rows[0][14] = driveUrl;
  const draft = product('DRAFT','https://drive.google.com/file/d/PRIVATE_IMAGE_999/view'); draft[7] = 'FALSE';
  const blankDraft = product('BLANK'); blankDraft[7] = '';
  const seen = [];
  const result = await importPublishedCms(endpoint,{ fetchImpl: transport(exportData([...rows,draft,blankDraft]),{ PUBLISHED_IMAGE_001:asset(image) },seen) });
  assert.equal(result.data.products.length,20); assert.equal(result.data.contacts.length,1); assert.equal(result.assets.length,1);
  assert.equal(seen.length,2); assert.ok(seen.every(url => !url.includes('PRIVATE')));
  assert.match(result.data.products[0].image,/^\/images\/cms\/[a-f0-9]{24}\.webp$/);
  assert.equal(result.data.products[0].modelPoster,result.data.products[0].image);
  const metadata = await sharp(result.assets[0].bytes).metadata(); assert.equal(metadata.width,1600); assert.equal(metadata.hasAlpha,true);
});

test('validates records before fetching assets and rejects media mismatches and broken documents', async () => {
  const row = product('P01','PUBLISHED_IMAGE_001'); row[3] = 'invalid'; const seen = [];
  await assert.rejects(importPublishedCms(endpoint,{fetchImpl:transport(exportData([row]),{},seen)}),/Invalid CMS product/); assert.equal(seen.length,1);
  row[3] = 'linea-fria';
  for (const payload of [asset(image,'image/jpeg'),asset(Buffer.from('<svg/>'),'image/svg+xml'),asset(Buffer.from('%PDF-not-a-document'),'application/pdf'),asset(Buffer.from('bad'),'model/gltf-binary','bad.glb')]) await assert.rejects(importPublishedCms(endpoint,{fetchImpl:transport(exportData([row]),{PUBLISHED_IMAGE_001:payload})}));
  await assert.rejects(importPublishedCms(endpoint,{fetchImpl:transport(exportData([row]),{PUBLISHED_IMAGE_001:{...asset(image),base64:'!!!!'}})}),/encoding/);
});

test('keeps opaque photographs out of pedestal stages and allows the entire catalog to be unpublished', async () => {
  const opaque = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 150, g: 160, b: 170, alpha: 1 } } }).png().toBuffer();
  const row = product('P01','OPAQUE_IMAGE_0001');
  const result = await importPublishedCms(endpoint,{fetchImpl:transport(exportData([row]),{OPAQUE_IMAGE_0001:asset(opaque)})});
  assert.match(result.data.products[0].image,/\.jpg$/); assert.equal((await sharp(result.assets[0].bytes).metadata()).format,'jpeg');
  row[7] = 'FALSE';
  const empty = await importPublishedCms(endpoint,{fetchImpl:transport(exportData([row]),{})});
  assert.deepEqual(empty.data.products,[]); assert.deepEqual(empty.assets,[]);
});

test('allows all contacts to be disabled so the website can remove contact actions', async () => {
  const payload = exportData([product()]); payload.contactsCsv = contactsCsv.replace(',Hola,TRUE', ',Hola,FALSE');
  const result = await importPublishedCms(endpoint,{fetchImpl:transport(payload,{})});
  assert.equal(result.data.products.length,1); assert.deepEqual(result.data.contacts,[]);
});

test('snapshot commits preserve previous resources on failure and clean them only after success', async () => {
  const root=resolve('work/cms-write-fixture');
  const oldPath='/images/cms/aaaaaaaaaaaaaaaaaaaaaaaa.webp'; const newPath='/images/cms/bbbbbbbbbbbbbbbbbbbbbbbb.webp';
  const snapshot=resolve(root,'.generated/cms-snapshot.json'); const inventory=resolve(root,'.generated/cms-assets.json');
  const oldFile=resolve(root,'public',`.${oldPath}`); const events=[];
  const files=new Map([[snapshot,JSON.stringify({products:['old']})],[inventory,JSON.stringify([oldPath])],[oldFile,Buffer.from('old')]]);
  let failCommit=true;
  const io={mkdir:async()=>{},readFile:async path=>{if(!files.has(path))throw Object.assign(new Error('Missing'),{code:'ENOENT'});return files.get(path);},writeFile:async(path,value)=>{files.set(path,value);},rename:async(from,to)=>{if(to===snapshot&&failCommit)throw new Error('Commit failed');events.push(['rename',to]);files.set(to,files.get(from));files.delete(from);},unlink:async path=>{events.push(['unlink',path]);files.delete(path);}};
  const next={data:{products:['new']},assets:[{path:newPath,bytes:Buffer.from('new')}]};
  await assert.rejects(writeCmsSnapshot(root,next,io),/Commit failed/);
  assert.deepEqual(JSON.parse(files.get(snapshot)),{products:['old']}); assert.ok(files.has(oldFile)); assert.deepEqual(JSON.parse(files.get(inventory)),[oldPath,newPath]); assert.ok(!events.some(([action])=>action==='unlink'));
  failCommit=false;events.length=0;
  await writeCmsSnapshot(root,next,io);
  assert.deepEqual(JSON.parse(files.get(snapshot)),next.data);assert.deepEqual(JSON.parse(files.get(inventory)),[newPath]);assert.ok(!files.has(oldFile));
  assert.ok(events.findIndex(([action,path])=>action==='rename'&&path===snapshot)<events.findIndex(([action])=>action==='unlink'));
});

test('imports valid PDF and self-contained GLB and refuses external model dependencies', async () => {
  const row = product(); row[11]='PUBLISHED_PDF_0001'; row[12]='PUBLISHED_GLB_0001';
  const makeGlb = model => { const raw=JSON.stringify(model); const chunk=Buffer.from(raw.padEnd(Math.ceil(raw.length/4)*4,' ')); const output=Buffer.alloc(20+chunk.length); output.write('glTF'); output.writeUInt32LE(2,4); output.writeUInt32LE(output.length,8); output.writeUInt32LE(chunk.length,12); output.writeUInt32LE(0x4e4f534a,16); chunk.copy(output,20); return output; };
  const media={PUBLISHED_PDF_0001:asset(Buffer.from('%PDF-1.7\n%%EOF'),'application/pdf','spec.pdf'),PUBLISHED_GLB_0001:asset(makeGlb({asset:{version:'2.0'}}),'application/octet-stream','model.glb')};
  const result=await importPublishedCms(endpoint,{fetchImpl:transport(exportData([row]),media)}); assert.match(result.data.products[0].technicalSheet,/\.pdf$/); assert.match(result.data.products[0].model3d,/\.glb$/);
  media.PUBLISHED_GLB_0001=asset(makeGlb({asset:{version:'2.0'},images:[{uri:'https://example.com/tracker.png'}]}),'model/gltf-binary','model.glb');
  await assert.rejects(importPublishedCms(endpoint,{fetchImpl:transport(exportData([row]),media)}),/self-contained/);
});

test('limits transfer sizes, validates deployment URLs and only follows approved Google redirects', async () => {
  assert.equal(validateExportUrl(endpoint),endpoint);
  for (const url of ['https://example.com/exec','https://script.google.com/macros/s/id/dev',endpoint+'?token=secret','https://evil@script.google.com/macros/s/id/exec']) assert.throws(()=>validateExportUrl(url));
  assert.equal(driveId('https://drive.google.com/open?id=PUBLISHED_IMAGE_001'),'PUBLISHED_IMAGE_001'); assert.equal(driveId('https://drive.google.com.evil.test/file/d/PUBLISHED_IMAGE_001/view'),'');
  const seen=[];
  const redirect=async url=>{seen.push(url);return seen.length===1?new Response(null,{status:302,headers:{location:'https://script.googleusercontent.com/macros/echo?key=abc'}}):json({ok:true});};
  assert.equal((await googleJson(endpoint,100,redirect)).ok,true); assert.equal(seen.length,2);
  for (const target of ['https://accounts.google.com/login','https://evil.test/data']) await assert.rejects(googleJson(endpoint,100,async()=>new Response(null,{status:302,headers:{location:target}})),/approved/);
  await assert.rejects(googleJson(endpoint,20,async()=>json({text:'x'.repeat(21)})),/too large/);
  await assert.rejects(googleJson(endpoint,100,async()=>new Response('Login',{headers:{'content-type':'text/html'}})),/login/);
  const row=product('P01','PUBLISHED_IMAGE_001');
  await assert.rejects(importPublishedCms(endpoint,{fetchImpl:transport(exportData([row]),{PUBLISHED_IMAGE_001:asset(Buffer.alloc(MAX_ASSET_BYTES+1))})}),/encoding|size/);
});

test('Apps Script exposes only published fields and denies arbitrary/private Drive IDs before lookup', async () => {
  const source=await readFile(new URL('../integration/google-apps-script/Code.gs',import.meta.url),'utf8');
  const published=product('P01','PUBLISHED_IMAGE_001'); const privateRow=product('PRIVATE','PRIVATE_IMAGE_001');privateRow[7]='FALSE'; const blank=product('BLANK','BLANK_IMAGE_001');blank[7]='';
  const sheets={Catalogo:[ [...headers,'internal_cost'],[...published,'SECRET'],[...privateRow,'HIDDEN'],[...blank,'HIDDEN'] ],Contactos:[['id','nombre','whatsapp','telefono','correo','mensaje','activo'],['ventas','Ventas','51964270406','','','Hola',true],['private','Private','51912345678','','','Secret',false]],Ajustes:[['clave','valor','descripcion'],['empresa','INOX 304','Nombre'],['contacto_principal','ventas','Principal'],['private_token','SECRET','Internal']]};
  const requested=[];
  const context=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'SHEET_ID'})},SpreadsheetApp:{openById:()=>({getSheetByName:name=>({getLastRow:()=>sheets[name].length,getLastColumn:()=>sheets[name][0].length,getDataRange:()=>({getValues:()=>sheets[name].map(row=>[...row])})})})},DriveApp:{getFileById:id=>{requested.push(id);return {getMimeType:()=> 'image/png',getName:()=> 'photo.png',getSize:()=>image.length,getBlob:()=>({getBytes:()=>[...image]})};}},Utilities:{base64Encode:bytes=>Buffer.from(bytes).toString('base64')},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>text})}});
  vm.runInContext(source,context);
  const call=parameter=>JSON.parse(context.doGet({parameter}));
  const exported=call({}); assert.equal(exported.version,1); assert.ok(!JSON.stringify(exported).includes('SECRET')); assert.ok(!JSON.stringify(exported).includes('PRIVATE_IMAGE')); assert.ok(!JSON.stringify(exported).includes('BLANK_IMAGE'));
  for (const id of ['PRIVATE_IMAGE_001','ARBITRARY_IMAGE_01','BLANK_IMAGE_001']) assert.ok(call({asset:id}).error);
  assert.equal(requested.length,0); assert.equal(call({asset:'PUBLISHED_IMAGE_001'}).mimeType,'image/png'); assert.deepEqual(requested,['PUBLISHED_IMAGE_001']);
});
