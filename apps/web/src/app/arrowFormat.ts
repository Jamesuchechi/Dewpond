export interface GridColumnMeta {
  name: string;
  type: string;
}

export interface QueryTableResult {
  columns: GridColumnMeta[];
  rows: string[][];
  totalRowsReturned: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface ArrowFieldLike {
  name: string;
  type: {
    toString(): string;
    scale?: number;
  };
}

export interface ArrowVectorLike {
  get(index: number): unknown;
}

export interface ArrowTableLike {
  numRows: number;
  schema: {
    fields: readonly ArrowFieldLike[];
  };
  getChildAt(index: number): ArrowVectorLike | null;
}

function uint32ArrayToSignedBigInt(words: Uint32Array): bigint {
  let result = 0n;
  for (let i = words.length - 1; i >= 0; i--) {
    result = (result << 32n) + BigInt(words[i]!);
  }
  const bitCount = BigInt(words.length * 32);
  const signBit = 1n << (bitCount - 1n);
  if ((result & signBit) !== 0n) {
    result -= 1n << bitCount;
  }
  return result;
}

function formatScaledBigInt(unscaled: bigint, scale: number): string {
  if (scale <= 0) return unscaled.toString();
  const negative = unscaled < 0n;
  const absStr = (negative ? -unscaled : unscaled).toString().padStart(scale + 1, '0');
  const intPart = absStr.slice(0, absStr.length - scale);
  const fracPart = absStr.slice(absStr.length - scale);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

function formatUtcEpoch(ms: number, dateOnly: boolean): string {
  if (!Number.isFinite(ms)) return String(ms);
  const iso = new Date(ms).toISOString();
  return dateOnly ? iso.slice(0, 10) : iso;
}

/**
 * Format an Apache Arrow scalar value into a lossless display string:
 * - Preserves 64-bit BIGINT precision without coercing to JS Number.
 * - Uses pure UTC ISO arithmetic for Date and Timestamp columns.
 * - Decodes fixed-point Arrow Decimal words accurately when scale is provided.
 */
export function formatArrowValue(value: unknown, typeStr: string, decimalScale?: number): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  const isDateOnly = typeStr.startsWith('Date');
  const isTimestamp = typeStr.startsWith('Timestamp');

  if (value instanceof Date) {
    const iso = value.toISOString();
    return isDateOnly ? iso.slice(0, 10) : iso;
  }

  if (isDateOnly || isTimestamp) {
    if (typeof value === 'number') {
      return formatUtcEpoch(value, isDateOnly);
    }
    if (typeof value === 'bigint') {
      return formatUtcEpoch(Number(value), isDateOnly);
    }
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeStr.startsWith('Decimal') && value instanceof Uint32Array) {
    const scaled = uint32ArrayToSignedBigInt(value);
    return formatScaledBigInt(scaled, decimalScale ?? 0);
  }

  if (value instanceof Uint8Array) {
    const preview = Array.from(value.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    return value.length > 16 ? `0x${preview}…(${value.length}B)` : `0x${preview}`;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  }

  return String(value);
}

/** Extract column schemas and formatted cell strings from an Arrow Table. */
export function extractArrowTable(
  table: ArrowTableLike,
  elapsedMs: number,
  maxRows = 2500,
): QueryTableResult {
  const fields = table.schema.fields;
  const columns: GridColumnMeta[] = fields.map((f) => ({
    name: f.name,
    type: f.type.toString(),
  }));

  const rowLimit = Math.min(table.numRows, maxRows);
  const columnVectors = fields.map((_, colIdx) => table.getChildAt(colIdx));
  const rows: string[][] = new Array(rowLimit);

  for (let r = 0; r < rowLimit; r++) {
    const row = new Array<string>(fields.length);
    for (let c = 0; c < fields.length; c++) {
      const field = fields[c]!;
      const vec = columnVectors[c];
      const val = vec ? vec.get(r) : null;
      row[c] = formatArrowValue(val, field.type.toString(), field.type.scale);
    }
    rows[r] = row;
  }

  return {
    columns,
    rows,
    totalRowsReturned: table.numRows,
    truncated: table.numRows > maxRows,
    elapsedMs,
  };
}
