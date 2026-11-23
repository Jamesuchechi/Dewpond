import { describe, expect, it } from 'vitest';
import {
  parseDelimitedRecords,
  parseEuDecimalNumber,
  parseUsCurrencyNumber,
  parseXlsxWorkbook,
  preprocessCsvBytes,
  scoreColumnSample,
} from '@dewpond/ingest';
import { generateMessyCorpusFile, MESSY_CORPUS_SPEC } from './index';

describe('20-file synthetic messy corpus zero-corruption regression', () => {
  it('generates and cleanly ingests every single one of the 20 messy fixtures', () => {
    expect(MESSY_CORPUS_SPEC).toHaveLength(20);

    const scoreColumns = (headers: readonly string[], rows: readonly (string | null)[][]) =>
      headers.map((h, cIdx) =>
        scoreColumnSample(
          h,
          rows.map((r) => r[cIdx] ?? null),
        ),
      );

    for (const spec of MESSY_CORPUS_SPEC) {
      const { bytes } = generateMessyCorpusFile(spec.id);
      expect(bytes.byteLength).toBeGreaterThan(0);

      if (spec.format === 'xlsx') {
        const wb = parseXlsxWorkbook(bytes);
        const colInferences = wb.columns.map((c) => scoreColumnSample(c.name, c.values));

        if (spec.id === '19-xlsx-1900-merges-formulas') {
          expect(wb.date1904).toBe(false);
          expect(wb.hiddenRowCount).toBe(1);
          expect(wb.mergedCells).toEqual(['A1:C1']);
          expect(colInferences.find((c) => c.columnName === 'tx_date')?.type).toBe('DATE');
          expect(colInferences.find((c) => c.columnName === 'phone')?.type).toBe('VARCHAR');
          expect(colInferences.find((c) => c.columnName === 'amount')?.type).toBe('DOUBLE');
          expect(wb.columns[0]!.values[0]).toBe('2025-04-03');
        } else if (spec.id === '20-xlsx-1904-hidden-sheet') {
          expect(wb.date1904).toBe(true);
          expect(wb.sheets.find((s) => s.name === 'AuditRaw')?.state).toBe('hidden');
          expect(wb.columns[1]!.values[0]).toBe('2025-04-03');
        }
        continue;
      }

      const norm = preprocessCsvBytes(bytes);
      const parsed = parseDelimitedRecords(norm.normalizedCsv, ',');
      const headers = parsed[0] ?? [];
      const rows = parsed.slice(1);
      const cols = scoreColumns(headers, rows);

      switch (spec.id) {
        case '01-decimal-rounding-guard':
          expect(cols.find((c) => c.columnName === 'amount')?.type).toBe('DOUBLE');
          break;
        case '02-leading-zero-phones':
          expect(cols.find((c) => c.columnName === 'contact_val')?.type).toBe('VARCHAR');
          expect(cols.find((c) => c.columnName === 'contact_val')?.vetoReasons).toContain(
            'leading_zero',
          );
          break;
        case '03-eleven-digit-bvn':
          expect(cols.find((c) => c.columnName === 'ref_code')?.type).toBe('VARCHAR');
          expect(cols.find((c) => c.columnName === 'ref_code')?.vetoReasons).toContain(
            'long_uniform_digits',
          );
          break;
        case '04-scientific-corruption':
          expect(cols.find((c) => c.columnName === 'ref_str')?.vetoReasons).toContain(
            'scientific_notation_corruption',
          );
          break;
        case '05-ambiguous-slash-dates':
          expect(cols.find((c) => c.columnName === 'tx_date')?.dateAmbiguity).toBe(true);
          break;
        case '06-unambiguous-dmy-dates':
          expect(cols.find((c) => c.columnName === 'tx_date')?.detectedDateOrder).toBe('DMY');
          break;
        case '07-unambiguous-mdy-dates':
          expect(cols.find((c) => c.columnName === 'tx_date')?.detectedDateOrder).toBe('MDY');
          break;
        case '08-iso-dates-and-bigint64':
          expect(cols.find((c) => c.columnName === 'event_date')?.type).toBe('DATE');
          expect(cols.find((c) => c.columnName === 'seq_num')?.type).toBe('BIGINT');
          break;
        case '09-utf8-bom-mixed-crlf':
          expect(norm.encoding).toBe('utf-8-bom');
          expect(norm.hadMixedLineEndings).toBe(true);
          expect(rows[0]?.[1]).toBe('Line 1\nLine 2');
          break;
        case '10-win1252-currency':
          expect(norm.encoding).toBe('windows-1252');
          expect(norm.normalizedCsv).toContain('Café — 1');
          expect(norm.normalizedCsv).toContain('€50');
          expect(norm.normalizedCsv).not.toContain('\uFFFD');
          break;
        case '11-ngn-usd-accounting':
          expect(cols.find((c) => c.columnName === 'gross_amount')?.localeNumberFormat).toBe(
            'us_currency',
          );
          expect(parseUsCurrencyNumber(rows[1]?.[1] ?? '')).toBe(-500.25);
          break;
        case '12-semicolon-eu-decimals':
          expect(norm.delimiter).toBe(';');
          expect(cols.find((c) => c.columnName === 'betrag')?.localeNumberFormat).toBe(
            'eu_decimal',
          );
          expect(parseEuDecimalNumber(rows[0]?.[1] ?? '')).toBe(1250000.5);
          break;
        case '13-tab-delimited-quotes':
          expect(norm.delimiter).toBe('\t');
          expect(rows[0]?.[1]).toBe('Lagos, Nigeria Settlement');
          break;
        case '14-banner-and-totals-footer':
          expect(norm.skippedBannerRows.length).toBeGreaterThanOrEqual(1);
          expect(norm.excludedFooterRows).toHaveLength(1);
          expect(norm.rowCount).toBe(2);
          break;
        case '15-duplicate-blank-headers':
          expect(headers).toEqual(['ref', 'amount', 'col_3', 'amount_2']);
          break;
        case '16-ragged-short-and-overflow':
          expect(norm.paddedShortRows).toBe(1);
          expect(norm.raggedRowAlerts).toHaveLength(1);
          break;
        case '17-mixed-types-rejects':
          expect(cols.find((c) => c.columnName === 'amount')?.vetoReasons).toContain('mixed_types');
          break;
        case '18-whitespace-casing-constants':
          expect(cols.find((c) => c.columnName === 'flag')?.type).toBe('BOOLEAN');
          break;
      }
    }
  });
});
