// Geometry adapter for the pinned PaddleOCR.js worker's OcrResult contract.
// Scores remain OCR estimates, never probabilities that a payment is correct.
export function normalizePaddleResult(result) {
  if (!result || !Array.isArray(result.items) || result.items.length > 512) {
    throw new Error('El resultado OCR excede el límite de lectura. Usa una foto de un solo comprobante.');
  }
  let characters = 0;
  const words = result.items.map((item, index) => {
    if (typeof item.text !== 'string' || !Array.isArray(item.poly) || item.poly.length < 4
      || item.poly.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) {
      throw new Error('El lector devolvió un resultado incompleto.');
    }
    const text = item.text.replace(/\s+/gu, ' ').trim();
    characters += text.length;
    if (characters > 60000) throw new Error('El comprobante contiene demasiado texto.');
    const xs = item.poly.map(point => point[0]);
    const ys = item.poly.map(point => point[1]);
    const bbox = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    if (bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0) throw new Error('El lector devolvió posiciones inválidas.');
    const confidence = Number.isFinite(item.score) && item.score >= 0 && item.score <= 1 ? item.score * 100 : 0;
    return { text, confidence, bbox, index };
  });
  words.sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1) || a.bbox.x0 - b.bbox.x0 || a.index - b.index);
  const rows = [];
  for (const word of words) {
    const box = word.bbox;
    const height = box.y1 - box.y0;
    const center = (box.y0 + box.y1) / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const row of rows) {
      const overlap = Math.min(box.y1, row.anchor.y1) - Math.max(box.y0, row.anchor.y0);
      const minHeight = Math.min(height, row.anchor.y1 - row.anchor.y0);
      const distance = Math.abs(center - row.center);
      if (overlap >= minHeight * 0.5 && distance <= minHeight * 0.6 && distance < bestDistance) {
        best = row;
        bestDistance = distance;
      }
    }
    if (best) best.words.push(word);
    else rows.push({ words: [word], anchor: box, center });
  }
  rows.sort((a, b) => a.center - b.center || a.anchor.x0 - b.anchor.x0);
  const lines = rows.map(row => {
    row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0 || a.index - b.index);
    return {
      text: row.words.map(word => word.text).join(' '),
      confidence: Math.min(...row.words.map(word => word.confidence)),
      bbox: {
        x0: Math.min(...row.words.map(word => word.bbox.x0)),
        y0: Math.min(...row.words.map(word => word.bbox.y0)),
        x1: Math.max(...row.words.map(word => word.bbox.x1)),
        y1: Math.max(...row.words.map(word => word.bbox.y1)),
      },
    };
  });
  return {
    text: lines.map(line => line.text).join('\n'),
    confidence: words.length ? Math.min(...words.map(word => word.confidence)) : 0,
    lines,
    words: rows.flatMap(row => row.words.map(({ index, ...word }) => word)),
  };
}
