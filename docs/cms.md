# Google Sheets catalogue and business contacts

## Current activation status

The website integration is implemented. Google account authorization and the published CSV URLs still need to be completed. It is **not connected to a live spreadsheet yet**. With all three URL variables empty, the existing bundled catalogue and business details remain fully functional.

## One-time activation

1. Use the business Google account to create or open the CMS spreadsheet with the three tabs and exact header rows below.
2. Publish **each intended business-data tab individually** to the web as CSV. Do not publish an entire workbook that includes private notes, account details, employees or unrelated data.
3. Configure these public URLs in the local/hosting build environment, then rebuild and restart the site:

```dotenv
PUBLIC_CMS_CATALOG_URL=https://docs.google.com/spreadsheets/d/e/PUBLISHED_ID/pub?gid=CATALOG_GID&single=true&output=csv
PUBLIC_CMS_CONTACTS_URL=https://docs.google.com/spreadsheets/d/e/PUBLISHED_ID/pub?gid=CONTACTS_GID&single=true&output=csv
PUBLIC_CMS_SETTINGS_URL=https://docs.google.com/spreadsheets/d/e/PUBLISHED_ID/pub?gid=SETTINGS_GID&single=true&output=csv
```

These are public resource URLs, never credentials. Once configured, the owner edits the spreadsheet without modifying website code. Reloading the page retrieves the published data; Google may take a short time to refresh a published tab.

## Editable schema

### Catalogo

```text
id,slug,nombre,categoria,descripcion,caracteristicas,imagen,visible,destacado,orden,contacto_id
```

- Keep `id` stable for an existing product. IDs are unique and use letters, digits, `_` or `-`. Do not reuse an ID for a different product.
- `slug` is unique, lowercase words separated by hyphens. Existing product URLs stay stable by ID; changing the slug does not move the already-built page.
- `categoria`: `coccion`, `fritura`, `refrigeracion`, `lavado`, `mobiliario` or `preparacion`.
- Separate `caracteristicas` with `|`. Quoted CSV commas and line breaks are supported automatically by Google export.
- `imagen`: existing `/images/...` website asset path, or an absolute `https://` image URL accessible without signing in. A Google Drive sharing page is not a direct image URL. Uploading a file into Sheets itself does not upload that image into the website.
- `visible`: `SI` or `NO`. `NO` removes the product from lists and disables its quote action after live data loads. Deleting its row has the same live effect.
- `destacado`: `SI` or `NO` controls home-page inclusion. `orden` is a numeric sort value.
- `contacto_id`: route a product quote to an active Contactos row. Missing/inactive IDs fall back to the active primary contact, then the first active contact.

### Contactos

```text
id,nombre,whatsapp,telefono,correo,mensaje,activo
```

Use an international WhatsApp number with country code; spaces, `+`, brackets and hyphens are accepted. Nine-digit Peruvian mobile numbers are normalized with `51`. `telefono` is the display text. `mensaje` is the default introduction; product quotes and form details are appended, and context-specific button messages are retained. `activo=NO` prevents routing to that contact. If no active contact remains, WhatsApp links and the form are disabled rather than using an old number.

### Ajustes

```text
clave,valor,descripcion
```

Supported keys: `empresa`, `direccion`, `referencia_direccion`, `facebook`, `contacto_principal`, `contacto_instalaciones`, `contacto_medida`, `contacto_formulario`. `empresa` and `contacto_principal` are required. Keep Facebook URLs on HTTPS.

## Runtime behavior and limits

- Three requests load together with a 12-second timeout. Every CSV is parsed and validated before the data is applied. A network, publication, schema or validation error retains the current static content rather than blanking the website. This fallback is the bundled build snapshot, not an offline database of prior spreadsheet edits.
- Search and category filtering reapply to new cards, preserving the current query. New cards participate in the motion system.
- Existing 32 product pages update by stable ID. New spreadsheet products open `/equipo/?id=...`, a generic `noindex` page. They do not create new pre-rendered SEO pages until a developer rebuilds those routes.
- The static HTML, sitemap, social previews, logo artwork and existing URL paths are build-time assets. Client-side edits do not remove old content from the generated HTML or replace the logo. Public removal requiring search-engine deindexing or full offline removal needs a rebuild.
- The browser only reads published tabs. It does not write to Sheets, send WhatsApp messages or hold Google credentials. Customers review the prepared message before sending it.
- If Google authorization is unavailable, all local integration work can be reviewed, but publication and a real-account end-to-end test remain pending.

## Verification

`node scripts/test-cms.mjs` tests CSV quoting/newlines, WhatsApp normalization, visibility/order, malicious URLs, duplicate records, contact fallback, published URL validation and stable/new product routing. Run `npm run check`, `npm run build` and `npm test` for the website checks. Inspect `document.documentElement.dataset.cmsState`: `unconfigured`, `live`, or `fallback`.
