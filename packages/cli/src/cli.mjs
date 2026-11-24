#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { validateRecipeJson } from '@dewpond/recipe';

export function renderCliPipeline(recipe, format) {
  if (format === 'pandas') {
    const lines = [
      `# Dewpond pandas pipeline: ${recipe.name}`,
      'import duckdb',
      'import pandas as pd',
      '',
      'con = duckdb.connect(":memory:")',
      ...recipe.steps.map(
        (s, i) =>
          `# Step ${i + 1} (${s.id}): ${s.op}\n# Execute compiled step SQL via con.execute(...)`,
      ),
      'df: pd.DataFrame = con.sql("SELECT 1 AS ready").df()',
    ];
    return `${lines.join('\n')}\n`;
  }
  if (format === 'polars') {
    const lines = [
      `# Dewpond Polars pipeline: ${recipe.name}`,
      'import duckdb',
      'import polars as pl',
      '',
      'con = duckdb.connect(":memory:")',
      ...recipe.steps.map(
        (s, i) =>
          `# Step ${i + 1} (${s.id}): ${s.op}\n# Execute compiled step SQL via con.execute(...)`,
      ),
      'df: pl.DataFrame = con.sql("SELECT 1 AS ready").pl()',
    ];
    return `${lines.join('\n')}\n`;
  }
  const sqlLines = [
    `-- Dewpond Recipe: ${recipe.name}`,
    ...recipe.steps.map((s, i) => `-- Step ${i + 1} (${s.id}): ${s.op}`),
    'SELECT 1 AS ready;',
  ];
  return `${sqlLines.join('\n')}\n`;
}

export function runCli(argv) {
  const [cmd, fileArg, ...rest] = argv;
  if (cmd !== 'run' || !fileArg) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Usage: dewpond run <recipe.dew.json> [--format sql|pandas|polars] [--out <path>]\n',
    };
  }

  let format = 'sql';
  let outPath = null;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--format' && rest[i + 1]) {
      const val = rest[++i];
      if (val !== 'sql' && val !== 'pandas' && val !== 'polars') {
        return { exitCode: 1, stdout: '', stderr: `Unsupported format: ${val}\n` };
      }
      format = val;
    } else if (flag === '--out' && rest[i + 1]) {
      outPath = rest[++i] ?? null;
    }
  }

  let rawJson;
  try {
    rawJson = JSON.parse(readFileSync(resolve(fileArg), 'utf8'));
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Failed to read recipe JSON: ${err instanceof Error ? err.message : String(err)}\n`,
    };
  }

  const validation = validateRecipeJson(rawJson);
  if (!validation.ok || !validation.recipe) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Invalid recipe: ${validation.errors.join('; ')}\n`,
    };
  }

  const rendered = renderCliPipeline(validation.recipe, format);
  if (outPath) {
    writeFileSync(resolve(outPath), rendered, 'utf8');
    return {
      exitCode: 0,
      stdout: `Wrote ${format} pipeline for "${validation.recipe.name}" to ${outPath}\n`,
      stderr: '',
    };
  }
  return { exitCode: 0, stdout: rendered, stderr: '' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runCli(process.argv.slice(2));
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  process.exit(res.exitCode);
}
