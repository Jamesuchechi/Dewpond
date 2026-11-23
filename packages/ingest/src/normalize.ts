import type { DetectedFormat, NormalizedCsvResult, RaggedRowAlert } from './types';

// CP1252 0x80..0x9F characters (0xA0..0xFF match Latin-1 U+00A0..U+00FF)
const WIN1252_HIGH_TABLE: Record<number, string> = {
  0x80: '\u20AC',
  0x81: '\u0081',
  0x82: '\u201A',
  0x83: '\u0192',
  0x84: '\u201E',
  0x85: '\u2026',
  0x86: '\u2020',
  0x87: '\u2021',
  0x88: '\u02C6',
  0x89: '\u2030',
  0x8a: '\u0160',
  0x8b: '\u2039',
  0x8c: '\u0152',
  0x8d: '\u008D',
  0x8e: '\u017D',
  0x8f: '\u008F',
  0x90: '\u0090',
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201C',
  0x94: '\u201D',
  0x95: '\u2022',
  0x96: '\u2013',
  0x97: '\u2014',
  0x98: '\u02DC',
  0x99: '\u2122',
  0x9a: '\u0161',
  0x9b: '\u203A',
  0x9c: '\u0153',
  0x9d: '\u009D',
  0x9e: '\u017E',
  0x9f: '\u0178',
};

const FOOTER_CELL_REGEX = /^(?:grand\s+total|sub\s*-?\s*total|totals?|sum(?:mary)?)\b[:\s-]*/i;

/** Sniff input file format from magic bytes and filename extension. */
export function sniffFileFormat(filename: string, headBytes?: Uint8Array): DetectedFormat {
  if (headBytes && headBytes.length >= 4) {
    if (
      headBytes[0] === 0x50 &&
      headBytes[1] === 0x41 &&
      headBytes[2] === 0x52 &&
      headBytes[3] === 0x31
    ) {
      return { kind: 'parquet' };
    }
    if (headBytes[0] === 0x1f && headBytes[1] === 0x8b) {
      return { kind: 'gzip' };
    }
    if (headBytes[0] === 0x50 && headBytes[1] === 0x4b && headBytes[2] === 0x03) {
      if (filename.toLowerCase().endsWith('.xlsx')) {
        return { kind: 'xlsx' };
      }
      return { kind: 'zip' };
    }
  }

  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return { kind: 'xlsx' };
  if (lower.endsWith('.parquet')) return { kind: 'parquet' };
  if (lower.endsWith('.tsv')) return { kind: 'tsv', delimiter: '\t' };
  if (lower.endsWith('.ndjson') || lower.endsWith('.jsonl')) return { kind: 'ndjson' };
  if (lower.endsWith('.json')) return { kind: 'json' };
  if (lower.endsWith('.gz')) return { kind: 'gzip' };
  if (lower.endsWith('.zip')) return { kind: 'zip' };
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return { kind: 'csv' };
  return { kind: 'unknown' };
}

function tryDecodeStrictUtf8(bytes: Uint8Array, start: number): string | null {
  const chunks: string[] = [];
  let i = start;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    if (b0 <= 0x7f) {
      chunks.push(String.fromCharCode(b0));
      i++;
      continue;
    }
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      if (i + 1 >= bytes.length) return null;
      const b1 = bytes[i + 1]!;
      if ((b1 & 0xc0) !== 0x80) return null;
      const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
      chunks.push(String.fromCharCode(cp));
      i += 2;
      continue;
    }
    if (b0 >= 0xe0 && b0 <= 0xef) {
      if (i + 2 >= bytes.length) return null;
      const b1 = bytes[i + 1]!;
      const b2 = bytes[i + 2]!;
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return null;
      if (b0 === 0xe0 && b1 < 0xa0) return null;
      if (b0 === 0xed && b1 >= 0xa0) return null;
      const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      chunks.push(String.fromCharCode(cp));
      i += 3;
      continue;
    }
    if (b0 >= 0xf0 && b0 <= 0xf4) {
      if (i + 3 >= bytes.length) return null;
      const b1 = bytes[i + 1]!;
      const b2 = bytes[i + 2]!;
      const b3 = bytes[i + 3]!;
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return null;
      if (b0 === 0xf0 && b1 < 0x90) return null;
      if (b0 === 0xf4 && b1 > 0x8f) return null;
      const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      chunks.push(String.fromCodePoint(cp));
      i += 4;
      continue;
    }
    return null;
  }
  return chunks.join('');
}

function decodeWindows1252(bytes: Uint8Array, start: number): string {
  const out = new Array<string>(bytes.length - start);
  for (let i = start; i < bytes.length; i++) {
    const b = bytes[i]!;
    out[i - start] =
      b >= 0x80 && b <= 0x9f
        ? (WIN1252_HIGH_TABLE[b] ?? String.fromCharCode(b))
        : String.fromCharCode(b);
  }
  return out.join('');
}

/** Decode raw bytes stripping UTF-8 BOM or transcoding invalid UTF-8 from Windows-1252. */
export function decodeTextWithEncoding(bytes: Uint8Array): {
  text: string;
  encoding: 'utf-8' | 'utf-8-bom' | 'windows-1252';
} {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const start = hasBom ? 3 : 0;
  const utf8 = tryDecodeStrictUtf8(bytes, start);
  if (utf8 !== null) {
    return { text: utf8, encoding: hasBom ? 'utf-8-bom' : 'utf-8' };
  }
  return { text: decodeWindows1252(bytes, start), encoding: 'windows-1252' };
}

/** Normalize CRLF and bare CR line endings to LF cleanly. */
export function normalizeLineEndings(text: string): { text: string; hadMixedLineEndings: boolean } {
  const hasCrlf = text.includes('\r\n');
  const bareCr = /\r(?!\n)/.test(text);
  const hasLf = /(?:^|[^\r])\n/.test(text);
  const hadMixedLineEndings = bareCr || (hasCrlf && hasLf);
  return {
    text: text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    hadMixedLineEndings,
  };
}

function countDelimitersOutsideQuotes(line: string, delim: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && ch === delim) {
      count++;
    }
  }
  return count;
}

/** Detect the dominant CSV/TSV delimiter across sample lines. */
export function detectDelimiter(text: string): ',' | '\t' | ';' | '|' {
  const candidates: readonly (',' | '\t' | ';' | '|')[] = [',', '\t', ';', '|'];
  const lines = text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, 25);
  if (lines.length === 0) return ',';

  let best: ',' | '\t' | ';' | '|' = ',';
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = lines.map((l) => countDelimitersOutsideQuotes(l, delim));
    const positiveCounts = counts.filter((c) => c > 0);
    if (positiveCounts.length === 0) continue;

    const sorted = [...positiveCounts].sort((a, b) => a - b);
    const medianCount = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const totalCount = positiveCounts.reduce((acc, c) => acc + c, 0);
    const consistentRows = positiveCounts.filter((c) => c === medianCount).length;
    const score = medianCount * 100 + consistentRows * 25 + totalCount;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }

  return best;
}

/** Parse normalized LF CSV text into records respecting RFC-4180 quotes and newlines. */
export function parseDelimitedRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (atFieldStart && ch === '"') {
      inQuotes = true;
      atFieldStart = false;
      continue;
    }

    if (ch === delimiter) {
      row.push(field);
      field = '';
      atFieldStart = true;
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      atFieldStart = true;
      continue;
    }

    field += ch;
    atFieldStart = false;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  // Drop trailing empty lines
  while (
    records.length > 0 &&
    records[records.length - 1]!.every((cell) => cell.trim().length === 0)
  ) {
    records.pop();
  }

  return records;
}

export function serializeCsvCell(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replaceAll('"', '""')}"`;
  }
  return val;
}

/** Normalize header names cleanly, filling blanks and suffixing duplicates. */
export function deduplicateHeaders(rawHeaders: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((raw, idx) => {
    const base = raw.trim().length > 0 ? raw.trim() : `col_${idx + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

/** Find header row index skipping title banners and blank separator lines. */
export function detectHeaderRowIndex(records: readonly string[][]): number {
  const sample = records.slice(0, 30);
  if (sample.length <= 1) return 0;

  const widthCounts = new Map<number, number>();
  for (const row of sample) {
    if (row.every((c) => c.trim().length === 0)) continue;
    const width = row.length;
    widthCounts.set(width, (widthCounts.get(width) ?? 0) + 1);
  }

  let modalWidth = 1;
  let maxFreq = 0;
  for (const [w, freq] of widthCounts.entries()) {
    if (freq > maxFreq || (freq === maxFreq && w > modalWidth)) {
      maxFreq = freq;
      modalWidth = w;
    }
  }

  if (modalWidth <= 1) {
    const firstNonEmpty = sample.findIndex((r) => r.some((c) => c.trim().length > 0));
    return firstNonEmpty >= 0 ? firstNonEmpty : 0;
  }

  for (let i = 0; i < sample.length; i++) {
    const row = sample[i]!;
    const nonEmptyCells = row.filter((c) => c.trim().length > 0);
    const uniqueNonEmpty = new Set(nonEmptyCells.map((c) => c.trim()));
    if (nonEmptyCells.length > 1 && uniqueNonEmpty.size <= 1) {
      // Skip horizontally merged / repeated-title banner rows
      continue;
    }
    if (row.length === modalWidth && nonEmptyCells.length >= Math.min(2, modalWidth)) {
      return i;
    }
  }

  return 0;
}

export function isTotalsFooterRow(row: readonly string[]): boolean {
  const firstNonEmpty = row.find((c) => c.trim().length > 0);
  if (!firstNonEmpty) return false;
  return FOOTER_CELL_REGEX.test(firstNonEmpty.trim());
}

/**
 * Normalize raw CSV/TSV bytes: strip UTF-8 BOM, transcode Windows-1252, normalize CRLF/CR,
 * sniff delimiter, skip leading banners, isolate totals footers, deduplicate headers,
 * and align ragged rows to uniform column width for reliable DuckDB ingestion.
 */
export function preprocessCsvBytes(
  bytes: Uint8Array,
  opts?: { excludeFooter?: boolean; delimiterOverride?: ',' | '\t' | ';' | '|' },
): NormalizedCsvResult {
  const excludeFooter = opts?.excludeFooter ?? true;
  const decoded = decodeTextWithEncoding(bytes);
  const lf = normalizeLineEndings(decoded.text);
  const delimiter = opts?.delimiterOverride ?? detectDelimiter(lf.text);
  const records = parseDelimitedRecords(lf.text, delimiter);

  if (records.length === 0) {
    return {
      normalizedCsv: '',
      headers: [],
      rowCount: 0,
      encoding: decoded.encoding,
      hadMixedLineEndings: lf.hadMixedLineEndings,
      delimiter,
      skippedBannerRows: [],
      excludedFooterRows: [],
      paddedShortRows: 0,
      raggedRowAlerts: [],
    };
  }

  const headerIdx = detectHeaderRowIndex(records);
  const skippedBannerRows = records
    .slice(0, headerIdx)
    .filter((r) => r.some((c) => c.trim().length > 0));
  const headers = deduplicateHeaders(records[headerIdx] ?? []);
  const expectedWidth = headers.length;

  const dataRows = records.slice(headerIdx + 1).filter((r) => r.some((c) => c.trim().length > 0));
  const excludedFooterRows: string[][] = [];

  if (excludeFooter && dataRows.length > 1) {
    // Check trailing rows from bottom up (at most 2 summary lines)
    while (dataRows.length > 1 && excludedFooterRows.length < 2) {
      const tail = dataRows[dataRows.length - 1]!;
      if (!isTotalsFooterRow(tail)) break;
      excludedFooterRows.unshift(dataRows.pop()!);
    }
  }

  let paddedShortRows = 0;
  const raggedRowAlerts: RaggedRowAlert[] = [];
  const alignedRows: string[][] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rawRow = dataRows[i]!;
    const sourceRowNumber = headerIdx + 2 + i;
    if (rawRow.length === expectedWidth) {
      alignedRows.push(rawRow);
      continue;
    }
    if (rawRow.length < expectedWidth) {
      paddedShortRows++;
      const padded = [...rawRow];
      while (padded.length < expectedWidth) padded.push('');
      alignedRows.push(padded);
    } else {
      raggedRowAlerts.push({
        sourceRow: sourceRowNumber,
        actualColumns: rawRow.length,
        expectedColumns: expectedWidth,
      });
      alignedRows.push(rawRow.slice(0, expectedWidth));
    }
  }

  const outLines = [
    headers.map((h) => serializeCsvCell(h)).join(','),
    ...alignedRows.map((row) => row.map((cell) => serializeCsvCell(cell)).join(',')),
  ];

  return {
    normalizedCsv: outLines.join('\n'),
    headers,
    rowCount: alignedRows.length,
    encoding: decoded.encoding,
    hadMixedLineEndings: lf.hadMixedLineEndings,
    delimiter,
    skippedBannerRows,
    excludedFooterRows,
    paddedShortRows,
    raggedRowAlerts,
  };
}
