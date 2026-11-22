import type { ColumnInference, VetoReason } from './types';

export const STRICT_INT_REGEX = /^[+-]?[0-9]+$/;
export const LEADING_ZERO_REGEX = /^0[0-9]+$/;
export const SCIENTIFIC_NOTATION_REGEX = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;
export const STRICT_DECIMAL_REGEX = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
export const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
export const SLASH_DATE_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
export const ID_COLUMN_NAME_REGEX =
  /(?:^|[_ -])(id|phone|mobile|tel|bvn|nin|ssn|tin|account|acct|zip|postal|pin|iban|card)(?:$|[_ -])/i;

const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function fitsInt64(raw: string): boolean {
  if (!STRICT_INT_REGEX.test(raw)) return false;
  try {
    const val = BigInt(raw);
    return val >= INT64_MIN && val <= INT64_MAX;
  } catch {
    return false;
  }
}

/**
 * Score a sample of raw text values for one column using strict regex & veto rules.
 * Never infers BIGINT from decimals like '1500.50' (avoids DuckDB try_cast rounding).
 */
export function scoreColumnSample(
  columnName: string,
  values: readonly (string | null | undefined)[],
): ColumnInference {
  const nonEmpty: string[] = [];
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const trimmed = v.trim();
    if (trimmed.length > 0) {
      nonEmpty.push(trimmed);
    }
  }

  const totalCount = values.length;
  const nonNullCount = nonEmpty.length;
  if (nonNullCount === 0) {
    return {
      columnName,
      type: 'VARCHAR',
      confidence: 0,
      vetoReasons: ['all_null'],
      dateAmbiguity: false,
      nonNullCount: 0,
      totalCount,
    };
  }

  const vetoReasons: VetoReason[] = [];

  if (nonEmpty.some((v) => LEADING_ZERO_REGEX.test(v))) {
    vetoReasons.push('leading_zero');
  }

  if (nonEmpty.some((v) => SCIENTIFIC_NOTATION_REGEX.test(v))) {
    vetoReasons.push('scientific_notation_corruption');
  }

  const firstLen = nonEmpty[0]!.length;
  if (firstLen >= 11 && nonEmpty.every((v) => /^\d+$/.test(v) && v.length === firstLen)) {
    vetoReasons.push('long_uniform_digits');
  }

  const numericLikeCount = nonEmpty.filter((v) => STRICT_DECIMAL_REGEX.test(v)).length;
  if (ID_COLUMN_NAME_REGEX.test(columnName) && numericLikeCount > 0) {
    vetoReasons.push('id_column_name');
  }

  if (vetoReasons.length > 0) {
    return {
      columnName,
      type: 'VARCHAR',
      confidence: 1,
      vetoReasons,
      dateAmbiguity: false,
      nonNullCount,
      totalCount,
    };
  }

  // Check ISO dates (YYYY-MM-DD)
  const allIsoDates = nonEmpty.every((v) => {
    const m = ISO_DATE_REGEX.exec(v);
    if (!m) return false;
    return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
  });
  if (allIsoDates) {
    return {
      columnName,
      type: 'DATE',
      confidence: 1,
      vetoReasons: [],
      dateAmbiguity: false,
      nonNullCount,
      totalCount,
    };
  }

  // Check ambiguous vs unambiguous slash dates (DD/MM/YYYY or MM/DD/YYYY)
  const slashMatches = nonEmpty.map((v) => SLASH_DATE_REGEX.exec(v));
  if (slashMatches.every((m): m is RegExpExecArray => m !== null)) {
    let canBeDmy = true;
    let canBeMdy = true;
    for (const m of slashMatches) {
      const p1 = Number(m[1]);
      const p2 = Number(m[2]);
      const year = Number(m[3]);
      if (!isValidCalendarDate(year, p2, p1)) canBeDmy = false;
      if (!isValidCalendarDate(year, p1, p2)) canBeMdy = false;
    }

    if (canBeDmy && canBeMdy) {
      return {
        columnName,
        type: 'VARCHAR',
        confidence: 0.5,
        vetoReasons: ['ambiguous_slash_date'],
        dateAmbiguity: true,
        nonNullCount,
        totalCount,
      };
    }

    if (canBeDmy || canBeMdy) {
      return {
        columnName,
        type: 'DATE',
        confidence: 1,
        vetoReasons: [],
        dateAmbiguity: false,
        detectedDateOrder: canBeDmy ? 'DMY' : 'MDY',
        nonNullCount,
        totalCount,
      };
    }
  }

  // Booleans (explicit true/false literals only)
  if (nonEmpty.every((v) => v.toLowerCase() === 'true' || v.toLowerCase() === 'false')) {
    return {
      columnName,
      type: 'BOOLEAN',
      confidence: 1,
      vetoReasons: [],
      dateAmbiguity: false,
      nonNullCount,
      totalCount,
    };
  }

  // Strict BIGINT: EVERY value must satisfy ^[+-]?[0-9]+$ and Int64 bounds
  if (nonEmpty.every((v) => fitsInt64(v))) {
    return {
      columnName,
      type: 'BIGINT',
      confidence: 1,
      vetoReasons: [],
      dateAmbiguity: false,
      nonNullCount,
      totalCount,
    };
  }

  // Finite DOUBLE: every value parses cleanly as a decimal number
  if (nonEmpty.every((v) => STRICT_DECIMAL_REGEX.test(v) && Number.isFinite(Number(v)))) {
    return {
      columnName,
      type: 'DOUBLE',
      confidence: 1,
      vetoReasons: [],
      dateAmbiguity: false,
      nonNullCount,
      totalCount,
    };
  }

  return {
    columnName,
    type: 'VARCHAR',
    confidence: 1,
    vetoReasons: numericLikeCount > 0 ? ['mixed_types'] : [],
    dateAmbiguity: false,
    nonNullCount,
    totalCount,
  };
}
