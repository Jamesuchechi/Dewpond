# Dewpond — Product Spec

> **Dewpond**: a sealed basin for your data. A local-first data workbench. Drop a file, get a database. Nothing leaves the tab.

**Status:** Milestone M0 *(W0 decisions locked: **Redact** for v1, **Diff** in v1.1, **static Vite MPA + portable `dist/` zip** distribution; human interviews deferred — see [`docs/spikes/00-falsification-report.md`](./docs/spikes/00-falsification-report.md))* · **License:** [Apache-2.0](./LICENSE) · **Hosting:** Static (zero backend)

---

## 1. One-liner

**Every file is a table. Every click is SQL. Nothing leaves the tab.**

Dewpond opens CSV, Parquet, JSON/NDJSON, and small/medium XLSX files (up to ~25–50 MB) directly in the browser using DuckDB-WASM, lets you repair messy imports, profile, clean, dedupe, query with SQL, **redact sensitive PII locally** *(with structural **Diff** slated for v1.1)*, and export both the clean result *and* the reproducible SQL that produced it.

---

## 2. The problem

People who work with data files are stuck choosing between four bad options:

| Option | Why it fails |
|---|---|
| **Excel / Sheets** | Chokes past ~1M rows. Silently corrupts data: leading zeros stripped from phone numbers, 11-digit IDs turned into `1.23457E+10`, dates flipped between `dd/mm` and `mm/dd`. Not reproducible. |
| **Python / pandas** | Great, but needs setup, and most people who touch data files don't write code. |
| **Online converters / "CSV cleaner" sites** | Upload sensitive customer, payroll, or financial data to a stranger's server. Violates most company data policies. |
| **Browser SQL playgrounds** | Tools like `PondPilot`, `QuackDB`, and `sql-workbench.com` run DuckDB in a tab, but target SQL-fluent developers with clean files rather than guided messy-file repair, `_rejects` quarantine, diffing, or PII redaction. |

The gap: **a serious data tool that is as easy as a converter site, repairs messy exports cleanly, and never touches a server.**

### Real-world pain this targets

- A bank export with BVN/NIN/phone columns that Excel mangles on open.
- A 400 MB transaction CSV that Excel refuses to open.
- An Excel report with merged cells, a 3-row header, and totals rows in the middle of the data.
- Two monthly exports where "what changed?" is answered by squinting.
- A dataset someone needs to share with a vendor *after* removing PII, with no trustworthy tool to do it.

---

## 3. Who it's for

| Persona | Job to be done |
|---|---|
| **The constrained analyst** | Work with company/customer data under NDA or compliance rules, with no permission to use random upload sites. |
| **The ops / finance person** | Fix messy CSV/Excel exports without learning code. Needs click-based tools that don't corrupt data. |
| **The data engineer** | Quick-look at a 500 MB Parquet/CSV file or ad-hoc join without spinning up a notebook or warehouse. |
| **The journalist / researcher** | Handle sensitive or leaked datasets where uploading is not an option. |
| **The SQL learner** | Practice real SQL on real files, with instant feedback and no install. |

**Primary persona for v1:** the constrained analyst + ops person. *(Validation script in [`docs/interviews.md`](./docs/interviews.md); interviews deferred until post-M0 prototype.)*

---

## 4. Principles

1. **Local, and provably so.** Privacy is a verifiable property, not a promise. (See §7.1.)
2. **Transparent by default.** Every UI action compiles to SQL the user can read, edit, and export. No black boxes.
3. **Non-destructive.** The original file is never modified. Every operation produces a new table or a step in a replayable history.
4. **Honest about limits.** Browser memory and WASM XLSX parsing have hard ceilings. Show memory usage, enforce sane caps, and fail cleanly.
5. **Click first, SQL when ready.** Beginners never have to see SQL; power users never have to leave it.
6. **Output is portable.** Results leave as standard files and `.sql` / `.dew.json` scripts. No lock-in.

---

## 5. Core concept: the "Recipe"

The central object in Dewpond is not a file or a query. It is a **Recipe**: an ordered, replayable list of steps applied to one or more source files.

```
Source files → [ step 1 → step 2 → step 3 … ] → Output
                 each step = a UI action = a SQL statement
```

Why this matters:

- **Reproducibility.** Re-run the same Recipe next month on the new export.
- **Auditability.** "What exactly did you do to this data?" has a readable answer.
- **Shareability (Share-Safe subset).** Structural cleaning and query Recipes contain no table rows; any step carrying literal filter constants is flagged before sharing so sensitive literals aren't embedded accidentally (see §7.4).
- **Teachability.** Users learn SQL by watching their clicks turn into it.

Recipes are stored as plain `.dew.json` (steps + SQL + schema fingerprint). Exportable as `.sql`, and post-v1 as a pandas/Polars script.

---

## 6. Feature set (Narrowed v1)

### 6.1 Ingest — "Unmess"

Opening a file is where most tools fail. Dewpond treats ingestion as a first-class feature.

- **Formats:** CSV/TSV (auto-detect delimiter, encoding, quote style, mixed line endings), JSON/NDJSON, Parquet, XLSX (streaming reader in compute worker — warn > 25 MB, hard cap 50 MB; recommend CSV/Parquet above 25 MB), plus ZIP/GZ of these.
- **Smart header detection:** finds the real header row under title banners and merged cells.
- **Multi-row headers** flattened into clean column names.
- **Totals / footer row detection** with a one-click "exclude."
- **Type inference with a veto:** uses sample-5k `VARCHAR` scoring with strict integer regex (avoiding silent decimal rounding) + veto rules before a single streaming cast pass. IDs, phone numbers, and account numbers default to **text**, never number.
- **Date ambiguity resolver:** if `03/04/2025` is ambiguous, Dewpond asks once ("day-first or month-first?") and shows sample rows, rather than guessing.
- **Multi-sheet XLSX** → each sheet becomes a table; hidden sheets/rows are surfaced explicitly.
- **Locale awareness:** `₦1,250,000.50`, `1.250.000,50`, and `(500)` as negative all parse correctly on request.
- **Bad-row quarantine:** malformed rows land in a `_rejects` table, never silently dropped.
- **Big-file mode:** Parquet and CSV up to 500 MB+ are read lazily via `BROWSER_FILEREADER` file handles rather than copied into JS memory.

### 6.2 Profile — instant understanding

On load, Dewpond runs a profile (built on DuckDB's `SUMMARIZE`) and shows:

- Row/column counts, null %, distinct counts, min/max, top values per column.
- Distribution sparkline per column.
- **Issue flags:** mixed types in a column, leading/trailing whitespace, inconsistent casing, near-duplicate categories (`Lagos` / `lagos ` / `LAGOS`), outliers, constant columns, suspected key columns.
- Each flag has a one-click fix that adds a step to the Recipe.

### 6.3 Clean — click to SQL

- Core v1 actions: filter, rename, drop, reorder, trim, case-normalize, replace, regex extract, split/merge columns, fill nulls, cast types (`onFail` → null or `_rejects`), parse dates, locale numbers, derive column.
- **Exact Dedupe:** by key columns, keep newest/oldest/most-complete with deterministic `__rid` tiebreaker.
- Every action shows its compiled SQL live:

```sql
CREATE OR REPLACE TABLE "customers@s5" AS
SELECT * FROM "customers@s4"
QUALIFY row_number() OVER (
  PARTITION BY lower(trim("email"))
  ORDER BY "updated_at" DESC NULLS LAST, "__rid" ASC
) = 1;
```

*(Fuzzy dedupe review queue and pivot/unpivot ship post-v1 unless interviews prioritize them.)*

### 6.4 Query — full SQL workbench

- DuckDB SQL editor (CodeMirror 6) with schema-aware autocomplete.
- Multiple tabs, query history, saved queries, results grid with virtualized scrolling.
- Query across multiple loaded files (`JOIN` a CSV to a Parquet to a sheet).
- Query-plan view (`EXPLAIN`); results → new table or export.

### 6.5 Compare — Diff *(v1.1)*

- Pick key column(s) with key-uniqueness check (blocking warning + dedupe suggestion).
- Built on `FULL OUTER JOIN` + `IS DISTINCT FROM` showing rows **added**, **removed**, **changed** (cell-level before/after highlighting), and **unchanged**, plus schema diff.
- *(Post-v1: Fuzzy Reconcile with blocking, tolerance rules, and review queue.)*

### 6.6 Redact — "Safe to share" *(v1 headline workflow)*

- **Local PII scanner:** detects emails, phone numbers (`+234` / `080x` and E.164), BVN/NIN-style 11-digit IDs, Luhn card numbers, IBAN/account-like patterns, IP addresses, heuristic names (low confidence). Suggestions are always human-confirmed.
- **Per-column actions:** mask (`08******12`), salted `sha256` hash (deterministic so joins survive), generalize (date → month, age → bracket), deterministic hash-seeded shuffle, or drop.
- **Before/after preview**, **residual-risk check** (k-anonymity warning over chosen quasi-identifiers), and **redaction report** (JSON + Markdown with zero raw values).
- *(Post-v1: Reversible tokenization key maps.)*

> **Locked decision (D4):** **Redact** ships in v1 as the flagship workflow alongside Unmess + Clean + SQL; **Diff** ships immediately in v1.1.

### 6.7 Export

- **Files:** CSV, JSON/NDJSON, Parquet, XLSX (≤ 50 MB / 1,048,576 rows per sheet, text columns kept text, optional formula neutralization).
- **Recipe:** `.dew.json`, `.sql`.
- **Copy as:** Markdown table, SQL `INSERT`s, pandas `read_csv` snippet with dtypes.
- *(Post-v1: Self-contained HTML reports, `.duckdb` export, SQLite export.)*

### 6.8 Persistence

- Recipes autosave in **IndexedDB**; workspace table snapshots persist explicitly in **OPFS** as Arrow IPC files (or `1.32.0` `opfs://` with mandatory `CHECKPOINT`) when supported, with an explicit `:memory:` session-only banner when OPFS is unavailable (e.g., private browsing / Safari limits).
- One-click **"Wipe all local data"** clears OPFS, IndexedDB, Cache Storage, and Service Worker caches.

### 6.9 Table Explorer (and Post-v1 Editing)

- **v1 Table explorer ("DB view"):** sidebar of loaded/derived tables with schema, row counts, key candidates, and Recipe lineage; save query results or pasted clipboard CSV/TSV as tables.
- **Post-v1:** Cell/row editing (`setCell`, `insertRows`, `deleteRows` with fractional order keys and keyset paging), schema designer, `.duckdb` `ATTACH`, and SQLite import.

---

## 7. Differentiators

### 7.1 Verifiable privacy, not claimed privacy

- Strict **CSP (`default-src 'none'`, `connect-src 'self'`, `worker-src 'self' blob:`)**, enforced on **both** the page and every worker (via **`blob:`-wrapped workers** on headerless hosts like GitHub Pages, or HTTP CSP headers on all `.html`/`.js` assets on Cloudflare Pages / Netlify).
- Self-hosted DuckDB-WASM bundles pinned by SHA-256; CI fails if `dist/` contains external asset URLs.
- Works offline in **airplane mode** via Service Worker precache.
- **60-second DevTools audit** + reproducible release SHA-256 digests (`docs/audit.md`).
- Live footer indicator shows SW-observed requests (`0`), explicitly documented as a convenience check rather than a security guarantee.

### 7.2 Clicks compile to SQL (the Recipe)

Turns one-off cleanup into repeatable pipelines for non-coders and teaches SQL as a side effect.

### 7.3 Messy-file repair as a headline feature

"Unmess" (§6.1) targets the unglamorous reality of ops and finance exports where Excel and native auto-sniffer tools silently fail or mangle values.

### 7.4 Share the question, not the data

A **Dewpond link** encodes a **share-safe Recipe** (structural steps + schema fingerprint, no row data) in the URL *fragment* (`/app/#r=…&v=1`), which browsers never send to a server. Filter literals trigger an explicit warning and can be redacted before link generation.

### 7.5 Local-first AI (Optional, Post-v1)

Schema-only NL→SQL (column names, types, summary stats — never rows), fully local WebLLM default or BYO-key with exact-payload preview; SQL lands in the editor and never auto-runs.

---

## 8. Non-goals

- **Not a BI/dashboard product.** No server-side scheduling or multi-user dashboards.
- **Not a cloud sync service.** No accounts, no backend, ever.
- **Not a Jupyter replacement.** No Python runtime in v1.
- **Not a spreadsheet clone.** No cell-level formulas; cell/row editing is deferred to post-v1.
- **No telemetry.** Success is measured by public signals (stars, forks, issues), not tracking.

---

## 9. Architecture & Stack Summary

Dewpond is built as a **two-page Vite Multi-Page Application (MPA)** (compatible with GitHub Pages without SPA rewrite rules, and distributable as a portable static `dist/` zip for air-gapped intranets):

- **Landing page (`/`):** Static, zero-WASM marketing, demo, and 60-second audit overview (< 30 KB, instant load).
- **Dashboard (`/app/`):** Sealed data workbench (`React 19` + `TypeScript` + `Zustand` + `CodeMirror 6` + `TanStack Table/Virtual` + `Tailwind`) running under strict `<meta>` CSP (`connect-src 'self'`, `worker-src 'self' blob:`) with:
  - **DuckDB worker (`@duckdb/duckdb-wasm@1.32.0`, single-threaded `eh`/`mvp`, `blob:`-isolated):** serialized task queue, streaming results (`conn.send()`), hard cancel via worker termination + replay.
  - **Compute worker (`Comlink`, `blob:`-isolated):** `fflate` streaming XLSX parser → CSP-safe direct Apache Arrow IPC (`arrow.makeData`), encoding/CRLF/ragged repair, PII regex/Luhn scanner.
  - **Storage:** IndexedDB (Recipes/prefs), explicit Arrow IPC OPFS snapshots (bypassing `opfs://db` locks), Service Worker Cache API (offline assets).

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for full specs, SQL compilation safety, and ADRs.

---

## 10. Hard problems and verified risks

| Risk | Verified Finding | Mitigation |
|---|---|---|
| **Worker CSP bypass on static hosts** | Classic same-origin HTTP workers ignore `<meta>` CSP in Chrome, Firefox, and WebKit. | Wrap all workers in `blob:` URLs (which inherit `<meta>` CSP) or deploy with HTTP CSP headers on worker JS files. |
| **WASM memory ceiling** | DuckDB-WASM is 32-bit (~2–4 GB theoretical max). `500 MB` CSV materialized used 889 MB; `500 MB` Parquet lazy used 4.04 MB. | Prefer `BROWSER_FILEREADER` lazy reads; sample-first ingest; live `duckdb_memory()` gauge; offer "Sample on load". |
| **XLSX XML expansion** | 100 MB `.xlsx` expands to ~581 MB XML (> V8's ~512 MiB string ceiling); SheetJS shifts `1904` dates by 4 years and crashed Firefox at 100 MB; DuckDB `excel` ext phones home and crawls. | Stream ZIP entries chunk-by-chunk with `fflate` + direct UTC serial date math; warn > 25 MB, hard cap at 50 MB. |
| **OPFS database VFS & Parquet export traps** | `opfs://db` lost 100% of writes on `-dev57.0` (fixed in `1.32.0` with `CHECKPOINT`, though WebKit throws `UnknownError`); browser `COPY TO PARQUET` on 50k rows trapped across `1.30.0`–`1.33.1-dev57.0`. | Pin `@duckdb/duckdb-wasm@1.32.0`; keep DuckDB `:memory:` + IndexedDB Recipes + explicit Arrow IPC OPFS snapshots (`20–87 ms`), and use `parquet-wasm`/`hyparquet-writer` for M3 Parquet export. |
| **Blocking worker & `cancelSent()`** | Read connections block behind writes and `cancelSent()` returns `false` in DuckDB-WASM `eh` and `coi`. | Cache visible grid pages in JS; implement Cancel as `worker.terminate()` + state replay. |
| **Silent integer rounding** | DuckDB `try_cast('1500.50' AS BIGINT)` rounds to `1501` instead of returning `NULL`. | Require strict `^[+-]?[0-9]+$` regex before inferring `BIGINT`. |

---

## 11. Narrowed v1 Roadmap (6–8 Weeks Solo)

- **Week 0 (Done):** Spikes S1–S9 + R1–R3 — [`docs/spikes/00-falsification-report.md`](./docs/spikes/00-falsification-report.md).
- **W0 Calls (Locked; interviews deferred):** Locked **Redact** for v1 (**Diff** in v1.1) and **two-page static MPA + portable `dist/` zip** distribution; practitioner & InfoSec interviews ([`docs/interviews.md`](./docs/interviews.md)) deferred until a clickable build exists.
- **M0 (Next):** Privacy-hardened monorepo & MPA skeleton (`blob:` workers, CSP, serialized DuckDB + hard cancel, virtualized grid, SQL editor, 50 MB CSV smoke test).
- **M1:** Unmess ingest (streaming sample-5k CSV, encoding/newline/ragged normalization, `fflate` XLSX ≤ 50 MB, `_rejects`, date resolver) + Profile + 20-file messy corpus.
- **M2:** Click-to-SQL Recipe compiler (`__rid` tiebreakers), core clean ops, exact dedupe, IndexedDB + explicit OPFS snapshot persistence.
- **M3 + V1:** **Redact** headline workflow (`packages/pii` detectors, deterministic salted `sha256` / mask / generalize / hash-shuffle, k-anonymity warning, raw-value-free report), CSV/Parquet/JSON/small-XLSX export, cross-browser E2E (network-blocked + offline), reproducible build SHA-256 digests, 60-second audit guide, launch.

**Post-v1:** **Compare (Diff)** in v1.1, cell/row editing (M2.5), fuzzy reconcile, `.duckdb`/SQLite export, HTML reports, optional Tauri offline wrapper, local schema-only AI SQL assist.

---

## 12. Success metrics (no telemetry)

- GitHub stars / forks / external contributors.
- Issues filed by real users with real sanitized messy files.
- Mentions in privacy/compliance-sensitive communities.
- **Time-to-first-result:** 50 MB CSV → profile on screen in **< 3 seconds** (`2.1–2.2 s` verified in spike).
- **Correctness bar:** **zero silent data corruption** on the published messy-file test suite.

---

## 13. Name: Dewpond

A dew pond is an artificial pond on a hilltop, built where there is no natural surface water — a sealed basin that holds only what you put in it.

**Tagline:** A sealed basin for your data.  
**Naming map:** repo `dewpond` · Recipe files `.dew.json` · share links `https://<host>/app/#r=…`  
**Verified D1 check (`2026-11-22`):**
- **npm (`dewpond`):** Available (`404`); fallback `tarn` is **taken** (`3.1.2`).
- **GitHub:** `github.com/dewpond` is **taken** (`HTTP 200`); `github.com/dewpond-data` is **available** (`404`).
- **Domains (RDAP):** `dewpond.app` and `dewpond.dev` are **taken** (`HTTP 200`); `dewpond.io` and `dewpond.org` are **available** (`404`).
- **Trademark note:** IT consultancy "Dewpond Technologies" exists (`dewpondtechnologies.com`); no competing open-source data workbench found. File formal trademark search only if commercializing.
