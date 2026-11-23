import { buildSyntheticXlsx, encodeUtf8 } from './xlsxBuilder';

export interface FixtureSpec {
  id: string;
  filename: string;
  format: 'csv' | 'tsv' | 'xlsx';
  hazard: string;
  expectedOutcome: string;
}

export interface GeneratedFixture {
  spec: FixtureSpec;
  bytes: Uint8Array;
}

export const MESSY_CORPUS_SPEC: readonly FixtureSpec[] = [
  {
    id: '01-decimal-rounding-guard',
    filename: '01-decimal-rounding-guard.csv',
    format: 'csv',
    hazard: "First 49 rows look like integers; row 50 has '1500.50'.",
    expectedOutcome: 'Must infer DOUBLE (never BIGINT rounded to 1501).',
  },
  {
    id: '02-leading-zero-phones',
    filename: '02-leading-zero-phones.csv',
    format: 'csv',
    hazard: 'Local Nigerian phone numbers starting with 0 (080/070/090).',
    expectedOutcome: 'Must veto numeric types (leading_zero) and preserve VARCHAR.',
  },
  {
    id: '03-eleven-digit-bvn',
    filename: '03-eleven-digit-bvn.csv',
    format: 'csv',
    hazard: 'Uniform 11-digit BVN/NIN IDs under neutral column header.',
    expectedOutcome: 'Must veto numeric types (long_uniform_digits) and keep VARCHAR.',
  },
  {
    id: '04-scientific-corruption',
    filename: '04-scientific-corruption.csv',
    format: 'csv',
    hazard: 'Upstream Excel already saved scientific notation strings (1.23E+10).',
    expectedOutcome: 'Must flag scientific_notation_corruption and keep VARCHAR.',
  },
  {
    id: '05-ambiguous-slash-dates',
    filename: '05-ambiguous-slash-dates.csv',
    format: 'csv',
    hazard: 'All slash dates have both day and month <= 12.',
    expectedOutcome: 'Must trigger dateAmbiguity resolver with DMY/MDY previews.',
  },
  {
    id: '06-unambiguous-dmy-dates',
    filename: '06-unambiguous-dmy-dates.csv',
    format: 'csv',
    hazard: 'DD/MM/YYYY dates where day > 12 disambiguates DMY.',
    expectedOutcome: 'Must infer DATE with detectedDateOrder DMY.',
  },
  {
    id: '07-unambiguous-mdy-dates',
    filename: '07-unambiguous-mdy-dates.csv',
    format: 'csv',
    hazard: 'MM/DD/YYYY dates where second part > 12 disambiguates MDY.',
    expectedOutcome: 'Must infer DATE with detectedDateOrder MDY.',
  },
  {
    id: '08-iso-dates-and-bigint64',
    filename: '08-iso-dates-and-bigint64.csv',
    format: 'csv',
    hazard: 'ISO YYYY-MM-DD dates + >2^53 non-ID integers (9007199254740993).',
    expectedOutcome: 'Must infer DATE and 64-bit BIGINT cleanly.',
  },
  {
    id: '09-utf8-bom-mixed-crlf',
    filename: '09-utf8-bom-mixed-crlf.csv',
    format: 'csv',
    hazard: 'UTF-8 BOM prefix + mixed CRLF/CR/LF line endings + quoted newline.',
    expectedOutcome: 'Strip BOM, normalize newlines, preserve multi-line cell.',
  },
  {
    id: '10-win1252-currency',
    filename: '10-win1252-currency.csv',
    format: 'csv',
    hazard: 'Windows-1252 bytes (0x80 Euro, 0x97 em-dash, 0xE9 e-acute).',
    expectedOutcome: 'Transcode cleanly with zero U+FFFD replacement chars.',
  },
  {
    id: '11-ngn-usd-accounting',
    filename: '11-ngn-usd-accounting.csv',
    format: 'csv',
    hazard: 'Mixed ₦1,250,000.50 currency formatting and accounting (500.25).',
    expectedOutcome: 'Detect us_currency DOUBLE format.',
  },
  {
    id: '12-semicolon-eu-decimals',
    filename: '12-semicolon-eu-decimals.csv',
    format: 'csv',
    hazard: 'Semicolon-delimited European numbers (1.250.000,50 and €45,25).',
    expectedOutcome: 'Sniff ; delimiter and eu_decimal DOUBLE format.',
  },
  {
    id: '13-tab-delimited-quotes',
    filename: '13-tab-delimited-quotes.tsv',
    format: 'tsv',
    hazard: 'Tab-delimited export containing internal commas inside text.',
    expectedOutcome: 'Detect tab delimiter without splitting on commas.',
  },
  {
    id: '14-banner-and-totals-footer',
    filename: '14-banner-and-totals-footer.csv',
    format: 'csv',
    hazard: 'Leading report title banner rows + blank line + Grand Total footer.',
    expectedOutcome: 'Skip banners, detect true headers, isolate footer rows.',
  },
  {
    id: '15-duplicate-blank-headers',
    filename: '15-duplicate-blank-headers.csv',
    format: 'csv',
    hazard: 'Blank column headers and repeated column names (amount, amount).',
    expectedOutcome: 'Fill blank names and deterministically suffix duplicates.',
  },
  {
    id: '16-ragged-short-and-overflow',
    filename: '16-ragged-short-and-overflow.csv',
    format: 'csv',
    hazard: 'Short missing trailing fields and overflow extra cells in rows.',
    expectedOutcome: 'Pad short rows and report overflow cells in raggedRowAlerts.',
  },
  {
    id: '17-mixed-types-rejects',
    filename: '17-mixed-types-rejects.csv',
    format: 'csv',
    hazard: 'Numeric column containing sentinel N/A / pending strings.',
    expectedOutcome: 'Flag mixed_types veto instead of silently dropping bad strings.',
  },
  {
    id: '18-whitespace-casing-constants',
    filename: '18-whitespace-casing-constants.csv',
    format: 'csv',
    hazard: 'Leading/trailing spaces, inconsistent city casing, constant column.',
    expectedOutcome: 'Boolean/string cleanliness + Profile issue detection.',
  },
  {
    id: '19-xlsx-1900-merges-formulas',
    filename: '19-xlsx-1900-merges-formulas.xlsx',
    format: 'xlsx',
    hazard: 'Excel 1900 workbook with merged banner, hidden row, date serial, cached formula.',
    expectedOutcome: 'Parse exact UTC dates, cached <v>, merges, and hidden row warning.',
  },
  {
    id: '20-xlsx-1904-hidden-sheet',
    filename: '20-xlsx-1904-hidden-sheet.xlsx',
    format: 'xlsx',
    hazard: 'Mac 1904 workbook with visible summary sheet and hidden raw audit sheet.',
    expectedOutcome: 'Apply 1904 UTC date epoch cleanly and surface hidden sheet.',
  },
] as const;

export function generateMessyCorpusFile(id: string): GeneratedFixture {
  const spec = MESSY_CORPUS_SPEC.find((s) => s.id === id);
  if (!spec) {
    throw new RangeError(`Unknown messy corpus fixture id: ${id}`);
  }

  switch (id) {
    case '01-decimal-rounding-guard': {
      const lines = ['tx_id,account_phone,amount'];
      for (let i = 1; i <= 49; i++) {
        lines.push(`TX-${i},0801234567${i % 10},${i * 100}`);
      }
      lines.push('TX-50,08098765432,1500.50');
      return { spec, bytes: encodeUtf8(lines.join('\n')) };
    }

    case '02-leading-zero-phones':
      return {
        spec,
        bytes: encodeUtf8(
          ['customer,contact_val', 'Ada,08012345678', 'Tunde,07055112233', 'Kemi,09088776655'].join(
            '\n',
          ),
        ),
      };

    case '03-eleven-digit-bvn':
      return {
        spec,
        bytes: encodeUtf8(
          ['member,ref_code', 'M1,22123456789', 'M2,22987654321', 'M3,22445566778'].join('\n'),
        ),
      };

    case '04-scientific-corruption':
      return {
        spec,
        bytes: encodeUtf8(
          ['account,ref_str', 'A1,1.23E+10', 'A2,4.56E+10', 'A3,7.89E+10'].join('\n'),
        ),
      };

    case '05-ambiguous-slash-dates':
      return {
        spec,
        bytes: encodeUtf8(
          ['tx_id,tx_date', 'T1,03/04/2025', 'T2,05/06/2025', 'T3,11/12/2025'].join('\n'),
        ),
      };

    case '06-unambiguous-dmy-dates':
      return {
        spec,
        bytes: encodeUtf8(
          ['tx_id,tx_date', 'T1,03/04/2025', 'T2,25/04/2025', 'T3,19/08/2025'].join('\n'),
        ),
      };

    case '07-unambiguous-mdy-dates':
      return {
        spec,
        bytes: encodeUtf8(
          ['tx_id,tx_date', 'T1,04/03/2025', 'T2,04/25/2025', 'T3,08/19/2025'].join('\n'),
        ),
      };

    case '08-iso-dates-and-bigint64':
      return {
        spec,
        bytes: encodeUtf8(
          [
            'event_date,seq_num',
            '2025-04-03,42',
            '2025-04-04,9007199254740993',
            '2025-04-05,9007199254740994',
          ].join('\n'),
        ),
      };

    case '09-utf8-bom-mixed-crlf': {
      const text = 'name,note\r\nAda,"Line 1\nLine 2"\rBola,Plain\nChidi,Done';
      const body = encodeUtf8(text);
      const out = new Uint8Array(3 + body.length);
      out[0] = 0xef;
      out[1] = 0xbb;
      out[2] = 0xbf;
      out.set(body, 3);
      return { spec, bytes: out };
    }

    case '10-win1252-currency': {
      // "item,price\nCafé — 1,€50" in Windows-1252 (é=0xE9, —=0x97, €=0x80)
      const bytes = new Uint8Array([
        0x69, 0x74, 0x65, 0x6d, 0x2c, 0x70, 0x72, 0x69, 0x63, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9,
        0x20, 0x97, 0x20, 0x31, 0x2c, 0x80, 0x35, 0x30,
      ]);
      return { spec, bytes };
    }

    case '11-ngn-usd-accounting':
      return {
        spec,
        bytes: encodeUtf8(
          ['entry,gross_amount', 'E1,"₦1,250,000.50"', 'E2,(500.25)', 'E3,"$2,400.00"'].join('\n'),
        ),
      };

    case '12-semicolon-eu-decimals':
      return {
        spec,
        bytes: encodeUtf8(['konto;betrag', 'K1;1.250.000,50', 'K2;-45,50', 'K3;€99,00'].join('\n')),
      };

    case '13-tab-delimited-quotes':
      return {
        spec,
        bytes: encodeUtf8(
          [
            'tx_id\tdescription\tamount',
            'T1\t"Lagos, Nigeria Settlement"\t1200.50',
            'T2\t"Abuja, FCT Fee"\t350.00',
          ].join('\n'),
        ),
      };

    case '14-banner-and-totals-footer':
      return {
        spec,
        bytes: encodeUtf8(
          [
            'ACME TREASURY Q4 REPORT',
            '',
            'tx_id,dept,amount',
            'T1,Treasury,1000',
            'T2,Ops,2500',
            'Grand Total,,3500',
          ].join('\n'),
        ),
      };

    case '15-duplicate-blank-headers':
      return {
        spec,
        bytes: encodeUtf8(['ref,amount,,amount', 'R1,10,ok,20', 'R2,30,ok,40'].join('\n')),
      };

    case '16-ragged-short-and-overflow':
      return {
        spec,
        bytes: encodeUtf8(['a,b,c', '1,2,3', '4,5', '6,7,8,extra'].join('\n')),
      };

    case '17-mixed-types-rejects':
      return {
        spec,
        bytes: encodeUtf8(
          ['tx_id,amount', 'T1,100.50', 'T2,N/A', 'T3,250.00', 'T4,pending'].join('\n'),
        ),
      };

    case '18-whitespace-casing-constants':
      return {
        spec,
        bytes: encodeUtf8(
          ['city,currency,flag', '  Lagos ,NGN,true', 'lagos,NGN,false', 'LAGOS,NGN,true'].join(
            '\n',
          ),
        ),
      };

    case '19-xlsx-1900-merges-formulas':
      return {
        spec,
        bytes: buildSyntheticXlsx({
          date1904: false,
          sheets: [
            {
              name: 'Ledger',
              hiddenRows: [4],
              mergedRanges: ['A1:C1'],
              rows: [
                [{ value: 'Synthetic Ledger Banner' }],
                [{ value: 'tx_date' }, { value: 'phone' }, { value: 'amount' }],
                [
                  { value: 45750, isDate: true },
                  { value: '08012345678' },
                  { value: '1500.50', formula: '1000+500.5' },
                ],
                [{ value: 45751, isDate: true }, { value: '08099998888' }, { value: 250 }],
              ],
            },
          ],
        }),
      };

    case '20-xlsx-1904-hidden-sheet':
      return {
        spec,
        bytes: buildSyntheticXlsx({
          date1904: true,
          sheets: [
            {
              name: 'Summary',
              rows: [
                [{ value: 'dept' }, { value: 'tx_date' }],
                [{ value: 'Treasury' }, { value: 44288, isDate: true }], // 2025-04-03 UTC in 1904 epoch
              ],
            },
            {
              name: 'AuditRaw',
              hidden: true,
              rows: [
                [{ value: 'audit_id' }, { value: 'tx_date' }],
                [{ value: 'AUD-1' }, { value: 44288, isDate: true }],
              ],
            },
          ],
        }),
      };
  }
  throw new RangeError(`Unhandled fixture id: ${id}`);
}

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
