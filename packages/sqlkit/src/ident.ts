/** Quote a DuckDB SQL identifier safely using double-quote doubling. */
export function ident(name: string): string {
  if (name.length === 0) {
    throw new RangeError('SQL identifier cannot be empty.');
  }
  if (name.includes('\0')) {
    throw new RangeError('SQL identifier cannot contain NUL bytes.');
  }
  return `"${name.replaceAll('"', '""')}"`;
}

/** Escape a scalar value as a DuckDB SQL literal (safe for CREATE VIEW bodies). */
export function lit(value: string | number | bigint | boolean | null): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Numeric SQL literal must be finite, got ${String(value)}.`);
    }
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (value.includes('\0')) {
    throw new RangeError('SQL string literal cannot contain NUL bytes.');
  }
  return `'${value.replaceAll("'", "''")}'`;
}
