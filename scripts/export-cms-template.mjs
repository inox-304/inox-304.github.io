import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { products } from '../src/data/products.ts';
import { site } from '../src/data/site.ts';
import { parseCms } from '../src/lib/cms.ts';

const destination = new URL('../public/cms/plantillas/', import.meta.url);
const csvCell = value => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = rows => '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
const featured = new Set(['P01', 'P16', 'P24', 'P03', 'P09', 'P21']);
const catalog = csv([
  ['id','slug','nombre','categoria','descripcion','caracteristicas','imagen','publicar','destacado','orden','contacto_id','precio','moneda','mostrar_precio','ficha_tecnica','modelo_3d','poster_3d','galeria'],
  ...products.map((product, index) => [product.id, product.slug, product.name, product.category, product.summary, product.features.join(' | '), product.image, 'TRUE', featured.has(product.id) ? 'TRUE' : 'FALSE', index + 1, 'ventas', product.price ?? '', product.currency || 'PEN', product.showPrice ? 'TRUE' : 'FALSE', product.technicalSheet || '', product.model3d || '', product.modelPoster || '', (product.gallery || []).join(' | ')]),
]);
const contacts = csv([
  ['id','nombre','whatsapp','telefono','correo','mensaje','activo'],
  ['ventas','Ventas',site.whatsapp,site.phone,site.email,'Hola INOX 304, me gustaría recibir asesoría para equipar mi negocio.','TRUE'],
  ['instalaciones','Instalaciones',site.whatsapp,site.phone,site.email,'Hola INOX 304, quiero asesoría para un proyecto de instalación.','TRUE'],
]);
const settings = csv([
  ['clave','valor','descripcion'],
  ['empresa',site.name,'Nombre comercial'],
  ['direccion',site.address,'Dirección pública del negocio'],
  ['referencia_direccion','Frente a Tottus · 4.º paradero','Referencia pública'],
  ['facebook',site.facebook,'URL pública de Facebook'],
  ['contacto_principal','ventas','ID del contacto predeterminado'],
  ['contacto_instalaciones','instalaciones','ID para consultas de instalación'],
  ['contacto_medida','ventas','ID para proyectos a medida'],
  ['contacto_formulario','ventas','ID del formulario de cotización'],
]);
const data = parseCms(catalog, contacts, settings);
await mkdir(destination, { recursive: true });
await Promise.all([
  writeFile(new URL('Catalogo.csv', destination), catalog, 'utf8'),
  writeFile(new URL('Contactos.csv', destination), contacts, 'utf8'),
  writeFile(new URL('Ajustes.csv', destination), settings, 'utf8'),
]);
console.log(`CMS templates written: ${data.products.length} products, ${data.contacts.length} contacts → ${fileURLToPath(destination)}`);
