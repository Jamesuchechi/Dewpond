const DEPARTMENTS = [
  'Treasury',
  'Operations',
  'Risk & Audit',
  'Merchant Ops',
  'Settlement',
] as const;
const FIRST_NAMES = [
  'Amaka',
  'Tunde',
  'Chidi',
  'Zainab',
  'Kemi',
  'Ibrahim',
  'Ngozi',
  'Seyi',
  'Damilola',
  'Chinedu',
] as const;
const LAST_NAMES = [
  'Okafor',
  'Adeyemi',
  'Nwosu',
  'Bello',
  'Balogun',
  'Musa',
  'Eze',
  'Akinola',
  'Ogunleye',
  'Okonkwo',
] as const;

/**
 * Deterministic synthetic messy CSV exercising Dewpond's ingest & redaction guards:
 * - leading-zero phone numbers ('0801...')
 * - uniform 11-digit BVNs ('22...')
 * - early integers followed by decimals ('1500.50') so BIGINT rounding never triggers
 * - ambiguous slash dates ('03/04/2025' .. '12/06/2025') requiring user DMY/MDY choice
 * - intentional duplicate records + 4 malformed 'N/A' amounts for _rejects quarantine
 */
export function buildSyntheticMessyPayrollCsv(rowCount = 1200): string {
  const lines = ['tx_id,full_name,email,phone,bvn,department,amount,tx_date'];

  for (let i = 0; i < rowCount; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last = LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]!;
    const dept = DEPARTMENTS[i % DEPARTMENTS.length]!;

    // Intentional duplicate contacts every 37th row so Exact Dedupe shrinks the table visibly
    const personIdx = i % 37 === 0 && i > 0 ? i - 1 : i;
    const pFirst = FIRST_NAMES[personIdx % FIRST_NAMES.length]!;
    const pLast = LAST_NAMES[Math.floor(personIdx / FIRST_NAMES.length) % LAST_NAMES.length]!;

    const txId = `TX-${String(10001 + i)}`;
    const fullName = i % 11 === 0 ? `  ${first} ${last}  ` : `${first} ${last}`;
    const email = `${pFirst.toLowerCase()}.${pLast.toLowerCase()}.${(personIdx % 120) + 1}@example.org`;
    const prefix = i % 3 === 0 ? '080' : i % 3 === 1 ? '070' : '090';
    const phone = `${prefix}${String(10000000 + ((i * 7919) % 89999999)).slice(0, 8)}`;
    const bvn = `22${String(100000000 + ((i * 104729) % 899999999)).slice(0, 9)}`;

    // Keep first 25 rows whole integers to prove scanner scans past row 1 and catches '.50'
    let amount: string;
    if (i === 180 || i === 420 || i === 760 || i === 1040) {
      amount = 'N/A';
    } else if (i < 25) {
      amount = String(1000 + i * 250);
    } else {
      const whole = 450 + ((i * 313) % 18000);
      const cents = i % 4 === 0 ? '.50' : i % 4 === 2 ? '.75' : '.00';
      amount = `${whole}${cents}`;
    }

    // All day <= 12 & month <= 12 so the ambiguous-slash-date detector fires accurately
    const day = String((i % 12) + 1).padStart(2, '0');
    const month = String(((i + 3) % 12) + 1).padStart(2, '0');
    const txDate = `${day}/${month}/2025`;

    lines.push(`${txId},${fullName},${email},${phone},${bvn},${dept},${amount},${txDate}`);
  }

  return lines.join('\n');
}
