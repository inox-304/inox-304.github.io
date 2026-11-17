"""Conservative suggestions only: receipt text never authorizes a payment."""
from datetime import date, datetime
import re
import unicodedata
from zoneinfo import ZoneInfo

MAX_TEXT = 60_000
MAX_CAPTION = 16_000
MAX_LINES = 1200
REVIEW_NOTE = "Revisa cada dato con el comprobante. Una factura no demuestra que el pago ya se realizó."
FIELDS = ("amount", "currency", "date", "reference", "description", "kind", "company_code", "company_name", "account_code")
CURRENCY_TOKEN = r"(?:US\$|USD|DOLARES(?:\s+AMERICANOS)?|S\s*/\.?|PEN|SOLES|\$)"
MONEY_LINE = re.compile(rf"^\s*({CURRENCY_TOKEN})?\s*([0-9][0-9., \u00a0]*)(?:\s*({CURRENCY_TOKEN}))?\s*$")
TOTAL_LABEL = re.compile(r"^(?:TOTAL(?:\s+(?:A\s+PAGAR|PAGADO|FINAL|VENTA|DE\s+LA\s+VENTA|DEL\s+COMPROBANTE))?|(?:IMPORTE|MONTO)(?:\s+(?:TOTAL|PAGADO|RECIBIDO|TRANSFERIDO))?)\s*(?::|=)?\s*")
DATE_LABEL = re.compile(r"^(?:FECHA(?:\s+(?:(?:DE\s+)?(?:EMISION|OPERACION|PAGO|TRANSACCION)|Y\s+HORA))?|EMITIDO(?:\s+EL)?)\s*(?::|=)?\s*")
REFERENCE = re.compile(r"^(?:(?:N[°º.]?|NRO\.?|NUMERO|CODIGO)\s*(?:DE\s+)?(?:OPERACION|TRANSACCION)|(?:OPERACION|TRANSACCION)(?:\s*(?:N[°º.]?|NRO\.?|NUMERO))?)\s*[:#]?\s*([A-Z0-9][A-Z0-9 -]{3,49})$")
DOCUMENT = re.compile(r"^(FACTURA(?:\s+ELECTRONICA)?|BOLETA(?:\s+DE\s+VENTA)?(?:\s+ELECTRONICA)?|RECIBO(?:\s+POR\s+HONORARIOS)?(?:\s+ELECTRONICO)?)\s*(?:(?:N[°º.]?|NRO\.?|NUMERO)\s*)?[:#]?\s*([FBRE][A-Z0-9]{0,3}-\d{1,12})?$")
MONTHS = {name: number for number, names in enumerate((
    ("ENE", "ENERO"), ("FEB", "FEBRERO"), ("MAR", "MARZO"), ("ABR", "ABRIL"),
    ("MAY", "MAYO"), ("JUN", "JUNIO"), ("JUL", "JULIO"), ("AGO", "AGOSTO"),
    ("SEP", "SEPT", "SET", "SEPTIEMBRE", "SETIEMBRE"), ("OCT", "OCTUBRE"),
    ("NOV", "NOVIEMBRE"), ("DIC", "DICIEMBRE")), 1) for name in names}


def _normalized(value):
    return "".join(char for char in unicodedata.normalize("NFD", value) if not unicodedata.combining(char)).upper().strip()


def _money(raw):
    value = raw.strip().replace("\u00a0", " ")
    if " " in value:
        if not re.fullmatch(r"\d{1,3}(?: \d{3})+(?:[.,]\d{2})?", value):
            return None
        value = value.replace(" ", "")
    if re.fullmatch(r"\d+", value):
        integer, fraction = value, "00"
    elif re.fullmatch(r"\d+[.,]\d{2}", value):
        integer, fraction = re.split(r"[.,]", value)
    elif re.fullmatch(r"\d{1,3}(?:,\d{3})+\.\d{2}", value):
        integer, fraction = value.replace(",", "").split(".")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+,\d{2}", value):
        integer, fraction = value.replace(".", "").split(",")
    else:
        return None
    integer = integer.lstrip("0") or "0"
    if len(integer) > 12 or (integer == "0" and fraction == "00"):
        return None
    return f"{integer}.{fraction}"


def _currency(raw):
    value = _normalized(raw or "")
    if re.fullmatch(r"S\s*/\.?|PEN|SOLES", value):
        return "PEN"
    if re.fullmatch(r"US\$|USD|DOLARES(?: AMERICANOS)?", value):
        return "USD"
    return None  # A bare $ is not evidence of USD.


def _money_line(raw):
    match = MONEY_LINE.fullmatch(raw) if len(raw) <= 200 else None
    if not match:
        return None
    amount = _money(match[2])
    currencies = {_currency(value) for value in (match[1], match[3])} - {None}
    return {"amount": amount, "currencies": currencies, "explicit": bool(match[1] or match[3]),
            "invalid": amount is None or len(currencies) > 1}


def _date(raw, today):
    text = _normalized(raw)
    match = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?=$|\s|T)", text)
    if match:
        year, month, day = map(int, match.groups())
    else:
        match = re.match(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?=$|\s)", text)
        if match:
            day, month, year = map(int, match.groups())
        else:
            match = re.match(r"^(\d{1,2})\s+(?:DE\s+)?([A-Z]+)\.?\s+(?:DE\s+)?(\d{4})(?=$|\s)", text)
            if not match or match[2] not in MONTHS:
                return None
            day, month, year = int(match[1]), MONTHS[match[2]], int(match[3])
    remainder = text[match.end():].strip()
    if remainder:
        # A printed time may follow the date. Arbitrary trailing text or a
        # second date is not discarded as if the first date were unambiguous.
        clock = re.fullmatch(r"T?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|A\.M\.|P\.M\.|HRS?\.?))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?", remainder)
        if not clock or int(clock[1]) > 23 or int(clock[2]) > 59 or int(clock[3] or 0) > 59:
            return None
        if clock[4] in {"AM", "PM", "A.M.", "P.M."} and not 1 <= int(clock[1]) <= 12:
            return None
    try:
        value = date(year, month, day)
    except ValueError:
        return None
    return value.isoformat() if 1900 <= year and value <= today else None


def extract_fields(ocr_text, caption="", *, today=None):
    """JSON-serializable suggestions; empty fields/conflicts require human input.

    Dates use the existing Spanish receipt convention DD/MM/YYYY. Company,
    account and direction can ONLY come from explicitly labelled caption lines.
    Instructions in an image are inert data; no model/tool is asked to obey them.
    """
    result = {**dict.fromkeys(FIELDS, ""), "warnings": [], "conflicts": []}
    if (not isinstance(ocr_text, str) or not isinstance(caption, str)
            or len(ocr_text) > MAX_TEXT or len(caption) > MAX_CAPTION
            or "\x00" in ocr_text or "\x00" in caption):
        result["warnings"] = ["El texto no es válido o excede el límite. Revisa un comprobante por vez.", REVIEW_NOTE]
        return result
    today = today or datetime.now(ZoneInfo("America/Lima")).date()
    ocr_lines = [line.strip() for line in ocr_text.splitlines() if line.strip()]
    caption_lines = [line.strip() for line in re.split(r"[\r\n;|]+", caption) if line.strip()]
    if len(ocr_lines) + len(caption_lines) > MAX_LINES:
        result["warnings"] = ["Se detectaron demasiadas líneas. Revisa un comprobante por vez.", REVIEW_NOTE]
        return result
    candidates = {field: [] for field in FIELDS}
    invalid = set()
    document_codes = set()
    captions_descriptions = []
    amount_currencies = set()

    def append_money(candidate):
        if candidate["invalid"]:
            invalid.add("amount")
        elif candidate["amount"]:
            candidates["amount"].append(candidate["amount"])
        amount_currencies.update(candidate["currencies"])
        candidates["currency"].extend(candidate["currencies"])

    # Previously advertised shorthand has a fixed header, not free-text company
    # inference: COMPANY | INGRESO/EGRESO | amount | labelled fields afterwards.
    header = [part.strip() for part in caption.splitlines()[0].split("|")] if caption.splitlines() else []
    if len(header) >= 3:
        header_kind = {"INGRESO": "income", "EGRESO": "expense", "GASTO": "expense", "TRASLADO": "transfer"}.get(_normalized(header[1]))
        header_amount = _money_line(_normalized(header[2]))
        if header_kind and header_amount and header[0] and len(header[0]) <= 180 and not re.search(r"[:=\x00-\x1f]", header[0]):
            candidates["company_name"].append(header[0])
            candidates["kind"].append(header_kind)
            append_money(header_amount)

    for source_lines, is_caption in ((ocr_lines, False), (caption_lines, True)):
        totals_found = False
        for index, line in enumerate(source_lines):
            upper = _normalized(line)
            following = _normalized(source_lines[index + 1]) if index + 1 < len(source_lines) else ""
            if match := TOTAL_LABEL.match(upper):
                tail = upper[match.end():]
                if not tail or re.fullmatch(CURRENCY_TOKEN, tail):
                    tail = f"{tail} {following}".strip()
                candidate = _money_line(tail)
                if candidate:
                    totals_found = True
                    append_money(candidate)
                elif re.match(r"^(?:[\d$]|S\s*/|USD\b|US\$|PEN\b|[-(]\d)", tail):
                    totals_found = True
                    invalid.add("amount")
            if match := re.match(r"^(?:MONEDA|CURRENCY)\s*[:=]?\s*(.+)$", upper):
                value = _currency(match[1])
                if value:
                    candidates["currency"].append(value)
                else:
                    invalid.add("currency")
            if match := DATE_LABEL.match(upper):
                tail = upper[match.end():] or following
                if re.match(r"^\d", tail):
                    value = _date(tail, today)
                    if value:
                        candidates["date"].append(value)
                    else:
                        invalid.add("date")
            if match := REFERENCE.fullmatch(upper):
                value = re.sub(r"\s+", "", match[1])
                if re.search(r"\d", value) and 4 <= len(value) <= 40 and not re.fullmatch(r"\d{4}-\d\d-\d\d", value):
                    candidates["reference"].append(value)
            if match := DOCUMENT.fullmatch(upper):
                code = match[2] or (following if re.fullmatch(r"[FBRE][A-Z0-9]{0,3}-\d{1,12}", following) else "")
                if code:
                    title = "Factura" if match[1].startswith("FACTURA") else "Boleta" if match[1].startswith("BOLETA") else "Recibo"
                    document_codes.add(code)
                    candidates["description"].append(f"{title} {code}")
            if not is_caption:
                continue
            # Labels are only trusted as explicit user-provided suggestions,
            # never executable instructions or authorization to post a payment.
            label, separator, value = line.partition(":")
            if not separator:
                label, separator, value = line.partition("=")
            if not separator:
                continue
            label, value = _normalized(label), value.strip()
            field = {"EMPRESA": "company_name", "CODIGO EMPRESA": "company_code", "CODIGO DE EMPRESA": "company_code",
                     "CUENTA": "account_code", "CODIGO CUENTA": "account_code", "CODIGO DE CUENTA": "account_code"}.get(label)
            if field:
                valid = bool(value) and len(value) <= (180 if field == "company_name" else 40) and not any(ord(char) < 32 for char in value)
                if field != "company_name":
                    valid = valid and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", value))
                if valid:
                    candidates[field].append(value)
                else:
                    invalid.add(field)
            elif label in {"TIPO", "MOVIMIENTO", "TIPO DE MOVIMIENTO"}:
                kind = {"INGRESO": "income", "EGRESO": "expense", "GASTO": "expense", "TRASLADO": "transfer", "TRASLADO ENTRE CUENTAS": "transfer"}.get(_normalized(value))
                if kind:
                    candidates["kind"].append(kind)
                else:
                    invalid.add("kind")
            elif label in {"DETALLE", "CONCEPTO", "DESCRIPCION"}:
                if value and len(value) <= 500 and not any(ord(char) < 32 for char in value):
                    captions_descriptions.append(value)
                else:
                    invalid.add("description")
            elif label == "REFERENCIA":
                if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ./_-]{0,119}", value):
                    candidates["reference"].append(re.sub(r"\s+", "", value.upper()))
                else:
                    invalid.add("reference")
        if not totals_found and re.search(r"\b(?:YAPE|PLIN|TRANSFERENCIA\s+(?:EXITOSA|REALIZADA)|OPERACION\s+EXITOSA)\b", _normalized("\n".join(source_lines))):
            for line in source_lines:
                candidate = _money_line(_normalized(line))
                if candidate and candidate["explicit"]:
                    append_money(candidate)
                elif re.match(rf"^{CURRENCY_TOKEN}\s*[-(]?[0-9]", _normalized(line)):
                    invalid.add("amount")

    if captions_descriptions:
        # A user's description adds context; it need not equal an invoice title.
        candidates["description"] = captions_descriptions
    if len(amount_currencies) > 1:
        invalid.update(("amount", "currency"))
    for field in FIELDS:
        distinct = set(candidates[field])
        if len(distinct) > 1 or field in invalid:
            result["conflicts"].append(field)
            result["warnings"].append(f"El campo {field} es ambiguo o inválido; complétalo después de revisar el comprobante.")
        elif distinct:
            result[field] = next(iter(distinct))
    if len(document_codes) > 1:
        for field in ("amount", "currency", "date", "reference", "description"):
            result[field] = ""
            if field not in result["conflicts"]:
                result["conflicts"].append(field)
        result["warnings"].append("Aparecen varios comprobantes. Registra y revisa un movimiento por vez.")
    if not ocr_lines:
        result["warnings"].append("No se leyó texto de la foto; las sugerencias provienen solo del mensaje.")
    for field, label in (("amount", "importe"), ("currency", "moneda"), ("date", "fecha"), ("kind", "tipo de movimiento")):
        if not result[field] and field not in result["conflicts"]:
            result["warnings"].append(f"Falta {label} explícito; debes completarlo antes de confirmar.")
    if not result["company_code"] and not result["company_name"]:
        result["warnings"].append("Falta Empresa: o Código empresa: en el mensaje; el emisor de la factura no determina tu empresa.")
    result["warnings"].append(REVIEW_NOTE)
    return result
