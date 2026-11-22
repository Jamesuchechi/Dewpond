# Dewpond — Architecture

> Companion to [`PRODUCT.md`](./PRODUCT.md). Describes *how* Dewpond is built, why each decision was made, and the empirical constraints verified in [`docs/spikes/00-falsification-report.md`](./docs/spikes/00-falsification-report.md).

---

## 1. Goals and hard constraints

| # | Constraint | Consequence |
|---|---|---|
| C1 | **No backend. Ever.** Static hosting only. | All compute in the browser; no accounts, no sync, no server logs. |
| C2 | **Verifiable privacy.** No user data leaves the device; independently checkable. | Strict CSP enforced on main thread **and workers** (`blob:` wrappers or HTTP headers), self-hosted assets, reproducible builds, offline operation. |
| C3 | **Never silent corruption.** A wrong result presented as right is the worst failure. | Sample-first text scoring with strict integer regex, type veto, `_rejects` quarantine, golden messy-file corpus. |
| C4 | **UI never freezes.** | All DuckDB/XLSX work off main thread (`maxRafGapMs < 50 ms`); cached grid pages; hard-cancellable worker; streaming Arrow results. |
| C5 | **Transparent.** Every action is inspectable as SQL. | Typed Recipe compiler is the single source of truth. |
| C6 | **Honest about limits.** Browser memory & WASM XLSX parsing are finite. | Live memory gauge, lazy `BROWSER_FILEREADER` reads, XLSX cap (warn > 25 MB, hard cap 50 MB), explicit errors. |
| C7 | **Static-host friendly.** Works on GitHub Pages / Vercel / Netlify without COOP/COEP. | Single-threaded DuckDB `eh`/`mvp` only; **`blob:` worker instantiation** when host cannot send HTTP CSP headers on `.js` worker files. |

**Non-goals (architectural):** multi-user collaboration, server-side scheduling, Python runtime, cell-level spreadsheet formulas, v1 cell-level editing.

---

## 2. System context (Two-Page Vite MPA)

Dewpond deploys as a **static Multi-Page Application (MPA)** — native to GitHub Pages, Cloudflare Pages, and Netlify with zero server routing rules:

- **`/` (`apps/web/index.html`):** Zero-WASM, zero-worker static landing page (< 30 KB). Explains the product, threat model, and 60-second audit; routes users to `/app/` without downloading the 7.64 MiB gz DuckDB engine upfront.
- **`/app/` (`apps/web/app/index.html`):** Sealed data workbench dashboard running under strict `<meta>` CSP (`connect-src 'self'`, `worker-src 'self' blob:`) with self-hosted WASM and `blob:`-isolated workers.

```
                    ┌──────────────────────────────────────────────────────┐
                    │               Browser tab (/app/ MPA)                │
                    │                                                      │
  User files ──────►│  Main thread (React UI + orchestrator)               │
  (File picker,     │   ├─ Recipe store (Zustand, autosaved to IndexedDB)  │
   drag-drop,       │   ├─ Grid (cached pages) / SQL / Profile / Wedge UI  │
   FS Access API)   │   └─ Serialized DuckDB client (AsyncDuckDB proxy)    │
                    │            │                         │               │
                    │   postMessage (blob: worker)  Comlink (blob: worker) │
                    │            ▼                         ▼               │
                    │   ┌──────────────────┐     ┌──────────────────────┐  │
                    │   │ DuckDB worker    │     │ Compute worker       │  │
                    │   │  DuckDB-WASM     │◄────│  fflate XLSX stream  │  │
                    │   │  (:memory:, CSV, │Arrow│  Encoding/CRLF fix   │  │
                    │   │  Parquet, JSON)  │ IPC │  PII regex/Luhn      │  │
                    │   └────────┬─────────┘     └──────────────────────┘  │
                    │            │                                         │
                    │   ┌────────▼───────────────────────────────────────┐ │
                    │   │ Storage: IndexedDB (Recipes/prefs), OPFS       │ │
                    │   │ (explicit snapshots, NOT opfs://db), Cache API │ │
                    │   └────────────────────────────────────────────────┘ │
                    │   Service Worker: offline shell, asset precache,     │
                    │   convenience request counter (not security proof)   │
                    └──────────────────────────────────────────────────────┘
                                      ▲ (static assets only, first load)
                              GitHub Pages / Cloudflare Pages / Netlify
```

**Key split:**
1. DuckDB-WASM runs in its own worker (driven through a **strictly serialized** `AsyncDuckDB` queue on the main thread).
2. A single **compute worker** handles work DuckDB doesn't do well offline: `fflate` streaming XLSX parsing/writing, encoding/CRLF/ragged CSV pre-normalization, PII validation, and hashing.
3. Both workers exchange columnar data as **Apache Arrow IPC** buffers via transferables (constructed with CSP-safe `arrow.makeData` + `arrow.makeVector`, avoiding `arrow.tableFromArrays()` which invokes `new Function()`).
4. **Both workers MUST be instantiated via same-origin `blob:` URLs** (when hosted on GitHub Pages without HTTP CSP headers) so they inherit `<meta>` CSP (`connect-src 'self'`).

---

## 3. Technology stack

| Layer | Choice | Rationale & Verification Status |
|---|---|---|
| Language | TypeScript (strict) | Compiler correctness depends on exhaustive types. |
| Build | Vite + pnpm workspaces | First-class bundling; supports `--ignore-scripts` CI installs (`esbuild@0.28.2` verified). |
| UI | React 19 | Familiar ecosystem; virtualized DOM grid. |
| State | Zustand (+ immer) | Plain serializable Recipe store. |
| Worker RPC | Comlink | Typed RPC over `postMessage` with transferable support. |
| Query engine | `@duckdb/duckdb-wasm@1.32.0` (pinned stable, `eh`/`mvp`) | **Verified in D6:** `duckdb-eh.wasm` is 34.24 MB raw / 7.64 MB gz (+ 773 KB / 188 KB worker); `1.32.0` fixes `-dev57.0`'s 0-byte `opfs://` bug, though 50k-row `COPY ... (FORMAT PARQUET)` traps across `1.30.0`–`1.33.1-dev57.0` (use Arrow IPC for OPFS snapshots; evaluate `parquet-wasm` for Parquet export). |
| Data interchange | `apache-arrow@17.0.0` | Native DuckDB IPC format; use `makeData`+`makeVector` (never `tableFromArrays`, which calls `new Function()` under CSP). |
| XLSX read/write | `fflate@0.8.3` (MIT) + streaming chunked XML parser | **Verified (ADR-009):** 421 KB worker bundle; 2.5–3.7× faster than SheetJS; exact `1900`/`1904` UTC dates; zero `'unsafe-eval'`; avoids SheetJS `0.18.5` CVEs / CDN tarball and DuckDB `excel` extension's remote fetch + slowness. |
| SQL editor | CodeMirror 6 + `@codemirror/lang-sql` | Lightweight, schema-aware autocomplete. |
| Grid | TanStack Table + TanStack Virtual | Accessible virtualized grid over cached 500-row Arrow pages. |
| Charts | uPlot | Tiny bundle for profile sparklines. |
| Styling | Tailwind + CSS variables | Design tokens. |
| PWA | `vite-plugin-pwa` (Workbox) | Offline shell, WASM precache, explicit reload prompt. |
| Compression | `CompressionStream` / `DecompressionStream` | Native deflate with 2 MB streaming decompression cap. |
| Tests | Vitest, fast-check, Playwright | Unit, property-based, 3-browser E2E (network-blocked + offline). |
| Lint/format | ESLint (`no-restricted-globals` for network APIs), Prettier | Code-level guard against accidental network calls. |

---

## 4. Repository layout

```
dewpond/
├─ apps/
│  └─ web/                      # Vite MPA (landing `/` + dashboard `/app/`)
│     ├─ index.html             # Landing page `/` (zero WASM, zero workers, < 30 KB)
│     ├─ app/
│     │  └─ index.html          # Sealed workbench `/app/` (strict <meta> CSP + blob: workers)
│     ├─ src/
│     │  ├─ landing/            # Static landing components + audit walkthrough
│     │  ├─ app/                # workbench shell, layout, command palette
│     │  ├─ features/
│     │  │  ├─ ingest/          # drop zone, type-veto screen, date resolver
│     │  │  ├─ profile/
│     │  │  ├─ clean/
│     │  │  ├─ query/
│     │  │  ├─ compare/         # diff (v1.1)
│     │  │  ├─ redact/          # v1 headline: PII scan + mask/hash/generalize/report
│     │  │  └─ export/
│     │  ├─ workers/
│     │  │  ├─ compute.worker.ts
│     │  │  ├─ blob-worker.ts   # fetches same-origin script -> Blob URL worker
│     │  │  └─ duckdb.client.ts # bundle selection + serialized AsyncDuckDB
│     │  └─ store/              # zustand slices
│     └─ public/duckdb/         # self-hosted wasm + worker bundles (sha256-checked)
├─ packages/
│  ├─ recipe/                   # Step types, compiler, migrations, fingerprint, share-sanitizer (pure TS)
│  ├─ ingest/                   # sniffing, header/footer detection, strict type scoring (pure TS)
│  ├─ pii/                      # detectors, validators (Luhn, NG phone/ID formats), actions
│  ├─ sqlkit/                   # identifier quoting, literal escaping, AST/SQL safety allowlist
│  └─ fixtures/                 # messy-file corpus + golden outputs
├─ docs/
│  ├─ adr/
│  ├─ spikes/                   # 00-falsification-report.md
│  ├─ interviews.md             # Week 1 validation script
│  └─ audit.md                  # 60-second privacy audit procedure
└─ scripts/
   ├─ fetch-duckdb.mjs          # downloads + verifies sha256 of pinned wasm assets
   └─ verify-build.mjs          # fails build if dist/ contains external origins
```

**Rule:** `packages/*` are pure and DOM-free so they are unit-testable in Node and reusable by a future CLI. Only `apps/web` touches browser APIs.

---

## 5. Core domain model

```ts
// packages/recipe/src/types.ts

type SourceId = string;
type TableId  = string;
type StepId   = string;

interface SourceRef {
  id: SourceId;
  name: string;
  kind: 'csv' | 'tsv' | 'xlsx' | 'json' | 'ndjson' | 'parquet';
  sheet?: string;
  bytes: number;
  fingerprint: SchemaFingerprint;
  ingest: IngestOptions;
  lastModified: number;
}

interface Recipe {
  version: 1;
  id: string;
  name: string;
  sources: SourceRef[];             // metadata only, never table rows
  steps: Step[];                    // ordered, immutable once applied
  head: number;                     // undo/redo moves head
  createdAt: number;
  updatedAt: number;
}

type Step =
  | { id: StepId; op: 'filter';      table: TableId; predicate: Predicate }
  | { id: StepId; op: 'derive';      table: TableId; column: string; expr: Expr }
  | { id: StepId; op: 'cast';        table: TableId; column: string; to: LogicalType; onFail: 'null' | 'reject' }
  | { id: StepId; op: 'dedupe';      table: TableId; keys: string[]; keep: 'first'|'last'|'most_complete'; orderBy?: string }
  | { id: StepId; op: 'join';        left: TableId; right: TableId; on: JoinKey[]; how: JoinHow; as: TableId }
  | { id: StepId; op: 'redact';      table: TableId; column: string; action: RedactAction }
  | { id: StepId; op: 'createTable'; as: TableId; from: 'query' | 'paste'; sql?: string }
  | { id: StepId; op: 'rawSql';      sql: string; as: TableId; trusted: boolean }
  /* … rename, drop, reorder, trim, case, replace, regexExtract, split, merge, fillNull, parseDate, parseLocaleNumber … */;
```

**Invariants:**
1. **Share-safe Recipe contract:** Structural steps carry zero row data. Steps that can hold user-provided literal values (`filter` constants, `replace` strings) trigger an explicit "review literals before sharing" check on `#r=` / `.dew.json` export. *(Post-v1 cell/row edit steps `setCell`/`insertRows` are barred from share links.)*
2. Steps are **pure descriptions**; SQL is derived, never stored as the primary artifact (except `rawSql`).
3. **Strict determinism:** Applying `steps[0..head]` to identical sources yields identical outputs across runs and sessions. Every `dedupe` / `window` includes `, "__rid" ASC` as a tiebreaker; `redact` shuffle uses keyed `ORDER BY sha256(seed || __rid::VARCHAR)`, never bare `random()`.
4. **Inverse-free undo:** Undo/redo moves `head`; nothing is mutated in place.

### 5.1 Post-v1 Edit Model Constraints (Deferred via ADR-011)

Spike S9 verified that on a 1M-row table:
- Single `setCell` `INSERT INTO __edits` latency is fast (`1.5–2.8 ms` median), and `UNIQUE` probes over the overlay view take `8.7–21.9 ms`.
- However, `OFFSET 500,000` grid page reads took `250–268 ms` (JS-merge) and `717–1,117 ms` (SQL view), `opfs://` consolidation of 10k edits took `5.9–6.2 s`, monotonic `__rid` placed `insertRows(after)` at the end of the table, and `setCell` leaked row values into Recipes.
- **When implemented post-v1**, cell/row editing must use **keyset pagination** (`WHERE __rid > cursor`), a **fractional `ord DOUBLE` order column** for `insertRows(after)`, strict `head`-consistent replay rules for `setCell` on inserted rows, and exclusion from `#r=` share links.

---

## 6. The Recipe compiler (the spine)

```
 UI action ──► Step (typed) ──► validate ──► compile ──► SQL ──► DuckDB (serialized queue)
                  │                                       │
                  ├─► history timeline                    ├─► live SQL preview
                  ├─► .dew.json export (share-checked)    └─► .sql export
                  └─► share link (#fragment)
```

### 6.1 Compilation model

- **Version chain:** `orders` → `orders@s3` → `orders@s7`.
- **Default materialization = view:** `CREATE OR REPLACE VIEW "orders@s7" AS SELECT … FROM "orders@s3"`.
- **Checkpoint = table** when a step is expensive (`dedupe`, `join`), view depth > 8, user exports/pins, or memory pressure warrants caching.
- **Undo/redo** moves `head` and repoints the active alias; old checkpoints are LRU-evicted under memory pressure.

### 6.2 Safety rules for generated SQL

- **Identifiers:** Always quoted via `sqlkit.ident()` (double-quote, escape `"`). Verified safe against hostile identifiers (`"; DROP TABLE x; --`, `🦆 emoji`).
- **Literals:** Escaped via `sqlkit.lit()`. *(Verified: `conn.prepare()` fails with `Binder Error` on `CREATE OR REPLACE VIEW` in DuckDB, so prepared statements cannot replace literal escaping for view-compiled steps.)*
- **`rawSql` steps:** Validated by a statement classifier (allowlist: single `SELECT`/`WITH`; blocks `COPY`, `ATTACH`, `INSTALL`, `LOAD`, `PRAGMA`, `SET`, `duckdb_secrets()`, `glob()`, and any table function referencing `http(s)://`, `s3://`, `opfs://`, or unregistered paths).
- **Golden-SQL snapshot & DuckDB semantic tests:** Every step type has snapshot + execution tests.

### 6.3 Example deterministic compile

```ts
compile({ op: 'dedupe', table: 'customers', keys: ['email'], keep: 'last', orderBy: 'updated_at' })
```
```sql
CREATE OR REPLACE TABLE "customers@s5" AS
SELECT * FROM "customers@s4"
QUALIFY row_number() OVER (
  PARTITION BY lower(trim("email"))
  ORDER BY "updated_at" DESC NULLS LAST, "__rid" ASC
) = 1;
```

---

## 7. DuckDB integration

### 7.1 Bootstrap (`blob:` worker + `:memory:`)

```ts
// apps/web/src/workers/duckdb.client.ts
import * as duckdb from '@duckdb/duckdb-wasm';

const abs = (p: string) => new URL(p, location.origin).href;

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: abs('/duckdb/duckdb-mvp.wasm'), mainWorker: abs('/duckdb/duckdb-browser-mvp.worker.js') },
  eh:  { mainModule: abs('/duckdb/duckdb-eh.wasm'),  mainWorker: abs('/duckdb/duckdb-browser-eh.worker.js') },
};

export async function bootDuckDB() {
  const bundle = await duckdb.selectBundle(BUNDLES);
  // Wrap same-origin worker script in a blob: URL so it strictly inherits index.html <meta> CSP.
  const workerSrc = await (await fetch(bundle.mainWorker!)).text();
  const blobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' }));
  const worker = new Worker(blobUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule);
  URL.revokeObjectURL(blobUrl);
  await db.open({ path: ':memory:' });
  return { db, worker };
}
```

- **No remote bundles or extensions:** `selectBundle` uses self-hosted absolute URLs only; CI fails on external references in `dist/`.
- **Persistence (ADR-010, verified on `1.32.0`):** Pin **`@duckdb/duckdb-wasm@1.32.0`** (avoiding `-dev57.0`, where `opfs://` lost 100% of writes). Two verified persistence primitives work in Chrome & Firefox: (1) explicit **Arrow IPC OPFS snapshots** (`1.76 MB` for 50k typed rows written via `createWritable` / `SyncAccessHandle` in `8–28 ms` and restored via `insertArrowFromIPCStream` in `20–87 ms`), or (2) `opfs://dewpond.db` **with mandatory `CHECKPOINT`** after mutations (since un-checkpointed rows are lost on abrupt tab reload). We keep DuckDB `:memory:` + IndexedDB Recipes + explicit Arrow IPC OPFS snapshots to avoid multi-tab `SyncAccessHandle` locks on an open DB file and display an explicit session-only banner when OPFS fails (e.g., WebKit `UnknownError` / private browsing).
- **Parquet export caveat (D6):** Browser `COPY ... TO 'out.parquet'` on 50k typed rows trapped (`table index is out of bounds`) across `1.30.0`, `1.32.0`, and `1.33.1-dev57.0` (`COPY ... TO 'out.csv'` and `arrow.tableToIPC` both succeeded cleanly). Plan M3 Parquet export via a small JS/WASM writer (`parquet-wasm` / `hyparquet-writer`) unless upstream DuckDB-WASM fixes multi-row-group virtual-FS Parquet writes.

### 7.2 Serialized queue & cancellation

- **Strictly single-worker serialized execution:** Spike S5 proved that a second "read connection" in DuckDB-WASM (`eh` and `coi`) still blocks behind an active `CREATE TABLE AS`. All queries run through a prioritized serialized task queue.
- **Keep scrolling smooth:** Cache the visible grid window (±2 pages of 500 rows) in main-thread JS before triggering heavy materializations.
- **Cancellation:** `connection.cancelSent()` returned `false` on active queries in both `eh` and `coi`. Cancel immediately terminates the worker (`worker.terminate()`), clears stale task handles, spawns a fresh `:memory:` instance, and replays the active Recipe up to `head` (skipping the cancelled step).
- **Streaming results:** Use `conn.send()` for large exports/queries rather than materializing giant JS tables.

### 7.3 Type handling gotchas

- `BIGINT` → JS `BigInt` in Arrow: format directly without coercing to `Number` (preserves 18+ digit IDs > `2^53 - 1`).
- `DECIMAL`, `DATE`, `TIMESTAMP[TZ]`, `HUGEINT`: format from Arrow integer + unit using pure UTC arithmetic — never JS local-timezone `Date` objects.

### 7.4 Threads and cross-origin isolation (ADR-003 — Closed)

**Single-threaded `eh`/`mvp` only.** Spike S5 showed `coi` roughly doubled boot time (`1,332 → 2,587 ms` Chromium) while speeding 1M-row `GROUP BY` by only `1.38×` (Chromium) and `0.98×` (Firefox), and still blocked `readConn` and failed `cancelSent()`. Cross-origin isolation complexity is unjustified for v1.

---

## 8. Ingestion pipeline

```
 File ─► Sniff/Normalize ─► Sample 5k (VARCHAR) ─► Strict Infer ─► [User veto/override] ─► Single-pass Cast ─► Profile
           │                                                                                      │
     BOM/Win-1252/CRLF,                                                                      try_cast +
     fflate XLSX stream                                                                      _rejects
```

### 8.1 Philosophy: **sample-first strict scoring, single streaming cast**

Spike S4/E1 showed materializing an intermediate `t_raw` table and running full-scan regex checks took `12.9–15.3 s` on a 50 MB CSV (`14×` slower than native `read_csv_auto`). Switching to sample-first + single streaming cast brought 50 MB CSV → profile down to **`2.1–2.2 s`**:

1. **Pre-normalize small/medium text files** in compute worker (strip UTF-8 BOM, transcode Windows-1252/Latin-1, normalize mixed `\r\n`/`\r` → `\n`, inspect ragged row widths).
2. **Sample first 5,000 rows as `VARCHAR`** (`read_csv(..., all_varchar=true, header=true) LIMIT 5000`).
3. **Infer types with strict rules:**
   - **NEVER use `try_cast(col AS BIGINT)` as an integer detector** — spike E1 caught DuckDB rounding `'1500.50'` to `1501`! Integer detection **must** pass strict `^[+-]?[0-9]+$` regex before `BIGINT` is offered.
   - Override numeric → `VARCHAR` on: leading zeros (`^0[0-9]+$`), uniform length ≥ 11 digits, ID/phone/bvn/nin/account/zip column names, or already scientific-corrupted strings (`1.23E+10`).
   - Ambiguous slash dates (`d ≤ 12` and `m ≤ 12` everywhere) open the **date resolver**.
4. **Show the veto screen** (column name, detected type, confidence, 5 sample values, override dropdown).
5. **Single streaming typed load:** `CREATE TABLE … AS SELECT row_number() OVER () AS __rid, <safe casts> FROM read_csv(..., all_varchar=true)`; any row failing a cast past row 5,000 is routed to `_rejects` (and if `--strict` full-file verification is requested, run a post-load cast check).

### 8.2 Format specifics

| Format | Strategy |
|---|---|
| **CSV/TSV** | `sniff_csv` + compute-worker normalization (BOM/Win-1252/CRLF/ragged check for files ≤ 50 MB). Files > 50 MB stream lazily via `registerFileHandle` (`BROWSER_FILEREADER`). |
| **XLSX/XLS** | **Compute worker `fflate@0.8.3` streaming ZIP + chunked XML parser** → direct UTF-8 Arrow `makeData`/`makeVector` (CSP-safe) → `insertArrowFromIPCStream`. Reads `workbookPr@date1904` with pure UTC serial math, preserves formula cached `<v>` values, surfaces hidden sheets/rows and merges. Warn > 25 MB; hard cap 50 MB (recommend CSV/Parquet). |
| **JSON/NDJSON** | `read_json_auto` with `union_by_name=true` and `maximum_depth`; nested `STRUCT`/`LIST` surfaced with flatten suggestion. |
| **Parquet** | Direct `read_parquet` via `BROWSER_FILEREADER` (4.04 MB RAM at 500 MB!); schema authoritative. |
| **ZIP/GZ** | Native `DecompressionStream` (stream-capped against zip bombs) for `.gz`; `fflate` entry picker for `.zip`. |

### 8.3 Header and layout detection (`packages/ingest`)

Heuristic scoring over the first ~50 rows:
- **Banner rows** above header → skipped with visible chip.
- **Duplicate headers** → deterministic suffix (`amount`, `amount_2`).
- **Footer/total rows** (`total`/`sum`/`grand`) → flagged and excluded by default (restorable).

### 8.4 Reject quarantine

```sql
CREATE TABLE _rejects (
  source_id VARCHAR, row_number BIGINT, column_name VARCHAR,
  raw_value VARCHAR, target_type VARCHAR, reason VARCHAR
);
```

Always visible with count badge; exported alongside results on request.

---

## 9. Schema fingerprint and Recipe portability

```ts
interface SchemaFingerprint {
  columns: { name: string; type: LogicalType }[];   // lower, trimmed, collapsed whitespace
  hash: string;                                     // sha256 of canonical JSON
}
```

Used for share-link compatibility checks and monthly re-runs with a **column-mapping assistant** when headers drift.

---

## 10. Feature module designs

### 10.1 Profile

- `SUMMARIZE "table"` + targeted SQL probes (mixed-type, whitespace, casing variants, constant columns, key candidates) cached per `(table@step, column)`, each paired with one-click fix steps.

### 10.2 Diff *(v1.1)*

- Key-uniqueness check first; `FULL OUTER JOIN` + `IS DISTINCT FROM` over key columns outputting `added` / `removed` / `changed` / `unchanged` + cell-level diff mask + schema diff.

### 10.3 Redact *(v1 headline workflow)*

- **Scanner:** regex + Luhn / NG phone (`0[789][01]\d{8}`, `+234`) / 11-digit ID validators → human-confirmed suggestions.
- **SQL actions:** mask, salted `sha256(salt || value)` (confirmed available offline in DuckDB-WASM), generalize (`date_trunc`, brackets), deterministic shuffle (`ORDER BY sha256(seed || __rid::VARCHAR)`), drop.
- **Residual-risk check:** `GROUP BY qi HAVING count(*) < k` k-anonymity warning + raw-value-free Markdown/JSON report.

### 10.4 Export

- **CSV/JSON:** `COPY … TO` → `copyFileToBuffer()` → `showSaveFilePicker` / Blob download (`COPY ... TO 'snap.csv'` verified across Chromium, Firefox, WebKit).
- **Parquet export caveat (D6):** Browser `COPY ... TO 'out.parquet'` on 50k typed rows trapped (`table index is out of bounds`) across `@duckdb/duckdb-wasm` `1.30.0`, `1.32.0`, and `1.33.1-dev57.0`. M3 Parquet export uses a lightweight client-side writer (`parquet-wasm` / `hyparquet-writer` fed from `conn.send()` Arrow batches) unless upstream DuckDB-WASM resolves virtual-FS multi-row-group Parquet writes.
- **XLSX:** Compute worker `fflate` writer; preserves text columns (leading zeros), splits > 1,048,576 rows, neutralizes formula prefixes (`=`, `+`, `-`, `@`) by default.

---

## 11. Share links and untrusted Recipes

### 11.1 Format

`https://<host>/app/#r=<base64url(deflate(canonicalJSON(shareSafeRecipe)))>&v=1`

- URL fragment never sent to server; size warning > 8 KB.
- **Share-safe validator:** strips/warns on filter or replace literals before encoding.

### 11.2 Threat model for opened Recipes

1. **Typed steps only** by default; `rawSql` steps from links never execute without diff-style user approval.
2. All identifiers quoted (`sqlkit.ident()`); all view literals escaped (`sqlkit.lit()`).
3. **Path/URL/function allowlist in `sqlkit` + AST validator:** **Do NOT run `SET enable_external_access=false`** (verified to break `registerFile*` virtual files and `COPY TO`). Instead block `http(s)://`, `s3://`, `opfs://`, `glob`, `COPY`, `ATTACH`, `INSTALL`, `LOAD`, `PRAGMA`, `SET`, `duckdb_secrets()` at validation time, and rely on `blob:`-worker CSP (`connect-src 'self'`) at the browser boundary.
4. **Resource caps:** `DecompressionStream` aborted via streaming reader at **2 MB max** (defeating 1028× deflate bombs); step count, join fan-out (row-estimate / `LIMIT` cap), and `PIVOT` column cardinality capped.

---

## 12. Memory, performance, and failure handling

- **32-bit WASM memory ceiling:** Poll `SELECT * FROM duckdb_memory()`. Warn auto-materialization above 70%, evict LRU checkpoints above 85%, catch OOM and restart worker + replay Recipe.
- **Verified performance targets (i5-8350U / 7.1 GiB RAM, `1.32.0`):**
  - Landing page `/` interactive: `< 500 ms` (zero WASM)
  - Dashboard `/app/` cached interactive: `< 1.5 s`
  - Cold DuckDB-WASM boot: `1.2–1.8 s` local (`1.32.0` `eh` bundle is `7.29 MiB gz` / `7.64 MB`; show download progress on broadband)
  - 50 MB CSV → profile: **`< 3 s`** (`2.1–2.2 s` verified)
  - 500 MB CSV / Parquet queryable via `BROWSER_FILEREADER`: **`< 5 s`** (`0.5–4.6 s` verified)
  - Main-thread long tasks: none `> 50 ms` (`maxRafGapMs ≤ 33.4 ms` verified)

---

## 13. Privacy and security architecture

### 13.1 Content Security Policy

```
default-src 'none';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
form-action 'none';
base-uri 'none';
object-src 'none';
```

- **Critical worker rule:** On hosts without HTTP CSP headers (GitHub Pages), every worker **must** be spawned via a same-origin `blob:` URL so it inherits `<meta>` CSP. Classic HTTP worker URLs (`new Worker('/duckdb/...')`) ignore `<meta>` CSP across Chrome, Firefox, and WebKit. On Cloudflare Pages / Netlify, also send the CSP as an HTTP response header on `.html` **and** `.js` worker assets.
- **Caveats documented honestly:** `connect-src 'self'` still permits same-origin requests (mitigated by static hosting with no collection endpoints + reproducible build digests), and CSP does not block top-level link navigations (`<a target="_blank">`) or browser extensions.

### 13.2 The network indicator

- Service worker precaches assets for offline use and surfaces a convenience count of observed fetches (`0` after warm load), while `docs/audit.md` explicitly points users to **DevTools → Network** + **Offline mode** + **build SHA-256 verification** as the real audit (since clean iframes, same-origin WebSockets, and `serviceWorker.unregister()` can bypass JS/SW meters).

### 13.3 Supply-chain integrity

- Lockfile committed; `pnpm install --frozen-lockfile --ignore-scripts` in CI (`esbuild` verified working with `--ignore-scripts`).
- All DuckDB WASM/worker assets SHA-256 verified (`scripts/fetch-duckdb.mjs`); reproducible `dist/` digests published per release.
- `verify-build.mjs` fails CI if `dist/` contains external `http(s)://` origins.

---

## 14. Browser support matrix (Updated from Spikes)

| Browser | Support level | Verified notes |
|---|---|---|
| Chrome / Edge (desktop) | **Tier 1** | Full: FS Access API, `blob:` worker CSP, 500 MB CSV/Parquet, streaming XLSX ≤ 50 MB, explicit OPFS snapshots. |
| Firefox (desktop) | **Tier 1** | No FS Access save picker (download fallback); `blob:` worker CSP, 500 MB CSV/Parquet, streaming XLSX ≤ 50 MB (faster than Chromium!), explicit OPFS snapshots. |
| Safari / WebKit (desktop) | **Tier 2** | `blob:` worker CSP works; OPFS failed in headless Playwright WebKit (`UnknownError`) → falls back cleanly to IndexedDB Recipes + `:memory:` session banner. |
| Mobile browsers | **Tier 3** | Small files only; explicit low-memory warnings. |

---

## 15. Architecture Decision Records (Summary)

| ADR | Decision | Status | Key trade-off |
|---|---|---|---|
| 001 | Recipe of typed steps is source of truth; SQL is derived | Accepted | Upfront design vs. transparency, undo, sharing |
| 002 | Streaming sample-5k strict text scoring + single-pass `all_varchar` + `try_cast` | Accepted | ~1.4–2.0× ingest time vs. zero silent coercion (`14×` faster than materialized 2-pass) |
| 003 | Single-threaded `eh`/`mvp` only (drop COI/pthreads for v1) | Accepted | Only `1.0–1.4×` group-by speedup vs. `2×` slower boot & COOP/COEP complexity |
| 004 | Serialized DuckDB worker + one `fflate`/PII compute worker (`blob:`-wrapped) | Accepted | Two workers vs. nested-worker quirks & `<meta>` CSP inheritance |
| 005 | `blob:`-worker CSP + self-hosted SHA-256 bundles + reproducible builds + DevTools 60s audit | Accepted | Practical verification vs. impossible mathematical proof in JS |
| 006 | TanStack Virtual DOM grid over cached 500-row Arrow pages | Accepted | A11y/control; avoids blocking UI during serialized writes |
| 007 | Views by default, checkpoint tables on cost/depth/pressure | Accepted | Cache management vs. instant undo |
| 008 | Share-safe `#r=` URL fragment Recipes; `rawSql` requires explicit review; AST allowlist | Accepted | Literal-warning friction vs. injection & PII-leak prevention |
| 009 | Streaming `fflate` + chunked XML XLSX parser (warn > 25 MB, cap 50 MB) | Accepted | Custom ~300 LOC parser vs. SheetJS 1904/TZ bugs, 100 MB crash, & off-npm CDN |
| 010 | Pin `@duckdb/duckdb-wasm@1.32.0`: `:memory:` DuckDB + IndexedDB Recipes + explicit Arrow IPC OPFS snapshots (or `opfs://db` + mandatory `CHECKPOINT`) | Accepted | Avoids `-dev57.0` 0-byte OPFS loss, `COPY TO PARQUET` 50k trap, & multi-tab DB locks |
| 011 | Cell/row editing (`setCell`/`insertRows`) deferred to Post-v1 | Deferred | Cuts ~25.5d v1 scope & `OFFSET` read lag; needs fractional `ord` + keyset paging |
| 012 | `.duckdb` `ATTACH`/export & SQLite deferred to Post-v1 | Deferred | Avoids broken VFS `copyFileToBuffer` & 31.7 MB `sql.js` / remote ext |

---

## 16. Resolved Spike Questions (Formerly §22)

1. **`opfs://` persistence?** Broken in `1.33.1-dev57.0` (0-byte loss); fixed in stable `1.32.0` for Chrome/Firefox (`CHECKPOINT` mandatory), still throws `UnknownError` in Playwright WebKit. Explicit Arrow IPC snapshots in OPFS (`20–87 ms` restore) avoid DB handle contention and work alongside IndexedDB Recipes.
2. **`cancelSent()`?** Returns `false` in `eh` and `coi` → solved via `worker.terminate()` + Recipe replay.
3. **`excel` extension in WASM?** Exists, phones `extensions.duckdb.org`, stops on banner blanks, slow (`31.2 s` at 10 MB) → rejected in favor of `fflate` streaming XML (`4.2–6.7 s` at 10 MB).
4. **500 MB ceiling?** Both 500 MB CSV (889 MB RAM) and 500 MB Parquet (4.04 MB RAM) ran in Chrome & Firefox with 0 crashes and `maxRafGapMs ≤ 33.4 ms`.
5. **`enable_external_access=false`?** Breaks virtual registered files & `COPY TO` → replaced by `sqlkit` + AST allowlist + `blob:`-worker CSP.
6. **COI threads worth it?** No (`2×` slower boot, `0.98–1.38×` group-by, still blocks read connection).
7. **`conn.prepare()` for all steps?** Fails on `CREATE VIEW` (`Binder Error`) → use `sqlkit.lit()` for views.
8. **Hash functions offline?** `sha256` and `md5` both built-in offline.
9. **`.duckdb` export/attach?** `copyFileToBuffer` failed (`Error`/`NotFoundError`) → deferred post-v1.
10. **`sqlite` extension?** Phones `extensions.duckdb.org`; `sql.js` is 31.7 MB unpacked → deferred post-v1.
11. **1M-row overlay latency?** `setCell` write is `1.5–2.8 ms`, `OFFSET 500k` view read is `717–1,117 ms`, OPFS consolidation `5.9–6.2 s` → editing deferred post-v1.
12. **1M-row `UNIQUE` check?** `8.7–21.9 ms` median in DuckDB-WASM.
