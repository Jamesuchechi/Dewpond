import { strToU8, zipSync } from 'fflate';
import { parquetWriteBuffer } from 'hyparquet-writer';
import type { GridColumnMeta } from './arrowFormat';

export const XLSX_EXPORT_CAP_BYTES = 50 * 1024 * 1024;
const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

/** Prefix spreadsheet formula triggers (=, +, -, @, tab, CR) with ' when neutralization is enabled. */
export function neutralizeSpreadsheetFormula(value: string, enabled: boolean): string {
  if (!enabled || value.length === 0) return value;
  return FORMULA_PREFIX_REGEX.test(value) ? `'${value}` : value;
}

function escapeCsvCell(raw: string): string {
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function escapeXmlText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colLetter(zeroBased: number): string {
  let n = zeroBased + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Build RFC-4180 UTF-8 CSV bytes with optional formula-injection neutralization. */
export function buildCsvExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
  neutralizeFormulas: boolean,
): Uint8Array {
  const lines: string[] = [columns.map((c) => escapeCsvCell(c.name)).join(',')];
  for (const row of rows) {
    const cells = columns.map((_col, idx) => {
      const val = row[idx];
      if (val === null || val === undefined) return '';
      return escapeCsvCell(neutralizeSpreadsheetFormula(val, neutralizeFormulas));
    });
    lines.push(cells.join(','));
  }
  return strToU8(`${lines.join('\n')}\n`);
}

/** Build JSON array bytes. */
export function buildJsonExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
): Uint8Array {
  const objects = rows.map((row) => {
    const obj: Record<string, string | null> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]!.name] = row[i] ?? null;
    }
    return obj;
  });
  return strToU8(`${JSON.stringify(objects, null, 2)}\n`);
}

/** Build newline-delimited JSON (NDJSON) bytes. */
export function buildNdjsonExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
): Uint8Array {
  const lines = rows.map((row) => {
    const obj: Record<string, string | null> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]!.name] = row[i] ?? null;
    }
    return JSON.stringify(obj);
  });
  return strToU8(lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

/** Build Parquet bytes via pure-JS hyparquet-writer (avoids raw DuckDB-WASM COPY TO PARQUET). */
export function buildParquetExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
): Uint8Array {
  const columnData = columns.map((col, colIdx) => {
    const upperType = col.type.toUpperCase();
    if (upperType.includes('INT')) {
      return {
        name: col.name,
        data: rows.map((r) => {
          const v = r[colIdx];
          if (v === null || v === undefined || v === '') return null;
          const num = Number(v);
          return Number.isFinite(num) ? Math.trunc(num) : null;
        }),
      };
    }
    if (
      upperType.includes('FLOAT') ||
      upperType.includes('DOUBLE') ||
      upperType.includes('DECIMAL')
    ) {
      return {
        name: col.name,
        data: rows.map((r) => {
          const v = r[colIdx];
          if (v === null || v === undefined || v === '') return null;
          const num = Number(v);
          return Number.isFinite(num) ? num : null;
        }),
      };
    }
    if (upperType.includes('BOOL')) {
      return {
        name: col.name,
        data: rows.map((r) => {
          const v = r[colIdx];
          if (v === null || v === undefined) return null;
          return v === 'true' || v === '1';
        }),
      };
    }
    return {
      name: col.name,
      data: rows.map((r) => r[colIdx] ?? null),
    };
  });

  const arrayBuffer = parquetWriteBuffer({ columnData });
  return new Uint8Array(arrayBuffer);
}

/**
 * Build a valid <= 50 MB OOXML .xlsx workbook via fflate with text preservation (inlineStr)
 * and optional formula-injection neutralization.
 */
export function buildXlsxExportBytes(
  columns: readonly GridColumnMeta[],
  rows: readonly (string | null)[][],
  neutralizeFormulas: boolean,
): Uint8Array {
  const rowXmlParts: string[] = [];

  const headerCells = columns
    .map(
      (col, cIdx) =>
        `<c r="${colLetter(cIdx)}1" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(col.name)}</t></is></c>`,
    )
    .join('');
  rowXmlParts.push(`<row r="1">${headerCells}</row>`);

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx]!;
    const excelRow = rIdx + 2;
    const cellsXml: string[] = [];

    for (let cIdx = 0; cIdx < columns.length; cIdx++) {
      const raw = row[cIdx];
      if (raw === null || raw === undefined) continue;
      const safe = neutralizeSpreadsheetFormula(raw, neutralizeFormulas);
      const ref = `${colLetter(cIdx)}${excelRow}`;
      cellsXml.push(
        `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(safe)}</t></is></c>`,
      );
    }
    rowXmlParts.push(`<row r="${excelRow}">${cellsXml.join('')}</row>`);
  }

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowXmlParts.join('')}</sheetData>` +
    '</worksheet>';

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="DewpondExport" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>';

  const workbookRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  const zipped = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypesXml),
      '_rels/.rels': strToU8(rootRelsXml),
      'xl/workbook.xml': strToU8(workbookXml),
      'xl/_rels/workbook.xml.rels': strToU8(workbookRelsXml),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml),
    },
    { level: 6 },
  );

  if (zipped.byteLength > XLSX_EXPORT_CAP_BYTES) {
    throw new Error(
      `Exported XLSX (${(zipped.byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds the 50 MB cap. Use CSV or Parquet.`,
    );
  }
  return zipped;
}
