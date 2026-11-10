/**
 * Conservative, local receipt suggestions. This parser never creates a payment
 * and never chooses a company, account or movement direction.
 */
const MAX_TEXT_LENGTH = 60000;
const MAX_LINES = 1200;
const REVIEW_NOTE = 'Revisa cada dato con la foto. Una factura no demuestra que el pago ya se haya realizado.';
const CURRENCY_TOKEN = '(?:US\\$|USD|D[ÓO]LARES(?:\\s+AMERICANOS)?|S\\s*\\/\\.?|PEN|SOLES|\\$)';
const MONEY_LINE = new RegExp(`^\\s*(${CURRENCY_TOKEN})?\\s*([0-9][0-9., \\u00a0]*)(?:\\s*(${CURRENCY_TOKEN}))?\\s*$`, 'iu');
const TOTAL_LABEL = /^(?:TOTAL(?:\s+(?:A\s+PAGAR|PAGADO|FINAL|VENTA|DE\s+LA\s+VENTA|DEL\s+COMPROBANTE))?|(?:IMPORTE|MONTO)(?:\s+(?:TOTAL|PAGADO|RECIBIDO|TRANSFERIDO))?)\s*(?::|=)?\s*/u;
const DATE_LABEL = /^(?:FECHA(?:\s+(?:(?:DE\s+)?(?:EMISION|OPERACION|PAGO|TRANSACCION)|Y\s+HORA))?|EMITIDO(?:\s+EL)?)\s*(?::|=)?\s*/u;
const MONTHS = { ENE: 1, ENERO: 1, FEB: 2, FEBRERO: 2, MAR: 3, MARZO: 3, ABR: 4, ABRIL: 4, MAY: 5, MAYO: 5, JUN: 6, JUNIO: 6, JUL: 7, JULIO: 7, AGO: 8, AGOSTO: 8, SEP: 9, SEPT: 9, SET: 9, SEPTIEMBRE: 9, SETIEMBRE: 9, OCT: 10, OCTUBRE: 10, NOV: 11, NOVIEMBRE: 11, DIC: 12, DICIEMBRE: 12 };

function normalized(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().trim();
}

function moneyValue(raw) {
  let value = raw.trim().replace(/\u00a0/gu, ' ');
  if (value.includes(' ')) {
    // Spaces are only accepted as complete thousands groups, not OCR fragments.
    if (!/^\d{1,3}(?: \d{3})+(?:[.,]\d{2})?$/u.test(value)) return null;
    value = value.replaceAll(' ', '');
  }
  let integer;
  let fraction;
  if (/^\d+$/u.test(value)) {
    integer = value;
    fraction = '00';
  } else if (/^\d+[.,]\d{2}$/u.test(value)) {
    [integer, fraction] = value.split(/[.,]/u);
  } else if (/^\d{1,3}(?:,\d{3})+\.\d{2}$/u.test(value)) {
    [integer, fraction] = value.replaceAll(',', '').split('.');
  } else if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/u.test(value)) {
    [integer, fraction] = value.replaceAll('.', '').split(',');
  } else {
    // "1,250" and "1.250" can have different meanings: ask for review.
    return null;
  }
  integer = integer.replace(/^0+(?=\d)/u, '');
  if (integer.length > 12 || (integer === '0' && fraction === '00')) return null;
  return `${integer}.${fraction}`;
}

function currencyValue(raw) {
  const value = normalized(raw || '');
  if (/^(?:S\s*\/\.?|PEN|SOLES)$/u.test(value)) return 'PEN';
  if (/^(?:US\$|USD|DOLARES(?: AMERICANOS)?)$/u.test(value)) return 'USD';
  // A bare "$" is used by several currencies; do not assume USD.
  return null;
}

function moneyLine(raw, evidence) {
  if (raw.length > 200) return null;
  const match = MONEY_LINE.exec(raw);
  if (!match) return null;
  const amount = moneyValue(match[2]);
  if (!amount) return { invalid: true, explicitCurrency: Boolean(match[1] || match[3]) };
  const currencies = [...new Set([currencyValue(match[1]), currencyValue(match[3])].filter(Boolean))];
  if (currencies.length > 1) return { invalid: true };
  return { value: amount, currency: currencies[0], evidence, explicitCurrency: Boolean(match[1] || match[3]) };
}

function localDay(today) {
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
}

function dateValue(raw, today) {
  const text = normalized(raw);
  let day;
  let month;
  let year;
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?=$|\s|T)/u.exec(text);
  if (match) {
    [, year, month, day] = match;
  } else {
    match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?=$|\s)/u.exec(text);
    if (match) {
      [, day, month, year] = match;
    } else {
      match = /^(\d{1,2})\s+(?:DE\s+)?([A-Z]+)\.?\s+(?:DE\s+)?(\d{4})(?=$|\s)/u.exec(text);
      if (!match || !MONTHS[match[2]]) return null;
      [, day, , year] = match;
      month = MONTHS[match[2]];
    }
  }
  day = Number(day);
  month = Number(month);
  year = Number(year);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return value <= localDay(today) ? value : null;
}

function uniqueSuggestion(candidates, field, result, warning) {
  const distinct = new Set(candidates.filter(candidate => candidate.value).map(candidate => candidate.value));
  if (distinct.size > 1 || candidates.some(candidate => candidate.invalid)) {
    result.warnings.push(warning);
    return null;
  }
  if (distinct.size === 1) {
    const candidate = candidates.find(item => item.value);
    result.suggestions[field] = candidate.value;
    result.evidence[field] = candidate.evidence;
    return candidate;
  }
  return null;
}

/** All returned values are untrusted suggestions; render evidence with textContent. */
export function parseReceiptText(text, { today = new Date() } = {}) {
  const result = { suggestions: {}, evidence: {}, warnings: [] };
  if (typeof text !== 'string' || !text.trim()) {
    result.warnings.push('No se pudo leer texto. Puedes completar los datos manualmente o probar una foto más nítida.');
    return result;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    result.warnings.push('El texto es demasiado extenso para una lectura segura. Registra un comprobante por vez.');
    return result;
  }
  const lines = text.replace(/\r\n?/gu, '\n').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length > MAX_LINES) {
    result.warnings.push('Se detectaron demasiadas líneas. Registra un comprobante por vez.');
    return result;
  }
  const totals = [];
  const dates = [];
  const references = [];
  const descriptions = [];
  const currencies = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const upper = normalized(line);
    const totalMatch = TOTAL_LABEL.exec(upper);
    if (totalMatch) {
      let tail = upper.slice(totalMatch[0].length);
      let evidence = line;
      if ((!tail || new RegExp(`^${CURRENCY_TOKEN}$`, 'iu').test(tail)) && lines[index + 1]) {
        tail = `${tail} ${lines[index + 1]}`.trim();
        evidence = `${line}\n${lines[index + 1]}`;
      }
      const candidate = moneyLine(tail, evidence);
      if (candidate) totals.push(candidate);
      else if (/^(?:[\d$]|S\s*\/|USD\b|US\$|PEN\b|[-(]\d)/u.test(tail)) totals.push({ invalid: true });
    }

    const currencyMatch = /^(?:MONEDA|CURRENCY)\s*(?::|=)?\s*(.+)$/u.exec(upper);
    if (currencyMatch) {
      const currency = currencyValue(currencyMatch[1]);
      if (currency) currencies.push({ value: currency, evidence: line });
    }

    const dateMatch = DATE_LABEL.exec(upper);
    if (dateMatch) {
      const tail = upper.slice(dateMatch[0].length) || normalized(lines[index + 1] || '');
      if (/^\d/u.test(tail)) {
        const value = dateValue(tail, today);
        dates.push(value ? { value, evidence: line + (upper.slice(dateMatch[0].length) ? '' : `\n${lines[index + 1]}`) } : { invalid: true });
      }
    }

    const referenceMatch = /^(?:(?:N[°º.]?|NRO\.?|NUMERO|CODIGO)\s*(?:DE\s+)?(?:OPERACION|TRANSACCION)|(?:OPERACION|TRANSACCION)(?:\s*(?:N[°º.]?|NRO\.?|NUMERO))?)\s*[:#]?\s*([A-Z0-9][A-Z0-9 -]{3,49})$/u.exec(upper);
    if (referenceMatch) {
      const value = referenceMatch[1].replace(/\s+/gu, '');
      if (/\d/u.test(value) && value.length >= 4 && value.length <= 40 && !/^\d{4}-\d\d-\d\d$/u.test(value)) references.push({ value, evidence: line });
    }

    const documentMatch = /^(FACTURA(?:\s+ELECTRONICA)?|BOLETA(?:\s+DE\s+VENTA)?(?:\s+ELECTRONICA)?|RECIBO(?:\s+POR\s+HONORARIOS)?(?:\s+ELECTRONICO)?)\s*(?:(?:N[°º.]?|NRO\.?|NUMERO)\s*)?[:#]?\s*([FBRE][A-Z0-9]{0,3}-\d{1,12})?$/u.exec(upper);
    if (documentMatch) {
      const code = documentMatch[2] || (/^[FBRE][A-Z0-9]{0,3}-\d{1,12}$/u.test(normalized(lines[index + 1] || '')) ? normalized(lines[index + 1]) : '');
      if (code) {
        const title = documentMatch[1].startsWith('FACTURA') ? 'Factura' : documentMatch[1].startsWith('BOLETA') ? 'Boleta' : 'Recibo';
        descriptions.push({ value: `${title} ${code}`, evidence: line + (documentMatch[2] ? '' : `\n${lines[index + 1]}`) });
      }
    }
  }

  // Mobile payment receipts may show the amount alone below the brand. Require
  // explicit payment context and currency, and reject multiple possible amounts.
  if (!totals.length && /\b(?:YAPE|PLIN|TRANSFERENCIA\s+(?:EXITOSA|REALIZADA)|OPERACION\s+EXITOSA)\b/u.test(normalized(text))) {
    for (const line of lines) {
      const candidate = moneyLine(line, line);
      if (candidate?.explicitCurrency) totals.push(candidate);
      else if (new RegExp(`^${CURRENCY_TOKEN}\\s*[-(]?[0-9]`, 'iu').test(line)) totals.push({ invalid: true });
    }
  }

  const total = uniqueSuggestion(totals, 'amount', result, 'El total no es inequívoco. Comprueba el importe; no se seleccionó un subtotal, impuesto o monto dudoso.');
  const totalCurrencies = [...new Set(totals.map(candidate => candidate.currency).filter(Boolean))];
  if (total && totalCurrencies.length === 1) currencies.push({ value: totalCurrencies[0], evidence: total.evidence });
  else if (totalCurrencies.length > 1) {
    delete result.suggestions.amount;
    delete result.evidence.amount;
    currencies.push({ invalid: true });
    result.warnings.push('Aparecen totales en distintas monedas. Revisa el importe y la moneda de esta operación.');
  }
  uniqueSuggestion(currencies, 'currency', result, 'La moneda no está clara. Selecciona soles o dólares según el comprobante.');
  uniqueSuggestion(dates, 'occurred_on', result, 'La fecha es ambigua, inválida o futura. Escribe la fecha real del movimiento.');
  uniqueSuggestion(references, 'reference', result, 'Se detectaron varias referencias de pago. Comprueba cuál corresponde a esta operación.');
  uniqueSuggestion(descriptions, 'description', result, 'Se detectaron varios comprobantes. Registra y revisa cada movimiento por separado.');
  if (new Set(descriptions.map(candidate => candidate.value)).size > 1) {
    // Two equal invoice totals are still two documents, not one safe amount.
    result.suggestions = {};
    result.evidence = {};
  }
  if (!Object.keys(result.suggestions).length) result.warnings.push('No se encontraron datos suficientemente claros. Puedes completar el formulario manualmente.');
  result.warnings.push(REVIEW_NOTE);
  return result;
}
