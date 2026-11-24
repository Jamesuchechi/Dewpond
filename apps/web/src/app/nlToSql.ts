import { ident, validateReadOnlySql } from '@dewpond/sqlkit';
import type { GridColumnMeta } from './arrowFormat';

export interface SchemaOnlyNlPayload {
  mode: 'schema-only';
  rowDataIncluded: false;
  tableAlias: string;
  columns: Array<{ name: string; type: string }>;
  question: string;
}

/**
 * Build the exact JSON payload for schema-only NL->SQL.
 * Guarantees zero row values, samples, or PII leave the browser.
 */
export function buildSchemaOnlyNlPayload(
  tableAlias: string,
  columns: readonly GridColumnMeta[],
  question: string,
): SchemaOnlyNlPayload {
  return {
    mode: 'schema-only',
    rowDataIncluded: false,
    tableAlias,
    columns: columns.filter((c) => c.name !== '__rid').map((c) => ({ name: c.name, type: c.type })),
    question: question.trim(),
  };
}

function isNumericType(type: string): boolean {
  return /int|float|double|decimal|numeric|bigint/i.test(type);
}

function matchColumnsInPrompt(
  promptLower: string,
  columns: readonly GridColumnMeta[],
): GridColumnMeta[] {
  const userCols = columns.filter((c) => c.name !== '__rid');
  const scored: Array<{ col: GridColumnMeta; index: number }> = [];
  for (const col of userCols) {
    const exact = col.name.toLowerCase();
    const spaced = exact.replace(/[_-]+/g, ' ');
    let idx = promptLower.indexOf(exact);
    if (idx < 0 && spaced !== exact) {
      idx = promptLower.indexOf(spaced);
    }
    if (idx >= 0) {
      scored.push({ col, index: idx });
    }
  }
  scored.sort((a, b) => a.index - b.index);
  return scored.map((s) => s.col);
}

/**
 * Compile a natural-language question into deterministic DuckDB SQL
 * using only table alias + column metadata (zero row data).
 */
export function compileLocalNlToSql(
  tableAlias: string,
  columns: readonly GridColumnMeta[],
  question: string,
): string {
  const tbl = ident(tableAlias);
  const userCols = columns.filter((c) => c.name !== '__rid');
  const q = question.trim().toLowerCase();
  const matched = matchColumnsInPrompt(q, userCols);

  const topMatch = q.match(/\b(?:top|first|limit)\s+(\d{1,4})\b/);
  const limit = topMatch ? Math.max(1, Math.min(1000, Number(topMatch[1]))) : 100;

  if (/\b(?:distinct|unique)\b/.test(q) && matched[0]) {
    const col = ident(matched[0].name);
    return `SELECT\n  ${col},\n  count(*)::BIGINT AS "row_count"\nFROM ${tbl}\nGROUP BY ${col}\nORDER BY "row_count" DESC\nLIMIT ${limit};`;
  }

  if (/\b(?:null|missing|empty|blank)\b/.test(q)) {
    const target = matched[0];
    if (target) {
      const col = ident(target.name);
      return `SELECT * EXCLUDE ("__rid")\nFROM ${tbl}\nWHERE ${col} IS NULL OR trim(${col}::VARCHAR) = ''\nLIMIT ${limit};`;
    }
  }

  const aggFn = /\b(?:sum|total)\b/.test(q)
    ? 'sum'
    : /\b(?:avg|average|mean)\b/.test(q)
      ? 'avg'
      : /\bmin(?:imum)?\b/.test(q)
        ? 'min'
        : /\bmax(?:imum)?\b/.test(q)
          ? 'max'
          : null;

  const byMatch = q.match(/\b(?:by|per|group(?:ed)?\s+by)\s+([a-z0-9_ -]+)/);
  if (aggFn || byMatch) {
    const numericMatch =
      matched.find((c) => isNumericType(c.type)) ?? userCols.find((c) => isNumericType(c.type));
    const groupMatch = byMatch
      ? (matchColumnsInPrompt(byMatch[1] ?? '', userCols)[0] ??
        matched.find((c) => c.name !== numericMatch?.name))
      : matched.find((c) => !isNumericType(c.type));

    if (groupMatch && aggFn && numericMatch && groupMatch.name !== numericMatch.name) {
      const g = ident(groupMatch.name);
      const m = ident(numericMatch.name);
      return `SELECT\n  ${g},\n  round(${aggFn}(${m}), 2) AS "${aggFn}_${numericMatch.name}",\n  count(*)::BIGINT AS "row_count"\nFROM ${tbl}\nGROUP BY ${g}\nORDER BY "${aggFn}_${numericMatch.name}" DESC NULLS LAST\nLIMIT ${limit};`;
    }
    if (groupMatch) {
      const g = ident(groupMatch.name);
      return `SELECT\n  ${g},\n  count(*)::BIGINT AS "row_count"\nFROM ${tbl}\nGROUP BY ${g}\nORDER BY "row_count" DESC\nLIMIT ${limit};`;
    }
    if (aggFn && numericMatch) {
      const m = ident(numericMatch.name);
      return `SELECT\n  round(${aggFn}(${m}), 2) AS "${aggFn}_${numericMatch.name}",\n  count(*)::BIGINT AS "row_count"\nFROM ${tbl};`;
    }
  }

  if (/\b(?:how many|count|total rows)\b/.test(q)) {
    return `SELECT count(*)::BIGINT AS "total_rows" FROM ${tbl};`;
  }

  if (/\b(?:highest|largest|top|lowest|smallest)\b/.test(q)) {
    const sortCol =
      matched.find((c) => isNumericType(c.type)) ??
      matched[0] ??
      userCols.find((c) => isNumericType(c.type));
    if (sortCol) {
      const dir = /\b(?:lowest|smallest)\b/.test(q) ? 'ASC' : 'DESC';
      return `SELECT * EXCLUDE ("__rid")\nFROM ${tbl}\nORDER BY ${ident(sortCol.name)} ${dir} NULLS LAST\nLIMIT ${limit};`;
    }
  }

  return `SELECT * EXCLUDE ("__rid")\nFROM ${tbl}\nLIMIT ${limit};`;
}

/** Extract SQL from an LLM response and enforce @dewpond/sqlkit read-only safety. */
export function extractSqlFromLlmResponse(rawText: string): string {
  const fenced = rawText.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? rawText).trim();
  if (!candidate) {
    throw new Error('Model returned an empty SQL response.');
  }
  const safety = validateReadOnlySql(candidate);
  if (!safety.ok) {
    throw new Error(`Generated SQL blocked by @dewpond/sqlkit: ${safety.reasons.join('; ')}`);
  }
  return candidate.endsWith(';') ? candidate : `${candidate};`;
}
