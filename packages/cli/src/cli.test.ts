import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.mjs';

describe('@dewpond/cli', () => {
  it('validates a .dew.json recipe and emits sql, pandas, and polars pipelines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dewpond-cli-'));
    try {
      const recipePath = join(dir, 'sample.dew.json');
      writeFileSync(
        recipePath,
        JSON.stringify({
          version: 1,
          id: 'cli-test-1',
          name: 'CLI Test Pipeline',
          createdAt: 1000,
          updatedAt: 1000,
          sources: [],
          steps: [{ id: 's1', op: 'trim', table: 'sales', columns: ['name'] }],
          head: 1,
        }),
      );

      const sqlRes = runCli(['run', recipePath]);
      expect(sqlRes.exitCode).toBe(0);
      expect(sqlRes.stdout).toContain('-- Dewpond Recipe: CLI Test Pipeline');

      const pdRes = runCli(['run', recipePath, '--format', 'pandas']);
      expect(pdRes.exitCode).toBe(0);
      expect(pdRes.stdout).toContain('import pandas as pd');

      const plRes = runCli(['run', recipePath, '--format', 'polars']);
      expect(plRes.exitCode).toBe(0);
      expect(plRes.stdout).toContain('import polars as pl');

      const badRes = runCli(['run']);
      expect(badRes.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
