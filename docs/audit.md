# 60-Second Privacy Audit & V1 Launch Verification

Dewpond asks nobody to trust a privacy claim on faith. Every security and offline claim in v1 can be verified in under 60 seconds against a hosted deployment or your own local `pnpm run build` output.

---

## 1. Zero-WASM Landing Check (`/`)

1. Open **DevTools → Network** before navigating to `/`.
2. Load `/`.
3. Verify zero `.wasm` binaries or worker scripts load on `/`, and inspect `<meta http-equiv="Content-Security-Policy">` for `connect-src 'none'`.

## 2. Live Workbench Network & Offline Audit (`/app/`)

1. Open `/app/` with **DevTools → Network** open (filter by `Fetch/XHR`, `WS`, and `Other`).
2. Click **Boot Engine** (DuckDB-WASM 1.32.0).
3. Verify the only network fetches during boot are same-origin `/duckdb/duckdb-*.worker.js`, `/duckdb/duckdb-*.wasm`, and `/duckdb/extensions/v1.4.3/*/*.duckdb_extension.wasm`.
4. **Clear the Network log** (∅), then:
   - Load a local CSV/XLSX/Parquet/JSON file or click **Load Messy Demo (1,200 rows)**,
   - Run **Profile**, **Clean**, **SQL Query**, and **Redact (v1)** (scan PII, apply mask / salted SHA-256 / hash-shuffle, check k-anonymity, download `.json`/`.md` raw-value-free reports),
   - Export **CSV / JSON / NDJSON / Parquet / XLSX**.
5. **Expected result:** **0 network requests** after initial boot.
6. Toggle **Offline** in DevTools after first load and reload `/app/`; confirm the precache Service Worker (`sw.js`) serves the entire workbench and local SQL/redaction/export still succeed.

## 3. Reproducible `dist/` SHA-256 Attestation

Clone the repository and reproduce the build and binary digests locally:

```bash
pnpm install --ignore-scripts
pnpm run fetch:duckdb
pnpm run check
pnpm run format:check
```

Generate a full file-by-file SHA-256 attestation of the static build output:

```bash
(cd apps/web/dist && find . -type f | sort | xargs sha256sum)
```

`scripts/verify-build.mjs` automatically fails the build if:
- `apps/web/dist/index.html` or its JS/CSS bundles mention `duckdb`, `.wasm`, or `AsyncDuckDB`;
- `apps/web/dist/app/index.html` is missing strict `<meta>` CSP (`default-src 'none'`, `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self'`);
- any HTML/JS/CSS asset in `apps/web/dist/` references external origins outside inert XML/SVG namespaces;
- any DuckDB binary or extension in `apps/web/dist/duckdb/` differs from [`scripts/duckdb-hashes.json`](../scripts/duckdb-hashes.json).

---

## 4. Synthetic Sample Datasets Included

- **In-App Messy Fintech Demo (`payroll_export_q4_messy.csv`, 1,200 rows):** Built locally in [`apps/web/src/app/sampleDataset.ts`](../apps/web/src/app/sampleDataset.ts) with synthetic Nigerian phones (`080...`), 11-digit BVNs, synthetic emails, mixed `₦`/`$` currency strings, ambiguous dates, and intentionally bad numeric rows (`_rejects` demonstration).
- **20-File Synthetic Messy Corpus (`packages/fixtures`):** Tested by [`packages/fixtures/src/corpus.test.ts`](../packages/fixtures/src/corpus.test.ts) covering BOM, Windows-1252, mixed `\r\n`/`\r`, ragged rows, merged XLSX banners, 1900/1904 UTC dates, hidden sheets/rows, leading-zero vetoes, and `1500.50` rounding guards.

---

## 5. V1 Architecture Summary & Honest Browser Limitations

- **Why `blob:` Workers:** Classic HTTP `new Worker('/...')` ignores `<meta>` CSP across Chrome, Firefox, and WebKit; Dewpond wraps workers in same-origin `blob:` URLs ([`apps/web/src/workers/blob-worker.ts`](../apps/web/src/workers/blob-worker.ts)) so `<meta>` CSP `connect-src 'self'` is inherited even on headerless hosts like GitHub Pages.
- **In-Page Counters:** Any in-page network counter is a **convenience indicator, not a security proof** — use browser DevTools Network + Offline mode for authoritative verification.
- **Top-Level Navigations:** `<meta>` CSP `connect-src 'self'` does not block top-level `<a target="_blank">` / `window.open` navigations or browser extensions with page permissions.
