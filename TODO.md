# Dewpond — TODO

> Execution plan. Companion to [`PRODUCT.md`](./PRODUCT.md) and [`ARCHITECTURE.md`](./ARCHITECTURE.md).  
> **Legend:** `P0` must-have · `P1` should-have · `🧪` spike · `📄` docs · `🔒` privacy/security-critical · `⏱` focused solo days  
> **Rule:** A milestone isn't done until its **Definition of Done** passes.

---

## Milestone S — De-risking spikes (COMPLETED)

All Milestone S spikes (S1–S9) plus replacement verification checks (R1–R3) were executed empirically against synthetic fixtures. See full evidence, numbers, and resolved ADRs in [`docs/spikes/00-falsification-report.md`](./docs/spikes/00-falsification-report.md).

- [x] 🧪 **S1 · DuckDB-WASM boot, self-hosted** — `eh` raw 35.91 MB / gz 8.06 MB; 0 external requests.
- [x] 🧪 **S2 + R2 · OPFS persistence** — `opfs://db` lost 100% of writes in `1.33.1-dev57.0`; resolved ADR-010 (IndexedDB Recipes + explicit OPFS snapshots).
- [x] 🧪 **S3 + R3 · XLSX path** — Rejected DuckDB `excel` ext & SheetJS; built streaming `fflate@0.8.3` + XML + CSP-safe `arrow.makeData` (`4.2–6.7 s` at 10 MB, exact `1900`/`1904` UTC dates); resolved ADR-009.
- [x] 🧪 **S4 · Big-file memory ceiling** — `50 MB` CSV profiled in `2.1–2.2 s` (sample-first streaming); `500 MB` CSV (889 MB RAM) & `500 MB` Parquet (4.04 MB RAM) ran crash-free in Chrome & Firefox.
- [x] 🧪 **S5 · Cancellation + threads** — `readConn` blocks & `cancelSent()` returns `false`; `coi` skipped; resolved ADR-003 (serialized worker + `worker.terminate()` replay).
- [x] 🧪 **S6 + R1 · Security primitives & CSP** — Proved classic HTTP workers escape `<meta>` CSP; verified `blob:`-wrapped workers inherit `<meta>` CSP in Chrome, Firefox, and WebKit; proved `enable_external_access=false` breaks virtual files.
- [x] 📄 **S7 · Spike report + ADR updates** — Documented in [`docs/spikes/00-falsification-report.md`](./docs/spikes/00-falsification-report.md) and [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- [x] 🧪 **S8 · `.duckdb` attach/export + SQLite** — `copyFileToBuffer` failed on `ATTACH` export and `sqlite` phoned remote CDN; deferred post-v1 (ADR-012).
- [x] 🧪 **S9 · Edit overlay prototype** — `setCell` `1.5–2.8 ms`, but `OFFSET 500k` view `717–1,117 ms`, `insertRows(after)` breaks `__rid` order, and edits leak row PII into Recipes; deferred M2.5 to post-v1 (ADR-011).

---

## Milestone W0 — Week 1 Market & Trust Validation (DECISIONS LOCKED; interviews deferred)

> Use [`docs/interviews.md`](./docs/interviews.md) when revisiting customer discovery. *(Human interviews explicitly deferred per product call on `2026-11-22`; D4 and D2b locked so Milestone M0 can proceed.)*

- [x] **D1 · Name, npm, GitHub, & Domain Check** — Verified `2026-11-22`: `dewpond` npm is free (`404`; fallback `tarn` is taken `3.1.2`); `github.com/dewpond` taken (`200`), `github.com/dewpond-data` free (`404`); `dewpond.app`/`.dev` taken, `dewpond.io`/`.org` free (`RDAP 404`).
- [x] **D6 · Stable DuckDB-WASM Pin & Snapshot Verification** — Verified `2026-11-22`: pinned **`@duckdb/duckdb-wasm@1.32.0`** (`eh` 7.29 MiB gz). Confirmed `blob:` CSP works across Chrome/Firefox/WebKit; `1.32.0` fixes `opfs://db` (with mandatory `CHECKPOINT`) and Arrow IPC OPFS snapshots (`20–87 ms` reload) in Chrome/Firefox; caught 50k `COPY TO PARQUET` trap across `1.30.0`–`1.33.1-dev57.0` (M3 will use `parquet-wasm`/`hyparquet-writer`).
- [ ] P0 Run 10 practitioner interviews (constrained analysts + finance/ops) ⏱3d *(Deferred per product call — revisit post-M0/v1)*
- [ ] P0 Run 3 IT / InfoSec / compliance gatekeeper interviews ⏱1d *(Deferred per product call — revisit post-M0/v1)*
- [x] P0 Lock Decision **D4** & **D2b** ⏱0.5d — **D4:** **Redact** locked as v1 headline workflow (**Diff** moved to v1.1). **D2b:** **Two-page static Vite MPA (`/` + `/app/`) + portable static `dist/` zip** (Tauri offline wrapper stays post-v1).

**DoD (W0):** Technical checks (D1, D6) verified; v1 headline wedge (**Redact**) and distribution target (**static MPA + portable `dist/` zip**) locked in writing; human interviews explicitly deferred rather than waived silently.

---

## Milestone M0 — Two-Page MPA & Privacy-Hardened Skeleton (COMPLETED)

**Goal:** Static zero-WASM landing page (`/`) + sealed dashboard (`/app/`) where you drop a 50 MB CSV/Parquet, run SQL, and see cached virtualized grid results — with `blob:`-worker CSP from day one.

- [x] P0 Create pnpm Vite MPA workspace (`apps/web/index.html` landing `/` + `apps/web/app/index.html` workbench `/app/`, `packages/{recipe,ingest,pii,sqlkit,fixtures}`), TypeScript strict, ESLint (`no-restricted-globals`), Vitest + `fast-check`, Playwright, CI (`--frozen-lockfile --ignore-scripts`)
- [x] P0 `scripts/fetch-duckdb.mjs` (pinned `@duckdb/duckdb-wasm@1.32.0` SHA-256 check via `scripts/duckdb-hashes.json`) + `scripts/verify-build.mjs` (fail on external `http(s)://` in `dist/`, verify `/` ships zero WASM, verify `<meta>` CSP, `_headers`, `sw.js`, `precache-manifest.json`) 🔒
- [x] P0 Core `blob-worker.ts` + `duckdb.client.ts` + `compute.worker.ts`: `blob:`-wrapped DuckDB instantiation, serialized task queue, hard cancel (`worker.terminate()`) with full source/Recipe replay (`cancelAndReplay`) 🔒
- [x] P0 Meta-CSP on `/` & `/app/`, HTTP CSP header config ([`apps/web/public/_headers`](./apps/web/public/_headers) for Cloudflare/Netlify), Service Worker offline precache ([`apps/web/public/sw.js`](./apps/web/public/sw.js) + `precache-manifest.json`), and convenience network status indicator 🔒
- [x] P0 Landing page (`/`) + interactive workbench (`/app/`): drag-and-drop / file picker (`BROWSER_FILEREADER`), CodeMirror 6 SQL editor (`@codemirror/lang-sql`), cached 500-row virtualized grid (`@tanstack/react-virtual`, `BigInt`/UTC-date safe)

**DoD (M0):** Verified `2026-11-23` via `pnpm run test:e2e` ([`scripts/test-m0-e2e.mjs`](./scripts/test-m0-e2e.mjs)) across both **Chromium** and **Firefox** against built `dist/`: (a) **0 external requests** and zero WASM on `/`, (b) `blob:` worker cross-origin `fetch` & `read_csv('http://...')` **blocked by CSP** & `sqlkit`, (c) offline reload (`setOffline(true)`) loads & commits 1,200 rows cleanly, (d) 50.02 MB CSV (`1,018,000` rows) loads + runs `GROUP BY` (`47 ms` Chromium / `88 ms` Firefox) with `maxRafGapMs` = `24.5 ms` (Chromium) / `36 ms` (Firefox) and `29` virtualized DOM rows over cached 500-row Arrow pages, (e) **Hard Cancel** terminates DuckDB mid-query and replays base source + `@s1` cleanly.

---

## Milestone M1 — Unmess + Profile (Weeks 3–4, ⏱12.5d) (COMPLETED)

### Ingestion core (`packages/ingest`, pure TS + tests first)
- [x] P0 Format sniffer + compute-worker pre-normalizer (BOM strip, UTF-8/Windows-1252 transcode, mixed `\r\n`/`\r`, ragged row alignment) ⏱2d
- [x] P0 Sample-5k `all_varchar` SQL scorer (**strict `^[+-]?[0-9]+$` int regex**, leading-zero / ≥11-digit / ID-name vetoes, locale currency/EU decimals) ⏱2.5d
- [x] P0 Date ambiguity resolver (detect disambiguation; UI prompt with both renderings) + Type-veto screen (name, type, confidence, 5 samples, override) ⏱2d
- [x] P0 Single streaming typed load (`try_cast`) + `_rejects` quarantine + JSON/NDJSON + Parquet lazy mode + `duckdb_memory()` gauge ⏱1.5d
- [x] P0 Streaming `fflate` + chunked XML XLSX reader in compute worker (CSP-safe `arrow.makeData`, 1900/1904 UTC dates, merges, hidden sheets/rows, warn > 25 MB, cap 50 MB) ⏱2.5d

### Profile & Messy Corpus
- [x] P0 `SUMMARIZE`-based profile + uPlot sparklines + issue flags (mixed-type, whitespace, casing, constant, key-candidate) with one-click fixes ⏱1d
- [x] P0 `packages/fixtures`: 20-file synthetic messy corpus + golden outputs (incl. `1500.50` rounding guard, Win-1252, mixed CRLF, ragged rows) ⏱1d

**DoD (M1):** All 20 messy corpus files ingest with **zero silent corruption** (`packages/fixtures/src/corpus.test.ts`); 50 MB CSV → `SUMMARIZE` profile in **2.35 s** (Chromium) / **2.96 s** (Firefox) (`< 3 s`); 503.84 MB Snappy Parquet queries via `BROWSER_FILEREADER` with **0.1 MB** DuckDB heap (`< 25 MB`) and 0 external requests (`pnpm run test:m1`).

---

## Milestone M2 — Recipe + Clean + Local Persistence (Weeks 5–6, ⏱10.5d) (COMPLETED)

- [x] P0 `Step` union + JSON Schema validator + share-safe literal checker 🔒 ⏱1.5d
- [x] P0 Deterministic SQL compiler (`sqlkit.ident`/`lit`, `, "__rid" ASC` tiebreakers, view-by-default + checkpoint policy, `head` undo/redo) ⏱2.5d
- [x] P0 Core clean actions (filter, derive, cast, rename, drop, reorder, trim, case, replace, regex extract, split/merge, fill nulls, parse dates/locale numbers, exact dedupe) ⏱3d
- [x] P0 Timeline panel, live SQL preview, `.sql` & `.dew.json` export/import + schema-drift column mapper ⏱1.5d
- [x] P0 `rawSql` statement classifier + `sqlkit` path/URL/function allowlist (NO `enable_external_access=false`) + 2 MB stream-capped `#r=` decoder 🔒 ⏱1d
- [x] P0 Autosave Recipes to IndexedDB + explicit OPFS workspace snapshots (`:memory:` fallback banner) + **"Wipe all local data"** 🔒 ⏱1d

**DoD (M2):** 10-step Recipe replays identically across fresh reloads (`pnpm run test:m2` on Chromium & Firefox); hostile column names, hostile SQL (`packages/sqlkit/src/sqlkit.test.ts`), and hostile/oversized `#r=` shared Recipes (`packages/recipe/src/recipe.test.ts`) pass security suite; reload restores workspace and `Wipe all local data` clears IndexedDB/OPFS/SW caches.

---

## Milestone M3 + V1 — Redact Headline Wedge, Export, & Launch (Weeks 7–8, ⏱9d) (COMPLETED)

### Headline Workflow *(D4 locked: Redact in v1; Diff moves to v1.1)*
- [x] P0 **Redact (`packages/pii`):** Luhn/NG-phone/email/ID detectors with precision/recall fixtures, mask / salted `sha256` / generalize / deterministic hash-shuffle / drop, k-anonymity residual-risk check, raw-value-free JSON/MD report ⏱3.5d

### Export, Audit, & Launch
- [x] P0 CSV / JSON / NDJSON / Parquet (`parquet-wasm` / `hyparquet-writer` — do not rely on raw DuckDB-WASM `COPY TO PARQUET`) / streaming ≤ 50 MB XLSX export (text preserved, formula-neutralization toggle) 🔒 ⏱2d
- [x] P0 Cross-browser E2E matrix (Chromium/Firefox/WebKit, network-blocked + offline), perf-budget CI, crash recovery test ⏱1.5d
- [x] P0 Complete [`docs/audit.md`](./docs/audit.md) (60-second DevTools audit + reproducible `dist/` SHA-256 attestation) + sample synthetic datasets + launch write-up ⏱2.5d

**DoD (V1):** Every milestone DoD green (`pnpm run check`, `pnpm run format:check`, `pnpm run test:e2e`, `pnpm run test:m1`, `pnpm run test:m2`, and `pnpm run test:m3` across Chromium, Firefox, & WebKit); stranger can run the 60-second audit in [`docs/audit.md`](./docs/audit.md) and reproduce the `dist/` SHA-256 digest.

---

## Post-v1 Backlog *(Explicitly Deferred)*

- [x] **v1.1 Headline Workflow — Compare (Diff):** Key picker + uniqueness check, `FULL OUTER JOIN` + `IS DISTINCT FROM` added/removed/changed/unchanged grid + schema diff + CSV/XLSX diff export (`⏱3d`)
- [x] **Cell/row editing (formerly M2.5):** overlay keyed by `__rid` + fractional `ord DOUBLE` ordering + keyset grid paging + share-link exclusion
- [x] **Fuzzy Reconcile & Fuzzy Dedupe** with blocking, tolerance rules, and review queue
- [x] **Pivot / Unpivot** UI step (with column-cardinality cap)
- [x] **`.duckdb` `ATTACH`/export & SQLite support** (pending verified stable DuckDB-WASM `copyFileToBuffer`)
- [x] **Self-contained HTML report** & **reversible tokenization key maps**
- [x] **Optional signed offline desktop wrapper (Tauri)** if InfoSec interviews require it
- [x] **Local-first AI (schema-only NL→SQL)** via WebLLM or opt-in BYO-key with exact-payload preview
- [ ] **pandas / Polars export**, CLI (`dewpond run`), public step-plugin API, PWA file-handler registration
