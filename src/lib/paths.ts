/** Prefix local absolute paths without changing external URLs or existing bases. */
export function withBase(path: string, base: string = import.meta.env?.BASE_URL || '/'): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const normalizedBase = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
  if (normalizedBase === '/') return path;
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname === normalizedBase.slice(0, -1) || pathname.startsWith(normalizedBase)) return path;
  return `${normalizedBase}${path.slice(1)}`;
}
