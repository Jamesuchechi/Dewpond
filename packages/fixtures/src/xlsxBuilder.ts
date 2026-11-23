import { zipSync } from 'fflate';

export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (cp <= 0x7f) {
      bytes.push(cp);
    } else if (cp <= 0x7ff) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function escapeXml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function colIndexToLetters(idx: number): string {
  let n = idx + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export interface SimpleXlsxCell {
  value: string | number;
  isDate?: boolean;
  formula?: string;
}

export interface SimpleXlsxSheet {
  name: string;
  hidden?: boolean;
  hiddenRows?: number[];
  mergedRanges?: string[];
  rows: readonly (readonly SimpleXlsxCell[])[];
}

export function buildSyntheticXlsx(opts: {
  date1904?: boolean;
  sheets: readonly SimpleXlsxSheet[];
}): Uint8Array {
  const sharedStrings: string[] = [];
  const ssIndex = new Map<string, number>();

  const intern = (s: string): number => {
    const existing = ssIndex.get(s);
    if (existing !== undefined) return existing;
    const idx = sharedStrings.length;
    sharedStrings.push(s);
    ssIndex.set(s, idx);
    return idx;
  };

  const files: Record<string, Uint8Array> = {};

  opts.sheets.forEach((sheet, sIdx) => {
    const sheetNum = sIdx + 1;
    const hiddenSet = new Set(sheet.hiddenRows ?? []);
    const rowXml = sheet.rows
      .map((row, rIdx) => {
        const rNum = rIdx + 1;
        const hiddenAttr = hiddenSet.has(rNum) ? ' hidden="1"' : '';
        const cellsXml = row
          .map((cell, cIdx) => {
            const ref = `${colIndexToLetters(cIdx)}${rNum}`;
            if (cell.formula) {
              return `<c r="${ref}"><f>${escapeXml(cell.formula)}</f><v>${escapeXml(String(cell.value))}</v></c>`;
            }
            if (typeof cell.value === 'number') {
              const styleAttr = cell.isDate ? ' s="1"' : '';
              return `<c r="${ref}"${styleAttr}><v>${cell.value}</v></c>`;
            }
            const ssId = intern(cell.value);
            return `<c r="${ref}" t="s"><v>${ssId}</v></c>`;
          })
          .join('');
        return `<row r="${rNum}"${hiddenAttr}>${cellsXml}</row>`;
      })
      .join('');

    const mergesXml =
      sheet.mergedRanges && sheet.mergedRanges.length > 0
        ? `<mergeCells count="${sheet.mergedRanges.length}">${sheet.mergedRanges.map((m) => `<mergeCell ref="${escapeXml(m)}"/>`).join('')}</mergeCells>`
        : '';

    files[`xl/worksheets/sheet${sheetNum}.xml`] = encodeUtf8(
      `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
  ${mergesXml}
</worksheet>`,
    );
  });

  files['xl/workbook.xml'] = encodeUtf8(
    `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="${opts.date1904 ? '1' : '0'}"/>
  <sheets>
    ${opts.sheets
      .map(
        (s, idx) =>
          `<sheet name="${escapeXml(s.name)}" sheetId="${idx + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${idx + 1}"/>`,
      )
      .join('')}
  </sheets>
</workbook>`,
  );

  files['xl/_rels/workbook.xml.rels'] = encodeUtf8(
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${opts.sheets
    .map((_s, idx) => `<Relationship Id="rId${idx + 1}" Target="worksheets/sheet${idx + 1}.xml"/>`)
    .join('')}
</Relationships>`,
  );

  files['xl/styles.xml'] = encodeUtf8(
    `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>
</styleSheet>`,
  );

  files['xl/sharedStrings.xml'] = encodeUtf8(
    `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${sharedStrings.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('')}
</sst>`,
  );

  return zipSync(files);
}
