import { wrap, type Remote } from 'comlink';
import { spawnBlobWorker } from './blob-worker';
import type { ComputeWorkerApi } from './compute.worker';
import computeWorkerUrl from './compute.worker.ts?worker&url';

/**
 * Compute worker client spawning the bundled compute worker inside a same-origin blob: URL
 * so XLSX fflate parsing, Win-1252 normalization, and PII regex scanning obey <meta> CSP.
 */
export class ComputeClient {
  private worker: Worker | null = null;
  private proxy: Remote<ComputeWorkerApi> | null = null;
  private bootPromise: Promise<Remote<ComputeWorkerApi>> | null = null;

  async getApi(): Promise<Remote<ComputeWorkerApi>> {
    if (this.proxy) return this.proxy;
    if (this.bootPromise) return this.bootPromise;

    this.bootPromise = (async () => {
      const resolvedUrl = new URL(computeWorkerUrl, window.location.href).href;
      const { worker, revoke } = await spawnBlobWorker(resolvedUrl);
      try {
        const api = wrap<ComputeWorkerApi>(worker);
        await api.ping();
        this.worker = worker;
        this.proxy = api;
        return api;
      } catch (err) {
        worker.terminate();
        throw err;
      } finally {
        revoke();
      }
    })();

    try {
      return await this.bootPromise;
    } finally {
      this.bootPromise = null;
    }
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
    }
    this.worker = null;
    this.proxy = null;
    this.bootPromise = null;
  }
}
