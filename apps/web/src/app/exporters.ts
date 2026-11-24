import { strToU8, zipSync } from 'fflate';
import { parquetWriteBuffer } from 'hyparquet-writer';
import type { GridColumnMeta } from './arrowFormat';

export const XLSX_EXPORT_CAP_BYTES = 50 * 1024 * 1024;
const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

/** Prefix spreadsheet formula triggers (=, +, -, @, tab, CR) with ' when neutralization is enabled. */
export function neutralizeSpreadsheetFormula(value: string, enabled: boolean): string {
  if (!enabled || value.length === 0) return value;
  return FORMULA_PREFIX_REGEX.test(value) ? `'${value}` : value;
}

function escapeCsvCell(raw: string): string {
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function escapeXmlText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colLetter(zeroBased: number): string {
  let n = zeroBased + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Build RFC-4180 UTF-8 CSV bytes with optional formula-injection neutralization. */
export function buildCsvExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
  neutralizeFormulas: boolean,
): Uint8Array {
  const lines: string[] = [columns.map((c) => escapeCsvCell(c.name)).join(',')];
  for (const row of rows) {
    const cells = columns.map((_col, idx) => {
      const val = row[idx];
      if (val === null || val === undefined) return '';
      return escapeCsvCell(neutralizeSpreadsheetFormula(val, neutralizeFormulas));
    });
    lines.push(cells.join(','));
  }
  return strToU8(`${lines.join('\n')}\n`);
}

/** Build JSON array bytes. */
export function buildJsonExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
): Uint8Array {
  const objects = rows.map((row) => {
    const obj: Record<string, string | null> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]!.name] = row[i] ?? null;
    }
    return obj;
  });
  return strToU8(`${JSON.stringify(objects, null, 2)}\n`);
}

/** Build newline-delimited JSON (NDJSON) bytes. */
export function buildNdjsonExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
): Uint8Array {
  const lines = rows.map((row) => {
    const obj: Record<string, string | null> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]!.name] = row[i] ?? null;
    }
    return JSON.stringify(obj);
  });
  return strToU8(lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

/** Build Parquet bytes via pure-JS hyparquet-writer (avoids raw DuckDB-WASM COPY TO PARQUET). */
export function buildParquetExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
): Uint8Array {
  const columnData = columns.map((col, colIdx) => {
    const upperType = col.type.toUpperCase();
    if (upperType.includes('INT')) {
      return {
        name: col.name,
        data: rows.map((r) => {
          const v = r[colIdx];
          if (v === null || v === undefined || v === '') return null;
          const num = Number(v);
          return Number.isFinite(num) ? Math.trunc(num) : null;
        }),
      };
    }
    if (
      upperType.includes('FLOAT') ||
      upperType.includes('DOUBLE') ||
      upperType.includes('DECIMAL')
    ) {
      return {
        name: col.name,
        data: rows.map((r) => {
          const v = r[colIdx];
          if (v === null || v === undefined || v === '') return null;
          const num = Number(v);
          return Number.isFinite(num) ? num : null;
        }),
      };
    }
    if (upperType.includes('BOOL')) {
      return {
        name: col.name,
        data: rows.map((r) => {
          const v = r[colIdx];
          if (v === null || v === undefined) return null;
          return v === 'true' || v === '1';
        }),
      };
    }
    return {
      name: col.name,
      data: rows.map((r) => r[colIdx] ?? null),
    };
  });

  const arrayBuffer = parquetWriteBuffer({ columnData });
  return new Uint8Array(arrayBuffer);
}

/**
 * Build a valid <= 50 MB OOXML .xlsx workbook via fflate with text preservation (inlineStr)
 * and optional formula-injection neutralization.
 */
export function buildXlsxExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
  neutralizeFormulas: boolean,
): Uint8Array {
  const rowXmlParts: string[] = [];

  const headerCells = columns
    .map(
      (col, cIdx) =>
        `<c r="${colLetter(cIdx)}1" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(col.name)}</t></is></c>`,
    )
    .join('');
  rowXmlParts.push(`<row r="1">${headerCells}</row>`);

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx]!;
    const excelRow = rIdx + 2;
    const cellsXml: string[] = [];

    for (let cIdx = 0; cIdx < columns.length; cIdx++) {
      const raw = row[cIdx];
      if (raw === null || raw === undefined) continue;
      const safe = neutralizeSpreadsheetFormula(raw, neutralizeFormulas);
      const ref = `${colLetter(cIdx)}${excelRow}`;
      cellsXml.push(
        `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(safe)}</t></is></c>`,
      );
    }
    rowXmlParts.push(`<row r="${excelRow}">${cellsXml.join('')}</row>`);
  }

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowXmlParts.join('')}</sheetData>` +
    '</worksheet>';

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="DewpondExport" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>';

  const workbookRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  const zipped = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypesXml),
      '_rels/.rels': strToU8(rootRelsXml),
      'xl/workbook.xml': strToU8(workbookXml),
      'xl/_rels/workbook.xml.rels': strToU8(workbookRelsXml),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml),
    },
    { level: 6 },
  );

  if (zipped.byteLength > XLSX_EXPORT_CAP_BYTES) {
    throw new Error(
      `Exported XLSX (${(zipped.byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds the 50 MB cap. Use CSV or Parquet.`,
    );
  }
  return zipped;
}

function escapeHtml(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface HtmlReportStepSummary {
  stepId: string;
  label: string;
  sql: string;
}

export interface HtmlReportIssueSummary {
  columnName: string;
  severity: string;
  message: string;
}

export interface HtmlReportChartSummary {
  title: string;
  svgMarkup: string;
}

export interface HtmlReportOptions {
  datasetName: string;
  activeAlias: string;
  rowCount: number;
  columns: readonly GridColumnMeta[];
  previewRows: readonly unknown[][];
  steps: readonly HtmlReportStepSummary[];
  issues?: readonly HtmlReportIssueSummary[];
  redactModes?: Record<string, string>;
  pinnedCharts?: readonly HtmlReportChartSummary[];
  generatedAtIso?: string;
}

/** Build a zero-dependency, self-contained HTML audit & data report. */
export function buildSelfContainedHtmlReport(opts: HtmlReportOptions): Uint8Array {
  const generatedAt = opts.generatedAtIso ?? new Date().toISOString();
  const sampleRows = opts.previewRows.slice(0, 50);

  const schemaRowsHtml = opts.columns
    .map((c) => {
      const redactMode = opts.redactModes?.[c.name] ?? 'keep';
      return `<tr>
        <td><code>${escapeHtml(c.name)}</code></td>
        <td><span class="badge">${escapeHtml(c.type)}</span></td>
        <td><span class="badge">${escapeHtml(redactMode)}</span></td>
      </tr>`;
    })
    .join('\n');

  const issuesHtml =
    opts.issues && opts.issues.length > 0
      ? `<ul>${opts.issues
          .map(
            (iss) =>
              `<li><strong>${escapeHtml(iss.columnName)}</strong> [${escapeHtml(iss.severity)}]: ${escapeHtml(iss.message)}</li>`,
          )
          .join('')}</ul>`
      : '<p class="muted">No profile issues flagged for the active dataset.</p>';

  const stepsHtml =
    opts.steps.length > 0
      ? `<ol class="steps">${opts.steps
          .map(
            (s) =>
              `<li><div class="step-title"><strong>${escapeHtml(s.stepId)}</strong> — ${escapeHtml(s.label)}</div><pre><code>${escapeHtml(s.sql)}</code></pre></li>`,
          )
          .join('')}</ol>`
      : '<p class="muted">No transformation steps applied (source table only).</p>';

  const previewHeaderHtml = opts.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join('');
  const previewBodyHtml = sampleRows
    .map(
      (row) =>
        `<tr>${opts.columns
          .map((_, idx) => `<td>${escapeHtml(row[idx] ?? '')}</td>`)
          .join('')}</tr>`,
    )
    .join('\n');

  const chartsHtml =
    opts.pinnedCharts && opts.pinnedCharts.length > 0
      ? `<section class="card">
      <h2>Pinned Charts</h2>
      ${opts.pinnedCharts
        .map(
          (ch) =>
            `<div style="margin-bottom:1rem;"><strong>${escapeHtml(ch.title)}</strong><div>${ch.svgMarkup}</div></div>`,
        )
        .join('\n')}
    </section>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dewpond Report — ${escapeHtml(opts.datasetName)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; line-height: 1.5; }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 2rem 1.5rem 3rem; }
    .hero { background: #0a1628; color: #f8fafc; border-radius: 14px; padding: 1.5rem 1.75rem; margin-bottom: 1.25rem; }
    .hero h1 { margin: 0 0 0.35rem; font-size: 1.35rem; }
    .hero p { margin: 0; color: #cbd5e1; font-size: 0.9rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
    .stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.85rem 1rem; }
    .stat small { display: block; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat strong { font-size: 1.15rem; color: #0f172a; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.15rem 1.25rem; margin-bottom: 1rem; }
    .card h2 { margin: 0 0 0.75rem; font-size: 1rem; color: #0a1628; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    th { background: #f1f5f9; font-weight: 600; color: #334155; }
    .table-scroll { overflow-x: auto; }
    .badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-family: ui-monospace, monospace; font-size: 0.74rem; }
    pre { background: #0f172a; color: #e2e8f0; padding: 0.65rem 0.8rem; border-radius: 8px; overflow-x: auto; font-size: 0.76rem; }
    .steps { padding-left: 1.25rem; margin: 0; display: grid; gap: 0.75rem; }
    .muted { color: #64748b; font-size: 0.85rem; margin: 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <h1>Dewpond Local Audit Report — ${escapeHtml(opts.datasetName)}</h1>
      <p>Active alias: <code>${escapeHtml(opts.activeAlias)}</code> · Generated locally at ${escapeHtml(generatedAt)} · Zero server upload</p>
    </header>
    <section class="stats">
      <div class="stat"><small>Rows</small><strong>${opts.rowCount.toLocaleString('en-US')}</strong></div>
      <div class="stat"><small>Columns</small><strong>${opts.columns.length}</strong></div>
      <div class="stat"><small>Recipe Steps</small><strong>${opts.steps.length}</strong></div>
      <div class="stat"><small>Profile Issues</small><strong>${opts.issues?.length ?? 0}</strong></div>
    </section>
    <section class="card">
      <h2>Schema &amp; Redaction Plan</h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Column</th><th>Type</th><th>Redaction Mode</th></tr></thead>
          <tbody>${schemaRowsHtml}</tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <h2>Profile Findings</h2>
      ${issuesHtml}
    </section>
    <section class="card">
      <h2>Reproducible Recipe Pipeline</h2>
      ${stepsHtml}
    </section>
    ${chartsHtml}
    <section class="card">
      <h2>Data Preview (First ${sampleRows.length} rows)</h2>
      <div class="table-scroll">
        <table>
          <thead><tr>${previewHeaderHtml}</tr></thead>
          <tbody>${previewBodyHtml}</tbody>
        </table>
      </div>
    </section>
  </div>
</body>
</html>`;

  return new TextEncoder().encode(html);
}

export interface TokenizationKeyEntry {
  column: string;
  original: string;
  token: string;
}

/** Build a reversible tokenization key map JSON payload (strictly local, never for share URLs). */
export function buildTokenizationKeyMapJson(
  tableAlias: string,
  entries: readonly TokenizationKeyEntry[],
  generatedAtIso = new Date().toISOString(),
): Uint8Array {
  const payload = {
    format: 'dewpond-token-keymap/v1',
    warning: 'CONFIDENTIAL REVERSIBLE KEY MAP — DO NOT SHARE PUBLICLY',
    tableAlias,
    generatedAt: generatedAtIso,
    entryCount: entries.length,
    entries,
  };
  return new TextEncoder().encode(JSON.stringify(payload, null, 2));
}

/** Compile active pipeline steps into a runnable pandas or Polars Python script using DuckDB. */
export function buildPythonPipelineExport(
  target: 'pandas' | 'polars',
  recipeName: string,
  activeAlias: string,
  steps: readonly HtmlReportStepSummary[],
): Uint8Array {
  const importLine = target === 'pandas' ? 'import pandas as pd' : 'import polars as pl';
  const dfExpr = target === 'pandas' ? 'df: pd.DataFrame' : 'df: pl.DataFrame';
  const method = target === 'pandas' ? '.df()' : '.pl()';

  const stepBlocks = steps.map(
    (s) => `# Step ${s.stepId}: ${s.label}\ncon.execute(${JSON.stringify(s.sql)})`,
  );

  const script = [
    `"""Dewpond ${target} pipeline — ${recipeName}"""`,
    'import duckdb',
    importLine,
    '',
    'con = duckdb.connect(":memory:")',
    '# Load your local source table(s) into DuckDB before executing steps, e.g.:',
    `# con.execute('CREATE TABLE "${activeAlias.split('@')[0] || 'source'}" AS SELECT * FROM read_csv_auto("input.csv")')`,
    '',
    ...stepBlocks,
    '',
    `${dfExpr} = con.sql(${JSON.stringify(`SELECT * FROM "${activeAlias}"`)})${method}`,
    'print(df.head())',
    '',
  ].join('\n');

  return new TextEncoder().encode(script);
}
