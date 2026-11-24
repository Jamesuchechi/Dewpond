import { describe, expect, it } from 'vitest';
import {
  buildArrowTableTypedCastSql,
  buildCompareDiffSql,
  buildCompareSummarySql,
  buildCsvTypedIngestSql,
  buildKAnonymityQuery,
  buildKeyUniquenessCheckSql,
  buildLazyFileIngestSql,
  buildPopulateRejectsSql,
  compileCleanStepSql,
  compileRedactViewSql,
  computeSchemaDiff,
  sanitizeTableName,
} from './sqlCompiler';

describe('workbench sqlCompiler', () => {
  it('sanitizes table names cleanly across messy filenames', () => {
    expect(sanitizeTableName('2026-Q4 Payroll (Final).csv')).toBe('t_2026_q4_payroll_final');
    expect(sanitizeTableName('___')).toBe('dataset');
  });

  it('builds strict sample-guarded CSV ingest SQL with __rid, DMY date casts, and locale numbers', () => {
    const sql = buildCsvTypedIngestSql({
      virtualFileName: 'payroll.csv',
      targetTableName: 'payroll',
      dateOrder: 'DMY',
      columns: [
        { name: 'phone', targetType: 'VARCHAR' },
        { name: 'amount', targetType: 'DOUBLE', localeNumberFormat: 'us_currency' },
        { name: 'eu_amt', targetType: 'DOUBLE', localeNumberFormat: 'eu_decimal' },
        { name: 'tx_date', targetType: 'DATE' },
      ],
    });
    expect(sql).toContain('row_number() OVER () AS "__rid"');
    expect(sql).toContain('all_varchar=true');
    expect(sql).toContain('%d/%m/%Y');
    expect(sql).toContain('regexp_replace(');

    const arrowCastSql = buildArrowTableTypedCastSql(
      '__xlsx_stage',
      'ledger',
      [{ name: 'amount', targetType: 'DOUBLE' }],
      'ISO',
    );
    expect(arrowCastSql).toContain('FROM "__xlsx_stage"');
  });

  it('keeps Parquet ingestion lazy as a VIEW and generates _rejects quarantine SQL', () => {
    const pqSql = buildLazyFileIngestSql('parquet', 'huge.parquet', 'huge');
    expect(pqSql).toContain('CREATE OR REPLACE VIEW "huge"');
    expect(pqSql).toContain("read_parquet('huge.parquet')");

    const rejSql = buildPopulateRejectsSql(
      'payroll',
      "read_csv('payroll.csv', all_varchar=true, header=true)",
      [{ name: 'amount', targetType: 'DOUBLE' }],
      'ISO',
    );
    expect(rejSql).toContain('CREATE TABLE IF NOT EXISTS "_rejects"');
    expect(rejSql).toContain("'Failed cast to DOUBLE'");
  });

  it('compiles dedupe with mandatory "__rid" ASC tiebreaker and safe hostile identifiers', () => {
    const res = compileCleanStepSql('raw_tbl', 'raw_tbl@s1', {
      id: 's1',
      op: 'dedupe',
      table: 'raw_tbl',
      keys: ['emp "email"'],
      keep: 'last',
      orderBy: 'tx_date',
    });
    expect(res.sql).toContain('"emp ""email"""');
    expect(res.sql).toContain('ORDER BY "tx_date" DESC NULLS LAST, "__rid" ASC');
  });

  it('compiles deterministic salted sha256 redactions and hash-seeded shuffles', () => {
    const sql = compileRedactViewSql(
      'payroll',
      'payroll@s2',
      [
        { columnName: 'bvn', mode: 'hash_sha256' },
        { columnName: 'department', mode: 'shuffle' },
        { columnName: 'secret_note', mode: 'drop' },
      ],
      'salt-2026',
      'seed-42',
    );
    expect(sql).toContain("sha256('salt-2026|' ||");
    expect(sql).toContain('sha256(\'seed-42:department:\' || "__rid"::VARCHAR)');
    expect(sql).not.toContain('secret_note');

    const riskSql = buildKAnonymityQuery('payroll@s2', ['department', 'tx_month'], 5);
    expect(riskSql).toContain('HAVING count(*) < 5');
  });

  it('compiles all core M2 clean ops with checkpoint support and __rid ordering', () => {
    const ffill = compileCleanStepSql('t', 't@s1', {
      id: 's1',
      op: 'fillNulls',
      table: 't',
      column: 'amount',
      strategy: 'ffill',
    });
    expect(ffill.sql).toContain('CREATE OR REPLACE TABLE "t@s1"');
    expect(ffill.sql).toContain('ORDER BY "__rid" ASC');

    const split = compileCleanStepSql('t', 't@s2', {
      id: 's2',
      op: 'split',
      table: 't',
      column: 'full_name',
      delimiter: ' ',
      into: ['first_name', 'last_name'],
    });
    expect(split.sql).toContain('CREATE OR REPLACE VIEW "t@s2"');
    expect(split.sql).toContain('AS "first_name"');

    const ckpt = compileCleanStepSql(
      't',
      't@s5',
      { id: 's5', op: 'case', table: 't', columns: ['city'], mode: 'title' },
      { checkpoint: true },
    );
    expect(ckpt.sql).toContain('CREATE OR REPLACE TABLE "t@s5"');
  });

  it('compiles v1.1 Compare schema diff, uniqueness check, and FULL OUTER JOIN + IS DISTINCT FROM', () => {
    const schema = computeSchemaDiff(
      [
        { name: '__rid', type: 'Int64' },
        { name: 'id', type: 'Utf8' },
        { name: 'amount', type: 'Int64' },
        { name: 'old_col', type: 'Utf8' },
      ],
      [
        { name: '__rid', type: 'Int64' },
        { name: 'id', type: 'Utf8' },
        { name: 'amount', type: 'Float64' },
        { name: 'new_col', type: 'Utf8' },
      ],
    );
    expect(schema.shared).toEqual(['id', 'amount']);
    expect(schema.removedFromLeft).toEqual(['old_col']);
    expect(schema.addedInRight).toEqual(['new_col']);
    expect(schema.typeChanges).toEqual([
      { column: 'amount', leftType: 'Int64', rightType: 'Float64' },
    ]);

    const uniq = buildKeyUniquenessCheckSql('left_tbl', ['id']);
    expect(uniq).toContain('GROUP BY "id"');

    const diffSql = buildCompareDiffSql({
      leftAlias: 'left_tbl',
      rightAlias: 'right_tbl',
      keyColumns: ['id'],
      compareColumns: ['amount'],
      statusFilter: 'changed',
    });
    expect(diffSql).toContain('FULL OUTER JOIN "right_tbl" R');
    expect(diffSql).toContain('IS DISTINCT FROM');
    expect(diffSql).toContain(`WHERE "__diff_status" = 'changed'`);

    const sumSql = buildCompareSummarySql({
      leftAlias: 'left_tbl',
      rightAlias: 'right_tbl',
      keyColumns: ['id'],
      compareColumns: ['amount'],
    });
    expect(sumSql).toContain('added_count');
    expect(sumSql).toContain('changed_count');
  });
});
