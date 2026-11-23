import { describe, expect, it } from 'vitest';
import {
  buildProfileIssueProbesSql,
  detectProfileIssues,
  parseEuDecimalNumber,
  parseUsCurrencyNumber,
  scoreColumnSample,
} from './index';

describe('@dewpond/ingest scoreColumnSample', () => {
  it('never infers BIGINT when any value has decimals like 1500.50 (rounding guard)', () => {
    const res = scoreColumnSample('amount', ['100', '250', '1500.50', '400']);
    expect(res.type).toBe('DOUBLE');
    expect(res.type).not.toBe('BIGINT');
    expect(res.sampleValues).toEqual(['100', '250', '1500.50', '400']);
  });

  it('vetoes numeric inference on leading zeros, 11-digit uniform IDs, ID names, and scientific corruption', () => {
    const phone = scoreColumnSample('contact', ['08012345678', '08098765432']);
    expect(phone.type).toBe('VARCHAR');
    expect(phone.vetoReasons).toContain('leading_zero');

    const bvn = scoreColumnSample('verification', ['22123456789', '22987654321']);
    expect(bvn.type).toBe('VARCHAR');
    expect(bvn.vetoReasons).toContain('long_uniform_digits');

    const acct = scoreColumnSample('account_id', ['1001', '1002']);
    expect(acct.type).toBe('VARCHAR');
    expect(acct.vetoReasons).toContain('id_column_name');

    const mangled = scoreColumnSample('tax_ref', ['1.23E+10', '4.56E+10']);
    expect(mangled.type).toBe('VARCHAR');
    expect(mangled.vetoReasons).toContain('scientific_notation_corruption');
  });

  it('flags ambiguous slash dates with dual UTC previews and resolves unambiguous slash/ISO dates', () => {
    const ambiguous = scoreColumnSample('tx_date', ['03/04/2025', '05/06/2025']);
    expect(ambiguous.type).toBe('VARCHAR');
    expect(ambiguous.dateAmbiguity).toBe(true);
    expect(ambiguous.vetoReasons).toContain('ambiguous_slash_date');
    expect(ambiguous.ambiguousDatePreviews?.[0]).toEqual({
      raw: '03/04/2025',
      asDmy: '03 Apr 2025',
      asMdy: '04 Mar 2025',
    });

    const dmy = scoreColumnSample('tx_date', ['03/04/2025', '25/04/2025']);
    expect(dmy.type).toBe('DATE');
    expect(dmy.dateAmbiguity).toBe(false);
    expect(dmy.detectedDateOrder).toBe('DMY');

    const iso = scoreColumnSample('created_at', ['2025-04-03', '2025-04-25', null]);
    expect(iso.type).toBe('DATE');
    expect(iso.nonNullCount).toBe(2);
  });

  it('parses locale currencies, accounting parens, and European decimals accurately', () => {
    expect(parseUsCurrencyNumber('₦1,250,000.50')).toBe(1250000.5);
    expect(parseUsCurrencyNumber('(500.25)')).toBe(-500.25);
    expect(parseEuDecimalNumber('1.250.000,50')).toBe(1250000.5);
    expect(parseEuDecimalNumber('-45,50')).toBe(-45.5);

    const ngnCol = scoreColumnSample('gross_pay', ['₦1,250,000.50', '(500.25)', '$45.00']);
    expect(ngnCol.type).toBe('DOUBLE');
    expect(ngnCol.localeNumberFormat).toBe('us_currency');

    const euCol = scoreColumnSample('euro_amt', ['1.250.000,50', '€45,25']);
    expect(euCol.type).toBe('DOUBLE');
    expect(euCol.localeNumberFormat).toBe('eu_decimal');
  });

  it('infers BIGINT, BOOLEAN, VARCHAR, and detects profile issues with one-click fixes', () => {
    expect(scoreColumnSample('qty', ['1', '0', '-42', null]).type).toBe('BIGINT');
    expect(scoreColumnSample('is_active', ['true', 'FALSE', '']).type).toBe('BOOLEAN');
    expect(scoreColumnSample('notes', ['hello', 'world']).type).toBe('VARCHAR');

    const sql = buildProfileIssueProbesSql('payroll', ['__rid', 'city', 'currency', 'tx_id']);
    expect(sql).not.toContain('AS "__rid"');
    expect(sql).toContain('UNION ALL');

    const issues = detectProfileIssues([
      {
        columnName: 'city',
        totalRows: 10,
        nonNullCount: 10,
        distinctCount: 4,
        whitespaceCount: 2,
        caseNormalizedDistinctCount: 2,
      },
      {
        columnName: 'currency',
        totalRows: 10,
        nonNullCount: 10,
        distinctCount: 1,
        whitespaceCount: 0,
        caseNormalizedDistinctCount: 1,
      },
      {
        columnName: 'tx_id',
        totalRows: 10,
        nonNullCount: 10,
        distinctCount: 10,
        whitespaceCount: 0,
        caseNormalizedDistinctCount: 10,
      },
    ]);
    expect(issues.map((i) => i.kind)).toEqual([
      'whitespace',
      'casing_variants',
      'constant_column',
      'key_candidate',
    ]);
  });
});
