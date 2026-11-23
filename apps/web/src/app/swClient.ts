export interface OfflineSwStatus {
  supported: boolean;
  ready: boolean;
  cachedCount: number;
  netFetchCount: number;
  externalBlockedCount: number;
}

/**
 * Register the offline precache Service Worker scoped to the Dewpond MPA root.
 * Status telemetry surfaced in the UI is an explicit convenience check, never a security proof.
 */
export function initOfflineServiceWorker(onUpdate: (status: OfflineSwStatus) => void): () => void {
  if (import.meta.env.DEV) {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => undefined);
    }
    if (typeof caches !== 'undefined') {
      void caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((k) => k.startsWith('dewpond-offline-')).map((k) => caches.delete(k)),
          ),
        )
        .catch(() => undefined);
    }
    onUpdate({
      supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      ready: false,
      cachedCount: 0,
      netFetchCount: 0,
      externalBlockedCount: 0,
    });
    return () => undefined;
  }

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    onUpdate({
      supported: false,
      ready: false,
      cachedCount: 0,
      netFetchCount: 0,
      externalBlockedCount: 0,
    });
    return () => undefined;
  }

  let disposed = false;

  const handleMessage = (event: MessageEvent) => {
    const data = event.data as
      | {
          type?: string;
          ready?: boolean;
          cachedCount?: number;
          netFetchCount?: number;
          externalBlockedCount?: number;
        }
      | undefined;
    if (!disposed && data?.type === 'SW_STATUS') {
      onUpdate({
        supported: true,
        ready: Boolean(data.ready),
        cachedCount: Number(data.cachedCount ?? 0),
        netFetchCount: Number(data.netFetchCount ?? 0),
        externalBlockedCount: Number(data.externalBlockedCount ?? 0),
      });
    }
  };

  navigator.serviceWorker.addEventListener('message', handleMessage);

  void (async () => {
    try {
      const reg = await navigator.serviceWorker.register('../sw.js', { scope: '../' });
      const active = reg.active ?? navigator.serviceWorker.controller;
      if (active) {
        active.postMessage({ type: 'SW_PING' });
      }
      await navigator.serviceWorker.ready;
      if (!disposed) {
        (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'SW_PING' });
      }
    } catch {
      if (!disposed) {
        onUpdate({
          supported: true,
          ready: false,
          cachedCount: 0,
          netFetchCount: 0,
          externalBlockedCount: 0,
        });
      }
    }
  })();

  return () => {
    disposed = true;
    navigator.serviceWorker.removeEventListener('message', handleMessage);
  };
}

export async function wipeServiceWorkerCaches(): Promise<void> {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    const target = reg?.active ?? navigator.serviceWorker.controller;
    target?.postMessage({ type: 'SW_WIPE' });
  }
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
}
