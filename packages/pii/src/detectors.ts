export type PiiDetectorKind =
  'email' | 'nigerian_phone' | 'e164_phone' | 'luhn_card' | 'eleven_digit_id';

export type PiiConfidence = 'high' | 'medium' | 'low';

export interface PiiFinding {
  columnName: string;
  detector: PiiDetectorKind;
  matchCount: number;
  nonNullCount: number;
  matchRate: number;
  confidence: PiiConfidence;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NIGERIAN_PHONE_REGEX = /^(?:0[789][01]\d{8}|(?:\+?234)[789][01]\d{8})$/;
const E164_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;
const ELEVEN_DIGIT_ID_REGEX = /^\d{11}$/;
const ID_HEADER_HINT_REGEX = /(?:bvn|nin|tin|national|identity|tax_id|ssn)/i;

function stripPhoneSeparators(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, '');
}

/** Validate a payment card PAN using Luhn mod-10 checksum (13–19 digits). */
export function isValidLuhn(raw: string): boolean {
  const digits = raw.trim().replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/** Match Nigerian MSISDN formats (070/080/081/090/091 or +234 equivalents). */
export function isNigerianPhone(raw: string): boolean {
  return NIGERIAN_PHONE_REGEX.test(stripPhoneSeparators(raw));
}

/** Match international E.164 numbers (+countrycode + subscriber digits). */
export function isE164Phone(raw: string): boolean {
  return E164_PHONE_REGEX.test(stripPhoneSeparators(raw));
}

/** Match fixed 11-digit national/bank IDs (such as BVN/NIN). */
export function isElevenDigitId(raw: string): boolean {
  return ELEVEN_DIGIT_ID_REGEX.test(raw.trim());
}

/** Match standard email addresses. */
export function isEmail(raw: string): boolean {
  return EMAIL_REGEX.test(raw.trim());
}

/**
 * Scan column samples for common PII patterns.
 * Output metadata never includes raw sample cell values.
 */
export function scanColumnSample(
  columnName: string,
  values: readonly (string | null | undefined)[],
): PiiFinding[] {
  const nonEmpty: string[] = [];
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const trimmed = v.trim();
    if (trimmed.length > 0) nonEmpty.push(trimmed);
  }

  const nonNullCount = nonEmpty.length;
  if (nonNullCount === 0) return [];

  const detectors: Array<{
    kind: PiiDetectorKind;
    predicate: (value: string) => boolean;
  }> = [
    { kind: 'email', predicate: isEmail },
    { kind: 'nigerian_phone', predicate: isNigerianPhone },
    { kind: 'e164_phone', predicate: isE164Phone },
    { kind: 'luhn_card', predicate: isValidLuhn },
    { kind: 'eleven_digit_id', predicate: isElevenDigitId },
  ];

  const findings: PiiFinding[] = [];
  const hasIdHeaderHint = ID_HEADER_HINT_REGEX.test(columnName);

  for (const detector of detectors) {
    let matchCount = 0;
    for (const value of nonEmpty) {
      if (detector.predicate(value)) matchCount++;
    }
    if (matchCount === 0) continue;

    const matchRate = matchCount / nonNullCount;
    let confidence: PiiConfidence;
    if (detector.kind === 'eleven_digit_id') {
      confidence =
        hasIdHeaderHint && matchRate >= 0.5 ? 'high' : matchRate >= 0.8 ? 'medium' : 'low';
    } else if (matchRate >= 0.8) {
      confidence = 'high';
    } else if (matchRate >= 0.3) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    findings.push({
      columnName,
      detector: detector.kind,
      matchCount,
      nonNullCount,
      matchRate,
      confidence,
    });
  }

  return findings;
}
