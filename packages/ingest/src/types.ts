export type InferredType = 'VARCHAR' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'DATE';

export type VetoReason =
  | 'all_null'
  | 'id_column_name'
  | 'leading_zero'
  | 'long_uniform_digits'
  | 'scientific_notation_corruption'
  | 'ambiguous_slash_date'
  | 'mixed_types';

export interface ColumnInference {
  columnName: string;
  type: InferredType;
  confidence: number;
  vetoReasons: VetoReason[];
  dateAmbiguity: boolean;
  detectedDateOrder?: 'DMY' | 'MDY';
  nonNullCount: number;
  totalCount: number;
}
