import { withBase } from './paths.ts';

/** Open the real login directly, either on Django or on the configured server. */
export function adminEntryUrl(apiMode: boolean, remoteUrl = '', base?: string): string {
  if (apiMode) return withBase('/admin/auth/login/', base);
  if (!remoteUrl.trim()) return 'http://127.0.0.1:8000/admin/auth/login/';
  const url = new URL(remoteUrl.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/\/admin\/$/.test(url.pathname)) {
    throw new Error('PUBLIC_ADMIN_URL must be an HTTPS /admin/ URL without credentials, query or fragment.');
  }
  url.pathname = `${url.pathname}auth/login/`;
  return url.href;
}
