import { describe, expect, it } from 'vitest';
import { extractArrowTable, formatArrowValue, type ArrowTableLike } from './arrowFormat';

describe('workbench arrowFormat', () => {
  it('preserves 64-bit BIGINT precision without IEEE-754 rounding', () => {
    expect(formatArrowValue(9007199254740993n, 'Int64')).toBe('9007199254740993');
    expect(formatArrowValue(null, 'Utf8')).toBe('NULL');
  });

  it('formats Date and Timestamp values using pure UTC ISO arithmetic', () => {
    const epochDayMs = Date.UTC(2025, 3, 3); // 2025-04-03 UTC
    expect(formatArrowValue(epochDayMs, 'Date<DAY>')).toBe('2025-04-03');
    expect(
      formatArrowValue(new Date(Date.UTC(2025, 3, 3, 14, 30, 0)), 'Timestamp<MICROSECOND>'),
    ).toBe('2025-04-03T14:30:00.000Z');
  });

  it('formats 128-bit Decimal arrays accurately', () => {
    // 150050 -> 1500.50 at scale 2
    const words = new Uint32Array([150050, 0, 0, 0]);
    expect(formatArrowValue(words, 'Decimal[38, 2]', 2)).toBe('1500.50');
  });

  it('extracts column metadata and formatted rows from Arrow-like tables', () => {
    const fakeTable: ArrowTableLike = {
      numRows: 2,
      schema: {
        fields: [
          { name: 'id', type: { toString: () => 'Int64' } },
          { name: 'amount', type: { toString: () => 'Float64' } },
        ],
      },
      getChildAt(colIndex) {
        const cols = [
          [9007199254740993n, 42n],
          [1500.5, null],
        ];
        return {
          get(r: number) {
            return cols[colIndex]?.[r] ?? null;
          },
        };
      },
    };

    const result = extractArrowTable(fakeTable, 12.4);
    expect(result.columns).toEqual([
      { name: 'id', type: 'Int64' },
      { name: 'amount', type: 'Float64' },
    ]);
    expect(result.rows).toEqual([
      ['9007199254740993', '1500.5'],
      ['42', 'NULL'],
    ]);
    expect(result.truncated).toBe(false);
  });
});
