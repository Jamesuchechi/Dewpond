import { parseXlsxWorkbook } from '@dewpond/ingest';
import { describe, expect, it } from 'vitest';
import {
  buildCsvExportBytes,
  buildNdjsonExportBytes,
  buildParquetExportBytes,
  buildXlsxExportBytes,
  neutralizeSpreadsheetFormula,
} from './exporters';

describe('M3 exporters', () => {
  const columns = [
    { name: 'phone', type: 'Utf8' },
    { name: 'amount', type: 'Float64' },
    { name: 'note', type: 'Utf8' },
  ];
  const rows: (string | null)[][] = [
    ['08012345678', '1500.50', '=CMD|calc'],
    ['08099998888', '250.00', 'ok'],
  ];

  it('neutralizes formula prefixes in CSV when enabled', () => {
    expect(neutralizeSpreadsheetFormula('=1+1', true)).toBe("'=1+1");
    expect(neutralizeSpreadsheetFormula('=1+1', false)).toBe('=1+1');

    const safeCsv = new TextDecoder().decode(buildCsvExportBytes(columns, rows, true));
    expect(safeCsv).toContain("'=CMD|calc");
    expect(safeCsv).toContain('08012345678');

    const rawCsv = new TextDecoder().decode(buildCsvExportBytes(columns, rows, false));
    expect(rawCsv).toContain(',=CMD|calc');
  });

  it('exports NDJSON and valid PAR1 Parquet via hyparquet-writer', () => {
    const ndjson = new TextDecoder().decode(buildNdjsonExportBytes(columns, rows));
    const lines = ndjson.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).phone).toBe('08012345678');

    const pqBytes = buildParquetExportBytes(columns, rows);
    expect(new TextDecoder().decode(pqBytes.subarray(0, 4))).toBe('PAR1');
    expect(new TextDecoder().decode(pqBytes.subarray(pqBytes.length - 4))).toBe('PAR1');
  });

  it('exports <= 50 MB XLSX preserving text leading zeros and exact 1500.50', () => {
    const xlsxBytes = buildXlsxExportBytes(columns, rows, true);
    expect(xlsxBytes[0]).toBe(0x50); // 'P'
    expect(xlsxBytes[1]).toBe(0x4b); // 'K'

    const parsed = parseXlsxWorkbook(xlsxBytes);
    expect(parsed.sheets[0]?.name).toBe('DewpondExport');
    expect(parsed.columns.find((c) => c.name === 'phone')?.values[0]).toBe('08012345678');
    expect(parsed.columns.find((c) => c.name === 'amount')?.values[0]).toBe('1500.50');
    expect(parsed.columns.find((c) => c.name === 'note')?.values[0]).toBe("'=CMD|calc");
  });
});
