import { useState } from 'react';
import {
  applyPreviewRedaction,
  RECIPE_PREVIEW_STEPS,
  REDACT_SQL_BY_MODE,
  SYNTHETIC_SAMPLE_ROWS,
  type RedactPreviewMode,
} from './demoData';
import { IconAlertTriangle, IconCheck, IconLock, IconShieldCheck } from './Icons';

type ShowcaseTab = 'unmess' | 'redact' | 'recipe';

const DISTRIBUTION_BARS = [18, 34, 68, 92, 54, 41, 27, 14] as const;

export function WorkbenchShowcase() {
  const [activeTab, setActiveTab] = useState<ShowcaseTab>('unmess');
  const [excelMode, setExcelMode] = useState(false);
  const [redactMode, setRedactMode] = useState<RedactPreviewMode>('mask');
  const [activeStepIndex, setActiveStepIndex] = useState(2);

  const selectedRecipeStep =
    RECIPE_PREVIEW_STEPS[activeStepIndex] ?? RECIPE_PREVIEW_STEPS[RECIPE_PREVIEW_STEPS.length - 1]!;

  return (
    <div
      id="showcase"
      className="dp-showcase-frame"
      aria-label="Interactive Dewpond Workbench Preview"
    >
      {/* Window Chrome */}
      <div className="dp-frame-chrome">
        <div className="dp-frame-left">
          <div className="dp-window-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="dp-frame-title">
            <code>payroll_export_q4.csv</code>
            <span className="dp-frame-dim">· 385,420 rows · 49.8 MB synthetic demo</span>
          </span>
        </div>

        <div className="dp-frame-status">
          <span className="dp-status-chip">
            <IconLock className="dp-ico-xs" />
            <code>blob:</code> isolated worker · 0 B sent
          </span>
        </div>
      </div>

      {/* Mode Switcher Toolbar */}
      <div className="dp-showcase-toolbar">
        <div className="dp-tab-group" role="tablist" aria-label="Workbench workflow previews">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'unmess'}
            className={activeTab === 'unmess' ? 'dp-tab active' : 'dp-tab'}
            onClick={() => setActiveTab('unmess')}
          >
            1. Unmess &amp; Type Veto
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'redact'}
            className={activeTab === 'redact' ? 'dp-tab active' : 'dp-tab'}
            onClick={() => setActiveTab('redact')}
          >
            2. Redact PII (v1)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'recipe'}
            className={activeTab === 'recipe' ? 'dp-tab active' : 'dp-tab'}
            onClick={() => setActiveTab('recipe')}
          >
            3. Recipe &amp; SQL Lineage
          </button>
        </div>

        {activeTab === 'unmess' ? (
          <div className="dp-mode-toggle" role="group" aria-label="Toggle ingestion behavior">
            <button
              type="button"
              className={!excelMode ? 'dp-pill active-safe' : 'dp-pill'}
              onClick={() => setExcelMode(false)}
            >
              Dewpond Strict Veto
            </button>
            <button
              type="button"
              className={excelMode ? 'dp-pill active-warn' : 'dp-pill'}
              onClick={() => setExcelMode(true)}
            >
              Excel Default (Corrupted)
            </button>
          </div>
        ) : null}

        {activeTab === 'redact' ? (
          <div className="dp-mode-toggle" role="group" aria-label="Select redaction strategy">
            {(
              [
                ['mask', 'Mask'],
                ['hash', 'Salted SHA-256'],
                ['generalize', 'Generalize'],
                ['raw', 'Raw Source'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={redactMode === mode ? 'dp-pill active-safe' : 'dp-pill'}
                onClick={() => setRedactMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {activeTab === 'recipe' ? (
          <div className="dp-recipe-badge">
            <span className="dp-head-dot" aria-hidden="true" />
            Recipe head: <strong>{selectedRecipeStep.id}</strong> ({selectedRecipeStep.rowsOut}{' '}
            rows)
          </div>
        ) : null}
      </div>

      {/* Main Split Workspace Body */}
      <div className="dp-showcase-body">
        {/* Left Data Grid / Timeline */}
        <div className="dp-showcase-main">
          {activeTab === 'unmess' ? (
            <div className="dp-grid-wrap">
              <table className="dp-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>tx_id</th>
                    <th>
                      phone{' '}
                      <span className={excelMode ? 'dp-type-tag bad' : 'dp-type-tag ok'}>
                        {excelMode ? 'INT (stripped 0)' : 'VARCHAR · veto'}
                      </span>
                    </th>
                    <th>
                      bvn{' '}
                      <span className={excelMode ? 'dp-type-tag bad' : 'dp-type-tag ok'}>
                        {excelMode ? 'FLOAT (E+10)' : 'VARCHAR · 11-digit'}
                      </span>
                    </th>
                    <th>
                      amount{' '}
                      <span className={excelMode ? 'dp-type-tag bad' : 'dp-type-tag ok'}>
                        {excelMode ? 'BIGINT (rounded)' : 'DOUBLE · exact'}
                      </span>
                    </th>
                    <th>
                      tx_date{' '}
                      <span className={excelMode ? 'dp-type-tag bad' : 'dp-type-tag warn'}>
                        {excelMode ? 'guessed MDY' : 'ASK DMY / MDY'}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SYNTHETIC_SAMPLE_ROWS.map((row) => (
                    <tr key={row.rid}>
                      <td className="dp-num dp-muted-cell">{row.rid}</td>
                      <td className="dp-mono">{row.tx_id}</td>
                      <td
                        className={excelMode ? 'dp-mono dp-cell-corrupt' : 'dp-mono dp-cell-safe'}
                      >
                        {excelMode ? row.excel_phone : row.phone}
                      </td>
                      <td
                        className={excelMode ? 'dp-mono dp-cell-corrupt' : 'dp-mono dp-cell-safe'}
                      >
                        {excelMode ? row.excel_bvn : row.bvn}
                      </td>
                      <td
                        className={
                          excelMode
                            ? 'dp-num dp-mono dp-cell-corrupt'
                            : 'dp-num dp-mono dp-cell-safe'
                        }
                      >
                        {excelMode ? row.excel_amount : row.amount}
                      </td>
                      <td className={excelMode ? 'dp-mono dp-cell-corrupt' : 'dp-mono dp-cell-ask'}>
                        {excelMode ? row.excel_date : row.tx_date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {activeTab === 'redact' ? (
            <div className="dp-grid-wrap">
              <table className="dp-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>tx_id</th>
                    <th>email</th>
                    <th>phone</th>
                    <th>bvn</th>
                    <th>amount</th>
                    <th>tx_date</th>
                  </tr>
                </thead>
                <tbody>
                  {SYNTHETIC_SAMPLE_ROWS.map((raw) => {
                    const row = applyPreviewRedaction(raw, redactMode);
                    return (
                      <tr key={row.rid}>
                        <td className="dp-num dp-muted-cell">{row.rid}</td>
                        <td className="dp-mono">{row.tx_id}</td>
                        <td className="dp-mono">{row.email}</td>
                        <td className="dp-mono">{row.phone}</td>
                        <td className="dp-mono">{row.bvn}</td>
                        <td className="dp-num dp-mono">{row.amount}</td>
                        <td className="dp-mono">{row.tx_date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {activeTab === 'recipe' ? (
            <div className="dp-recipe-view">
              <div className="dp-step-list" role="list" aria-label="Interactive Recipe steps">
                {RECIPE_PREVIEW_STEPS.map((step, idx) => {
                  const active = idx === activeStepIndex;
                  const applied = idx <= activeStepIndex;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      className={
                        active
                          ? 'dp-step-card active'
                          : applied
                            ? 'dp-step-card applied'
                            : 'dp-step-card'
                      }
                      onClick={() => setActiveStepIndex(idx)}
                    >
                      <div className="dp-step-head">
                        <span className="dp-step-id">
                          {step.id} · {step.badge}
                        </span>
                        <span className="dp-step-rows">{step.rowsOut} rows</span>
                      </div>
                      <strong>{step.label}</strong>
                      <p>{step.summary}</p>
                    </button>
                  );
                })}
              </div>
              <pre className="dp-sql-block">
                <code>{selectedRecipeStep.sql}</code>
              </pre>
            </div>
          ) : null}
        </div>

        {/* Right Analytical Inspector Panel */}
        <aside className="dp-showcase-inspector" aria-label="Column and Audit Inspector">
          {activeTab === 'unmess' ? (
            <>
              <div className="dp-insp-header">
                <span>COLUMN INSPECTOR</span>
                <span className={excelMode ? 'dp-insp-badge warn' : 'dp-insp-badge ok'}>
                  {excelMode ? '4 silent coercions' : '0 corruptions'}
                </span>
              </div>
              <div className="dp-insp-metrics">
                <div>
                  <small>Scanned Sample</small>
                  <strong>5,000 rows</strong>
                </div>
                <div>
                  <small>Profile Speed</small>
                  <strong>2.12 s total</strong>
                </div>
              </div>
              <div className="dp-spark-box">
                <small>amount distribution (strict DOUBLE)</small>
                <div className="dp-spark-bars" aria-hidden="true">
                  {DISTRIBUTION_BARS.map((pct, i) => (
                    <span key={i} style={{ height: `${pct}%` }} />
                  ))}
                </div>
              </div>
              <ul className="dp-insp-checks">
                <li>
                  {excelMode ? (
                    <IconAlertTriangle className="dp-ico-warn" />
                  ) : (
                    <IconCheck className="dp-ico-ok" />
                  )}
                  <span>
                    <code>phone</code>: leading zero veto preserves <code>08012345678</code>
                  </span>
                </li>
                <li>
                  {excelMode ? (
                    <IconAlertTriangle className="dp-ico-warn" />
                  ) : (
                    <IconCheck className="dp-ico-ok" />
                  )}
                  <span>
                    <code>bvn</code>: uniform 11-digit ID stays <code>VARCHAR</code>
                  </span>
                </li>
                <li>
                  {excelMode ? (
                    <IconAlertTriangle className="dp-ico-warn" />
                  ) : (
                    <IconCheck className="dp-ico-ok" />
                  )}
                  <span>
                    <code>amount</code>: strict <code>^[+-]?[0-9]+$</code> catches <code>.50</code>
                  </span>
                </li>
              </ul>
            </>
          ) : null}

          {activeTab === 'redact' ? (
            <>
              <div className="dp-insp-header">
                <span>PII AUDIT &amp; RISK CHECK</span>
                <span className="dp-insp-badge ok">
                  <IconShieldCheck className="dp-ico-xs" /> k = 14 ≥ 5
                </span>
              </div>
              <div className="dp-insp-metrics">
                <div>
                  <small>Detectors Fired</small>
                  <strong>Email · NG Phone · BVN</strong>
                </div>
                <div>
                  <small>Raw Values in Report</small>
                  <strong>0 strings</strong>
                </div>
              </div>
              <p className="dp-insp-sub">Compiled DuckDB Redaction View</p>
              <pre className="dp-sql-mini">
                <code>{REDACT_SQL_BY_MODE[redactMode]}</code>
              </pre>
            </>
          ) : null}

          {activeTab === 'recipe' ? (
            <>
              <div className="dp-insp-header">
                <span>REPLAY INTEGRITY</span>
                <span className="dp-insp-badge ok">Deterministic</span>
              </div>
              <div className="dp-insp-metrics">
                <div>
                  <small>Active Alias</small>
                  <strong>payroll_q4@{selectedRecipeStep.id}</strong>
                </div>
                <div>
                  <small>Tie-Breaker Key</small>
                  <strong>&quot;__rid&quot; ASC</strong>
                </div>
              </div>
              <ul className="dp-insp-checks">
                <li>
                  <IconCheck className="dp-ico-ok" />
                  <span>Click any step on the left to move head without deleting history</span>
                </li>
                <li>
                  <IconCheck className="dp-ico-ok" />
                  <span>Share links warn before embedding filter literals</span>
                </li>
                <li>
                  <IconCheck className="dp-ico-ok" />
                  <span>
                    Exports cleanly as <code>.dew.json</code> or standalone <code>.sql</code>
                  </span>
                </li>
              </ul>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
