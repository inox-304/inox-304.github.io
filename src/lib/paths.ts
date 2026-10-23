import { productPhotoVersions } from './product-photo-versions.ts';

/** Prefix local paths and refresh edited catalog photos without changing external URLs. */
export function withBase(path: string, base: string = import.meta.env?.BASE_URL || '/'): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const normalizedBase = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
  const pathname = path.split(/[?#]/, 1)[0];
  const alreadyPrefixed = normalizedBase !== '/' && (pathname === normalizedBase.slice(0, -1) || pathname.startsWith(normalizedBase));
  const localPath = alreadyPrefixed ? `/${pathname.slice(normalizedBase.length)}` : pathname;
  const result = normalizedBase === '/' || alreadyPrefixed ? path : `${normalizedBase}${path.slice(1)}`;
  const revision = productPhotoVersions[localPath];
  if (!revision) return result;
  const url = new URL(result, 'https://catalog-photo.invalid');
  url.searchParams.set('v', revision);
  return `${url.pathname}${url.search}${url.hash}`;
}
