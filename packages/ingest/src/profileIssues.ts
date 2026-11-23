import type { ProfileIssue } from './types';

export interface ColumnProbeStats {
  columnName: string;
  totalRows: number;
  nonNullCount: number;
  distinctCount: number;
  whitespaceCount: number;
  caseNormalizedDistinctCount: number;
  rejectCount?: number;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Build a single SQL query probing whitespace, casing variants, cardinality, and nulls
 * across user columns without pulling raw table rows to JS.
 */
export function buildProfileIssueProbesSql(
  tableAlias: string,
  columnNames: readonly string[],
): string {
  const userCols = columnNames.filter((c) => c !== '__rid');
  if (userCols.length === 0) {
    return `SELECT '' AS column_name, 0::BIGINT AS total_rows, 0::BIGINT AS non_null_count, 0::BIGINT AS distinct_count, 0::BIGINT AS whitespace_count, 0::BIGINT AS case_distinct_count WHERE FALSE;`;
  }

  const tbl = quoteIdent(tableAlias);
  const parts = userCols.map((colName) => {
    const col = quoteIdent(colName);
    const colLit = `'${colName.replaceAll("'", "''")}'`;
    return `SELECT
  ${colLit} AS column_name,
  count(*)::BIGINT AS total_rows,
  count(${col})::BIGINT AS non_null_count,
  count(DISTINCT ${col})::BIGINT AS distinct_count,
  count(*) FILTER (WHERE ${col} IS NOT NULL AND ${col}::VARCHAR <> trim(${col}::VARCHAR))::BIGINT AS whitespace_count,
  count(DISTINCT lower(trim(${col}::VARCHAR)))::BIGINT AS case_distinct_count
FROM ${tbl}`;
  });

  return `${parts.join('\nUNION ALL\n')};`;
}

/** Convert column probe metrics into actionable Profile Issue flags with one-click fixes. */
export function detectProfileIssues(probes: readonly ColumnProbeStats[]): ProfileIssue[] {
  const issues: ProfileIssue[] = [];

  for (const col of probes) {
    if ((col.rejectCount ?? 0) > 0) {
      issues.push({
        columnName: col.columnName,
        kind: 'mixed_type',
        severity: 'warn',
        message: `${col.rejectCount} row(s) failed typed cast and moved to _rejects.`,
        fixLabel: 'Inspect _rejects',
        fixAction: 'inspect_rejects',
      });
    }

    if (col.whitespaceCount > 0) {
      issues.push({
        columnName: col.columnName,
        kind: 'whitespace',
        severity: 'warn',
        message: `${col.whitespaceCount.toLocaleString('en-US')} cell(s) contain leading/trailing whitespace.`,
        fixLabel: 'Trim Whitespace',
        fixAction: 'trim',
      });
    }

    if (col.distinctCount > 1 && col.caseNormalizedDistinctCount < col.distinctCount) {
      const collapsed = col.distinctCount - col.caseNormalizedDistinctCount;
      issues.push({
        columnName: col.columnName,
        kind: 'casing_variants',
        severity: 'warn',
        message: `${collapsed} casing/spacing duplicate variant(s) detected (e.g. Lagos vs lagos).`,
        fixLabel: 'Normalize Lowercase',
        fixAction: 'lowercase',
      });
    }

    if (col.totalRows > 1 && col.nonNullCount > 0 && col.distinctCount === 1) {
      issues.push({
        columnName: col.columnName,
        kind: 'constant_column',
        severity: 'info',
        message: 'Constant column (only 1 distinct non-null value across all rows).',
        fixLabel: 'Drop Column',
        fixAction: 'drop',
      });
    } else if (
      col.totalRows >= 5 &&
      col.nonNullCount === col.totalRows &&
      col.distinctCount === col.totalRows
    ) {
      issues.push({
        columnName: col.columnName,
        kind: 'key_candidate',
        severity: 'info',
        message: 'Unique non-null candidate key (100% distinct values).',
      });
    }
  }

  return issues;
}
