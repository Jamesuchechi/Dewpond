import { describe, expect, it } from 'vitest';
import {
  decodeShareRecipe,
  detectSchemaDrift,
  encodeShareRecipe,
  findShareUnsafeLiterals,
  remapRecipeColumns,
  validateRecipeJson,
  type Recipe,
} from './index';

function baseRecipe(steps: Recipe['steps']): Recipe {
  return {
    version: 1,
    id: 'r1',
    name: 'Test Recipe',
    sources: [],
    steps,
    head: steps.length,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe('@dewpond/recipe', () => {
  it('produces zero share warnings for structural-only steps', () => {
    const recipe = baseRecipe([
      { id: 's1', op: 'trim', table: 'customers', columns: ['email'] },
      { id: 's2', op: 'rename', table: 'customers', from: 'email', to: 'email_addr' },
      {
        id: 's3',
        op: 'dedupe',
        table: 'customers',
        keys: ['email_addr'],
        keep: 'first',
      },
      {
        id: 's4',
        op: 'cast',
        table: 'customers',
        column: 'amount',
        to: 'DOUBLE',
        onFail: 'reject',
      },
      {
        id: 's5',
        op: 'filter',
        table: 'customers',
        predicate: { column: 'email_addr', op: 'not_null' },
      },
    ]);

    expect(findShareUnsafeLiterals(recipe)).toEqual([]);
  });

  it('flags filter literals, replace strings, and rawSql steps for share review', () => {
    const recipe = baseRecipe([
      {
        id: 's1',
        op: 'filter',
        table: 'customers',
        predicate: { column: 'email', op: 'eq', value: 'ada@example.org' },
      },
      {
        id: 's2',
        op: 'replace',
        table: 'customers',
        column: 'notes',
        search: 'secret-token',
        replacement: '[REDACTED]',
      },
      {
        id: 's3',
        op: 'rawSql',
        sql: 'SELECT * FROM "customers"',
        as: 'customers_copy',
        trusted: true,
      },
    ]);

    const findings = findShareUnsafeLiterals(recipe);
    expect(findings.map((f) => f.stepId)).toEqual(['s1', 's2', 's3']);
    expect(findings.map((f) => f.op)).toEqual(['filter', 'replace', 'rawSql']);
  });

  it('validates v1 recipe schema and rejects malformed payloads', () => {
    const valid = baseRecipe([{ id: 's1', op: 'case', table: 't', columns: ['a'], mode: 'upper' }]);
    expect(validateRecipeJson(valid).ok).toBe(true);

    const badHead = { ...valid, head: 99 };
    expect(validateRecipeJson(badHead).ok).toBe(false);

    const badOp = { ...valid, steps: [{ id: 's1', op: 'exec_shell', table: 't' }] };
    expect(validateRecipeJson(badOp).ok).toBe(false);
  });

  it('round-trips #r= share recipes and enforces the 2 MB stream decompression cap', () => {
    const recipe = baseRecipe([
      { id: 's1', op: 'trim', table: 'sales', columns: ['email'] },
      { id: 's2', op: 'parseDate', table: 'sales', column: 'tx_date', format: 'DMY' },
    ]);
    const token = encodeShareRecipe(recipe);
    expect(token.startsWith('#r=')).toBe(true);

    const decoded = decodeShareRecipe(token);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.recipe.steps).toHaveLength(2);
      expect(decoded.recipe.steps[1]?.op).toBe('parseDate');
    }

    // 256 KB repetitive payload compressed to tiny #r= token, tested with 64 KB cap
    const bigRecipe = baseRecipe([
      {
        id: 's1',
        op: 'replace',
        table: 'sales',
        column: 'note',
        search: 'A'.repeat(150_000),
        replacement: 'B',
      },
    ]);
    const bigToken = encodeShareRecipe(bigRecipe);
    const capped = decodeShareRecipe(bigToken, 64 * 1024);
    expect(capped.ok).toBe(false);
    if (!capped.ok) {
      expect(capped.error).toContain('security cap');
    }
  });

  it('detects schema drift and remaps column names cleanly', () => {
    const recipe = baseRecipe([
      { id: 's1', op: 'trim', table: 'sales', columns: ['customer_email'] },
      {
        id: 's2',
        op: 'filter',
        table: 'sales',
        predicate: { column: 'gross_amt', op: 'gt', value: 100 },
      },
    ]);

    const missing = detectSchemaDrift(recipe, ['email_addr', 'gross_amt', 'status']);
    expect(missing).toEqual(['customer_email']);

    const remapped = remapRecipeColumns(recipe, { customer_email: 'email_addr' });
    expect(detectSchemaDrift(remapped, ['email_addr', 'gross_amt', 'status'])).toEqual([]);
  });
});
