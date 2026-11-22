import { useRef, useState } from 'react';
import { DuckDBClient } from '../workers/duckdb.client';
import { useWorkspaceStore, type WorkbenchFeature } from '../store/workspace.store';

const FEATURE_TABS: ReadonlyArray<{ id: WorkbenchFeature; label: string; blurb: string }> = [
  {
    id: 'ingest',
    label: 'Unmess / Ingest',
    blurb: 'Drop files, inspect strict type scores, veto coercions.',
  },
  {
    id: 'profile',
    label: 'Profile',
    blurb: 'SUMMARIZE stats, null %, whitespace, casing, key candidates.',
  },
  {
    id: 'clean',
    label: 'Clean',
    blurb: 'Click-to-SQL transforms with __rid deterministic tiebreakers.',
  },
  { id: 'query', label: 'SQL Query', blurb: 'Run local DuckDB SQL across loaded tables.' },
  {
    id: 'redact',
    label: 'Redact (v1)',
    blurb: 'Local PII scan + mask / salted sha256 / generalize / report.',
  },
  {
    id: 'export',
    label: 'Export',
    blurb: 'CSV, Parquet, JSON, small XLSX, plus .sql and .dew.json Recipes.',
  },
];

export function WorkbenchShell() {
  const clientRef = useRef<DuckDBClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new DuckDBClient();
  }

  const {
    engineStatus,
    engineBundle,
    engineError,
    activeFeature,
    recipe,
    setEngineStatus,
    setActiveFeature,
  } = useWorkspaceStore();
  const [probeOutput, setProbeOutput] = useState<string>('Engine idle (not yet booted).');

  async function handleBoot() {
    const client = clientRef.current;
    if (!client) return;
    setEngineStatus('booting');
    try {
      const { bundle } = await client.boot();
      const version = await client.enqueue(async (conn) => {
        const res = await conn.query('SELECT version() AS v');
        return String(res.toArray()[0]?.v ?? 'unknown');
      });
      setEngineStatus('ready', { bundle });
      setProbeOutput(`DuckDB ${version} (${bundle}) booted in :memory: inside a blob: worker.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setEngineStatus('error', { error: message });
      setProbeOutput(`Boot failed: ${message}`);
    }
  }

  function handleCancelReset() {
    clientRef.current?.cancelAndReset();
    setEngineStatus('idle');
    setProbeOutput('Worker terminated cleanly; ready to reboot on demand.');
  }

  const currentTab = FEATURE_TABS.find((t) => t.id === activeFeature) ?? FEATURE_TABS[0]!;

  return (
    <div className="wb-shell">
      <header className="wb-topbar">
        <div className="wb-brand">
          <a href="../" className="wb-back">
            ← Dewpond
          </a>
          <strong>Workbench</strong>
          <span className="wb-badge">connect-src &apos;self&apos; · blob: worker</span>
        </div>
        <div className="wb-engine-controls">
          <span className={`wb-status wb-status-${engineStatus}`}>Engine: {engineStatus}</span>
          {engineBundle ? <span className="wb-meta">({engineBundle})</span> : null}
          <button
            type="button"
            className="wb-btn"
            onClick={() => void handleBoot()}
            disabled={engineStatus === 'booting'}
          >
            {engineStatus === 'booting' ? 'Booting…' : 'Boot DuckDB-WASM 1.32.0'}
          </button>
          <button type="button" className="wb-btn wb-btn-secondary" onClick={handleCancelReset}>
            Hard Cancel / Reset
          </button>
        </div>
      </header>

      <div className="wb-body">
        <nav className="wb-sidebar" aria-label="Workbench modules">
          <p className="wb-sidebar-title">v1 Pipeline</p>
          <ul>
            {FEATURE_TABS.map((tab) => (
              <li key={tab.id}>
                <button
                  type="button"
                  className={tab.id === activeFeature ? 'wb-nav-item active' : 'wb-nav-item'}
                  onClick={() => setActiveFeature(tab.id)}
                >
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
          <p className="wb-sidebar-title">v1.1 Planned</p>
          <p className="wb-note">Compare (Diff) deferred to v1.1 per D4 call.</p>
        </nav>

        <main className="wb-main">
          <h1>{currentTab.label}</h1>
          <p>{currentTab.blurb}</p>

          <section className="wb-panel" aria-label="Milestone M0 status">
            <h2>Engine Probe</h2>
            <p className="wb-probe">{engineError ?? probeOutput}</p>
            <p className="wb-meta">
              Active Recipe: <strong>{recipe.name}</strong> · Steps: {recipe.steps.length} · Head:{' '}
              {recipe.head}
            </p>
          </section>
        </main>
      </div>

      <footer className="wb-footer">
        <span>All compute local (:memory: DuckDB-WASM + pure TypeScript workers).</span>
        <span>Zero backend · Compare (Diff) scheduled for v1.1</span>
      </footer>
    </div>
  );
}
