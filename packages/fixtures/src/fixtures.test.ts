import { describe, expect, it } from 'vitest';
import { buildDecimalRoundingFixtureCsv, MESSY_CORPUS_SPEC } from './index';

describe('@dewpond/fixtures', () => {
  it('defines core messy-corpus hazards and deterministic CSV builder', () => {
    expect(MESSY_CORPUS_SPEC.length).toBeGreaterThanOrEqual(7);
    const csv = buildDecimalRoundingFixtureCsv();
    expect(csv.split('\n')).toHaveLength(5);
    expect(csv).toContain('1500.50');
    expect(csv).toContain('08012345678');
  });
});
