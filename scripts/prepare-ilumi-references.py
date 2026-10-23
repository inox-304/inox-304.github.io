"""Build a local, reviewable reference library. Does not download or invent 3D assets."""
import argparse
import html
import json
from pathlib import Path
from urllib.parse import urlsplit


FAMILIES = {
    "amasadoras": "Amasadoras",
    "batidoras": "Batidoras",
    "envasadoras-vacio": "Envasadoras al vacío",
    "extractores-naranja": "Extractores de naranja",
    "cremoladeras": "Cremoladeras",
    "maquinas-helado": "Máquinas de helado",
    "dispensadores-jugo": "Dispensadores de jugos",
}


def safe_link(value):
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname not in ("ilumiperu.com", "www.ilumiperu.com", "cdn.shopify.com") or parsed.username or parsed.password:
        raise ValueError("Solo enlaces públicos oficiales de referencia.")
    return html.escape(value, quote=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("catalogs/ilumi/catalog.json"))
    parser.add_argument("--output", type=Path, default=Path("outputs/ilumi"))
    args = parser.parse_args()
    data = json.loads(args.source.read_text(encoding="utf-8"))
    products = data["products"]
    args.output.mkdir(parents=True, exist_ok=True)
    cards = []
    for item in products:
        family, code = item["category_slug"], item["code"]
        if family not in FAMILIES or not code.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Familia o código inválido.")
        directory = args.output / family / code
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "referencias.json").write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        brief = [
            f"ILUMI | {item['sku']} | {item['name']}",
            f"Referencia revisada: {data['checked_on']}",
            "Equipo de distribución: respetar diseño, medidas y opciones oficiales.",
            "Estado 3D: pendiente de modelado y validación. No existe un GLB adjunto.",
            "", f"Capacidad: {item.get('capacity_text') or 'Por confirmar'}",
            f"Medidas: {item.get('dimensions_text') or 'Por confirmar con proveedor'}", "",
            "Antes de modelar: reunir fotos frontal, laterales, posterior y superior; validar medidas exteriores y piezas móviles.",
            "El volumen exterior no permite deducir medidas internas, bisagras o mecanismos.",
            "Exportar GLB con escala en metros, origen en el suelo y texturas incluidas.",
            "Objetivo 2–5 MB, hasta 150000 triángulos. Subida del panel: máximo 8 MB y 300000 triángulos.",
            "Animaciones solo cuando el mecanismo y recorrido se hayan confirmado. No inventar funcionamiento interno.",
            "Cada capacidad/SKU conserva su propia geometría. No escalar otro modelo como si fuera equivalente.",
            "", "Pendientes y discrepancias:", *["- " + w for w in item.get("warnings", [])],
            "", "Fuente: " + item["source_url"],
            "Fotos:", *item.get("image_urls", []), "Fichas (pueden ser imágenes JPG):", *item.get("technical_sheet_urls", []),
        ]
        (directory / "brief-modelado.txt").write_text("\n".join(brief) + "\n", encoding="utf-8")
        esc = html.escape
        image_urls = item.get("image_urls", [])
        picture = f'<img src="{safe_link(image_urls[0])}" alt="{esc(item["name"], quote=True)}" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>Foto pendiente de cargar</span>' if image_urls else '<span>Foto por confirmar</span>'
        warning_items = ''.join(f'<li>{esc(w)}</li>' for w in item.get("warnings", []))
        warnings = f'<details class="warnings"><summary>{len(item["warnings"])} datos por revisar</summary><ul>{warning_items}</ul></details>' if warning_items else '<p class="verified">Datos publicados por el proveedor; validar antes de modelar.</p>'
        sheet_links = ''.join(f'<a href="{safe_link(url)}" target="_blank" rel="noopener noreferrer">Ficha visual ↗</a>' for url in item.get("technical_sheet_urls", [])[:1])
        keywords = esc(' '.join(str(item.get(key) or '') for key in ("sku", "name", "capacity_text", "category_slug")), quote=True)
        cards.append(f'''<article data-family="{family}" data-search="{keywords}">
<div class="photo">{picture}</div><div class="body"><div class="eyebrow">{esc(FAMILIES[family])}</div><h2>{esc(item['sku'])}</h2><p class="name">{esc(item['name'])}</p>
<dl><dt>Capacidad / rendimiento</dt><dd>{esc(item.get('capacity_text') or 'Por confirmar')}</dd><dt>Medidas del equipo</dt><dd>{esc(item.get('dimensions_text') or 'Pendientes de confirmar')}</dd></dl>
<div class="status">3D pendiente de modelado</div>{warnings}<div class="links"><a href="{safe_link(item['source_url'])}" target="_blank" rel="noopener noreferrer">Fuente oficial ↗</a>{sheet_links}<a href="{family}/{code}/brief-modelado.txt">Guía de modelado</a></div></div></article>''')
    options = ''.join(f'<option value="{slug}">{html.escape(label)} · {sum(p["category_slug"] == slug for p in products)}</option>' for slug, label in FAMILIES.items())
    page = '''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>INOX 304 · Biblioteca ILUMI</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f8;color:#142d43;font-family:system-ui,Segoe UI,sans-serif;line-height:1.5}header{background:#10283d;color:#fff;padding:46px max(24px,calc((100vw - 1440px)/2)) 34px}.kicker{letter-spacing:.15em;font-size:12px;color:#a6c6dd;font-weight:700}h1{font-size:clamp(28px,4vw,44px);margin:12px 0}header p{color:#c3d3df;max-width:820px;margin-bottom:0}.metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}.metrics span{background:#213e55;border:1px solid #426079;border-radius:8px;padding:10px 16px}.metrics b{color:#fff}main{max-width:1488px;margin:auto;padding:24px}.toolbar{display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin:4px 0 22px}label{font-size:12px;font-weight:700;color:#52697c;display:grid;gap:6px}input,select{font:inherit;font-size:15px;padding:12px 14px;border:1px solid #c5d3de;border-radius:7px;background:#fff;color:#18334a}input{min-width:280px}.count{margin-left:auto;font-size:14px}section{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:22px}article{background:#fff;border:1px solid #d8e2e9;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}article[hidden]{display:none}.photo{height:210px;background:#fff;display:flex;align-items:center;justify-content:center;padding:20px;border-bottom:1px solid #eef1f4}.photo img{width:100%;height:100%;object-fit:contain}.photo span{color:#8294a3;font-size:14px}.body{padding:22px;display:flex;flex-direction:column;flex:1}.eyebrow{text-transform:uppercase;font-size:11px;letter-spacing:.09em;color:#517890;font-weight:750}h2{margin:8px 0 0;font-size:24px}.name{font-size:14px;color:#52677a;margin:3px 0 16px}dl{margin:0 0 14px}dt{font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;color:#61798c;margin:8px 0 4px}dd{margin:0;font-size:14px}.status{background:#edf2f7;color:#45627a;border-radius:6px;font-size:12px;padding:7px 10px;font-weight:650}.warnings{font-size:12px;color:#845823;background:#fff8ec;border-radius:6px;padding:10px;margin:12px 0}.warnings summary{cursor:pointer;font-weight:600}.warnings ul{padding-left:18px}.verified{font-size:12px;color:#62788a}.links{display:flex;gap:12px;flex-wrap:wrap;padding-top:12px;margin-top:auto;border-top:1px solid #e7edf2;font-size:12px}.links a{color:#1d5d8d;text-decoration:none;font-weight:650}.links a:hover{text-decoration:underline}footer{max-width:1440px;margin:10px auto 36px;padding:0 24px;color:#62788a;font-size:12px}.empty{padding:40px;text-align:center}.help{background:#e8eff5;border-left:3px solid #8daec7;padding:12px 16px;font-size:13px;margin-bottom:24px}a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #357db5;outline-offset:3px}@media(max-width:600px){header{padding:28px 22px}.toolbar label,input,select{width:100%}.count{margin-left:0}main{padding:18px}}
</style><header><div class="kicker">INOX 304 / EQUIPOS DE DISTRIBUCIÓN</div><h1>Biblioteca ILUMI</h1><p>Modelos comerciales y referencias para preparar el catálogo 3D. Cada equipo conserva el diseño y las capacidades del fabricante.</p><div class="metrics"><span><b>__COUNT__</b> modelos identificados</span><span><b>7</b> categorías</span><span><b>0</b> archivos 3D confirmados</span></div></header>
<main><div class="toolbar"><label>BUSCAR MODELO O CAPACIDAD<input id="search" type="search" placeholder="Ej. B-20L, helado, 36 L"></label><label>CATEGORÍA<select id="family"><option value="">Todas las categorías</option>__OPTIONS__</select></label><p class="count" id="count" aria-live="polite"></p></div><p class="help">Referencias para revisión. Los precios, las existencias y la publicación comercial están pendientes. Las fichas JPG son imágenes técnicas; no son modelos 3D.</p><section>__CARDS__</section><p class="empty" hidden>No hay modelos que coincidan.</p></main><footer>Fuentes oficiales ILUMI consultadas el __DATE__. Las fotos se cargan desde el proveedor; no se han descargado ni convertido en modelos. Biblioteca local regenerable, sin conexión de escritura a Google Sheets.</footer>
<script>const cards=[...document.querySelectorAll('article')],search=document.querySelector('#search'),family=document.querySelector('#family');const normalize=s=>s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();function filter(){const terms=normalize(search.value).split(/\\s+/).filter(Boolean);let n=0;cards.forEach(c=>{c.hidden=!!((family.value&&c.dataset.family!==family.value)||!terms.every(t=>normalize(c.dataset.search).includes(t)));if(!c.hidden)n++});document.querySelector('#count').textContent=n+' de '+cards.length+' modelos';document.querySelector('.empty').hidden=n!==0}search.addEventListener('input',filter);family.addEventListener('change',filter);filter();</script></html>'''
    page = page.replace('__COUNT__', str(len(products))).replace('__OPTIONS__', options).replace('__CARDS__', '\n'.join(cards)).replace('__DATE__', html.escape(data['checked_on']))
    (args.output / 'revision-catalogo.html').write_text(page, encoding='utf-8')
    print(f'Biblioteca local preparada: {len(products)} modelos en {args.output}')


if __name__ == '__main__':
    main()
