import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCms, normalizeWhatsapp, safeImage, safeHttps, validatePublishedUrl, resolveContact, visibleCmsProducts, cmsProductRoute } from '../src/lib/cms.ts';

const header = 'id,slug,nombre,categoria,descripcion,caracteristicas,imagen,visible,destacado,orden,contacto_id\n';
const catalog = header + 'P01,equipo-prueba,Equipo de prueba,coccion,Descripción,Acero|Dos puertas,/images/products/example.webp,SI,SI,1,ventas\n';
const contacts = 'id,nombre,whatsapp,telefono,correo,mensaje,activo\nventas,Ventas,+51 964 270 406,964 270 406,ventas@example.com,Hola,SI\nsecundario,Secundario,51974284843,974 284 843,,Hola,NO\n';
const settings = 'clave,valor,descripcion\nempresa,INOX 304,Empresa\ncontacto_principal,ventas,Principal\n';

test('CSV preserves quoted commas, escaped quotes, embedded newlines, BOM and CRLF', () => {
  assert.deepEqual(parseCsv('\uFEFFid,nombre\r\nP1,"Equipo, modelo ""A""\nIndustrial"\r\n'), [['id','nombre'],['P1','Equipo, modelo "A"\nIndustrial']]);
  assert.throws(() => parseCsv('id,name\nP1,"unfinished'));
  assert.throws(() => parseCsv('id,name\nP1,"closed"oops'));
});
test('WhatsApp normalizes Peruvian local and international numbers, rejects markup and letters', () => {
  assert.equal(normalizeWhatsapp('964 270 406'), '51964270406');
  assert.equal(normalizeWhatsapp('+51 (964) 270-406'), '51964270406');
  assert.equal(normalizeWhatsapp('0051 964270406'), '51964270406');
  assert.equal(normalizeWhatsapp('abc51964270406'), '');
  assert.equal(normalizeWhatsapp('123'), '');
});
test('published product visibility and ordering control the visible dataset', () => {
  const csv = catalog + 'P02,otro-equipo,Otro,coccion,Otro detalle,,/images/other.png,NO,SI,0,ventas\n';
  const data = parseCms(csv, contacts, settings);
  assert.equal(data.products[0].id,'P02');
  assert.deepEqual(visibleCmsProducts(data).map(product => product.id),['P01']);
  assert.deepEqual(data.products[1].features,['Acero','Dos puertas']);
});
test('malicious URL protocols, local traversal and duplicate IDs invalidate whole payload', () => {
  for (const value of ['javascript:alert(1)','data:image/svg+xml,x','//evil.example/a.png','/images/../secret','https://user:pass@example.com/a.png']) assert.equal(safeImage(value),'');
  assert.equal(safeHttps('http://example.com'),'');
  assert.equal(safeImage('https://example.com/photo.png'),'https://example.com/photo.png');
  assert.throws(() => parseCms(catalog.replace('/images/products/example.webp','javascript:alert(1)'),contacts,settings));
  assert.throws(() => parseCms(catalog + catalog.split('\n')[1]+'\n',contacts,settings));
  assert.throws(() => parseCms(catalog.replace(',SI,SI,',',maybe,SI,'),contacts,settings));
});
test('inactive/missing contact falls back to active primary; zero active disables contact', () => {
  const data = parseCms(catalog, contacts, settings);
  assert.equal(resolveContact(data,'secundario')?.id,'ventas');
  assert.equal(resolveContact(data,'missing')?.id,'ventas');
  data.contacts.forEach(contact => { contact.active = false; });
  assert.equal(resolveContact(data,'ventas'),undefined);
});
test('CMS accepts only Google published CSV endpoints', () => {
  assert.ok(validatePublishedUrl('https://docs.google.com/spreadsheets/d/e/2PACX-test/pub?gid=0&single=true&output=csv'));
  assert.equal(validatePublishedUrl('https://docs.google.com/spreadsheets/d/private/edit'), '');
  assert.equal(validatePublishedUrl('https://evil.example/pub?output=csv'), '');
});
test('existing stable IDs retain paths; new IDs including inherited object keys get generic routes', () => {
  const routes = { P01: '/catalogo/equipo-original/' };
  assert.equal(cmsProductRoute({id:'P01'},routes),'/catalogo/equipo-original/');
  assert.equal(cmsProductRoute({id:'P99'},routes),'/equipo/?id=P99');
  for (const id of ['constructor','toString','__proto__']) assert.equal(cmsProductRoute({id},routes),`/equipo/?id=${id}`);
});
