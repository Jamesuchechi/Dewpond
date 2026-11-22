export function LandingPage() {
  return (
    <main className="dp-landing">
      <header className="dp-hero">
        <p className="dp-kicker">Dewpond · Browser-Only Data Workbench</p>
        <h1>A sealed basin for your data.</h1>
        <p className="dp-subtitle">
          Every file is a table. Every click compiles to inspectable SQL. Drop messy CSV, Parquet,
          JSON, or Excel files in a browser tab, fix coercion traps, redact PII locally, and export
          clean data plus a reproducible SQL script — with zero backend.
        </p>
        <div className="dp-actions">
          <a className="dp-btn dp-btn-primary" href="./app/">
            Open Workbench (/app/)
          </a>
          <a className="dp-btn dp-btn-secondary" href="#audit">
            60-Second Privacy Audit
          </a>
        </div>
        <p className="dp-meta">
          This landing page ships zero WebAssembly and zero workers (`connect-src 'none'`). The 7.29
          MiB gz DuckDB-WASM engine loads only when you open <code>/app/</code> and boot it.
        </p>
      </header>

      <section className="dp-grid" aria-label="Core v1 capabilities">
        <article className="dp-card">
          <h2>1. Unmess Before Casting</h2>
          <p>
            Sample-first text scoring guards integers with strict regexes, preserves leading-zero
            phone numbers and 11-digit IDs as text, resolves ambiguous <code>dd/mm</code> dates with
            you, and quarantines bad rows into <code>_rejects</code>.
          </p>
        </article>
        <article className="dp-card">
          <h2>2. Click-to-SQL Recipes</h2>
          <p>
            Every transform records a typed step in an immutable Recipe with deterministic{' '}
            <code>__rid</code> tiebreakers, undo/redo via a <code>head</code> pointer, and{' '}
            <code>.dew.json</code> / <code>.sql</code> exports.
          </p>
        </article>
        <article className="dp-card">
          <h2>3. Local PII Redact (v1)</h2>
          <p>
            Validate emails, Luhn payment cards, E.164 and local phone numbers, and 11-digit IDs in
            your browser, then apply masks, salted <code>sha256</code> hashes, generalizations, or
            hash-seeded shuffles with a raw-value-free report.
          </p>
        </article>
      </section>

      <section id="audit" className="dp-audit">
        <h2>60-Second Privacy Audit</h2>
        <ol>
          <li>
            Open <strong>DevTools → Network</strong> before opening <code>/app/</code>.
          </li>
          <li>
            Boot the local DuckDB-WASM engine, drop a sensitive file, run SQL, and export — confirm
            zero network requests occur after initial asset load.
          </li>
          <li>
            Verify offline operation by toggling <strong>Offline</strong> in DevTools or disabling
            Wi-Fi after first load, or host the built static <code>dist/</code> folder internally.
          </li>
        </ol>
        <p className="dp-honest">
          <strong>Honest browser boundaries:</strong> In-page request counters and{' '}
          <code>&lt;meta&gt;</code> CSP are paired with <code>blob:</code>-isolated workers and
          reproducible build digests; DevTools Network monitoring and offline mode remain the
          authoritative verification checks.
        </p>
      </section>
    </main>
  );
}
