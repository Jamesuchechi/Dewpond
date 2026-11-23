export interface SyntheticRow {
  rid: number;
  tx_id: string;
  full_name: string;
  email: string;
  phone: string;
  bvn: string;
  amount: string;
  tx_date: string;
  excel_phone: string;
  excel_bvn: string;
  excel_amount: string;
  excel_date: string;
}

export type RedactPreviewMode = 'raw' | 'mask' | 'hash' | 'generalize';

export interface RedactedRowView {
  rid: number;
  tx_id: string;
  full_name: string;
  email: string;
  phone: string;
  bvn: string;
  amount: string;
  tx_date: string;
}

export interface RecipePreviewStep {
  id: string;
  index: number;
  label: string;
  badge: string;
  summary: string;
  rowsOut: string;
  colsOut: number;
  sql: string;
}

export interface CapabilityPillar {
  id: 'unmess' | 'recipes' | 'redact' | 'export';
  tag: string;
  title: string;
  headline: string;
  description: string;
  highlights: readonly string[];
  codeLabel: string;
  codeSnippet: string;
}

export interface BenchmarkMetric {
  id: string;
  workload: string;
  detail: string;
  chromiumSec: number;
  firefoxSec: number;
  maxSec: number;
  ramNote: string;
}

export interface ComparisonRow {
  capability: string;
  dewpond: { status: 'yes' | 'warn' | 'no'; label: string };
  excel: { status: 'yes' | 'warn' | 'no'; label: string };
  onlineCleaner: { status: 'yes' | 'warn' | 'no'; label: string };
  pythonPandas: { status: 'yes' | 'warn' | 'no'; label: string };
}

export const SYNTHETIC_SAMPLE_ROWS: readonly SyntheticRow[] = [
  {
    rid: 1,
    tx_id: 'TX-9041',
    full_name: 'Amaka Okafor',
    email: 'amaka.okafor@example.org',
    phone: '08012345678',
    bvn: '22123456789',
    amount: '1500.50',
    tx_date: '03/04/2025',
    excel_phone: '8012345678',
    excel_bvn: '2.21235E+10',
    excel_amount: '1501',
    excel_date: '2025-03-04 (MDY?)',
  },
  {
    rid: 2,
    tx_id: 'TX-9042',
    full_name: 'Tunde Adeyemi',
    email: 't.adeyemi@example.com',
    phone: '08098765432',
    bvn: '22987654321',
    amount: '2450.00',
    tx_date: '05/06/2025',
    excel_phone: '8098765432',
    excel_bvn: '2.29877E+10',
    excel_amount: '2450',
    excel_date: '2025-05-06 (MDY?)',
  },
  {
    rid: 3,
    tx_id: 'TX-9043',
    full_name: 'Chidi Nwosu',
    email: 'chidi.nwosu@example.net',
    phone: '07055112233',
    bvn: '22445566778',
    amount: '890.75',
    tx_date: '11/12/2025',
    excel_phone: '7055112233',
    excel_bvn: '2.24456E+10',
    excel_amount: '891',
    excel_date: '2025-11-12 (MDY?)',
  },
  {
    rid: 4,
    tx_id: 'TX-9044',
    full_name: 'Zainab Bello',
    email: 'zainab.bello@example.org',
    phone: '09033445566',
    bvn: '22778899001',
    amount: '12400.25',
    tx_date: '02/08/2025',
    excel_phone: '9033445566',
    excel_bvn: '2.27789E+10',
    excel_amount: '12400',
    excel_date: '2025-02-08 (MDY?)',
  },
  {
    rid: 5,
    tx_id: 'TX-9045',
    full_name: 'Kemi Balogun',
    email: 'kemi.balogun@example.com',
    phone: '08144556677',
    bvn: '22334455667',
    amount: '310.00',
    tx_date: '07/09/2025',
    excel_phone: '8144556677',
    excel_bvn: '2.23345E+10',
    excel_amount: '310',
    excel_date: '2025-07-09 (MDY?)',
  },
];

function deterministicHexDigest(input: string): string {
  // Deterministic 32-bit FNV-1a derived hex preview token for client-side UI illustration
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `sha256:${part1}${part2}...`;
}

function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 1) return '***';
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function maskBvn(bvn: string): string {
  if (bvn.length < 6) return '***********';
  return `${bvn.slice(0, 2)}*******${bvn.slice(-2)}`;
}

function generalizeAmount(raw: string): string {
  const num = Number(raw);
  if (!Number.isFinite(num)) return '[unknown]';
  const low = Math.floor(num / 1000) * 1000;
  const high = low + 999;
  return `${low.toLocaleString('en-US')}-${high.toLocaleString('en-US')}`;
}

function generalizeDateMonth(dmyDate: string): string {
  const parts = dmyDate.split('/');
  if (parts.length !== 3) return dmyDate;
  return `${parts[2]}-${parts[1]}`;
}

export function applyPreviewRedaction(row: SyntheticRow, mode: RedactPreviewMode): RedactedRowView {
  if (mode === 'raw') {
    return {
      rid: row.rid,
      tx_id: row.tx_id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      bvn: row.bvn,
      amount: row.amount,
      tx_date: row.tx_date,
    };
  }

  if (mode === 'mask') {
    return {
      rid: row.rid,
      tx_id: row.tx_id,
      full_name: '[MEMBER]',
      email: maskEmail(row.email),
      phone: maskPhone(row.phone),
      bvn: maskBvn(row.bvn),
      amount: row.amount,
      tx_date: row.tx_date,
    };
  }

  if (mode === 'hash') {
    return {
      rid: row.rid,
      tx_id: row.tx_id,
      full_name: deterministicHexDigest(`name:${row.full_name}`),
      email: deterministicHexDigest(`email:${row.email}`),
      phone: deterministicHexDigest(`phone:${row.phone}`),
      bvn: deterministicHexDigest(`bvn:${row.bvn}`),
      amount: row.amount,
      tx_date: row.tx_date,
    };
  }

  return {
    rid: row.rid,
    tx_id: row.tx_id,
    full_name: '[GENERALIZED]',
    email: `@${row.email.split('@')[1] ?? 'domain'}`,
    phone: `${row.phone.slice(0, 4)}xxxxxxx`,
    bvn: '[DROPPED]',
    amount: generalizeAmount(row.amount),
    tx_date: generalizeDateMonth(row.tx_date),
  };
}

export const REDACT_SQL_BY_MODE: Record<RedactPreviewMode, string> = {
  mask: `CREATE OR REPLACE VIEW "payroll_q4@s3" AS
SELECT
  "tx_id",
  '[MEMBER]' AS "full_name",
  regexp_replace("email", '^(.{1}).*(@.*)$', '\\1***\\2') AS "email",
  concat(left("phone", 3), '****', right("phone", 4)) AS "phone",
  concat(left("bvn", 2), '*******', right("bvn", 2)) AS "bvn",
  "amount", "tx_date"
FROM "payroll_q4@s2";`,
  hash: `CREATE OR REPLACE VIEW "payroll_q4@s3" AS
SELECT
  "tx_id",
  sha256('session_salt_v1|' || "full_name") AS "full_name",
  sha256('session_salt_v1|' || "email")     AS "email",
  sha256('session_salt_v1|' || "phone")     AS "phone",
  sha256('session_salt_v1|' || "bvn")       AS "bvn",
  "amount", "tx_date"
FROM "payroll_q4@s2";`,
  generalize: `CREATE OR REPLACE VIEW "payroll_q4@s3" AS
SELECT
  "tx_id",
  split_part("email", '@', 2)               AS "email_domain",
  concat(left("phone", 4), 'xxxxxxx')       AS "phone_prefix",
  (floor("amount" / 1000) * 1000)::BIGINT   AS "amount_band",
  strftime("tx_date", '%Y-%m')              AS "tx_month"
FROM "payroll_q4@s2"; -- BVN column dropped`,
  raw: `-- Previewing source columns before redaction step
SELECT "tx_id", "full_name", "email", "phone", "bvn", "amount", "tx_date"
FROM "payroll_q4@s2"
ORDER BY "__rid" ASC;`,
};

export const RECIPE_PREVIEW_STEPS: readonly RecipePreviewStep[] = [
  {
    id: 's1',
    index: 1,
    label: 'Unmess & Strict Cast',
    badge: 'Ingest',
    summary: 'Sample-5k text scoring vetoes phone/BVN; routes 42 malformed rows to _rejects.',
    rowsOut: '385,378',
    colsOut: 7,
    sql: `CREATE OR REPLACE TABLE "payroll_q4@s1" AS
SELECT
  row_number() OVER () AS "__rid",
  "tx_id", "full_name", "email",
  "phone"::VARCHAR AS "phone", -- vetoed (leading zero)
  "bvn"::VARCHAR   AS "bvn",   -- vetoed (11-digit uniform ID)
  try_cast("amount" AS DOUBLE) AS "amount",
  strptime("tx_date", '%d/%m/%Y')::DATE AS "tx_date"
FROM read_csv('payroll_export_q4.csv', all_varchar=true, header=true);`,
  },
  {
    id: 's2',
    index: 2,
    label: 'Trim & Exact Dedupe',
    badge: 'Clean',
    summary: 'Normalizes whitespace & removes duplicate emails deterministically via __rid.',
    rowsOut: '381,910',
    colsOut: 7,
    sql: `CREATE OR REPLACE TABLE "payroll_q4@s2" AS
SELECT * REPLACE (trim("email") AS "email")
FROM "payroll_q4@s1"
QUALIFY row_number() OVER (
  PARTITION BY lower(trim("email"))
  ORDER BY "tx_date" DESC NULLS LAST, "__rid" ASC
) = 1;`,
  },
  {
    id: 's3',
    index: 3,
    label: 'Salted PII Redaction',
    badge: 'Redact',
    summary: 'Replaces BVN & phone with salted sha256; logs zero raw values in report.',
    rowsOut: '381,910',
    colsOut: 7,
    sql: `CREATE OR REPLACE VIEW "payroll_q4@s3" AS
SELECT
  "tx_id",
  sha256('vendor_drop_2026|' || "bvn")   AS "bvn_token",
  concat(left("phone", 3), '****', right("phone", 4)) AS "phone_mask",
  "amount", "tx_date"
FROM "payroll_q4@s2";`,
  },
];

export const CAPABILITY_PILLARS: readonly CapabilityPillar[] = [
  {
    id: 'unmess',
    tag: '01 · TEXT-FIRST INGEST',
    title: 'Unmess Messy CSVs & Workbooks Before Coercion',
    headline: 'Stop tools from quietly rounding numbers or stripping leading zeros.',
    description:
      'Every CSV opens as plain VARCHAR first. Dewpond runs strict regex and domain veto checks across a 5,000-row sample—catching Excel scientific notation traps, 11-digit IDs, decimals disguised after integer leading rows, and ambiguous dd/mm dates before a single streaming cast runs.',
    highlights: [
      'Strict integer guard prevents DuckDB try_cast("1500.50" AS BIGINT) rounding to 1501',
      'Banner & totals-footer detection plus _rejects quarantine for unparseable rows',
      'Streaming fflate ZIP/XML reader for XLSX (1900 & 1904 UTC dates, no eval CSP bypass)',
    ],
    codeLabel: 'Strict Scoring & Quarantine',
    codeSnippet: `// @dewpond/ingest strict integer + ID guard
STRICT_INT_REGEX = /^[+-]?[0-9]+$/
LEADING_ZERO_REGEX = /^0[0-9]+$/
ID_COLUMN_REGEX = /(bvn|nin|phone|account|iban|zip)/i

// Bad rows past sample window go to _rejects, never dropped`,
  },
  {
    id: 'recipes',
    tag: '02 · CLICK-TO-SQL SPINE',
    title: 'Every Click Compiles to Deterministic DuckDB SQL',
    headline: 'A non-destructive Recipe timeline for ops teams—readable SQL for engineers.',
    description:
      'UI actions append immutable typed steps to a Recipe (.dew.json). Undo moves a head pointer without mutating history. Tie-breaking always orders by "__rid" ASC and shuffles use keyed hashes, keeping replays identical across reloads.',
    highlights: [
      'Views by default; automatic checkpoint tables for joins, dedupes, or deep chains',
      'Share-safe #r= URL fragments inspect filter/replace literals before encoding',
      'Statement allowlist blocks COPY, ATTACH, PRAGMA, and http(s)/s3 URIs on rawSql',
    ],
    codeLabel: 'Deterministic Replay SQL',
    codeSnippet: `CREATE OR REPLACE TABLE "customers@s5" AS
SELECT * FROM "customers@s4"
QUALIFY row_number() OVER (
  PARTITION BY lower(trim("email"))
  ORDER BY "updated_at" DESC NULLS LAST, "__rid" ASC
) = 1;`,
  },
  {
    id: 'redact',
    tag: '03 · V1 HEADLINE WORKFLOW',
    title: 'Redact Sensitive Exports Safe Enough for External Vendors',
    headline: 'Detect PII locally, transform deterministically, and audit residual risk.',
    description:
      'Scan columns in a pure TypeScript Web Worker for Luhn payment cards, E.164 & local 080/070/090 phones, emails, and 11-digit BVN/NIN identifiers. Apply human-confirmed masks, join-preserving salted sha256 hashes, date/numeric generalization, or deterministic shuffles.',
    highlights: [
      'Pre-export k-anonymity warning over chosen quasi-identifiers (HAVING count(*) < k)',
      'Structured JSON & Markdown redaction reports guaranteed to carry zero raw cell values',
      'All validators verified in pure Node unit suites before touching browser workers',
    ],
    codeLabel: 'Salted Join-Safe Hash + Risk Check',
    codeSnippet: `SELECT
  "dept_band", "region", count(*) AS cohort_size
FROM "vendor_share@s4"
GROUP BY "dept_band", "region"
HAVING count(*) < 5; -- Warn if re-identification cohort is small`,
  },
  {
    id: 'export',
    tag: '04 · PORTABLE OUTPUTS & ROADMAP',
    title: 'Standard Files & Auditable Scripts Out — No Lock-In',
    headline: 'Export cleaned datasets, reproducible .sql, and portable .dew.json Recipes.',
    description:
      'Write clean CSV, JSON/NDJSON, Parquet, and small/medium XLSX spreadsheets (preserving leading-zero text cells and optional formula-prefix neutralization) straight from your browser memory. Structural dataset Diff ships next in v1.1.',
    highlights: [
      'Direct lazy file reads via BROWSER_FILEREADER for 500 MB CSV & Parquet inspection',
      'Reproducible build scripts verify DuckDB-WASM 1.32.0 assets via SHA-256 digests',
      'Structural table Diff (FULL OUTER JOIN + IS DISTINCT FROM) scheduled immediately in v1.1',
    ],
    codeLabel: 'Zero Lock-In Export Artifacts',
    codeSnippet: `deliverables/
  ├─ cleaned_payroll_q4.csv
  ├─ transform_pipeline.sql       # full inspectable DuckDB SQL
  ├─ pipeline.dew.json            # portable schema-fingerprinted Recipe
  └─ redaction_audit_report.json  # zero raw PII values`,
  },
];

export const BENCHMARK_METRICS: readonly BenchmarkMetric[] = [
  {
    id: 'csv-50mb',
    workload: '50 MB CSV (385k rows × 15 cols) → Full Profile',
    detail: 'Sample-5k text scoring + streaming all_varchar cast + SUMMARIZE',
    chromiumSec: 2.2,
    firefoxSec: 2.12,
    maxSec: 15,
    ramNote: 'maxRafGapMs ≤ 17.2 ms · 0 UI freezes',
  },
  {
    id: 'parquet-500mb',
    workload: '500 MB Parquet (4.16M rows, Snappy) → GROUP BY',
    detail: 'Lazy range reads via BROWSER_FILEREADER directly in tab',
    chromiumSec: 0.53,
    firefoxSec: 0.5,
    maxSec: 15,
    ramNote: '4.04 MB DuckDB heap used',
  },
  {
    id: 'csv-500mb',
    workload: '500 MB CSV (3.8M rows) → Lazy Filtered GROUP BY',
    detail: 'Out-of-core browser file handle scan without copying raw file to JS',
    chromiumSec: 2.75,
    firefoxSec: 4.01,
    maxSec: 15,
    ramNote: '0 crashes on 7.1 GiB RAM laptop',
  },
  {
    id: 'xlsx-25mb',
    workload: '25 MB XLSX (~260k rows) → Streaming Arrow Ingest',
    detail: 'fflate chunked XML stream + UTC 1900/1904 dates (warn >25 MB, cap 50 MB)',
    chromiumSec: 12.7,
    firefoxSec: 8.6,
    maxSec: 15,
    ramNote: '2.5–3.7× faster than SheetJS; no eval()',
  },
];

export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    capability: 'Zero server upload / verifiable offline mode',
    dewpond: { status: 'yes', label: 'Yes — connect-src + DevTools 0 B' },
    excel: { status: 'yes', label: 'Desktop local (cloud in 365/Sheets)' },
    onlineCleaner: { status: 'no', label: 'No — uploads file to third party' },
    pythonPandas: { status: 'yes', label: 'Yes — local machine' },
  },
  {
    capability: 'Protects leading zeros, 11-digit IDs & decimals',
    dewpond: { status: 'yes', label: 'Strict regex + explicit veto UI' },
    excel: { status: 'no', label: 'Strips 0s, E+10 mangling, flips dates' },
    onlineCleaner: { status: 'warn', label: 'Varies; opaque coercion' },
    pythonPandas: { status: 'warn', label: 'Requires explicit dtype=str code' },
  },
  {
    capability: 'Scale beyond 1,048,576 rows (CSV & Parquet)',
    dewpond: { status: 'yes', label: '3.8M–4.16M+ rows tested lazy' },
    excel: { status: 'no', label: 'Hard 1,048,576-row grid limit' },
    onlineCleaner: { status: 'warn', label: 'Paywalled / slow upload timeouts' },
    pythonPandas: { status: 'yes', label: 'Yes — RAM / Polars' },
  },
  {
    capability: 'No-code clicks + exportable SQL audit trail',
    dewpond: { status: 'yes', label: '.dew.json + deterministic .sql' },
    excel: { status: 'no', label: 'Manual clicks are not reproducible' },
    onlineCleaner: { status: 'no', label: 'Black-box output' },
    pythonPandas: { status: 'no', label: 'Code-only' },
  },
  {
    capability: 'Local PII detection + raw-value-free report',
    dewpond: { status: 'yes', label: 'Built in (v1 headline workflow)' },
    excel: { status: 'no', label: 'Manual find/replace' },
    onlineCleaner: { status: 'no', label: 'Must upload PII first' },
    pythonPandas: { status: 'warn', label: 'Custom scripts required' },
  },
  {
    capability: 'Zero installation in locked-down environments',
    dewpond: { status: 'yes', label: 'Browser tab or static intranet zip' },
    excel: { status: 'warn', label: 'Needs Office license / IT approval' },
    onlineCleaner: { status: 'warn', label: 'Often blocked by InfoSec policy' },
    pythonPandas: { status: 'no', label: 'Needs Python/venv/pip setup' },
  },
];
