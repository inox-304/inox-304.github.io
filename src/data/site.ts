export const site = {
  name: 'INOX 304',
  tagline: 'Equipamiento comercial e industrial',
  description: 'Diseñamos, fabricamos e instalamos equipamiento gastronómico y mobiliario en acero inoxidable. Conoce nuestro catálogo y cotiza tu proyecto a medida.',
  phone: '964 270 406',
  whatsapp: '51964270406',
  email: 'ventasinox304@gmail.com',
  address: 'Prolongación Av. de la Cultura 1608, San Sebastián, Cusco',
  facebook: 'https://www.facebook.com/inox304peru',
};

export function whatsappUrl(message = 'Hola INOX 304, me gustaría recibir asesoría para equipar mi negocio.') {
  return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;
}
