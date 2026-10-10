import { buildCmsData } from './cms-build.ts';
import { resolveContact } from '../lib/cms.ts';
import { withBase } from '../lib/paths.ts';
import { apiMode } from './cms-mode.ts';
const publishedContact = buildCmsData ? resolveContact(buildCmsData) : undefined;
const defaults = {
  name: 'INOX 304',
  tagline: 'Equipamiento comercial e industrial',
  description: 'Diseñamos, fabricamos e instalamos equipamiento gastronómico y mobiliario en acero inoxidable. Conoce nuestro catálogo y cotiza tu proyecto a medida.',
  phone: '964 270 406',
  whatsapp: '51964270406',
  email: 'ventasinox304@gmail.com',
  address: 'Prolongación Av. de la Cultura 1608, San Sebastián, Cusco',
  facebook: 'https://www.facebook.com/inox304peru',
  instagram: '',
  tiktok: '',
  hours: '',
  addressReference: 'Frente a Tottus · 4.º paradero',
};
export const site = apiMode ? {
  ...defaults, phone: '', whatsapp: '', email: '', address: '', addressReference: '', facebook: '', instagram: '', tiktok: '', hours: '',
} : buildCmsData ? {
  ...defaults,
  name: buildCmsData.settings.empresa,
  address: buildCmsData.settings.direccion || '',
  facebook: buildCmsData.settings.facebook || '',
  phone: publishedContact?.phone || '',
  whatsapp: publishedContact?.whatsapp || '',
  email: publishedContact?.email || '',
  instagram: buildCmsData.settings.instagram || '',
  tiktok: buildCmsData.settings.tiktok || '',
  hours: buildCmsData.settings.horarios || '',
  addressReference: buildCmsData.settings.referencia_direccion || '',
} : defaults;

export function whatsappUrl(message = 'Hola INOX 304, me gustaría recibir asesoría para equipar mi negocio.', requestedContactId = '') {
  const whatsapp = buildCmsData ? resolveContact(buildCmsData, requestedContactId)?.whatsapp : site.whatsapp;
  return whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}` : withBase('/contacto/');
}
