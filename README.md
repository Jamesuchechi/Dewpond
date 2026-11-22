# Dewpond

> **A sealed basin for your data.**  
> A browser-only, no-backend data workbench powered by DuckDB-WASM. Open messy CSV, Parquet, JSON, or Excel files, repair broken types, clean with clicks that compile to SQL, redact sensitive PII locally *(with structural Diff in v1.1)*, and export both the clean data and the reproducible SQL script — **without a single byte leaving your device.**

**Status:** Milestone M0 *(Spikes S1–S9, R1–R3, & D1/D6 verified; W0 locked **Redact** for v1 & **static Vite MPA + portable `dist/` zip** distribution; user interviews deferred)*  
**License:** [Apache-2.0](./LICENSE) · **Architecture:** Two-page Vite MPA (`/` zero-WASM landing page + `/app/` sealed dashboard; zero backend, zero telemetry)

---

## Why Dewpond?

People working with sensitive exports are stuck picking between bad trade-offs:

- **Excel / Google Sheets:** Silently corrupt data on open — stripping leading zeros from phone numbers (`08012345678`), turning 11-digit IDs (`22123456789`) into scientific notation (`2.21E+10`), flipping `dd/mm` vs `mm/dd` dates — and choke past 1,048,576 rows.
- **Python / pandas:** Fast and reproducible, but requires local environment setup that non-coding ops, finance, and compliance teams don't maintain.
- **Online "CSV cleaner" / converter sites:** Upload sensitive payroll, customer, or bank exports to a third-party server — violating most company data policies.
- **Browser SQL playgrounds (`PondPilot`, `QuackDB`, `sql-workbench.com`):** Great for developers writing SQL, but they assume clean files and don't offer guided messy-Excel repair, quarantine tables (`_rejects`), or PII redaction workflows.

Dewpond closes that gap: **drop a messy file in a browser tab, fix ingestion traps before data is coerced, apply click-based transformations that compile to inspectable SQL, and export.**

---

## Non-Goals (Explicitly Out of Scope)

- **Not a cloud service or BI dashboard:** No backend, no user accounts, no cloud sync, no telemetry.
- **Not a spreadsheet clone:** No cell-level formulas (`=SUM(...)`); the model is typed columns, tables, and replayable SQL steps.
- **Not a Python / Jupyter runtime:** Everything runs in DuckDB-WASM + pure TypeScript Web Workers.
- **Not a 100 MB Excel processor:** Browser ZIP/XML limits make huge `.xlsx` files impractical in WASM (see [Measured Limits](#verified-performance--browser-limits) below).

---

## Core Workflow

1. **Unmess (Text-First Ingest):**
   - Loads CSV/TSV as `VARCHAR` first, sniffs dialect/encoding (UTF-8 BOM, Windows-1252, mixed `\r\n`/`\n`, ragged rows), strips banner/footer total rows, and runs strict regex-guarded type scoring.
   - Leading-zero numbers, uniform ≥11-digit IDs, and ID-named columns (`phone`, `bvn`, `nin`, `account`, `zip`) **default to `VARCHAR`**, never integer/double.
   - Ambiguous slash dates (`03/04/2025`) trigger an explicit day-first vs. month-first resolver with live previews instead of guessing silently.
   - Unparseable values are quarantined into `_rejects` rather than silently dropped or coerced.
2. **Profile & Clean (Click-to-SQL Recipe):**
   - Instant column summary (`SUMMARIZE`), mixed-type / whitespace / casing / constant / key-candidate issue flags, and one-click fixes.
   - Every UI action appends a typed step to a replayable **Recipe** (`.dew.json`) that compiles deterministically to DuckDB SQL (`.sql`), with undo/redo via a non-destructive `head` pointer.
3. **Query (SQL Workbench):**
   - Full DuckDB SQL editor across multiple loaded tables (`JOIN` a CSV to a Parquet to an Excel sheet).
4. **Redact *(v1 Headline Workflow)* & Diff *(v1.1)*:**
   - **Redact (v1):** Local PII scanner (email, E.164 & local `0[789][01]\d{8}` phones, Luhn cards, IBAN, 11-digit IDs) + human-confirmed mask, deterministic salted `sha256` hash, generalization, deterministic shuffle, k-anonymity residual-risk check, and raw-value-free redaction report.
   - **Compare / Diff (v1.1):** `FULL OUTER JOIN` + `IS DISTINCT FROM` over composite keys showing added, removed, changed, and unchanged rows plus schema drift.
5. **Export:**
   - Clean CSV, Parquet, JSON/NDJSON, small/medium XLSX, plus reproducible `.sql` and `.dew.json` Recipes.

---

## Verifiable Privacy Architecture (And Its Honest Boundaries)

Saying "nothing leaves your device" is cheap; Dewpond is designed to let a security engineer verify it in 60 seconds:

1. **Zero remote runtime assets:** DuckDB-WASM binaries and worker scripts are pinned, SHA-256 verified at build time, and self-hosted (`dist/` build verification fails on any external `http(s)://` origin).
2. **CSP enforced on BOTH main thread and workers:**
   - Our security spike proved that `<meta http-equiv="Content-Security-Policy">` alone **does not** protect classic same-origin HTTP workers (`new Worker('/worker.js')`) on headerless static hosts like GitHub Pages — in Chromium, Firefox, and WebKit, classic HTTP workers escaped `<meta>` CSP completely.
   - Therefore Dewpond either serves real **HTTP `Content-Security-Policy` headers on every HTML + JS worker response** (Cloudflare Pages / Netlify) **or instantiates every worker from same-origin `blob:` URLs**, which our spike verified inherit `<meta>` CSP (`connect-src 'self'`) and block DuckDB `read_csv('http://...')` across Chromium, Firefox, and WebKit.
3. **Offline capable:** Service worker precaches the app shell and WASM bundles after first load so everything runs in airplane mode.
4. **Honest boundaries (what the browser cannot prevent on its own):**
   - The footer network indicator is a **UI convenience, not a security proof** (spikes showed clean-realm iframes, same-origin WebSockets, and `serviceWorker.unregister()` can bypass in-page wrappers/SW fetch listeners).
   - `<meta>` CSP `connect-src 'self'` does not block top-level link navigations (`<a target="_blank">` / `window.open`) or browser extensions with page access.
   - **Authoritative 60-second audit:** Open browser DevTools → Network tab (and Offline toggle), drop a sensitive file, run cleaning/export, and confirm **0 requests after load**.

---

## Verified Performance & Browser Limits

Measured before writing app code on a mainstream laptop (**Intel Core i5-8350U, 7.1 GiB RAM**, Chrome 157 / Playwright Chromium-1255, Firefox 154 / Playwright Firefox-1572, Playwright WebKit-2388, `@duckdb/duckdb-wasm@1.33.1-dev57.0`). Full data in [`docs/spikes/00-falsification-report.md`](./docs/spikes/00-falsification-report.md):

| Workload | Chromium | Firefox | WebKit | Notes & Honest Limits |
|---|---|---|---|---|
| **Cold DuckDB-WASM boot** (`1.32.0` `eh` via `blob:` worker, 7.29 MiB gz WASM) | 1.18–1.28 s | 1.59–1.79 s | 2.21–2.84 s | Zero external requests; `eh` raw 34.24 MB / gz 7.64 MB (7.29 MiB) |
| **50 MB CSV (385k × 15) → profile** (sample-5k + streaming `all_varchar` + `try_cast` + `SUMMARIZE`) | **2.20 s** | **2.12 s** | — | `maxRafGapMs ≤ 17.2 ms` (0 UI freezes); naive full-scan 2-pass took 12.9–15.3 s |
| **500 MB CSV (3.8M rows)** lazy `GROUP BY` / full `VARCHAR` load | 2.75 s / 6.71 s | 4.01 s / 8.78 s | — | 889 MB DuckDB RAM if fully materialized; 0 crashes |
| **500 MB Parquet (4.16M rows, Snappy)** `GROUP BY` / `LIMIT 100` / `SUMMARIZE` | 0.53 s / 0.27 s / 8.55 s | 0.50 s / 0.21 s / 9.43 s | — | **4.04 MB** DuckDB RAM via `BROWSER_FILEREADER` |
| **XLSX (streaming `fflate@0.8.3` + XML)** 10 MB / 25 MB / 50 MB | 6.7 s / 12.7 s / 24.8 s | 4.2 s / 8.6 s / 17.0 s | — | Exact 1900/1904 dates; v1 warns > 25 MB, caps at 50 MB (SheetJS failed at 100 MB) |
| **OPFS Persistence** (`1.32.0` `Arrow IPC` snapshot / `opfs://db` + `CHECKPOINT`) | **20–87 ms** / OK | **20–31 ms** / OK | `UnknownError` | Explicit Arrow IPC snapshots verified; Safari/WebKit falls back cleanly to `:memory:` |

---

## Roadmap

Dewpond intentionally prioritizes a tight, high-reliability v1 over breadth:

- **Milestone S (Done):** Falsification spikes S1–S9 + replacement checks R1–R3 — see [`docs/spikes/00-falsification-report.md`](./docs/spikes/00-falsification-report.md).
- **W0 Calls (Locked; interviews deferred):** Locked **Redact** as v1 headline (**Diff** in v1.1) and **static Vite MPA + portable `dist/` zip** distribution; practitioner & InfoSec interviews ([`docs/interviews.md`](./docs/interviews.md)) deferred until M0/M1 prototype.
- **M0 — Two-Page MPA & Privacy-Hardened Skeleton *(In Progress)*:** Zero-WASM landing page (`/`) + sealed workbench (`/app/`), `blob:`-isolated workers, pinned `1.32.0` DuckDB task queue + hard cancel via worker restart, build-time digest & zero-external-origin verification, virtualized grid, SQL editor.
- **M1 — Unmess + Profile:** Streaming sample-first CSV ingest (strict integer regex, no rounding), encoding/newline/ragged repair, date resolver, `_rejects`, `SUMMARIZE` + issue detectors, `fflate` streaming XLSX (≤ 25–50 MB).
- **M2 — Recipe + Clean + Local Persistence:** Deterministic Click-to-SQL compiler (`__rid` tiebreakers), IndexedDB Recipe autosave + explicit OPFS snapshot persistence.
- **M3 — Redact + Export + Launch:** PII detectors + deterministic redaction actions + raw-value-free reports, CSV/Parquet/JSON/XLSX/SQL export, reproducible build SHA-256 digests, 60-second audit guide.
- **Post-v1 Backlog:** **Compare (Diff)** in v1.1, cell/row editing (`setCell`/`insertRows` with fractional order keys & keyset paging), fuzzy reconciliation review queue, `.duckdb`/SQLite import/export, self-contained HTML reports, optional Tauri offline shell, local schema-only AI SQL assist.

---

## Local Development & Verification

Requires **Node >= 20.19** and **pnpm 12+**:

```bash
pnpm install --ignore-scripts   # install workspaces cleanly without postinstall scripts
pnpm run fetch:duckdb           # copy & SHA-256 verify self-hosted DuckDB-WASM 1.32.0 assets
pnpm run check                  # lint + typecheck + vitest + vite MPA build + dist/ audit
pnpm run dev                    # start local Vite MPA dev server (/ and /app/)
```

`pnpm run check` fails if any code under `packages/` or `apps/web/src/` introduces network APIs (`fetch` outside `blob-worker.ts`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`), if the landing page `/` pulls in WASM/DuckDB, or if `apps/web/dist/` references external origins or mismatched WASM SHA-256 digests.

---

## Documentation

| Document | Purpose |
|---|---|
| [`PRODUCT.md`](./PRODUCT.md) | Product spec, personas, narrowed v1 scope, and non-goals |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design, Recipe compiler, CSP/worker security model, and ADRs |
| [`TODO.md`](./TODO.md) | Execution checklist from W0 calls through v1 launch |
| [`docs/spikes/00-falsification-report.md`](./docs/spikes/00-falsification-report.md) | Empirical spike benchmarks, falsified assumptions, and resolved ADRs |
| [`docs/audit.md`](./docs/audit.md) | 60-second browser & build privacy audit procedure |
| [`docs/adr/README.md`](./docs/adr/README.md) | Index of Architecture Decision Records (ADR-001 to ADR-012) |
| [`docs/interviews.md`](./docs/interviews.md) | Customer and InfoSec validation interview script (deferred) |
| [`LICENSE`](./LICENSE) | Apache License 2.0 |

---

## Contributing

The highest-value contributions are **sanitized, synthetic messy-file fixtures** (CSV/XLSX/NDJSON with anonymized headers and dummy rows) that expose real-world parsing edge cases: broken encodings, exotic date formats, merged Excel banners, ragged rows, or currency formatting. Every confirmed parser bug becomes a permanent regression fixture in [`packages/fixtures`](./packages/fixtures).

---

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
