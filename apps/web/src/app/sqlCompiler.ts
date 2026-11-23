import type { LocaleNumberFormat } from '@dewpond/ingest';
import type { LogicalType, RedactAction, Step } from '@dewpond/recipe';
import { ident, lit } from '@dewpond/sqlkit';

export interface ColumnCastSpec {
  name: string;
  targetType: LogicalType;
  localeNumberFormat?: LocaleNumberFormat;
}

export interface CsvIngestSqlOptions {
  virtualFileName: string;
  targetTableName: string;
  columns: readonly ColumnCastSpec[];
  dateOrder: 'DMY' | 'MDY' | 'ISO';
}

export interface CleanStepCompileResult {
  sql: string;
  label: string;
}

export interface RedactColumnPlan {
  columnName: string;
  mode: 'keep' | RedactAction['mode'];
  keepStart?: number;
  keepEnd?: number;
  maskChar?: string;
  bucketSize?: number;
  generalizeStrategy?: 'date_month' | 'numeric_bucket';
}

export function sanitizeTableName(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  const normalized = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return 'dataset';
  return /^[0-9]/.test(normalized) ? `t_${normalized}` : normalized;
}

function castColumnExpr(col: ColumnCastSpec, dateOrder: 'DMY' | 'MDY' | 'ISO'): string {
  const colIdent = ident(col.name);
  const trimmedNonEmpty = `NULLIF(trim(${colIdent}::VARCHAR), '')`;

  switch (col.targetType) {
    case 'VARCHAR':
      return `${colIdent}::VARCHAR`;
    case 'BIGINT':
      return `try_cast(${trimmedNonEmpty} AS BIGINT)`;
    case 'DOUBLE': {
      if (col.localeNumberFormat === 'us_currency') {
        const parenSigned = `CASE WHEN starts_with(${trimmedNonEmpty}, '(') AND ends_with(${trimmedNonEmpty}, ')') THEN '-' || substr(${trimmedNonEmpty}, 2, length(${trimmedNonEmpty}) - 2) ELSE ${trimmedNonEmpty} END`;
        return `try_cast(NULLIF(regexp_replace(${parenSigned}, '[^0-9.+\\-]', '', 'g'), '') AS DOUBLE)`;
      }
      if (col.localeNumberFormat === 'eu_decimal') {
        const parenSigned = `CASE WHEN starts_with(${trimmedNonEmpty}, '(') AND ends_with(${trimmedNonEmpty}, ')') THEN '-' || substr(${trimmedNonEmpty}, 2, length(${trimmedNonEmpty}) - 2) ELSE ${trimmedNonEmpty} END`;
        return `try_cast(NULLIF(replace(regexp_replace(${parenSigned}, '[^0-9,\\-]', '', 'g'), ',', '.'), '') AS DOUBLE)`;
      }
      return `try_cast(${trimmedNonEmpty} AS DOUBLE)`;
    }
    case 'BOOLEAN':
      return `try_cast(${trimmedNonEmpty} AS BOOLEAN)`;
    case 'TIMESTAMP':
      return `try_cast(${trimmedNonEmpty} AS TIMESTAMP)`;
    case 'DATE':
      if (dateOrder === 'DMY') {
        return `coalesce(try_strptime(${trimmedNonEmpty}, '%d/%m/%Y')::DATE, try_cast(${trimmedNonEmpty} AS DATE))`;
      }
      if (dateOrder === 'MDY') {
        return `coalesce(try_strptime(${trimmedNonEmpty}, '%m/%d/%Y')::DATE, try_cast(${trimmedNonEmpty} AS DATE))`;
      }
      return `try_cast(${trimmedNonEmpty} AS DATE)`;
  }
}

/** Build single-pass streaming CSV load SQL using explicit strict-scored column casts. */
export function buildCsvTypedIngestSql(opts: CsvIngestSqlOptions): string {
  const projections = opts.columns.map(
    (col) => `${castColumnExpr(col, opts.dateOrder)} AS ${ident(col.name)}`,
  );

  return `CREATE OR REPLACE TABLE ${ident(opts.targetTableName)} AS
SELECT
  row_number() OVER () AS "__rid",
  ${projections.join(',\n  ')}
FROM read_csv(${lit(opts.virtualFileName)}, all_varchar=true, header=true);`;
}

/** Cast a staged UTF-8 Arrow table (from XLSX compute worker) into a typed DuckDB table. */
export function buildArrowTableTypedCastSql(
  stagedTableName: string,
  targetTableName: string,
  columns: readonly ColumnCastSpec[],
  dateOrder: 'DMY' | 'MDY' | 'ISO',
): string {
  const projections = columns.map(
    (col) => `${castColumnExpr(col, dateOrder)} AS ${ident(col.name)}`,
  );

  return `CREATE OR REPLACE TABLE ${ident(targetTableName)} AS
SELECT
  row_number() OVER () AS "__rid",
  ${projections.join(',\n  ')}
FROM ${ident(stagedTableName)};`;
}

/** Build a fast streaming query counting rows where a typed cast rejected non-empty text. */
export function buildCsvRejectCountSql(
  virtualFileName: string,
  columns: readonly ColumnCastSpec[],
  dateOrder: 'DMY' | 'MDY' | 'ISO',
): string | null {
  const typedCols = columns.filter((c) => c.targetType !== 'VARCHAR');
  if (typedCols.length === 0) return null;

  const predicates = typedCols.map((col) => {
    const colIdent = ident(col.name);
    const expr = castColumnExpr(col, dateOrder);
    return `(NULLIF(trim(${colIdent}::VARCHAR), '') IS NOT NULL AND (${expr}) IS NULL)`;
  });

  return `SELECT count(*)::BIGINT AS reject_rows
FROM read_csv(${lit(virtualFileName)}, all_varchar=true, header=true)
WHERE ${predicates.join('\n   OR ')};`;
}

/**
 * Populate the global _rejects quarantine table for non-VARCHAR cast failures.
 * Intended for small/medium sources or staged Arrow tables; >20 MB streaming CSVs
 * avoid second full scans unless explicitly requested.
 */
export function buildPopulateRejectsSql(
  sourceId: string,
  sourceRelationSql: string,
  columns: readonly ColumnCastSpec[],
  dateOrder: 'DMY' | 'MDY' | 'ISO',
): string | null {
  const typedCols = columns.filter((c) => c.targetType !== 'VARCHAR');
  if (typedCols.length === 0) return null;

  const branchQueries = typedCols.map((col) => {
    const rawCol = ident(col.name);
    const castExpr = castColumnExpr(col, dateOrder);
    return `SELECT
  ${lit(sourceId)}::VARCHAR AS "source_id",
  "__rn"::BIGINT AS "row_number",
  ${lit(col.name)}::VARCHAR AS "column_name",
  ${rawCol}::VARCHAR AS "raw_value",
  ${lit(col.targetType)}::VARCHAR AS "target_type",
  ${lit(`Failed cast to ${col.targetType}`)} AS "reason"
FROM _src
WHERE NULLIF(trim(${rawCol}::VARCHAR), '') IS NOT NULL
  AND (${castExpr}) IS NULL`;
  });

  return `CREATE TABLE IF NOT EXISTS "_rejects" (
  "source_id" VARCHAR,
  "row_number" BIGINT,
  "column_name" VARCHAR,
  "raw_value" VARCHAR,
  "target_type" VARCHAR,
  "reason" VARCHAR
);
DELETE FROM "_rejects" WHERE "source_id" = ${lit(sourceId)};
INSERT INTO "_rejects"
WITH _src AS (
  SELECT row_number() OVER () AS "__rn", *
  FROM ${sourceRelationSql}
)
${branchQueries.join('\nUNION ALL\n')}
LIMIT 5000;`;
}

/**
 * Lazy file ingestion:
 * - Parquet creates a VIEW directly over read_parquet() via BROWSER_FILEREADER so 500 MB Parquet stays <25 MB RAM.
 * - JSON / NDJSON load via read_json_auto().
 */
export function buildLazyFileIngestSql(
  kind: 'parquet' | 'json' | 'ndjson',
  virtualFileName: string,
  targetTableName: string,
): string {
  if (kind === 'parquet') {
    return `CREATE OR REPLACE VIEW ${ident(targetTableName)} AS
SELECT *
FROM read_parquet(${lit(virtualFileName)});`;
  }
  return `CREATE OR REPLACE TABLE ${ident(targetTableName)} AS
SELECT row_number() OVER () AS "__rid", *
FROM read_json_auto(${lit(virtualFileName)}, union_by_name=true);`;
}

function compilePredicateSql(step: Extract<Step, { op: 'filter' }>): string {
  const col = ident(step.predicate.column);
  const val = step.predicate.value ?? null;

  switch (step.predicate.op) {
    case 'is_null':
      return `${col} IS NULL`;
    case 'not_null':
      return `${col} IS NOT NULL`;
    case 'eq':
      return val === null ? `${col} IS NULL` : `${col}::VARCHAR = ${lit(String(val))}`;
    case 'neq':
      return val === null ? `${col} IS NOT NULL` : `${col}::VARCHAR <> ${lit(String(val))}`;
    case 'contains':
      return `contains(lower(coalesce(${col}::VARCHAR, '')), lower(${lit(String(val ?? ''))}))`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const opSymbol =
        step.predicate.op === 'gt'
          ? '>'
          : step.predicate.op === 'gte'
            ? '>='
            : step.predicate.op === 'lt'
              ? '<'
              : '<=';
      const numVal = typeof val === 'number' ? val : Number(val);
      if (Number.isFinite(numVal) && String(val ?? '').trim() !== '') {
        return `try_cast(${col} AS DOUBLE) ${opSymbol} ${lit(numVal)}`;
      }
      return `${col}::VARCHAR ${opSymbol} ${lit(String(val ?? ''))}`;
    }
  }
}

export function compileLowercaseColumnSql(
  sourceAlias: string,
  targetAlias: string,
  columnName: string,
): CleanStepCompileResult {
  const col = ident(columnName);
  return {
    label: `Normalize lowercase (${columnName})`,
    sql: `CREATE OR REPLACE VIEW ${ident(targetAlias)} AS
SELECT * REPLACE (lower(trim(${col}::VARCHAR)) AS ${col})
FROM ${ident(sourceAlias)};`,
  };
}

/** Compile a clean Recipe step into deterministic DuckDB SQL with __rid tiebreakers. */
export function compileCleanStepSql(
  sourceAlias: string,
  targetAlias: string,
  step: Step,
): CleanStepCompileResult {
  const src = ident(sourceAlias);
  const dst = ident(targetAlias);

  switch (step.op) {
    case 'trim':
      return {
        label: `Trim ${step.columns.length} column(s)`,
        sql: `CREATE OR REPLACE VIEW ${dst} AS
SELECT * REPLACE (${step.columns.map((c) => `trim(${ident(c)}::VARCHAR) AS ${ident(c)}`).join(', ')})
FROM ${src};`,
      };
    case 'rename':
      return {
        label: `Rename ${step.from} -> ${step.to}`,
        sql: `CREATE OR REPLACE VIEW ${dst} AS
SELECT * RENAME (${ident(step.from)} AS ${ident(step.to)})
FROM ${src};`,
      };
    case 'drop':
      return {
        label: `Drop ${step.columns.join(', ')}`,
        sql: `CREATE OR REPLACE VIEW ${dst} AS
SELECT * EXCLUDE (${step.columns.map((c) => ident(c)).join(', ')})
FROM ${src};`,
      };
    case 'filter':
      return {
        label: `Filter ${step.predicate.column} (${step.predicate.op})`,
        sql: `CREATE OR REPLACE VIEW ${dst} AS
SELECT *
FROM ${src}
WHERE ${compilePredicateSql(step)};`,
      };
    case 'dedupe': {
      const partKeys = step.keys
        .map((k) => `lower(trim(coalesce(${ident(k)}::VARCHAR, '')))`)
        .join(', ');
      const orderDir = step.keep === 'first' ? 'ASC' : 'DESC';
      const orderClause = step.orderBy
        ? `${ident(step.orderBy)} ${orderDir} NULLS LAST, "__rid" ASC`
        : step.keep === 'last'
          ? `"__rid" DESC`
          : `"__rid" ASC`;
      return {
        label: `Dedupe by ${step.keys.join(', ')} (${step.keep})`,
        sql: `CREATE OR REPLACE TABLE ${dst} AS
SELECT *
FROM ${src}
QUALIFY row_number() OVER (
  PARTITION BY ${partKeys}
  ORDER BY ${orderClause}
) = 1;`,
      };
    }
    default:
      throw new Error(`Unsupported interactive clean step op: ${step.op}`);
  }
}

/** Compile deterministic column-level PII redactions into a DuckDB TABLE/VIEW. */
export function compileRedactViewSql(
  sourceAlias: string,
  targetAlias: string,
  plans: readonly RedactColumnPlan[],
  salt: string,
  shuffleSeed: string,
): string {
  const src = ident(sourceAlias);
  const dst = ident(targetAlias);
  const activePlans = plans.filter((p) => p.mode !== 'drop');
  const shuffledCols = activePlans.filter((p) => p.mode === 'shuffle');

  const exprForPlan = (plan: RedactColumnPlan, tableRef = ''): string => {
    const colRef = tableRef ? `${tableRef}.${ident(plan.columnName)}` : ident(plan.columnName);
    const outName = ident(plan.columnName);

    switch (plan.mode) {
      case 'keep':
      case 'shuffle':
        return `${colRef} AS ${outName}`;
      case 'mask': {
        const keepStart = plan.keepStart ?? 2;
        const keepEnd = plan.keepEnd ?? 2;
        const maskChar = plan.maskChar ?? '*';
        return `CASE
    WHEN ${colRef} IS NULL THEN NULL
    WHEN length(${colRef}::VARCHAR) <= ${keepStart + keepEnd} THEN repeat(${lit(maskChar)}, length(${colRef}::VARCHAR))
    ELSE concat(
      left(${colRef}::VARCHAR, ${keepStart}),
      repeat(${lit(maskChar)}, greatest(1, length(${colRef}::VARCHAR) - ${keepStart + keepEnd})),
      right(${colRef}::VARCHAR, ${keepEnd})
    )
  END AS ${outName}`;
      }
      case 'hash_sha256':
        return `CASE WHEN ${colRef} IS NULL THEN NULL ELSE sha256(${lit(`${salt}|`)} || ${colRef}::VARCHAR) END AS ${outName}`;
      case 'generalize':
        if (plan.generalizeStrategy === 'numeric_bucket') {
          const bucket = Math.max(1, plan.bucketSize ?? 1000);
          return `(floor(try_cast(${colRef} AS DOUBLE) / ${lit(bucket)}) * ${lit(bucket)})::BIGINT AS ${outName}`;
        }
        return `coalesce(strftime(try_cast(${colRef} AS DATE), '%Y-%m'), left(${colRef}::VARCHAR, 7)) AS ${outName}`;
    }
    return `${colRef} AS ${outName}`;
  };

  if (shuffledCols.length === 0) {
    const projections = activePlans.map((p) => exprForPlan(p));
    return `CREATE OR REPLACE TABLE ${dst} AS
SELECT
  "__rid",
  ${projections.join(',\n  ')}
FROM ${src};`;
  }

  const permCtes = shuffledCols.map((p, idx) => {
    const colId = ident(p.columnName);
    const permOrder = `sha256(${lit(`${shuffleSeed}:${p.columnName}:`)} || "__rid"::VARCHAR), "__rid" ASC`;
    return `_perm_${idx} AS (
  SELECT
    row_number() OVER (ORDER BY ${permOrder}) AS "__pos",
    ${colId} AS "__val"
  FROM _numbered
)`;
  });

  const finalCols = activePlans.map((p) => {
    if (p.mode === 'shuffle') {
      const idx = shuffledCols.findIndex((s) => s.columnName === p.columnName);
      return `_perm_${idx}."__val" AS ${ident(p.columnName)}`;
    }
    return exprForPlan(p, '_numbered');
  });

  const joins = shuffledCols.map(
    (_p, idx) => `JOIN _perm_${idx} ON _perm_${idx}."__pos" = _numbered."__pos"`,
  );

  return `CREATE OR REPLACE TABLE ${dst} AS
WITH _numbered AS (
  SELECT row_number() OVER (ORDER BY "__rid" ASC) AS "__pos", *
  FROM ${src}
),
${permCtes.join(',\n')}
SELECT
  _numbered."__rid" AS "__rid",
  ${finalCols.join(',\n  ')}
FROM _numbered
${joins.join('\n')};`;
}

export function buildKAnonymityQuery(
  tableAlias: string,
  quasiIdentifiers: readonly string[],
  kThreshold: number,
): string {
  const cols = quasiIdentifiers.map((c) => ident(c)).join(', ');
  return `SELECT
  ${cols},
  count(*)::BIGINT AS cohort_size
FROM ${ident(tableAlias)}
GROUP BY ${cols}
HAVING count(*) < ${lit(Math.max(2, Math.floor(kThreshold)))}
ORDER BY cohort_size ASC
LIMIT 100;`;
}

export function compileFullRecipeSql(
  entries: readonly { stepId: string; label: string; sql: string }[],
): string {
  const header = [
    '-- Exported from Dewpond Workbench (Apache-2.0)',
    '-- Replayable deterministic DuckDB SQL pipeline',
    '',
  ].join('\n');

  if (entries.length === 0) {
    return `${header}-- No transformation steps recorded yet.\n`;
  }

  return (
    header +
    entries
      .map((entry, idx) => `-- Step ${idx + 1} (${entry.stepId}): ${entry.label}\n${entry.sql}`)
      .join('\n\n') +
    '\n'
  );
}
