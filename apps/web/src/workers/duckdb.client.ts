import * as duckdb from '@duckdb/duckdb-wasm';
import { spawnBlobWorker } from './blob-worker';

export type DuckDBAssetName =
  | 'duckdb-mvp.wasm'
  | 'duckdb-browser-mvp.worker.js'
  | 'duckdb-eh.wasm'
  | 'duckdb-browser-eh.worker.js';

/** Resolve a self-hosted DuckDB asset to an absolute same-origin URL usable inside blob: workers. */
export function resolveDuckdbAssetUrl(filename: DuckDBAssetName): string {
  const base = import.meta.env.BASE_URL || '/';
  if (base.startsWith('.')) {
    const inAppSubdir =
      window.location.pathname.endsWith('/app/') ||
      window.location.pathname.endsWith('/app/index.html');
    const relPrefix = inAppSubdir ? '../duckdb/' : './duckdb/';
    return new URL(`${relPrefix}${filename}`, window.location.href).href;
  }
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${normalizedBase}duckdb/${filename}`, window.location.origin).href;
}

function getSelfHostedBundles(): duckdb.DuckDBBundles {
  return {
    mvp: {
      mainModule: resolveDuckdbAssetUrl('duckdb-mvp.wasm'),
      mainWorker: resolveDuckdbAssetUrl('duckdb-browser-mvp.worker.js'),
    },
    eh: {
      mainModule: resolveDuckdbAssetUrl('duckdb-eh.wasm'),
      mainWorker: resolveDuckdbAssetUrl('duckdb-browser-eh.worker.js'),
    },
  };
}

/**
 * Serialized single-worker DuckDB-WASM client.
 * - Spawns worker through a same-origin blob: URL so <meta> CSP applies to worker requests.
 * - Serializes all SQL queries/mutations (spike S5 showed concurrent read connections still block).
 * - Implements hard cancellation via worker.terminate() because connection.cancelSent() returns false.
 */
export class DuckDBClient {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private worker: Worker | null = null;
  private queue: Promise<void> = Promise.resolve();
  private epoch = 0;

  get isReady(): boolean {
    return this.db !== null && this.conn !== null && this.worker !== null;
  }

  async boot(): Promise<{ bundle: 'eh' | 'mvp' | 'coi' }> {
    if (this.isReady) {
      return { bundle: 'eh' };
    }

    const myEpoch = this.epoch;
    const bundles = getSelfHostedBundles();
    const selected = await duckdb.selectBundle(bundles);
    if (!selected.mainWorker) {
      throw new Error('Selected DuckDB-WASM bundle is missing mainWorker URL.');
    }

    const { worker, revoke } = await spawnBlobWorker(selected.mainWorker);
    try {
      if (this.epoch !== myEpoch) {
        worker.terminate();
        throw new DOMException('DuckDB boot cancelled.', 'AbortError');
      }

      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
      await db.instantiate(selected.mainModule, selected.pthreadWorker);
      await db.open({ path: ':memory:' });
      const conn = await db.connect();

      if (this.epoch !== myEpoch) {
        await conn.close().catch(() => undefined);
        await db.terminate().catch(() => undefined);
        worker.terminate();
        throw new DOMException('DuckDB boot cancelled.', 'AbortError');
      }

      this.worker = worker;
      this.db = db;
      this.conn = conn;

      const bundleName = selected.mainModule.includes('duckdb-mvp') ? 'mvp' : 'eh';
      return { bundle: bundleName };
    } catch (err) {
      worker.terminate();
      throw err;
    } finally {
      revoke();
    }
  }

  enqueue<T>(task: (conn: duckdb.AsyncDuckDBConnection) => Promise<T>): Promise<T> {
    const taskEpoch = this.epoch;
    const result = this.queue.then(async () => {
      if (taskEpoch !== this.epoch) {
        throw new DOMException('DuckDB task cancelled before execution.', 'AbortError');
      }
      if (!this.conn) {
        throw new Error('DuckDB-WASM engine is not booted.');
      }
      return task(this.conn);
    });

    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  cancelAndReset(): void {
    this.epoch++;
    if (this.worker) {
      this.worker.terminate();
    }
    this.worker = null;
    this.conn = null;
    this.db = null;
    this.queue = Promise.resolve();
  }
}
