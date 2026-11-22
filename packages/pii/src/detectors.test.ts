import { describe, expect, it } from 'vitest';
import {
  isE164Phone,
  isElevenDigitId,
  isEmail,
  isNigerianPhone,
  isValidLuhn,
  scanColumnSample,
} from './index';

describe('@dewpond/pii', () => {
  it('validates Luhn card numbers and rejects bad checksums', () => {
    expect(isValidLuhn('4111 1111 1111 1111')).toBe(true);
    expect(isValidLuhn('4111-1111-1111-1112')).toBe(false);
    expect(isValidLuhn('12345')).toBe(false);
  });

  it('validates Nigerian phones, E.164 phones, 11-digit IDs, and emails', () => {
    expect(isNigerianPhone('0801 234 5678')).toBe(true);
    expect(isNigerianPhone('+234 809 876 5432')).toBe(true);
    expect(isNigerianPhone('06012345678')).toBe(false);

    expect(isE164Phone('+44 20 7946 0958')).toBe(true);
    expect(isElevenDigitId('22123456789')).toBe(true);
    expect(isEmail('ada.lovelace@example.org')).toBe(true);
  });

  it('produces confidence ratings and never leaks raw values in findings', () => {
    const syntheticEmails = ['secret.one@example.org', 'secret.two@example.org'];
    const emailFindings = scanColumnSample('contact_email', syntheticEmails);
    expect(emailFindings).toHaveLength(1);
    expect(emailFindings[0]?.detector).toBe('email');
    expect(emailFindings[0]?.confidence).toBe('high');
    expect(JSON.stringify(emailFindings)).not.toContain('secret.one@example.org');

    const bvnFindings = scanColumnSample('customer_bvn', ['22123456789', '22987654321']);
    expect(bvnFindings.find((f) => f.detector === 'eleven_digit_id')?.confidence).toBe('high');
    expect(JSON.stringify(bvnFindings)).not.toContain('22123456789');

    const unhinted = scanColumnSample('code', ['22123456789', '22987654321']);
    expect(unhinted.find((f) => f.detector === 'eleven_digit_id')?.confidence).toBe('medium');
  });
});
