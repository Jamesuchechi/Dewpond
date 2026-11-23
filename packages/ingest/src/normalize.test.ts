import { describe, expect, it } from 'vitest';
import { decodeTextWithEncoding, preprocessCsvBytes, sniffFileFormat } from './index';

describe('@dewpond/ingest normalization', () => {
  it('sniffs file formats from magic bytes and extensions', () => {
    expect(sniffFileFormat('data.parquet', new Uint8Array([0x50, 0x41, 0x52, 0x31]))).toEqual({
      kind: 'parquet',
    });
    expect(sniffFileFormat('book.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toEqual({
      kind: 'xlsx',
    });
    expect(sniffFileFormat('feed.tsv')).toEqual({ kind: 'tsv', delimiter: '\t' });
  });

  it('strips UTF-8 BOM and transcodes Windows-1252 bytes without U+FFFD', () => {
    const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]);
    expect(decodeTextWithEncoding(bomBytes)).toEqual({ text: 'a,b', encoding: 'utf-8-bom' });

    // "Café — €50" in Windows-1252: é=0xE9, —=0x97, €=0x80
    const winBytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x97, 0x20, 0x80, 0x35, 0x30]);
    const decoded = decodeTextWithEncoding(winBytes);
    expect(decoded.encoding).toBe('windows-1252');
    expect(decoded.text).toBe('Café — €50');
    expect(decoded.text).not.toContain('\uFFFD');
  });

  it('normalizes mixed line endings, skips banner rows, dedupes headers, removes footers, and aligns ragged rows', () => {
    const messy = [
      'Quarterly Settlement Export',
      '',
      'id;amount; ;amount',
      '1;100,50;ok;extra1',
      '2;200,00',
      '3;300,25;ok;extra3;overflow_cell',
      'Grand Total;600,75;;',
    ].join('\r\n');

    const bytes = new TextEncoder().encode(messy.replace('\r\n2;', '\r2;'));
    const res = preprocessCsvBytes(bytes);

    expect(res.hadMixedLineEndings).toBe(true);
    expect(res.delimiter).toBe(';');
    expect(res.skippedBannerRows).toHaveLength(1);
    expect(res.headers).toEqual(['id', 'amount', 'col_3', 'amount_2']);
    expect(res.excludedFooterRows).toHaveLength(1);
    expect(res.rowCount).toBe(3);
    expect(res.paddedShortRows).toBe(1);
    expect(res.raggedRowAlerts).toEqual([{ sourceRow: 6, actualColumns: 5, expectedColumns: 4 }]);
  });
});
