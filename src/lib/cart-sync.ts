import { parseCartConfig, type CartConfig } from './cart-config.ts';

export type CartSyncStatus = 'loading' | 'slow' | 'error' | 'ready' | 'disabled';

/** Public rules only. A transport failure never means that the owner disabled a cart. */
export function startCartSync(options: {
  origin: string;
  productId: string;
  onConfig: (config: CartConfig | null) => void;
  onStatus: (status: CartSyncStatus) => void;
}) {
  let disposed = false;
  let active: AbortController | undefined;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const clearTimers = () => { clearTimeout(slowTimer); clearTimeout(deadline); };
  const retry = async () => {
    if (disposed || active) return;
    const controller = new AbortController(); active = controller;
    const request = ++generation;
    const current = () => !disposed && request === generation;
    options.onStatus('loading');
    slowTimer = setTimeout(() => { if (current()) options.onStatus('slow'); }, 5000);
    deadline = setTimeout(() => {
      if (!current()) return;
      // Invalidate even a fetch implementation that ignores abort.
      generation++; active = undefined; clearTimers(); controller.abort(); options.onStatus('error');
    }, 65000);
    try {
      const origin = new URL(options.origin);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid configuration origin');
      const response = await fetch(new URL(`/api/catalog/${encodeURIComponent(options.productId)}/cart/`, origin), {
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      if (!current()) return;
      if (response.status === 404 || response.status === 410) {
        options.onConfig(null); options.onStatus('disabled'); return;
      }
      if (!response.ok) throw new Error('Unavailable rules');
      const value = await response.json();
      if (!current()) return;
      if (!value || value.productId !== options.productId || !Object.hasOwn(value, 'cartConfig')) throw new Error('Unexpected configuration');
      const parsed = parseCartConfig(value.cartConfig);
      if (value.cartConfig !== null && !parsed) throw new Error('Incomplete configuration');
      const config = parsed?.enabled ? parsed : null;
      options.onConfig(config); options.onStatus(config ? 'ready' : 'disabled');
    } catch {
      if (current()) options.onStatus('error');
    } finally {
      if (current()) { clearTimers(); active = undefined; }
    }
  };
  void retry();
  return {
    retry: () => { void retry(); },
    dispose: () => { disposed = true; generation++; clearTimers(); active?.abort(); active = undefined; },
  };
}
