import * as duckdb from '@duckdb/duckdb-wasm';
import { ident, lit } from '@dewpond/sqlkit';
import { extractArrowTable, type ArrowTableLike, type QueryTableResult } from '../app/arrowFormat';
import { spawnBlobWorker } from './blob-worker';

export type DuckDBAssetName =
  | 'duckdb-mvp.wasm'
  | 'duckdb-browser-mvp.worker.js'
  | 'duckdb-eh.wasm'
  | 'duckdb-browser-eh.worker.js';

export interface DuckDBBootInfo {
  bundle: 'eh' | 'mvp' | 'coi';
  version: string;
}

export interface ReplaySource {
  virtualName: string;
  file?: File;
  text?: string;
  arrowStageName?: string;
  arrowIpc?: Uint8Array;
  ingestSql: string;
}

export interface ReplayPlan {
  sources: readonly ReplaySource[];
  stepSqls: readonly string[];
}

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

/** Resolve self-hosted DuckDB extension repository base URL (no trailing slash). */
export function resolveDuckdbExtensionRepoUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  if (base.startsWith('.')) {
    const inAppSubdir =
      window.location.pathname.endsWith('/app/') ||
      window.location.pathname.endsWith('/app/index.html');
    const relPrefix = inAppSubdir ? '../duckdb/extensions' : './duckdb/extensions';
    return new URL(relPrefix, window.location.href).href.replace(/\/+$/, '');
  }
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${normalizedBase}duckdb/extensions`, window.location.origin).href.replace(
    /\/+$/,
    '',
  );
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
  private activeBundle: 'eh' | 'mvp' | 'coi' | null = null;
  private activeVersion: string | null = null;
  private bootPromise: Promise<DuckDBBootInfo> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private epoch = 0;

  get isReady(): boolean {
    return this.db !== null && this.conn !== null && this.worker !== null;
  }

  async boot(): Promise<DuckDBBootInfo> {
    if (this.isReady && this.activeBundle && this.activeVersion) {
      return { bundle: this.activeBundle, version: this.activeVersion };
    }
    if (this.bootPromise) {
      return this.bootPromise;
    }

    const myEpoch = this.epoch;
    this.bootPromise = (async () => {
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

        const db = new duckdb.AsyncDuckDB(
          new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
          worker,
        );
        await db.instantiate(selected.mainModule, selected.pthreadWorker);
        await db.open({ path: ':memory:' });
        const conn = await db.connect();

        const extRepoUrl = resolveDuckdbExtensionRepoUrl();
        await conn.query(`SET custom_extension_repository = ${lit(extRepoUrl)};`);
        await conn.query('SET autoinstall_known_extensions = true;');
        await conn.query('SET autoload_known_extensions = true;');
        try {
          await conn.query('INSTALL parquet;');
          await conn.query('LOAD parquet;');
        } catch {
          // Non-fatal if extension load deferred
        }

        const verRes = await conn.query('SELECT version() AS v');
        const version = String(verRes.toArray()[0]?.v ?? '1.32.0');

        if (this.epoch !== myEpoch) {
          await conn.close().catch(() => undefined);
          await db.terminate().catch(() => undefined);
          worker.terminate();
          throw new DOMException('DuckDB boot cancelled.', 'AbortError');
        }

        const bundleName: 'eh' | 'mvp' = selected.mainModule.includes('duckdb-mvp') ? 'mvp' : 'eh';
        this.worker = worker;
        this.db = db;
        this.conn = conn;
        this.activeBundle = bundleName;
        this.activeVersion = version;

        return { bundle: bundleName, version };
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

  async ensureBooted(): Promise<DuckDBBootInfo> {
    return this.boot();
  }

  enqueue<T>(
    task: (conn: duckdb.AsyncDuckDBConnection, db: duckdb.AsyncDuckDB) => Promise<T>,
  ): Promise<T> {
    const taskEpoch = this.epoch;
    const result = this.queue.then(async () => {
      if (taskEpoch !== this.epoch) {
        throw new DOMException('DuckDB task cancelled before execution.', 'AbortError');
      }
      if (!this.conn || !this.db) {
        throw new Error('DuckDB-WASM engine is not booted.');
      }
      return task(this.conn, this.db);
    });

    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async registerFile(file: File, virtualName = file.name): Promise<string> {
    return this.enqueue(async (_conn, db) => {
      await db.registerFileHandle(
        virtualName,
        file,
        duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
        true,
      );
      return virtualName;
    });
  }

  async registerTextFile(virtualName: string, content: string): Promise<string> {
    return this.enqueue(async (_conn, db) => {
      await db.registerFileText(virtualName, content);
      return virtualName;
    });
  }

  async insertArrowIpc(tableName: string, ipcBytes: Uint8Array): Promise<void> {
    return this.enqueue(async (conn) => {
      await conn.query(`DROP TABLE IF EXISTS ${ident(tableName)};`);
      await conn.insertArrowFromIPCStream(ipcBytes.slice(), { name: tableName, create: true });
    });
  }

  async exec(sql: string): Promise<{ elapsedMs: number }> {
    return this.enqueue(async (conn) => {
      const start = performance.now();
      await conn.query(sql);
      return { elapsedMs: performance.now() - start };
    });
  }

  async queryRows(sql: string, maxRows = 2500): Promise<QueryTableResult> {
    return this.enqueue(async (conn) => {
      const start = performance.now();
      const arrowTable = await conn.query(sql);
      const elapsedMs = performance.now() - start;
      return extractArrowTable(arrowTable as unknown as ArrowTableLike, elapsedMs, maxRows);
    });
  }

  async getMemoryUsageBytes(): Promise<number> {
    return this.enqueue(async (conn) => {
      const res = await conn.query(
        'SELECT coalesce(sum(memory_usage_bytes), 0)::BIGINT AS total_bytes FROM duckdb_memory()',
      );
      const raw = res.toArray()[0]?.total_bytes;
      return typeof raw === 'bigint' ? Number(raw) : Number(raw ?? 0);
    });
  }

  async exportTable(tableName: string, format: 'csv' | 'json'): Promise<Uint8Array> {
    return this.enqueue(async (conn, db) => {
      const outName = `__dewpond_export_${Date.now()}.${format}`;
      const options = format === 'csv' ? "(HEADER, DELIMITER ',')" : '(FORMAT JSON, ARRAY true)';
      await conn.query(`COPY ${ident(tableName)} TO ${lit(outName)} ${options}`);
      try {
        const buf = await db.copyFileToBuffer(outName);
        return new Uint8Array(buf);
      } finally {
        await db.dropFile(outName).catch(() => undefined);
      }
    });
  }

  cancelAndReset(): void {
    this.epoch++;
    if (this.worker) {
      this.worker.terminate();
    }
    this.worker = null;
    this.conn = null;
    this.db = null;
    this.activeBundle = null;
    this.activeVersion = null;
    this.bootPromise = null;
    this.queue = Promise.resolve();
  }

  /**
   * Hard-cancel any hung/running DuckDB query by terminating the worker,
   * booting a fresh :memory: instance in a new blob: worker, re-registering all
   * source handles/texts, and replaying compiled Recipe steps up to head.
   */
  async cancelAndReplay(plan: ReplayPlan): Promise<DuckDBBootInfo> {
    this.cancelAndReset();
    const bootInfo = await this.boot();

    for (const source of plan.sources) {
      if (source.arrowIpc && source.arrowStageName) {
        await this.insertArrowIpc(source.arrowStageName, source.arrowIpc);
      } else if (source.file) {
        await this.registerFile(source.file, source.virtualName);
      } else if (source.text !== undefined) {
        await this.registerTextFile(source.virtualName, source.text);
      }
      await this.exec(source.ingestSql);
    }

    for (const stepSql of plan.stepSqls) {
      await this.exec(stepSql);
    }

    return bootInfo;
  }
}
