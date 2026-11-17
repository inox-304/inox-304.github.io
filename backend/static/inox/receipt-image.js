// Check dimensions before the browser allocates decoded pixels. This is a
// bounded header check, not a replacement for browser/server image validation.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 24000000;
const invalid = () => new Error('Usa un JPG o PNG estático válido de hasta 24 megapíxeles.');

function dimensions(width, height) {
  if (!width || !height || width * height > MAX_PIXELS) throw invalid();
  return { width, height };
}

export function inspectReceiptImage(bytes, type) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_FILE_BYTES) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || signature.some((value, i) => bytes[i] !== value)
      || view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw invalid();
    const size = dimensions(view.getUint32(16), view.getUint32(20));
    let offset = 8;
    let data = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) throw invalid();
      const chunk = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (chunk === 'acTL' || (chunk === 'IHDR' && offset !== 8)) throw invalid();
      if (chunk === 'IDAT') data = true;
      if (chunk === 'IEND') {
        if (length || !data || end !== bytes.length) throw invalid();
        return size;
      }
      offset = end;
    }
    throw invalid();
  }
  if (type === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw invalid();
    let offset = 2;
    let size;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid();
      while (bytes[offset] === 255) offset += 1;
      const marker = bytes[offset++];
      if (marker === 1) continue;
      if (marker === 0 || marker === 216 || (marker >= 208 && marker <= 217) || offset + 2 > bytes.length) throw invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalid();
      if (marker === 218) {
        if (!size) throw invalid();
        return size;
      }
      // SOF0/SOF2: ordinary 8-bit baseline/progressive photographic JPEGs.
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (![192, 194].includes(marker) || size || length < 8 || bytes[offset + 2] !== 8
          || ![1, 3, 4].includes(bytes[offset + 7]) || length !== 8 + 3 * bytes[offset + 7]) throw invalid();
        size = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
  }
  throw invalid();
}

export async function checkReceiptImage(file) {
  if (!file || !['image/jpeg', 'image/png'].includes(file.type)
    || !file.size || file.size > MAX_FILE_BYTES) throw invalid();
  return inspectReceiptImage(new Uint8Array(await file.arrayBuffer()), file.type);
}
