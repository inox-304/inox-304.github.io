/** Public catalogue transport. Failed requests never stand in for publication decisions. */
export const CATALOG_CACHE_VERSION = 1;
export const CATALOG_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const CATALOG_MAX_LENGTH = 5_000_000;
export type CatalogSyncStatus = 'loading' | 'slow' | 'ready' | 'error';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function catalogEndpoint(value: string, pageOrigin: string): string {
  try {
    const page = new URL(pageOrigin);
    const url = new URL(value, page);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/catalog/') return '';
    if (url.protocol !== 'https:' && !(url.origin === page.origin && /^https?:$/.test(url.protocol))) return '';
    return url.href;
  } catch { return ''; }
}

function cacheKey(endpoint: string) { return `inox:public-catalog:${CATALOG_CACHE_VERSION}:${endpoint}`; }

export function readCatalogCache<T>(endpoint: string, parse: (value: unknown) => T, storage?: Storage, now = Date.now()): T | null {
  if (!storage) return null;
  const key = cacheKey(endpoint);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    if (raw.length > CATALOG_MAX_LENGTH + 1000) throw new Error('Cache too large');
    const value = JSON.parse(raw);
    if (!value || value.version !== CATALOG_CACHE_VERSION || value.endpoint !== endpoint || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt > CATALOG_CACHE_MAX_AGE) throw new Error('Stale public cache');
    return parse(value.data);
  } catch { try { storage.removeItem(key); } catch { /* Storage may be disabled. */ } return null; }
}

export function writeCatalogCache<T>(endpoint: string, data: T, storage?: Storage, now = Date.now()) {
  if (!storage) return;
  try {
    const raw = JSON.stringify({ version: CATALOG_CACHE_VERSION, endpoint, savedAt: now, data });
    if (raw.length <= CATALOG_MAX_LENGTH + 1000) storage.setItem(cacheKey(endpoint), raw);
  } catch { /* Privacy mode or a full storage quota never prevents publication. */ }
}

export function startCatalogSync<T>(options: {
  endpoint: string;
  parse: (value: unknown) => T;
  onData: (data: T) => void;
  onStatus: (status: CatalogSyncStatus) => void;
  storage?: Storage;
}) {
  let disposed = false;
  let active: AbortController | undefined;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const clearTimers = () => { clearTimeout(slowTimer); clearTimeout(deadline); };
  const refresh = async () => {
    if (disposed || active) return;
    const controller = new AbortController(); active = controller;
    const request = ++generation;
    const current = () => !disposed && request === generation;
    options.onStatus('loading');
    slowTimer = setTimeout(() => { if (current()) options.onStatus('slow'); }, 5000);
    deadline = setTimeout(() => {
      if (!current()) return;
      generation++; active = undefined; clearTimers(); controller.abort(); options.onStatus('error');
    }, 65000);
    try {
      const response = await fetch(options.endpoint, {
        signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' },
      });
      if (!current()) return;
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Catalog unavailable');
      const declaredLength = Number(response.headers.get('content-length'));
      if (declaredLength > CATALOG_MAX_LENGTH) throw new Error('Catalog too large');
      const raw = await response.text();
      if (!current()) return;
      if (raw.length > CATALOG_MAX_LENGTH) throw new Error('Catalog too large');
      const data = options.parse(JSON.parse(raw));
      if (!current()) return;
      // A complete, validated empty catalogue is an explicit publication decision.
      options.onData(data);
      writeCatalogCache(options.endpoint, data, options.storage);
      options.onStatus('ready');
    } catch { if (current()) options.onStatus('error'); }
    finally { if (current()) { clearTimers(); active = undefined; } }
  };
  return {
    refresh,
    pause: () => { generation++; clearTimers(); active?.abort(); active = undefined; },
    dispose: () => { disposed = true; generation++; clearTimers(); active?.abort(); active = undefined; },
  };
}
