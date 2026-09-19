// Read-only export. Only published business rows and their referenced media leave Drive.
const CATALOG_COLUMNS = ['id','slug','nombre','categoria','descripcion','caracteristicas','imagen','publicar','destacado','orden','contacto_id','precio','moneda','mostrar_precio','ficha_tecnica','modelo_3d','poster_3d','galeria'];
const CONTACT_COLUMNS = ['id','nombre','whatsapp','telefono','correo','mensaje','activo'];
const SETTING_KEYS = ['empresa','direccion','referencia_direccion','facebook','contacto_principal','contacto_instalaciones','contacto_medida','contacto_formulario'];
const ASSET_COLUMNS = ['imagen','galeria','ficha_tecnica','modelo_3d','poster_3d'];
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

function enabled_(value) { return /^(true|si|sí|1)$/i.test(String(value).trim()); }
function rows_(spreadsheet, name, required) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet || sheet.getLastRow() > 2001 || sheet.getLastColumn() > 100) throw new Error('Invalid sheet');
  const values = sheet.getDataRange().getValues();
  const headers = (values.shift() || []).map(value => String(value).trim().toLowerCase());
  if (new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) throw new Error('Invalid columns');
  return values.filter(row => row.some(value => String(value).trim())).map(row => Object.fromEntries(headers.map((key, index) => [key, String(row[index] == null ? '' : row[index]).trim()])));
}
function csv_(columns, rows) {
  const escape = value => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  return [columns, ...rows.map(row => columns.map(key => row[key] || ''))].map(row => row.map(escape).join(',')).join('\n');
}
function driveId_(value) {
  const text = String(value).trim();
  if (/^[a-zA-Z0-9_-]{10,200}$/.test(text)) return text;
  const file = text.match(/^https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,200})(?:\/[^?#]*)?(?:[?#].*)?$/);
  const query = text.match(/^https:\/\/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]{10,200})(?:&[^#]*)?(?:#.*)?$/);
  return file ? file[1] : query ? query[1] : '';
}
function published_(spreadsheet) {
  return rows_(spreadsheet, 'Catalogo', CATALOG_COLUMNS.slice(0, 11)).filter(row => enabled_(row.publicar));
}
function exportAsset_(requestedId, catalog) {
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(requestedId)) throw new Error('Invalid asset');
  const referenced = catalog.some(row => ASSET_COLUMNS.some(key => String(row[key] || '').split('|').some(value => driveId_(value) === requestedId)));
  if (!referenced) throw new Error('Asset is not published');
  const file = DriveApp.getFileById(requestedId);
  const mimeType = file.getMimeType(); const name = file.getName();
  const allowed = ['image/png','image/jpeg','image/webp','application/pdf','model/gltf-binary'].includes(mimeType) || (mimeType === 'application/octet-stream' && /\.glb$/i.test(name));
  if (!allowed || file.getSize() > MAX_ASSET_BYTES || file.getSize() === 0) throw new Error('Unsupported asset');
  const bytes = file.getBlob().getBytes();
  if (bytes.length > MAX_ASSET_BYTES) throw new Error('Asset too large');
  return { mimeType, name, base64: Utilities.base64Encode(bytes) };
}
function doGet(event) {
  let payload;
  try {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('Missing spreadsheet');
    const spreadsheet = SpreadsheetApp.openById(id);
    const catalog = published_(spreadsheet);
    const asset = event && event.parameter && event.parameter.asset;
    if (asset) payload = exportAsset_(String(asset), catalog);
    else {
      const contacts = rows_(spreadsheet, 'Contactos', CONTACT_COLUMNS).filter(row => enabled_(row.activo));
      const settings = rows_(spreadsheet, 'Ajustes', ['clave','valor','descripcion']).filter(row => SETTING_KEYS.includes(row.clave));
      payload = { version: 1, catalogCsv: csv_(CATALOG_COLUMNS, catalog), contactsCsv: csv_(CONTACT_COLUMNS, contacts), settingsCsv: csv_(['clave','valor','descripcion'], settings) };
    }
  } catch (_) { payload = { error: 'No se pudo exportar. Revisa las pestañas, los permisos y los archivos publicados.' }; }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
