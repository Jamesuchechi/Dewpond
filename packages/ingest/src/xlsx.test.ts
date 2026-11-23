import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { XLSX_HARD_CAP_BYTES, excelSerialToUtcIso, parseXlsxWorkbook } from './index';

function buildMinimalXlsx(opts: { date1904: boolean }): Uint8Array {
  const enc = new TextEncoder();
  const serial = opts.date1904 ? '44288' : '45750'; // 2025-04-03 in 1904 vs 1900 epoch

  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <workbookPr date1904="${opts.date1904 ? '1' : '0'}"/>
        <sheets>
          <sheet name="Summary" sheetId="1" r:id="rId1"/>
          <sheet name="HiddenAudit" sheetId="2" state="hidden" r:id="rId2"/>
        </sheets>
      </workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
      </Relationships>`,
    ),
    'xl/styles.xml': enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <cellXfs count="2">
          <xf numFmtId="0"/>
          <xf numFmtId="14"/>
        </cellXfs>
      </styleSheet>`,
    ),
    'xl/sharedStrings.xml': enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
        <si><t>Payroll Banner</t></si>
        <si><t>tx_date</t></si>
        <si><t>phone</t></si>
        <si><t>amount</t></si>
      </sst>`,
    ),
    'xl/worksheets/sheet1.xml': enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c></row>
          <row r="2">
            <c r="A2" t="s"><v>1</v></c>
            <c r="B2" t="s"><v>2</v></c>
            <c r="C2" t="s"><v>3</v></c>
          </row>
          <row r="3">
            <c r="A3" s="1"><v>${serial}</v></c>
            <c r="B3" t="inlineStr"><is><t>08012345678</t></is></c>
            <c r="C3"><f>1000+500.5</f><v>1500.50</v></c>
          </row>
          <row r="4" hidden="1">
            <c r="A4" s="1"><v>${serial}</v></c>
            <c r="B4" t="inlineStr"><is><t>08099998888</t></is></c>
            <c r="C4"><v>250</v></c>
          </row>
        </sheetData>
        <mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>
      </worksheet>`,
    ),
    'xl/worksheets/sheet2.xml': enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" t="inlineStr"><is><t>audit_id</t></is></c></row>
          <row r="2"><c r="A2" t="inlineStr"><is><t>AUD-1</t></is></c></row>
        </sheetData>
      </worksheet>`,
    ),
  };
  return zipSync(files);
}

describe('@dewpond/ingest XLSX streaming reader', () => {
  it('computes exact UTC dates for both 1900 and 1904 epochs and preserves cached formulas, merges, and hidden warnings', () => {
    expect(excelSerialToUtcIso(45750, false)).toBe('2025-04-03');
    expect(excelSerialToUtcIso(44288, true)).toBe('2025-04-03');

    const wb1900 = parseXlsxWorkbook(buildMinimalXlsx({ date1904: false }));
    expect(wb1900.date1904).toBe(false);
    expect(wb1900.skippedBannerRows).toHaveLength(1);
    expect(wb1900.mergedCells).toEqual(['A1:C1']);
    expect(wb1900.hiddenRowCount).toBe(1);
    expect(wb1900.sheets.find((s) => s.name === 'HiddenAudit')?.state).toBe('hidden');
    expect(wb1900.warnings.length).toBeGreaterThanOrEqual(2);
    expect(wb1900.columns.map((c) => c.name)).toEqual(['tx_date', 'phone', 'amount']);
    expect(wb1900.columns[0]!.values[0]).toBe('2025-04-03');
    expect(wb1900.columns[1]!.values[0]).toBe('08012345678');
    expect(wb1900.columns[2]!.values[0]).toBe('1500.50');

    const wb1904 = parseXlsxWorkbook(buildMinimalXlsx({ date1904: true }), 'HiddenAudit');
    expect(wb1904.date1904).toBe(true);
    expect(wb1904.selectedSheet).toBe('HiddenAudit');
    expect(wb1904.columns[0]!.values).toEqual(['AUD-1']);
  });

  it('rejects XLSX buffers above the 50 MB hard cap cleanly', () => {
    const oversize = new Uint8Array(XLSX_HARD_CAP_BYTES + 1);
    expect(() => parseXlsxWorkbook(oversize)).toThrow(/50 MB/);
  });
});
