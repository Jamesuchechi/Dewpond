import { describe, expect, it } from 'vitest';
import {
  applyPreviewRedaction,
  BENCHMARK_METRICS,
  CAPABILITY_PILLARS,
  COMPARISON_ROWS,
  RECIPE_PREVIEW_STEPS,
  SYNTHETIC_SAMPLE_ROWS,
} from './demoData';

describe('landing showcase synthetic demo data', () => {
  it('masks, hashes, and generalizes PII without leaking raw values', () => {
    const sample = SYNTHETIC_SAMPLE_ROWS[0]!;

    const masked = applyPreviewRedaction(sample, 'mask');
    expect(masked.phone).toBe('080****5678');
    expect(masked.bvn).toBe('22*******89');
    expect(JSON.stringify(masked)).not.toContain(sample.email);
    expect(JSON.stringify(masked)).not.toContain(sample.bvn);

    const hashed1 = applyPreviewRedaction(sample, 'hash');
    const hashed2 = applyPreviewRedaction(sample, 'hash');
    expect(hashed1).toEqual(hashed2);
    expect(hashed1.bvn.startsWith('sha256:')).toBe(true);
    expect(JSON.stringify(hashed1)).not.toContain(sample.email);
    expect(JSON.stringify(hashed1)).not.toContain(sample.phone);
    expect(JSON.stringify(hashed1)).not.toContain(sample.bvn);

    const generalized = applyPreviewRedaction(sample, 'generalize');
    expect(generalized.amount).toBe('1,000-1,999');
    expect(generalized.tx_date).toBe('2025-04');
    expect(generalized.bvn).toBe('[DROPPED]');
  });

  it('contains aligned showcase steps, pillars, benchmarks, and comparison rows', () => {
    expect(SYNTHETIC_SAMPLE_ROWS).toHaveLength(5);
    expect(RECIPE_PREVIEW_STEPS).toHaveLength(3);
    expect(CAPABILITY_PILLARS).toHaveLength(4);
    expect(BENCHMARK_METRICS).toHaveLength(4);
    expect(COMPARISON_ROWS).toHaveLength(6);
  });
});
