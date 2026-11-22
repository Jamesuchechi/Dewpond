import { describe, expect, it } from 'vitest';
import { findShareUnsafeLiterals, type Recipe } from './index';

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
});
