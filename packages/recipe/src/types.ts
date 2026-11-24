export type SourceId = string;
export type TableId = string;
export type StepId = string;

export type LogicalType = 'VARCHAR' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'DATE' | 'TIMESTAMP';

export type SourceKind =
  'csv' | 'tsv' | 'xlsx' | 'json' | 'ndjson' | 'parquet' | 'duckdb' | 'sqlite';

export interface SchemaColumn {
  name: string;
  type: LogicalType;
}

export interface SchemaFingerprint {
  columns: SchemaColumn[];
  hash: string;
}

export interface IngestOptions {
  delimiter?: string;
  headerRow?: number;
  dateOrder?: 'DMY' | 'MDY' | 'ISO';
  overrides?: Record<string, LogicalType>;
}

export interface SourceRef {
  id: SourceId;
  name: string;
  kind: SourceKind;
  sheet?: string;
  bytes: number;
  fingerprint: SchemaFingerprint;
  ingest: IngestOptions;
  lastModified: number;
}

export type PredicateOp =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'is_null' | 'not_null';

export interface Predicate {
  column: string;
  op: PredicateOp;
  value?: string | number | boolean | null;
}

export type Expr =
  | { kind: 'column'; name: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'sql'; expression: string };

export interface JoinKey {
  left: string;
  right: string;
}

export type JoinHow = 'inner' | 'left' | 'right' | 'full';

export type RedactAction =
  | { mode: 'mask'; keepStart: number; keepEnd: number; maskChar?: string }
  | { mode: 'hash_sha256'; salt?: string }
  | { mode: 'generalize'; strategy: 'date_month' | 'numeric_bucket'; bucketSize?: number }
  | { mode: 'shuffle'; seed: string }
  | { mode: 'drop' };

export type Step =
  | { id: StepId; op: 'filter'; table: TableId; predicate: Predicate }
  | { id: StepId; op: 'derive'; table: TableId; column: string; expr: Expr }
  | {
      id: StepId;
      op: 'cast';
      table: TableId;
      column: string;
      to: LogicalType;
      onFail: 'null' | 'reject';
    }
  | {
      id: StepId;
      op: 'dedupe';
      table: TableId;
      keys: string[];
      keep: 'first' | 'last' | 'most_complete';
      orderBy?: string;
    }
  | {
      id: StepId;
      op: 'join';
      left: TableId;
      right: TableId;
      on: JoinKey[];
      how: JoinHow;
      as: TableId;
    }
  | { id: StepId; op: 'redact'; table: TableId; column: string; action: RedactAction }
  | { id: StepId; op: 'createTable'; as: TableId; from: 'query' | 'paste'; sql?: string }
  | { id: StepId; op: 'rawSql'; sql: string; as: TableId; trusted: boolean }
  | { id: StepId; op: 'rename'; table: TableId; from: string; to: string }
  | { id: StepId; op: 'drop'; table: TableId; columns: string[] }
  | { id: StepId; op: 'trim'; table: TableId; columns: string[] }
  | {
      id: StepId;
      op: 'replace';
      table: TableId;
      column: string;
      search: string;
      replacement: string;
    }
  | { id: StepId; op: 'reorder'; table: TableId; columns: string[] }
  | {
      id: StepId;
      op: 'case';
      table: TableId;
      columns: string[];
      mode: 'lower' | 'upper' | 'title';
    }
  | {
      id: StepId;
      op: 'regexExtract';
      table: TableId;
      column: string;
      pattern: string;
      into: string;
      group?: number;
    }
  | {
      id: StepId;
      op: 'split';
      table: TableId;
      column: string;
      delimiter: string;
      into: string[];
    }
  | {
      id: StepId;
      op: 'merge';
      table: TableId;
      columns: string[];
      separator: string;
      into: string;
    }
  | {
      id: StepId;
      op: 'fillNulls';
      table: TableId;
      column: string;
      strategy: 'value' | 'mean' | 'median' | 'ffill';
      value?: string | number | boolean;
    }
  | {
      id: StepId;
      op: 'parseDate';
      table: TableId;
      column: string;
      format: 'DMY' | 'MDY' | 'ISO';
    }
  | {
      id: StepId;
      op: 'parseNumber';
      table: TableId;
      column: string;
      locale: 'us_currency' | 'eu_decimal';
    };

export interface CellEditEntry {
  rid: string;
  column: string;
  value: string | null;
}

export interface InsertedRowEntry {
  rid: string;
  ord: number;
  values: Record<string, string | null>;
}

export interface EditOverlay {
  tableId: TableId;
  cellEdits: CellEditEntry[];
  deletedRids: string[];
  insertedRows: InsertedRowEntry[];
}

export interface Recipe {
  version: 1;
  id: string;
  name: string;
  sources: SourceRef[];
  steps: Step[];
  head: number;
  overlay?: EditOverlay;
  createdAt: number;
  updatedAt: number;
}
