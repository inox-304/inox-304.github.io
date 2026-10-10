import html
import json
import mimetypes
import re
from pathlib import Path
from django.conf import settings
from django.db import connection
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_safe
from catalog.serializers import public_catalog_data, public_product_queryset


def _render_shell(route, data, *, title=None, description=None, canonical='/', status=200, preview=False, preview_product_id=None):
    path = settings.FRONTEND_DIST / route
    if not path.is_file():
        return HttpResponse('La web necesita compilarse con npm run build:server.', status=503, content_type='text/plain; charset=utf-8')
    source = path.read_text(encoding='utf-8')
    bootstrap = re.search(r'<script\b[^>]*\bid="inox-cms-bootstrap"[^>]*>([\s\S]*?)</script>', source)
    try:
        compiled_data = json.loads(bootstrap.group(1)) if bootstrap else {}
    except (ValueError, TypeError):
        compiled_data = {}
    if compiled_data.get('mode') != 'api':
        return HttpResponse('Usa npm run build:server para servir contenido de la base de datos.', status=503, content_type='text/plain; charset=utf-8')
    payload = {'apiUrl': '/api/catalog/', 'mode': 'api', 'preview': preview, 'previewProductId': preview_product_id, 'routes': {}, 'data': data}
    encoded = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    source, count = re.subn(r'(<script\b[^>]*\bid="inox-cms-bootstrap"[^>]*>)[\s\S]*?(</script>)', lambda match: match[1] + encoded + match[2], source, count=1)
    if not count:
        return HttpResponse('No se encontró el punto de conexión de datos. Revisa la compilación.', status=503)
    if title:
        source = re.sub(r'<title>.*?</title>', lambda _: '<title>' + html.escape(title) + '</title>', source, count=1)
        source = re.sub(r'(<meta\b[^>]*property="og:title"[^>]*content=")[^"]*', lambda match: match[1] + html.escape(title, quote=True), source)
    if description:
        source = re.sub(r'(<meta\b[^>]*(?:name="description"|property="og:description")[^>]*content=")[^"]*', lambda match: match[1] + html.escape(description, quote=True), source)
    canonical_url = html.escape(settings.PUBLIC_ORIGIN + canonical, quote=True)
    source = re.sub(r'(<link\b[^>]*rel="canonical"[^>]*href=")[^"]*', lambda match: match[1] + canonical_url, source)
    source = re.sub(r'(<meta\b[^>]*property="og:url"[^>]*content=")[^"]*', lambda match: match[1] + canonical_url, source)
    if route == 'equipo/index.html' and not preview:
        source = re.sub(r'<meta\b[^>]*name="robots"[^>]*>', '', source)
    response = HttpResponse(source, status=status)
    response['Cache-Control'] = 'no-store'
    if preview:
        response['X-Robots-Tag'] = 'noindex, nofollow'
    return response


@require_safe
def frontend(request):
    route = request.path.strip('/')
    return _render_shell((route + '/' if route else '') + 'index.html', public_catalog_data(), canonical=request.path)


@require_safe
def product_page(request, slug):
    product = get_object_or_404(public_product_queryset(), slug=slug)
    data = public_catalog_data()
    return _render_shell('equipo/index.html', data, title=f'{product.name} | {data["settings"]["empresa"]}', description=product.description, canonical=request.path)


@require_safe
def asset(request, asset):
    root = settings.FRONTEND_DIST.resolve()
    path = (root / asset).resolve()
    if not path.is_relative_to(root) or not path.is_file() or path.suffix.lower() not in {'.css', '.js', '.woff', '.woff2', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.mp4', '.glb', '.wasm', '.pdf', '.txt'}:
        raise Http404
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    response = FileResponse(path.open('rb'), content_type=mime)
    response['Cache-Control'] = 'public, max-age=31536000, immutable' if asset.startswith('_astro/') else 'public, max-age=3600'
    return response


@require_safe
def sitemap(request):
    paths = ['/', '/catalogo/', '/contacto/'] + [f'/catalogo/{slug}/' for slug in public_product_queryset().values_list('slug', flat=True)]
    urls = ''.join(f'<url><loc>{html.escape(settings.PUBLIC_ORIGIN + path)}</loc></url>' for path in paths)
    return HttpResponse(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>', content_type='application/xml')


@require_safe
def robots(request):
    return HttpResponse(f'User-agent: *\nDisallow: /admin/\nDisallow: /api/\nSitemap: {settings.PUBLIC_ORIGIN}/sitemap.xml\n', content_type='text/plain')


@require_safe
def health(request):
    try:
        connection.ensure_connection()
    except Exception:
        return JsonResponse({'status': 'unavailable'}, status=503)
    return JsonResponse({'status': 'ok'})
