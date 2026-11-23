import { Unzip, UnzipInflate } from 'fflate';
import { deduplicateHeaders, detectHeaderRowIndex, isTotalsFooterRow } from './normalize';
import type { ParsedXlsxWorkbook, XlsxSheetInfo } from './types';

export const XLSX_WARN_BYTES = 25 * 1024 * 1024;
export const XLSX_HARD_CAP_BYTES = 50 * 1024 * 1024;

const BUILTIN_DATE_NUMFMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const MS_PER_DAY = 86_400_000;
const EXCEL_1900_EPOCH_UTC = Date.UTC(1899, 11, 30);
const EXCEL_1904_EPOCH_UTC = Date.UTC(1904, 0, 1);

function decodeUtf8Bytes(bytes: Uint8Array): string {
  // Fast ASCII path with UTF-8 multi-byte decoding
  const out: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    if (b0 <= 0x7f) {
      out.push(String.fromCharCode(b0));
      i++;
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      const cp = ((b0 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      out.push(String.fromCharCode(cp));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      const cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      out.push(String.fromCharCode(cp));
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      out.push(String.fromCodePoint(cp));
      i += 4;
    } else {
      out.push('\uFFFD');
      i++;
    }
  }
  return out.join('');
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function getAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`);
  const m = re.exec(tag);
  return m ? decodeXmlEntities(m[1]!) : undefined;
}

function extractTagText(xml: string, tagName: string): string {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'g');
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    parts.push(decodeXmlEntities(match[1]!));
  }
  return parts.join('');
}

function colLettersToZeroIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!m) return null;
  return { col: colLettersToZeroIndex(m[1]!), row: Number(m[2]) - 1 };
}

function parseMergeRange(rangeRef: string): {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
} | null {
  const parts = rangeRef.split(':');
  if (parts.length !== 2) return null;
  const start = parseCellRef(parts[0]!);
  const end = parseCellRef(parts[1]!);
  if (!start || !end) return null;
  return { r1: start.row, c1: start.col, r2: end.row, c2: end.col };
}

/** Convert Excel numeric serial to UTC YYYY-MM-DD (or ISO timestamp when fractional). */
export function excelSerialToUtcIso(serial: number, date1904: boolean): string {
  const baseEpoch = date1904 ? EXCEL_1904_EPOCH_UTC : EXCEL_1900_EPOCH_UTC;
  const hasTime = Math.abs(serial - Math.trunc(serial)) > 1e-6;
  const ms = Math.round(baseEpoch + serial * MS_PER_DAY);
  const iso = new Date(ms).toISOString();
  return hasTime ? iso : iso.slice(0, 10);
}

function isCustomDateFormatCode(code: string): boolean {
  const stripped = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
  return /[ymdhs]/i.test(stripped);
}

function parseStylesDateIndexes(stylesXml: string): Set<number> {
  const customDateFmtIds = new Set<number>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const attrs = m[1]!;
    const id = Number(getAttr(attrs, 'numFmtId'));
    const code = getAttr(attrs, 'formatCode');
    if (Number.isFinite(id) && code && isCustomDateFormatCode(code)) {
      customDateFmtIds.add(id);
    }
  }

  const dateStyleIndexes = new Set<number>();
  const xfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!xfsMatch) return dateStyleIndexes;

  let idx = 0;
  for (const m of xfsMatch[1]!.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const numFmtId = Number(getAttr(m[1]!, 'numFmtId'));
    if (BUILTIN_DATE_NUMFMT_IDS.has(numFmtId) || customDateFmtIds.has(numFmtId)) {
      dateStyleIndexes.add(idx);
    }
    idx++;
  }
  return dateStyleIndexes;
}

function parseSharedStringsChunked(chunks: readonly Uint8Array[]): string[] {
  const strings: string[] = [];
  let buffer = '';

  for (const chunk of chunks) {
    buffer += decodeUtf8Bytes(chunk);
    while (true) {
      const start = buffer.indexOf('<si');
      if (start === -1) {
        if (buffer.length > 64) buffer = buffer.slice(-16);
        break;
      }
      const end = buffer.indexOf('</si>', start);
      if (end === -1) {
        buffer = buffer.slice(start);
        break;
      }
      const siBody = buffer.slice(start, end + 5);
      strings.push(extractTagText(siBody, 't'));
      buffer = buffer.slice(end + 5);
    }
  }

  return strings;
}

function parseWorkbookMeta(
  workbookXml: string,
  relsXml: string,
): { date1904: boolean; sheets: XlsxSheetInfo[] } {
  const date1904Match = /<workbookPr\b[^>]*date1904=["'](1|true)["']/i.exec(workbookXml);
  const date1904 = Boolean(date1904Match);

  const targetByRid = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs = m[1]!;
    const id = getAttr(attrs, 'Id');
    const target = getAttr(attrs, 'Target');
    if (id && target) {
      const clean = target.replace(/^\/+/, '');
      targetByRid.set(id, clean.startsWith('xl/') ? clean : `xl/${clean}`);
    }
  }

  const sheets: XlsxSheetInfo[] = [];
  let autoIndex = 1;
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const attrs = m[1]!;
    const name = getAttr(attrs, 'name') ?? `Sheet${autoIndex}`;
    const sheetId = getAttr(attrs, 'sheetId') ?? String(autoIndex);
    const stateRaw = getAttr(attrs, 'state');
    const state =
      stateRaw === 'hidden' || stateRaw === 'veryHidden' ? stateRaw : ('visible' as const);
    const rId = getAttr(attrs, 'r:id') ?? '';
    const path = targetByRid.get(rId) ?? `xl/worksheets/sheet${autoIndex}.xml`;
    sheets.push({ name, sheetId, state, path });
    autoIndex++;
  }

  return { date1904, sheets };
}

function parseWorksheetChunked(
  chunks: readonly Uint8Array[],
  sharedStrings: readonly string[],
  dateStyleIndexes: ReadonlySet<number>,
  date1904: boolean,
): { rows: string[][]; mergedCells: string[]; hiddenRowCount: number } {
  const sparseRows = new Map<number, Map<number, string>>();
  const mergedCells: string[] = [];
  let hiddenRowCount = 0;
  let maxRow = -1;
  let maxCol = -1;

  let buffer = '';
  for (const chunk of chunks) {
    buffer += decodeUtf8Bytes(chunk);

    // Parse complete <row ...>...</row> blocks incrementally so we never hold full XML
    while (true) {
      const rStart = buffer.indexOf('<row');
      if (rStart === -1) break;
      const rSelfClose = buffer.indexOf('/>', rStart);
      const rTagEnd = buffer.indexOf('>', rStart);
      if (rTagEnd === -1) break;

      let rowBlock: string;
      let consumeEnd: number;
      if (rSelfClose !== -1 && rSelfClose < rTagEnd) {
        rowBlock = buffer.slice(rStart, rSelfClose + 2);
        consumeEnd = rSelfClose + 2;
      } else {
        const rClose = buffer.indexOf('</row>', rTagEnd);
        if (rClose === -1) break;
        rowBlock = buffer.slice(rStart, rClose + 6);
        consumeEnd = rClose + 6;
      }

      const openTag = rowBlock.slice(0, rowBlock.indexOf('>') + 1);
      if (getAttr(openTag, 'hidden') === '1') {
        hiddenRowCount++;
      }

      const rowAttr = Number(getAttr(openTag, 'r'));
      const fallbackRowIdx = maxRow + 1;
      const rowNumZero = Number.isFinite(rowAttr) && rowAttr >= 1 ? rowAttr - 1 : fallbackRowIdx;
      if (rowNumZero > maxRow) maxRow = rowNumZero;

      const cellMap = sparseRows.get(rowNumZero) ?? new Map<number, string>();
      let fallbackCol = 0;

      for (const cMatch of rowBlock.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const cAttrs = cMatch[1]!;
        const cBody = cMatch[2] ?? '';
        const refStr = getAttr(cAttrs, 'r');
        const parsedRef = refStr ? parseCellRef(refStr) : null;
        const colIdx = parsedRef ? parsedRef.col : fallbackCol;
        fallbackCol = colIdx + 1;
        if (colIdx > maxCol) maxCol = colIdx;

        const cellType = getAttr(cAttrs, 't');
        const styleIdx = Number(getAttr(cAttrs, 's') ?? '-1');

        let resolved: string;
        if (cellType === 'inlineStr') {
          resolved = extractTagText(cBody, 't');
        } else {
          const rawV = extractTagText(cBody, 'v');
          if (cellType === 's') {
            const ssIdx = Number(rawV);
            resolved = Number.isInteger(ssIdx) ? (sharedStrings[ssIdx] ?? '') : '';
          } else if (cellType === 'b') {
            resolved = rawV === '1' ? 'true' : 'false';
          } else if (cellType === 'str' || cellType === 'e') {
            resolved = rawV;
          } else if (rawV.length > 0 && dateStyleIndexes.has(styleIdx)) {
            const num = Number(rawV);
            resolved = Number.isFinite(num) ? excelSerialToUtcIso(num, date1904) : rawV;
          } else {
            resolved = rawV;
          }
        }

        cellMap.set(colIdx, resolved);
      }

      if (cellMap.size > 0) {
        sparseRows.set(rowNumZero, cellMap);
      }
      buffer = buffer.slice(consumeEnd);
    }

    // Parse any completed <mergeCell ref="..."/> tags present in buffer
    for (const mMatch of buffer.matchAll(/<mergeCell\b([^>]*?)\/?>/g)) {
      const ref = getAttr(mMatch[1]!, 'ref');
      if (ref && !mergedCells.includes(ref)) {
        mergedCells.push(ref);
      }
    }

    if (buffer.length > 65536) {
      const lastRow = buffer.lastIndexOf('<row');
      const lastMerge = buffer.lastIndexOf('<mergeCells');
      const keepFrom = Math.max(lastRow, lastMerge);
      if (keepFrom > 0) buffer = buffer.slice(keepFrom);
    }
  }

  // Propagate merged top-left cell values across merged ranges
  for (const rangeRef of mergedCells) {
    const bounds = parseMergeRange(rangeRef);
    if (!bounds) continue;
    const anchorRow = sparseRows.get(bounds.r1);
    const anchorVal = anchorRow?.get(bounds.c1);
    if (!anchorVal) continue;
    if (bounds.r2 > maxRow) maxRow = bounds.r2;
    if (bounds.c2 > maxCol) maxCol = bounds.c2;

    for (let r = bounds.r1; r <= bounds.r2; r++) {
      const rowMap = sparseRows.get(r) ?? new Map<number, string>();
      for (let c = bounds.c1; c <= bounds.c2; c++) {
        if (!rowMap.has(c) || rowMap.get(c) === '') {
          rowMap.set(c, anchorVal);
        }
      }
      sparseRows.set(r, rowMap);
    }
  }

  if (maxRow < 0 || maxCol < 0) {
    return { rows: [], mergedCells, hiddenRowCount };
  }

  const width = maxCol + 1;
  const rows: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const rowMap = sparseRows.get(r);
    if (!rowMap) continue;
    const out = new Array<string>(width).fill('');
    for (const [c, val] of rowMap.entries()) {
      out[c] = val;
    }
    if (out.some((cell) => cell.trim().length > 0)) {
      rows.push(out);
    }
  }

  return { rows, mergedCells, hiddenRowCount };
}

/**
 * Parse an XLSX workbook using fflate streaming ZIP + chunked XML extraction.
 * - Enforces Dewpond's 50 MB hard cap & warns > 25 MB.
 * - Surfaces hidden sheets, hidden rows, merged cells, cached formulas, and exact 1900/1904 UTC dates.
 */
export function parseXlsxWorkbook(
  zipBytes: Uint8Array,
  selectedSheetName?: string,
): ParsedXlsxWorkbook {
  if (zipBytes.byteLength > XLSX_HARD_CAP_BYTES) {
    throw new RangeError(
      `XLSX size ${(zipBytes.byteLength / (1024 * 1024)).toFixed(1)} MB exceeds Dewpond's 50 MB browser XLSX cap. Convert to CSV or Parquet instead.`,
    );
  }

  const warnings: string[] = [];
  if (zipBytes.byteLength > XLSX_WARN_BYTES) {
    warnings.push(
      `Large XLSX (${(zipBytes.byteLength / (1024 * 1024)).toFixed(1)} MB > 25 MB). Prefer CSV or Parquet for large workbooks.`,
    );
  }

  const entryChunks = new Map<string, Uint8Array[]>();
  const unzip = new Unzip((file) => {
    const name = file.name.replace(/^\/+/, '');
    if (
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/styles.xml' ||
      name === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)
    ) {
      const chunks: Uint8Array[] = [];
      entryChunks.set(name, chunks);
      file.ondata = (err, data) => {
        if (err) throw err;
        if (data && data.length > 0) chunks.push(data);
      };
      file.start();
    }
  });
  unzip.register(UnzipInflate);
  unzip.push(zipBytes, true);

  const readWholeXml = (entryName: string): string => {
    const chunks = entryChunks.get(entryName);
    if (!chunks) return '';
    return chunks.map((c) => decodeUtf8Bytes(c)).join('');
  };

  const workbookXml = readWholeXml('xl/workbook.xml');
  if (!workbookXml) {
    throw new Error('Invalid XLSX archive: missing xl/workbook.xml');
  }
  const relsXml = readWholeXml('xl/_rels/workbook.xml.rels');
  const { date1904, sheets } = parseWorkbookMeta(workbookXml, relsXml);
  if (sheets.length === 0) {
    throw new Error('XLSX workbook contains zero worksheets.');
  }

  const hiddenSheets = sheets.filter((s) => s.state !== 'visible');
  if (hiddenSheets.length > 0) {
    warnings.push(
      `Workbook contains ${hiddenSheets.length} hidden sheet(s): ${hiddenSheets.map((s) => s.name).join(', ')}.`,
    );
  }

  const chosen =
    (selectedSheetName ? sheets.find((s) => s.name === selectedSheetName) : undefined) ??
    sheets.find((s) => s.state === 'visible') ??
    sheets[0]!;

  const stylesXml = readWholeXml('xl/styles.xml');
  const dateStyleIndexes = stylesXml ? parseStylesDateIndexes(stylesXml) : new Set<number>();

  const ssChunks = entryChunks.get('xl/sharedStrings.xml') ?? [];
  const sharedStrings = ssChunks.length > 0 ? parseSharedStringsChunked(ssChunks) : [];

  const sheetChunks = entryChunks.get(chosen.path) ?? [];
  if (sheetChunks.length === 0) {
    throw new Error(`Worksheet data missing for "${chosen.name}" (${chosen.path}).`);
  }

  const parsedSheet = parseWorksheetChunked(sheetChunks, sharedStrings, dateStyleIndexes, date1904);
  if (parsedSheet.hiddenRowCount > 0) {
    warnings.push(`Sheet "${chosen.name}" contains ${parsedSheet.hiddenRowCount} hidden row(s).`);
  }

  if (parsedSheet.rows.length === 0) {
    return {
      sheets,
      selectedSheet: chosen.name,
      date1904,
      columns: [],
      rowCount: 0,
      mergedCells: parsedSheet.mergedCells,
      hiddenRowCount: parsedSheet.hiddenRowCount,
      skippedBannerRows: [],
      excludedFooterRows: [],
      warnings,
    };
  }

  const headerIdx = detectHeaderRowIndex(parsedSheet.rows);
  const skippedBannerRows = parsedSheet.rows.slice(0, headerIdx);
  const rawHeaders = parsedSheet.rows[headerIdx] ?? [];
  const headers = deduplicateHeaders(rawHeaders);

  const dataRows = parsedSheet.rows.slice(headerIdx + 1);
  const excludedFooterRows: string[][] = [];
  if (dataRows.length > 1 && isTotalsFooterRow(dataRows[dataRows.length - 1]!)) {
    excludedFooterRows.push(dataRows.pop()!);
  }

  const columns = headers.map((name, colIdx) => ({
    name,
    values: dataRows.map((row) => {
      const val = row[colIdx];
      return val === undefined || val === '' ? null : val;
    }),
  }));

  return {
    sheets,
    selectedSheet: chosen.name,
    date1904,
    columns,
    rowCount: dataRows.length,
    mergedCells: parsedSheet.mergedCells,
    hiddenRowCount: parsedSheet.hiddenRowCount,
    skippedBannerRows,
    excludedFooterRows,
    warnings,
  };
}
