import { buildCmsData } from './cms-build.ts';
import { resolveContact } from '../lib/cms.ts';
import { withBase } from '../lib/paths.ts';
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
};
export const site = buildCmsData ? {
  ...defaults,
  name: buildCmsData.settings.empresa,
  address: buildCmsData.settings.direccion || '',
  facebook: buildCmsData.settings.facebook || '',
  phone: publishedContact?.phone || '',
  whatsapp: publishedContact?.whatsapp || '',
  email: publishedContact?.email || '',
} : defaults;

export function whatsappUrl(message = 'Hola INOX 304, me gustaría recibir asesoría para equipar mi negocio.', requestedContactId = '') {
  const whatsapp = buildCmsData ? resolveContact(buildCmsData, requestedContactId)?.whatsapp : site.whatsapp;
  return whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}` : withBase('/contacto/');
}
