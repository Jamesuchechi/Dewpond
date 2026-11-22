# 60-Second Privacy Audit

Dewpond asks nobody to trust a privacy claim on faith. Follow this three-part check against either a hosted deployment or your own local `pnpm run build` output.

---

## 1. Zero-WASM Landing Check (`/`)

1. Open **DevTools → Network** before navigating to `/`.
2. Load `/`.
3. Verify no `.wasm` binary or worker script downloads on `/`, and check the `<meta http-equiv="Content-Security-Policy">` tag enforces `connect-src 'none'`.

## 2. Live Workbench Network & Offline Audit (`/app/`)

1. Open `/app/` with **DevTools → Network** open (filter by `Fetch/XHR`, `WS`, and `Other`).
2. Wait for the local shell to finish loading, then click **Boot DuckDB-WASM 1.32.0**.
3. Verify the only network fetches during boot are same-origin `/duckdb/duckdb-*.worker.js` and `/duckdb/duckdb-*.wasm` (or cached locally).
4. **Clear the Network log** (∅), then load/drop a synthetic sensitive file, run SQL / cleaning / redaction, and export results.
5. **Expected result:** **0 network requests** after initial boot.
6. Toggle **Offline** in DevTools (or turn off Wi-Fi) after first load; confirm local SQL execution still succeeds.

## 3. Source & Build Digest Verification

Clone the repository and reproduce the static build checks locally:

```bash
pnpm install --ignore-scripts
pnpm run fetch:duckdb
pnpm run lint
pnpm run test
pnpm run build
pnpm run verify:build
```

`verify:build` fails if:
- `apps/web/dist/index.html` or its JS/CSS bundles mention `duckdb`, `.wasm`, or `AsyncDuckDB`;
- `apps/web/dist/app/index.html` is missing strict `<meta>` CSP (`default-src 'none'`, `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self'`);
- any HTML/JS/CSS asset in `apps/web/dist/` references external origins outside inert XML/SVG namespaces;
- any binary in `apps/web/dist/duckdb/` differs from [`scripts/duckdb-hashes.json`](../scripts/duckdb-hashes.json).

---

## Honest Browser Limitations

- Any in-page network counter is a **convenience indicator, not a security proof**.
- `<meta>` CSP `connect-src 'self'` does not block top-level link navigations (`<a target="_blank">` / `window.open`) or browser extensions with page permissions.
- Classic HTTP `new Worker('/...')` ignores `<meta>` CSP across Chrome, Firefox, and WebKit; Dewpond wraps workers in same-origin `blob:` URLs ([`apps/web/src/workers/blob-worker.ts`](../apps/web/src/workers/blob-worker.ts)) so `<meta>` CSP is inherited even on headerless hosts like GitHub Pages.
