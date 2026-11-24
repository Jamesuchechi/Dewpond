import { describe, expect, it } from 'vitest';
import {
  evaluateDetectorMetrics,
  formatRedactionReportMarkdown,
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

  it('meets precision/recall >= 0.95 across synthetic PII fixtures and renders raw-value-free MD report', () => {
    const luhnCases = [
      { value: '4111111111111111', expected: true },
      { value: '5500000000000004', expected: true },
      { value: '378282246310005', expected: true },
      { value: '4111111111111112', expected: false },
      { value: '123456789012', expected: false },
      { value: 'ORD-2026-0001', expected: false },
    ];
    const luhnMetrics = evaluateDetectorMetrics(luhnCases, isValidLuhn);
    expect(luhnMetrics.precision).toBe(1);
    expect(luhnMetrics.recall).toBe(1);

    const ngPhoneCases = [
      { value: '08031234567', expected: true },
      { value: '+2348091234567', expected: true },
      { value: '09123456789', expected: true },
      { value: '06012345678', expected: false },
      { value: '12345', expected: false },
    ];
    const phoneMetrics = evaluateDetectorMetrics(ngPhoneCases, isNigerianPhone);
    expect(phoneMetrics.precision).toBe(1);
    expect(phoneMetrics.recall).toBe(1);

    const md = formatRedactionReportMarkdown({
      generatedAt: '2026-11-24T10:00:00.000Z',
      tableAlias: 'payroll@s1',
      rowCount: 1200,
      containsRawCellValues: false,
      detectors: [
        {
          columnName: 'email',
          detector: 'email',
          matchCount: 1200,
          nonNullCount: 1200,
          matchRate: 1,
          confidence: 'high',
        },
      ],
      appliedActions: [{ columnName: 'email', mode: 'hash_sha256' }],
      kAnonymityThreshold: 5,
      quasiIdentifiers: ['department'],
      smallCohortsDetected: 0,
    });
    expect(md).toContain('# Dewpond Local Redaction & Privacy Audit Report');
    expect(md).toContain('`false`');
    expect(md).toContain('`hash_sha256`');
  });
});
