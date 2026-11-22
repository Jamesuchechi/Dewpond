import { describe, expect, it } from 'vitest';
import { scoreColumnSample } from './index';

describe('@dewpond/ingest scoreColumnSample', () => {
  it('never infers BIGINT when any value has decimals like 1500.50 (rounding guard)', () => {
    const res = scoreColumnSample('amount', ['100', '250', '1500.50', '400']);
    expect(res.type).toBe('DOUBLE');
    expect(res.type).not.toBe('BIGINT');
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

  it('flags ambiguous slash dates while resolving unambiguous slash and ISO dates', () => {
    const ambiguous = scoreColumnSample('tx_date', ['03/04/2025', '05/06/2025']);
    expect(ambiguous.type).toBe('VARCHAR');
    expect(ambiguous.dateAmbiguity).toBe(true);
    expect(ambiguous.vetoReasons).toContain('ambiguous_slash_date');

    const dmy = scoreColumnSample('tx_date', ['03/04/2025', '25/04/2025']);
    expect(dmy.type).toBe('DATE');
    expect(dmy.dateAmbiguity).toBe(false);
    expect(dmy.detectedDateOrder).toBe('DMY');

    const iso = scoreColumnSample('created_at', ['2025-04-03', '2025-04-25', null]);
    expect(iso.type).toBe('DATE');
    expect(iso.nonNullCount).toBe(2);
  });

  it('infers BIGINT, BOOLEAN, and VARCHAR cleanly', () => {
    expect(scoreColumnSample('qty', ['1', '0', '-42', null]).type).toBe('BIGINT');
    expect(scoreColumnSample('is_active', ['true', 'FALSE', '']).type).toBe('BOOLEAN');
    expect(scoreColumnSample('notes', ['hello', 'world']).type).toBe('VARCHAR');
  });
});
