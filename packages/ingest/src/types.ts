export type InferredType = 'VARCHAR' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'DATE';

export type LocaleNumberFormat = 'us_currency' | 'eu_decimal';

export type VetoReason =
  | 'all_null'
  | 'id_column_name'
  | 'leading_zero'
  | 'long_uniform_digits'
  | 'scientific_notation_corruption'
  | 'ambiguous_slash_date'
  | 'mixed_types';

export interface AmbiguousDatePreview {
  raw: string;
  asDmy: string;
  asMdy: string;
}

export interface ColumnInference {
  columnName: string;
  type: InferredType;
  confidence: number;
  vetoReasons: VetoReason[];
  dateAmbiguity: boolean;
  detectedDateOrder?: 'DMY' | 'MDY';
  ambiguousDatePreviews?: AmbiguousDatePreview[];
  localeNumberFormat?: LocaleNumberFormat;
  sampleValues: string[];
  nonNullCount: number;
  totalCount: number;
}

export type DetectedFormatKind =
  'csv' | 'tsv' | 'xlsx' | 'parquet' | 'json' | 'ndjson' | 'gzip' | 'zip' | 'unknown';

export interface DetectedFormat {
  kind: DetectedFormatKind;
  delimiter?: ',' | '\t' | ';' | '|';
}

export interface RaggedRowAlert {
  sourceRow: number;
  actualColumns: number;
  expectedColumns: number;
}

export interface NormalizedCsvResult {
  normalizedCsv: string;
  headers: string[];
  rowCount: number;
  encoding: 'utf-8' | 'utf-8-bom' | 'windows-1252';
  hadMixedLineEndings: boolean;
  delimiter: ',' | '\t' | ';' | '|';
  skippedBannerRows: string[][];
  excludedFooterRows: string[][];
  paddedShortRows: number;
  raggedRowAlerts: RaggedRowAlert[];
}

export interface XlsxSheetInfo {
  name: string;
  sheetId: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  path: string;
}

export interface ParsedXlsxColumn {
  name: string;
  values: (string | null)[];
}

export interface ParsedXlsxWorkbook {
  sheets: XlsxSheetInfo[];
  selectedSheet: string;
  date1904: boolean;
  columns: ParsedXlsxColumn[];
  rowCount: number;
  mergedCells: string[];
  hiddenRowCount: number;
  skippedBannerRows: string[][];
  excludedFooterRows: string[][];
  warnings: string[];
}

export type ProfileIssueKind =
  'mixed_type' | 'whitespace' | 'casing_variants' | 'constant_column' | 'key_candidate';

export interface ProfileIssue {
  columnName: string;
  kind: ProfileIssueKind;
  severity: 'warn' | 'info';
  message: string;
  fixLabel?: string;
  fixAction?: 'trim' | 'lowercase' | 'drop' | 'dedupe' | 'inspect_rejects';
}
