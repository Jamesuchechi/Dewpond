export interface FixtureSpec {
  id: string;
  format: 'csv' | 'tsv' | 'xlsx' | 'ndjson';
  hazard: string;
  expectedOutcome: string;
}

export const MESSY_CORPUS_SPEC: readonly FixtureSpec[] = [
  {
    id: 'decimal-rounding-guard',
    format: 'csv',
    hazard: "First rows look like integers; later rows have '.50' decimals.",
    expectedOutcome: 'Must infer DOUBLE (not BIGINT rounded to integer).',
  },
  {
    id: 'leading-zero-msisdn',
    format: 'csv',
    hazard: 'Local phone numbers with leading 0 (08012345678).',
    expectedOutcome: 'Must veto numeric types and retain VARCHAR.',
  },
  {
    id: 'eleven-digit-bvn',
    format: 'csv',
    hazard: 'Uniform 11-digit BVN/NIN IDs.',
    expectedOutcome: 'Must veto numeric coercion and retain VARCHAR.',
  },
  {
    id: 'ambiguous-slash-dates',
    format: 'csv',
    hazard: 'Slash dates where day and month are both <= 12 across all sample rows.',
    expectedOutcome: 'Must pause ingest and trigger explicit DMY/MDY resolver.',
  },
  {
    id: 'win1252-currency-crlf',
    format: 'csv',
    hazard: 'Windows-1252 encoding, mixed CRLF/LF newlines, currency symbols, totals footer.',
    expectedOutcome: 'Normalize encoding/newlines and isolate totals footer.',
  },
  {
    id: 'ragged-banner-rows',
    format: 'csv',
    hazard: 'Title banner rows above real header plus trailing ragged columns.',
    expectedOutcome: 'Skip banner rows cleanly and quarantine malformed rows in _rejects.',
  },
  {
    id: 'xlsx-1904-dates-merges',
    format: 'xlsx',
    hazard: 'Mac 1904 workbook date system, merged header banner, hidden sheet.',
    expectedOutcome: 'Apply exact UTC 1904 epoch math and surface hidden sheets.',
  },
] as const;

/** Build a deterministic synthetic CSV testing that '1500.50' never rounds to integer. */
export function buildDecimalRoundingFixtureCsv(): string {
  return [
    'tx_id,account_phone,amount',
    'TX001,08012345678,100',
    'TX002,08023456789,250',
    'TX003,08034567890,1500.50',
    'TX004,08045678901,400',
  ].join('\n');
}
