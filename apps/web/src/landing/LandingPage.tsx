import { useState } from 'react';
import {
  BENCHMARK_METRICS,
  CAPABILITY_PILLARS,
  COMPARISON_ROWS,
  type CapabilityPillar,
  type ComparisonRow,
} from './demoData';
import {
  DewpondLogo,
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconDatabase,
  IconEyeOff,
  IconLock,
  IconShieldCheck,
  IconTerminal,
  IconX,
} from './Icons';
import { WorkbenchShowcase } from './WorkbenchShowcase';

function ComparisonCell({ cell }: { cell: ComparisonRow['dewpond'] }) {
  return (
    <span className={`dp-cmp-cell dp-cmp-${cell.status}`}>
      {cell.status === 'yes' ? <IconCheck className="dp-ico-sm" /> : null}
      {cell.status === 'warn' ? <IconAlertTriangle className="dp-ico-sm" /> : null}
      {cell.status === 'no' ? <IconX className="dp-ico-sm" /> : null}
      <span>{cell.label}</span>
    </span>
  );
}

export function LandingPage() {
  const [selectedPillarId, setSelectedPillarId] = useState<CapabilityPillar['id']>('unmess');
  const activePillar =
    CAPABILITY_PILLARS.find((p) => p.id === selectedPillarId) ?? CAPABILITY_PILLARS[0]!;

  return (
    <div className="dp-page">
      {/* Sticky Top Navigation */}
      <header className="dp-nav-wrap">
        <div className="dp-container dp-nav">
          <a href="#" className="dp-brand">
            <DewpondLogo size={30} />
            <span className="dp-brand-text">
              <strong>Dewpond</strong>
              <small>Local Workbench</small>
            </span>
          </a>

          <nav className="dp-nav-links" aria-label="Primary sections">
            <a href="#showcase">Live Preview</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#benchmarks">Benchmarks</a>
            <a href="#compare">Compare</a>
            <a href="#audit">60s Audit</a>
          </nav>

          <div className="dp-nav-cta">
            <span className="dp-zero-pill" title="Enforced by connect-src 'none' on landing">
              <span className="dp-pulse-dot" aria-hidden="true" />0 B Uploaded
            </span>
            <a className="dp-btn dp-btn-primary dp-btn-sm" href="./app/">
              Launch Workbench <IconArrowRight className="dp-ico-sm" />
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* Editorial Hero + Interactive Product Showcase */}
        <section className="dp-hero-band">
          <div className="dp-container">
            <div className="dp-hero-copy">
              <div className="dp-release-pill">
                <IconShieldCheck className="dp-ico-sm" />
                <span>Apache-2.0 · DuckDB-WASM 1.32.0 · Zero Backend</span>
              </div>

              <h1>A sealed basin for your messy data.</h1>

              <p className="dp-hero-sub">
                Every file becomes an in-browser SQL table. Every click compiles to inspectable
                DuckDB SQL. Drop messy CSV, Parquet, JSON, or Excel exports in a browser tab—stop
                silent coercions before they happen, redact PII locally, and export clean files plus
                reproducible pipelines without a single byte leaving your device.
              </p>

              <div className="dp-hero-actions">
                <a className="dp-btn dp-btn-primary dp-btn-lg" href="./app/">
                  Open Workbench (/app/) <IconArrowRight className="dp-ico-sm" />
                </a>
                <a className="dp-btn dp-btn-secondary dp-btn-lg" href="#audit">
                  <IconTerminal className="dp-ico-sm" />
                  Run 60-Second Privacy Audit
                </a>
              </div>

              <div className="dp-hero-facts">
                <span>
                  <IconLock className="dp-ico-xs" /> This landing page ships zero WebAssembly and
                  enforces <code>connect-src &apos;none&apos;</code>
                </span>
                <span>
                  <IconDatabase className="dp-ico-xs" /> 7.29 MiB gz engine downloads from self only
                  when you boot <code>/app/</code>
                </span>
              </div>
            </div>

            <WorkbenchShowcase />
          </div>
        </section>

        {/* Verified Telemetry Strip */}
        <section className="dp-kpi-band" aria-label="Verified benchmark highlights">
          <div className="dp-container dp-kpi-grid">
            <article className="dp-kpi-card">
              <span className="dp-kpi-label">NETWORK EXFILTRATION</span>
              <strong className="dp-kpi-value">0 Bytes</strong>
              <p>
                Verified in DevTools Network &amp; Offline mode across Chromium, Firefox, WebKit
              </p>
            </article>
            <article className="dp-kpi-card">
              <span className="dp-kpi-label">50 MB CSV → FULL PROFILE</span>
              <strong className="dp-kpi-value">2.12 s</strong>
              <p>Firefox · 2.20 s Chromium via sample-5k strict scoring + streaming cast</p>
            </article>
            <article className="dp-kpi-card">
              <span className="dp-kpi-label">500 MB PARQUET RAM</span>
              <strong className="dp-kpi-value">4.04 MB</strong>
              <p>Lazy range reads query 4.16M rows in 0.50 s without copying the file to JS</p>
            </article>
            <article className="dp-kpi-card">
              <span className="dp-kpi-label">UI RESPONSIVENESS</span>
              <strong className="dp-kpi-value">≤ 33.4 ms</strong>
              <p>Measured max frame gap during 500 MB queries; workers isolate all compute</p>
            </article>
          </div>
        </section>

        {/* Tableau-style Interactive Capability Spotlight */}
        <section id="capabilities" className="dp-section dp-cap-band">
          <div className="dp-container">
            <div className="dp-section-header">
              <p className="dp-eyebrow">BUILT FOR CONSTRAINED ANALYSTS &amp; OPS TEAMS</p>
              <h2>Excel simplicity upfront. DuckDB discipline underneath.</h2>
              <p>
                Explore the four architectural pillars separating Dewpond from spreadsheet guesswork
                and opaque cloud converters.
              </p>
            </div>

            <div className="dp-cap-layout">
              <div className="dp-cap-tabs" role="tablist" aria-label="Dewpond capabilities">
                {CAPABILITY_PILLARS.map((pillar) => {
                  const isActive = pillar.id === activePillar.id;
                  return (
                    <button
                      key={pillar.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={isActive ? 'dp-cap-tab active' : 'dp-cap-tab'}
                      onClick={() => setSelectedPillarId(pillar.id)}
                    >
                      <span className="dp-cap-tag">{pillar.tag}</span>
                      <strong>{pillar.title}</strong>
                    </button>
                  );
                })}
              </div>

              <div className="dp-cap-panel" role="tabpanel" aria-label={activePillar.title}>
                <span className="dp-cap-tag-accent">{activePillar.tag}</span>
                <h3>{activePillar.headline}</h3>
                <p className="dp-cap-desc">{activePillar.description}</p>

                <ul className="dp-cap-list">
                  {activePillar.highlights.map((item) => (
                    <li key={item}>
                      <IconCheck className="dp-ico-ok" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <div className="dp-code-card">
                  <div className="dp-code-head">
                    <span>{activePillar.codeLabel}</span>
                    <span>Pure Local Compile</span>
                  </div>
                  <pre>
                    <code>{activePillar.codeSnippet}</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Power BI-style Measured Benchmarks & Honest Limits */}
        <section id="benchmarks" className="dp-section dp-bench-band">
          <div className="dp-container">
            <div className="dp-section-header">
              <p className="dp-eyebrow">EMPIRICAL BENCHMARKS &amp; HONEST LIMITS</p>
              <h2>Tested before UI polish—with exact ceilings published.</h2>
              <p>
                Measured on a mainstream laptop (Intel Core i5-8350U, 7.1 GiB RAM) using synthetic
                datasets. No cloud GPUs, no cherry-picked hardware.
              </p>
            </div>

            <div className="dp-bench-grid">
              <div className="dp-chart-card">
                <div className="dp-chart-top">
                  <h3>Measured Latency Across Core Workloads</h3>
                  <div className="dp-legend">
                    <span>
                      <i className="dp-dot-chrome" /> Chromium
                    </span>
                    <span>
                      <i className="dp-dot-firefox" /> Firefox
                    </span>
                  </div>
                </div>

                <div className="dp-bars">
                  {BENCHMARK_METRICS.map((m) => (
                    <div key={m.id} className="dp-bar-group">
                      <div className="dp-bar-meta">
                        <strong>{m.workload}</strong>
                        <span>{m.ramNote}</span>
                      </div>
                      <div className="dp-bar-rows">
                        <div className="dp-bar-line">
                          <span className="dp-bar-browser">Chrome</span>
                          <div className="dp-bar-track">
                            <div
                              className="dp-bar-fill chrome"
                              style={{ width: `${Math.max(4, (m.chromiumSec / m.maxSec) * 100)}%` }}
                            />
                          </div>
                          <span className="dp-bar-val">{m.chromiumSec.toFixed(2)} s</span>
                        </div>
                        <div className="dp-bar-line">
                          <span className="dp-bar-browser">Firefox</span>
                          <div className="dp-bar-track">
                            <div
                              className="dp-bar-fill firefox"
                              style={{ width: `${Math.max(4, (m.firefoxSec / m.maxSec) * 100)}%` }}
                            />
                          </div>
                          <span className="dp-bar-val">{m.firefoxSec.toFixed(2)} s</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="dp-limits-card">
                <h3>Published Browser &amp; Format Limits</h3>
                <p className="dp-limits-sub">
                  Browser WebAssembly runs in a 32-bit address space (~2–4 GiB ceiling). Dewpond
                  enforces clear limits instead of crashing tabs silently.
                </p>

                <dl className="dp-limits-list">
                  <div>
                    <dt>Parquet &amp; CSV (Lazy Handle)</dt>
                    <dd>500 MB+ verified crash-free in Chrome &amp; Firefox</dd>
                  </div>
                  <div>
                    <dt>XLSX Workbooks (fflate stream)</dt>
                    <dd>Warn &gt; 25 MB · hard cap 50 MB (XML inflation ~5.8×)</dd>
                  </div>
                  <div>
                    <dt>Chrome / Edge / Firefox Desktop</dt>
                    <dd>Tier 1: Arrow IPC OPFS snapshots restore in 20–87 ms</dd>
                  </div>
                  <div>
                    <dt>Safari / WebKit Desktop</dt>
                    <dd>Tier 2: Clean fallback to in-memory DB + IndexedDB Recipes</dd>
                  </div>
                  <div>
                    <dt>v1 vs. v1.1 Scope Discipline</dt>
                    <dd>v1 ships Unmess + SQL + Redact; Compare (Diff) follows in v1.1</dd>
                  </div>
                </dl>
              </aside>
            </div>
          </div>
        </section>

        {/* Enterprise Comparison Matrix */}
        <section id="compare" className="dp-section dp-cmp-band">
          <div className="dp-container">
            <div className="dp-section-header">
              <p className="dp-eyebrow">WHERE DEWPOND FITS</p>
              <h2>Built for the gap between Excel fragility and Python setup.</h2>
            </div>

            <div className="dp-table-scroll">
              <table className="dp-cmp-table">
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th className="dp-col-highlight">Dewpond</th>
                    <th>Excel / Sheets</th>
                    <th>Online CSV Cleaners</th>
                    <th>Python / pandas</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.capability}>
                      <td className="dp-cmp-req">{row.capability}</td>
                      <td className="dp-col-highlight">
                        <ComparisonCell cell={row.dewpond} />
                      </td>
                      <td>
                        <ComparisonCell cell={row.excel} />
                      </td>
                      <td>
                        <ComparisonCell cell={row.onlineCleaner} />
                      </td>
                      <td>
                        <ComparisonCell cell={row.pythonPandas} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Deep Navy Security Architecture + 60-Second Audit */}
        <section id="audit" className="dp-section dp-audit-band">
          <div className="dp-container dp-audit-grid">
            <div className="dp-arch-col">
              <p className="dp-eyebrow dp-eyebrow-light">VERIFIABLE PRIVACY ARCHITECTURE</p>
              <h2>Don&apos;t trust a privacy policy. Verify the boundary in 60 seconds.</h2>
              <p className="dp-audit-lead">
                Classic HTTP workers silently ignore <code>&lt;meta&gt;</code> Content Security
                Policies on static hosts like GitHub Pages. Dewpond instantiates every worker inside
                a same-origin <code>blob:</code> wrapper so worker fetches inherit strict CSP across
                Chromium, Firefox, and WebKit.
              </p>

              {/* Inline SVG Architecture Topology Diagram */}
              <div className="dp-diagram-card">
                <svg
                  viewBox="0 0 560 270"
                  role="img"
                  aria-label="Dewpond browser sandbox architecture showing local file handles flowing into blob-isolated DuckDB and compute workers with zero external network exits"
                  className="dp-arch-svg"
                >
                  <rect
                    x="10"
                    y="10"
                    width="540"
                    height="250"
                    rx="14"
                    fill="#0B1628"
                    stroke="#284166"
                    strokeWidth="1.5"
                    strokeDasharray="6 4"
                  />
                  <text x="28" y="34" fill="#38BDF8" fontSize="11" fontWeight="700">
                    SEALED BROWSER TAB (/app/) · CSP connect-src &apos;self&apos; · ZERO TELEMETRY
                  </text>

                  {/* User File */}
                  <rect
                    x="28"
                    y="72"
                    width="124"
                    height="76"
                    rx="10"
                    fill="#13233C"
                    stroke="#3B5B8C"
                  />
                  <text x="44" y="102" fill="#F8FAFC" fontSize="13" fontWeight="700">
                    Local Files
                  </text>
                  <text x="44" y="122" fill="#94A3B8" fontSize="11">
                    CSV / Parquet / XLSX
                  </text>

                  {/* Arrow to Workers */}
                  <path d="M152 110H194" stroke="#38BDF8" strokeWidth="2" />
                  <polygon points="194,105 204,110 194,115" fill="#38BDF8" />

                  {/* Blob Workers */}
                  <rect
                    x="206"
                    y="56"
                    width="168"
                    height="56"
                    rx="10"
                    fill="#142C4E"
                    stroke="#1D4ED8"
                    strokeWidth="1.5"
                  />
                  <text x="220" y="80" fill="#FFFFFF" fontSize="12.5" fontWeight="700">
                    DuckDB Worker (blob:)
                  </text>
                  <text x="220" y="98" fill="#BAE6FD" fontSize="10.5">
                    Pinned 1.32.0 · :memory:
                  </text>

                  <rect
                    x="206"
                    y="124"
                    width="168"
                    height="56"
                    rx="10"
                    fill="#142C4E"
                    stroke="#0284C7"
                    strokeWidth="1.5"
                  />
                  <text x="220" y="148" fill="#FFFFFF" fontSize="12.5" fontWeight="700">
                    Compute Worker (blob:)
                  </text>
                  <text x="220" y="166" fill="#BAE6FD" fontSize="10.5">
                    fflate XLSX · PII · Scoring
                  </text>

                  {/* Arrow to Storage / Export */}
                  <path d="M374 110H410" stroke="#34D399" strokeWidth="2" />
                  <polygon points="410,105 420,110 410,115" fill="#34D399" />

                  {/* Outputs */}
                  <rect
                    x="422"
                    y="56"
                    width="110"
                    height="124"
                    rx="10"
                    fill="#0F2A2A"
                    stroke="#059669"
                    strokeWidth="1.5"
                  />
                  <text x="434" y="84" fill="#ECFDF5" fontSize="12" fontWeight="700">
                    Local Outputs
                  </text>
                  <text x="434" y="106" fill="#A7F3D0" fontSize="10.5">
                    Clean Data + .sql
                  </text>
                  <text x="434" y="124" fill="#A7F3D0" fontSize="10.5">
                    .dew.json Recipe
                  </text>
                  <text x="434" y="142" fill="#A7F3D0" fontSize="10.5">
                    IndexedDB / OPFS
                  </text>
                  <text x="434" y="162" fill="#6EE7B7" fontSize="10.5">
                    Redact Report (0 PII)
                  </text>

                  {/* Blocked Exfiltration Boundary */}
                  <rect
                    x="28"
                    y="204"
                    width="504"
                    height="38"
                    rx="8"
                    fill="#2A1215"
                    stroke="#B91C1C"
                  />
                  <text x="44" y="227" fill="#FCA5A5" fontSize="11.5" fontWeight="600">
                    Blocked at Runtime: remote HTTP fetches, external S3/extensions, CDN bundles
                  </text>
                </svg>
              </div>
            </div>

            <div className="dp-steps-col">
              <div className="dp-audit-card">
                <h3>Three-Step InfoSec Verification</h3>
                <ol className="dp-audit-list">
                  <li>
                    <span className="dp-step-num">01</span>
                    <div>
                      <strong>Inspect this landing page (/)</strong>
                      <p>
                        Open <strong>DevTools → Network</strong> and refresh. Confirm zero
                        WebAssembly binaries load on <code>/</code> and{' '}
                        <code>connect-src &apos;none&apos;</code> blocks all runtime connections.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span className="dp-step-num">02</span>
                    <div>
                      <strong>Audit the Workbench (/app/) with sensitive data</strong>
                      <p>
                        Click <strong>Launch Workbench</strong>, boot DuckDB-WASM 1.32.0, clear the
                        Network log, then load files, query SQL, redact PII, and export. Observed
                        network traffic after boot: <strong>0 requests</strong>.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span className="dp-step-num">03</span>
                    <div>
                      <strong>Toggle Offline &amp; reproduce SHA-256 build digests</strong>
                      <p>
                        Enable DevTools <strong>Offline</strong> mode (or host the portable{' '}
                        <code>dist/</code> zip on an internal intranet). Run{' '}
                        <code>pnpm run verify:build</code> locally to check exact engine binary
                        digests.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              <div className="dp-honest-box">
                <div className="dp-honest-head">
                  <IconEyeOff className="dp-ico-sm" />
                  <strong>Honest Browser Boundaries</strong>
                </div>
                <p>
                  No web app can stop browser extensions with host permissions or external link
                  clicks, and in-page request badges are convenience UI—not security proof. DevTools
                  Network inspection, <code>blob:</code> worker CSP, and verifiable build digests
                  are the authoritative guarantees.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Closing Enterprise CTA */}
        <section className="dp-closing-band">
          <div className="dp-container">
            <div className="dp-closing-card">
              <div>
                <p className="dp-eyebrow">READY IN ONE TAB · NO ACCOUNT REQUIRED</p>
                <h2>Open your next messy export inside a sealed basin.</h2>
                <p>
                  All compute happens on your laptop CPU &amp; memory. Close the tab or click Wipe
                  Local Data whenever you finish.
                </p>
              </div>
              <div className="dp-closing-actions">
                <a className="dp-btn dp-btn-primary dp-btn-lg" href="./app/">
                  Launch Workbench <IconArrowRight className="dp-ico-sm" />
                </a>
                <a className="dp-btn dp-btn-ghost-dark dp-btn-lg" href="#showcase">
                  Review Interactive Demo
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Enterprise Footer */}
      <footer className="dp-footer">
        <div className="dp-container dp-footer-grid">
          <div className="dp-footer-brand">
            <div className="dp-brand">
              <DewpondLogo size={26} />
              <span className="dp-brand-text">
                <strong>Dewpond</strong>
                <small>Apache License 2.0</small>
              </span>
            </div>
            <p>
              A browser-only, no-backend data workbench powered by DuckDB-WASM 1.32.0 and strict
              client-side TypeScript workers.
            </p>
          </div>

          <div>
            <h4>Product</h4>
            <ul>
              <li>
                <a href="./app/">Workbench (/app/)</a>
              </li>
              <li>
                <a href="#showcase">Unmess &amp; Type Veto</a>
              </li>
              <li>
                <a href="#capabilities">Redact PII (v1)</a>
              </li>
              <li>
                <a href="#compare">Comparison Matrix</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Verification</h4>
            <ul>
              <li>
                <a href="#benchmarks">Empirical Benchmarks</a>
              </li>
              <li>
                <a href="#audit">60-Second Audit</a>
              </li>
              <li>
                <a href="#benchmarks">Published Format Limits</a>
              </li>
              <li>
                <a href="#audit">Browser Sandbox Model</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Architecture</h4>
            <ul>
              <li>Zero-WASM Landing (/)</li>
              <li>blob:-Isolated Workers</li>
              <li>Deterministic __rid SQL</li>
              <li>Portable dist/ Zip Ready</li>
            </ul>
          </div>
        </div>

        <div className="dp-container dp-footer-bottom">
          <span>Dewpond · Zero Telemetry · Nothing leaves the tab.</span>
          <span>Two-Page Static Vite MPA</span>
        </div>
      </footer>
    </div>
  );
}
