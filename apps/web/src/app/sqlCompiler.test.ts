import { describe, expect, it } from 'vitest';
import {
  buildArrowTableTypedCastSql,
  buildAttachSql,
  buildBarChartSql,
  buildBoxPlotChartSql,
  buildCompareDiffSql,
  buildCompareSummarySql,
  buildCsvTypedIngestSql,
  buildDetachSql,
  buildExportAttachedTableSql,
  buildFuzzyDedupeCandidatesSql,
  buildFuzzyDedupeCommitSql,
  buildFuzzyReconcileSql,
  buildHistogramChartSql,
  buildImportAttachedTableSql,
  buildKAnonymityQuery,
  buildKeysetPageSql,
  buildKeyUniquenessCheckSql,
  buildLazyFileIngestSql,
  buildLineChartSql,
  buildListAttachedTablesSql,
  buildPivotCardinalitySql,
  buildPivotSql,
  buildPopulateRejectsSql,
  buildScatterChartSql,
  buildTokenizationKeyMapSql,
  buildUnpivotSql,
  compileCellRowOverlaySql,
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

  it('compiles __rid + fractional ord DOUBLE overlay and keyset paging SQL', () => {
    const overlaySql = compileCellRowOverlaySql(
      'payroll',
      'payroll@edits',
      [
        { name: '__rid', type: 'Int64' },
        { name: 'email', type: 'Utf8' },
        { name: 'amount', type: 'Float64' },
      ],
      {
        tableId: 'payroll',
        cellEdits: [{ rid: '2', column: 'email', value: 'updated@example.org' }],
        deletedRids: ['5'],
        insertedRows: [
          { rid: '9001', ord: 2.5, values: { email: 'new@example.org', amount: '125.5' } },
        ],
      },
    );
    expect(overlaySql).toContain(`WHEN "__rid"::VARCHAR = '2' THEN 'updated@example.org'`);
    expect(overlaySql).toContain(`WHERE "__rid"::VARCHAR NOT IN ('5')`);
    expect(overlaySql).toContain('2.5::DOUBLE AS "__ord"');
    expect(overlaySql).toContain('ORDER BY "__ord" ASC, "__rid" ASC');

    const keysetNext = buildKeysetPageSql({
      alias: 'payroll@edits',
      pageSize: 500,
      hasRid: true,
      hasOrd: true,
      direction: 'next',
      cursorOrd: 500,
      cursorRid: '500',
    });
    expect(keysetNext).toContain('("__ord" > 500 OR ("__ord" = 500 AND "__rid" > 500))');
    expect(keysetNext).not.toContain('OFFSET');
  });

  it('compiles Fuzzy Dedupe & Fuzzy Reconcile SQL with blocking and numeric tolerance', () => {
    const candSql = buildFuzzyDedupeCandidatesSql({
      tableAlias: 'vendors',
      matchColumn: 'vendor_name',
      blockingMode: 'prefix_3',
      minSimilarity: 0.85,
      numericColumn: 'amount',
      numericTolerance: 5.0,
    });
    expect(candSql).toContain('jaro_winkler_similarity');
    expect(candSql).toContain('left(lower(trim(coalesce(A."vendor_name"::VARCHAR, \'\'))), 3)');
    expect(candSql).toContain('<= 5');

    const commitSql = buildFuzzyDedupeCommitSql('vendors', 'vendors@s1', ['12', '19']);
    expect(commitSql).toContain(`WHERE "__rid"::VARCHAR NOT IN ('12', '19')`);

    const recSql = buildFuzzyReconcileSql({
      leftAlias: 'bank_tx',
      rightAlias: 'ledger_tx',
      keyColumn: 'merchant',
      blockingMode: 'first_token',
      minSimilarity: 0.8,
    });
    expect(recSql).toContain('split_part(');
    expect(recSql).toContain('__reconcile_status');
  });

  it('compiles Pivot cardinality check, Pivot, and Unpivot SQL cleanly', () => {
    const cardSql = buildPivotCardinalitySql('sales', 'region');
    expect(cardSql).toContain('count(DISTINCT "region")::INTEGER AS "distinct_count"');

    const pivotSql = buildPivotSql({
      sourceAlias: 'sales',
      targetAlias: 'sales@s1',
      indexColumns: ['year', 'category'],
      pivotColumn: 'region',
      valueColumn: 'revenue',
      aggFn: 'SUM',
    });
    expect(pivotSql).toContain('PIVOT (SELECT * EXCLUDE ("__rid") FROM "sales")');
    expect(pivotSql).toContain('ON "region"');
    expect(pivotSql).toContain('USING sum("revenue")');
    expect(pivotSql).toContain('GROUP BY "year", "category"');

    const unpivotSql = buildUnpivotSql({
      sourceAlias: 'sales@s1',
      targetAlias: 'sales@s2',
      unpivotColumns: ['q1', 'q2'],
      nameColumn: 'quarter',
      valueColumn: 'amount',
    });
    expect(unpivotSql).toContain('UNPIVOT (SELECT * EXCLUDE ("__rid") FROM "sales@s1")');
    expect(unpivotSql).toContain('ON "q1", "q2"');
    expect(unpivotSql).toContain('NAME "quarter"');
    expect(unpivotSql).toContain('VALUE "amount"');
  });

  it('compiles .duckdb ATTACH, SQLite ATTACH, import, export, and DETACH SQL', () => {
    expect(buildAttachSql('__upload.duckdb', '__ext', 'duckdb')).toBe(
      `ATTACH '__upload.duckdb' AS "__ext" (READ_ONLY);`,
    );
    expect(buildAttachSql('__upload.sqlite', '__ext', 'sqlite')).toBe(
      `ATTACH '__upload.sqlite' AS "__ext" (TYPE SQLITE, READ_ONLY);`,
    );
    expect(buildListAttachedTablesSql('__ext')).toContain(`WHERE table_catalog = '__ext'`);
    expect(buildImportAttachedTableSql('__ext', 'orders', 'orders', true)).toContain(
      'EXCLUDE ("__rid")',
    );
    expect(buildExportAttachedTableSql('__out', 'orders@s1', 'orders')).toContain(
      'CREATE OR REPLACE TABLE "__out"."orders" AS',
    );
    expect(buildDetachSql('__ext')).toBe('DETACH "__ext";');

    const keyMapSql = buildTokenizationKeyMapSql('customers', ['email', 'ssn'], 'salt_v1');
    expect(keyMapSql).toContain(`'email' AS "column_name"`);
    expect(keyMapSql).toContain(`sha256('salt_v1|' || "ssn"::VARCHAR) AS "token"`);
    expect(keyMapSql).toContain('UNION ALL');
  });

  it('compiles Bar, Histogram, Line, and Scatter chart aggregation SQL', () => {
    const barSql = buildBarChartSql({
      tableAlias: 'sales',
      xColumn: 'region',
      yColumn: 'revenue',
      aggFn: 'SUM',
      topN: 15,
    });
    expect(barSql).toContain('GROUP BY 1');
    expect(barSql).toContain('LIMIT 15;');

    const histSql = buildHistogramChartSql({ tableAlias: 'sales', column: 'revenue', bins: 10 });
    expect(histSql).toContain('width_bucket');
    expect(histSql).toContain('bin_min');

    const lineSql = buildLineChartSql({
      tableAlias: 'sales',
      xColumn: 'sale_date',
      yColumn: 'revenue',
      aggFn: 'AVG',
      timeGrain: 'month',
    });
    expect(lineSql).toContain(`date_trunc('month'`);

    const scatterSql = buildScatterChartSql({
      tableAlias: 'sales',
      xColumn: 'price',
      yColumn: 'units',
    });
    expect(scatterSql).toContain('isfinite');

    const groupedBarSql = buildBarChartSql({
      tableAlias: 'sales',
      xColumn: 'region',
      yColumn: 'revenue',
      seriesColumn: 'channel',
      aggFn: 'SUM',
    });
    expect(groupedBarSql).toContain('AS "series"');
    expect(groupedBarSql).toContain('GROUP BY 1, 3');

    const boxSql = buildBoxPlotChartSql({
      tableAlias: 'sales',
      xColumn: 'region',
      yColumn: 'revenue',
    });
    expect(boxSql).toContain('quantile_cont');
    expect(boxSql).toContain('AS "median_val"');
  });
});
