import * as arrow from 'apache-arrow';
import { expose, transfer } from 'comlink';
import {
  parseXlsxWorkbook,
  preprocessCsvBytes,
  scoreColumnSample,
  type ColumnInference,
  type ParsedXlsxColumn,
} from '@dewpond/ingest';
import { scanColumnSample } from '@dewpond/pii';

const UTF8_ENCODER = new TextEncoder();

/** CSP-safe Arrow UTF-8 column builder using arrow.makeData (avoids tableFromArrays' new Function()). */
function buildUtf8ArrowData(values: readonly (string | null)[]): arrow.Data<arrow.Utf8> {
  const n = values.length;
  const offsets = new Int32Array(n + 1);
  const nullBitmap = new Uint8Array(Math.ceil(n / 8));
  const chunks: Array<Uint8Array | null> = new Array(n);
  let totalBytes = 0;
  let nullCount = 0;

  for (let i = 0; i < n; i++) {
    offsets[i] = totalBytes;
    const v = values[i];
    if (v === null || v === undefined) {
      nullCount++;
      chunks[i] = null;
    } else {
      nullBitmap[i >> 3] = (nullBitmap[i >> 3] ?? 0) | (1 << (i & 7));
      const encoded = UTF8_ENCODER.encode(v);
      chunks[i] = encoded;
      totalBytes += encoded.byteLength;
    }
  }
  offsets[n] = totalBytes;

  const data = new Uint8Array(totalBytes);
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const chunk = chunks[i];
    if (chunk) {
      data.set(chunk, pos);
      pos += chunk.byteLength;
    }
  }

  return arrow.makeData({
    type: new arrow.Utf8(),
    length: n,
    nullCount,
    nullBitmap: nullCount > 0 ? nullBitmap : undefined,
    valueOffsets: offsets,
    data,
  });
}

function columnsToArrowIpc(columns: readonly ParsedXlsxColumn[]): Uint8Array {
  const vectors: Record<string, arrow.Vector<arrow.Utf8>> = {};
  for (const col of columns) {
    vectors[col.name] = arrow.makeVector(buildUtf8ArrowData(col.values));
  }
  const tbl = new arrow.Table(vectors);
  return arrow.tableToIPC(tbl, 'stream').slice();
}

export interface ScoredColumnBatchItem {
  columnName: string;
  values: (string | null)[];
}

export interface ParsedXlsxWorkerResult {
  sheets: ReturnType<typeof parseXlsxWorkbook>['sheets'];
  selectedSheet: string;
  date1904: boolean;
  rowCount: number;
  mergedCells: string[];
  hiddenRowCount: number;
  skippedBannerRows: string[][];
  excludedFooterRows: string[][];
  warnings: string[];
  inferences: ColumnInference[];
  ipcBytes: Uint8Array;
}

const computeApi = {
  ping(): { ok: true; worker: 'compute' } {
    return { ok: true, worker: 'compute' };
  },
  preprocessCsv(
    bytes: Uint8Array,
    opts?: { excludeFooter?: boolean; delimiterOverride?: ',' | '\t' | ';' | '|' },
  ) {
    return preprocessCsvBytes(bytes, opts);
  },
  scoreColumnsBatch(columns: readonly ScoredColumnBatchItem[]): ColumnInference[] {
    return columns.map((col) => scoreColumnSample(col.columnName, col.values));
  },
  parseXlsxToArrowIpc(bytes: Uint8Array, selectedSheet?: string): ParsedXlsxWorkerResult {
    const wb = parseXlsxWorkbook(bytes, selectedSheet);
    const inferences = wb.columns.map((c) => scoreColumnSample(c.name, c.values.slice(0, 5000)));
    const ipcBytes = columnsToArrowIpc(wb.columns);

    const payload: ParsedXlsxWorkerResult = {
      sheets: wb.sheets,
      selectedSheet: wb.selectedSheet,
      date1904: wb.date1904,
      rowCount: wb.rowCount,
      mergedCells: wb.mergedCells,
      hiddenRowCount: wb.hiddenRowCount,
      skippedBannerRows: wb.skippedBannerRows,
      excludedFooterRows: wb.excludedFooterRows,
      warnings: wb.warnings,
      inferences,
      ipcBytes,
    };
    return transfer(payload, [ipcBytes.buffer]);
  },
  scanColumnSample,
};

export type ComputeWorkerApi = typeof computeApi;

expose(computeApi);
