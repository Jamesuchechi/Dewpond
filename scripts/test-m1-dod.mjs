import { spawn } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright-core';
import { buildSyntheticXlsx } from '../packages/fixtures/src/xlsxBuilder.ts';

const ROOT_DIR = resolve(fileURLToPath(import.meta.url), '../..');
const CACHE_BASE = join(homedir(), '.cache');
const PORT = 4188;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`M1 DoD Assertion Failed: ${msg}`);
  }
}

function buildFiftyMbFifteenColCsv(workDir) {
  const filePath = join(workDir, 'm1_50mb_15col.csv');
  const header =
    'tx_id,phone,bvn,email,tx_date,amount,qty,rate,is_verified,channel,city,merchant,currency,status,note\n';
  const rows = [];
  const channels = ['POS', 'NIP', 'USSD', 'Card', 'Web', 'Mobile'];
  const cities = ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Enugu', 'Benin'];
  for (let i = 0; i < 1000; i++) {
    const phone = `080${String(10000000 + i * 7919).slice(0, 8)}`;
    const bvn = `22${String(100000000 + i * 104729).slice(0, 9)}`;
    const amt = i < 50 && i % 2 === 0 ? String(100 + i) : `${1000 + (i % 9000)}.50`;
    rows.push(
      `TX${String(i).padStart(7, '0')},${phone},${bvn},user${i}@example.org,2025-04-03,${amt},${(i % 25) + 1},1.${10 + (i % 80)},true,${channels[i % 6]},${cities[i % 6]},Merch_${i % 100},NGN,settled,note_ok_${i % 50}\n`,
    );
  }
  const block = rows.join('');
  // ~385k rows x 15 cols (~50 MB)
  const repeatCount = 385;
  const parts = [header];
  for (let r = 0; r < repeatCount; r++) parts.push(block);
  const content = parts.join('');
  writeFileSync(filePath, content);
  return {
    filePath,
    bytes: Buffer.byteLength(content),
    rows: repeatCount * 1000,
  };
}

async function generateFiveHundredMbParquet(workDir) {
  const outFile = join(workDir, 'm1_500mb.parquet');
  const require = createRequire(import.meta.url);
  const arrowEntry = require.resolve('apache-arrow', {
    paths: [join(ROOT_DIR, 'apps/web/node_modules')],
  });
  const arrowDir = dirname(arrowEntry);
  const tslibEntry = require.resolve('tslib/tslib.es6.js', { paths: [arrowDir] });
  const flatbuffersDir = dirname(
    require.resolve('flatbuffers/mjs/flatbuffers.js', { paths: [arrowDir] }),
  );
  const duckdbDir = resolve(ROOT_DIR, 'apps/web/node_modules/@duckdb/duckdb-wasm/dist');
  const publicDuckdbDir = resolve(ROOT_DIR, 'apps/web/public/duckdb');

  const outStream = createWriteStream(outFile);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/_chunk') {
      req.on('data', (chunk) => outStream.write(chunk));
      req.on('end', () => {
        res.writeHead(204);
        res.end();
      });
      return;
    }
    if (url.pathname === '/gen.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body>
        <script type="importmap">{"imports":{"apache-arrow":"/arrow/Arrow.dom.mjs","tslib":"/dep/tslib.es6.js","flatbuffers":"/flatbuffers/flatbuffers.js"}}</script>
        <script type="module">
          import * as duckdb from '/duckdb-dist/duckdb-browser.mjs';
          window.__genDuck = duckdb;
        </script>
      </body></html>`);
      return;
    }

    let filePath = null;
    if (url.pathname === '/dep/tslib.es6.js') {
      filePath = tslibEntry;
    } else if (url.pathname.startsWith('/flatbuffers/')) {
      filePath = resolve(flatbuffersDir, url.pathname.slice(13));
    } else if (url.pathname.startsWith('/arrow/')) {
      filePath = resolve(arrowDir, url.pathname.slice(7));
    } else if (url.pathname.startsWith('/duckdb-dist/')) {
      filePath = resolve(duckdbDir, url.pathname.slice(13));
    } else if (url.pathname.startsWith('/duckdb/')) {
      filePath = resolve(publicDuckdbDir, url.pathname.slice(8));
    }

    if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const mime =
        ext === '.mjs' || ext === '.js'
          ? 'application/javascript'
          : ext === '.wasm'
            ? 'application/wasm'
            : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      createReadStream(filePath).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const genUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error('[gen.html pageerror]', err.message));
    await page.goto(`${genUrl}/gen.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__genDuck), { timeout: 15000 });

    const result = await page.evaluate(async (origin) => {
      const d = window.__genDuck;
      const bundles = {
        mvp: {
          mainModule: `${origin}/duckdb/duckdb-mvp.wasm`,
          mainWorker: `${origin}/duckdb/duckdb-browser-mvp.worker.js`,
        },
        eh: {
          mainModule: `${origin}/duckdb/duckdb-eh.wasm`,
          mainWorker: `${origin}/duckdb/duckdb-browser-eh.worker.js`,
        },
      };
      const sel = await d.selectBundle(bundles);
      const w = await d.createWorker(sel.mainWorker);
      const db = new d.AsyncDuckDB(new d.VoidLogger(), w);
      await db.instantiate(sel.mainModule, sel.pthreadWorker);
      await db.open({ path: ':memory:' });
      const c = await db.connect();
      await c.query(`SET custom_extension_repository = '${origin}/duckdb/extensions';`);
      await c.query('INSTALL parquet; LOAD parquet;');

      await c.query(`
        COPY (
          SELECT
            'TX' || lpad(i::VARCHAR, 8, '0') AS tx_id,
            '080' || lpad(((i * 7919) % 100000000)::VARCHAR, 8, '0') AS phone,
            '22' || lpad(((i * 104729) % 1000000000)::VARCHAR, 9, '0') AS bvn,
            'user' || i::VARCHAR || '@example.ng' AS email,
            DATE '2025-01-01' + (i % 365)::INTEGER AS tx_date,
            (((i * 137) % 950000) + (i % 99) / 100.0)::DOUBLE AS amount,
            ((i % 50) + 1)::INTEGER AS qty,
            CASE i % 6 WHEN 0 THEN 'POS' WHEN 1 THEN 'NIP' WHEN 2 THEN 'USSD' WHEN 3 THEN 'Card' WHEN 4 THEN 'Web' ELSE 'Mobile' END AS channel,
            sha256(i::VARCHAR) || '_' || md5(i::VARCHAR) AS payload_sig
          FROM range(50000) t(i)
        ) TO '_sample.parquet' (FORMAT PARQUET, COMPRESSION SNAPPY, ROW_GROUP_SIZE 50000);
      `);
      const sampleBuf = await db.copyFileToBuffer('_sample.parquet');
      await db.dropFile('_sample.parquet');
      const targetRows = Math.round((502 * 1024 * 1024) / (sampleBuf.byteLength / 50000));

      await c.query(`
        COPY (
          SELECT
            'TX' || lpad(i::VARCHAR, 8, '0') AS tx_id,
            '080' || lpad(((i * 7919) % 100000000)::VARCHAR, 8, '0') AS phone,
            '22' || lpad(((i * 104729) % 1000000000)::VARCHAR, 9, '0') AS bvn,
            'user' || i::VARCHAR || '@example.ng' AS email,
            DATE '2025-01-01' + (i % 365)::INTEGER AS tx_date,
            (((i * 137) % 950000) + (i % 99) / 100.0)::DOUBLE AS amount,
            ((i % 50) + 1)::INTEGER AS qty,
            CASE i % 6 WHEN 0 THEN 'POS' WHEN 1 THEN 'NIP' WHEN 2 THEN 'USSD' WHEN 3 THEN 'Card' WHEN 4 THEN 'Web' ELSE 'Mobile' END AS channel,
            sha256(i::VARCHAR) || '_' || md5(i::VARCHAR) AS payload_sig
          FROM range(${targetRows}) t(i)
        ) TO '_full_500mb.parquet' (FORMAT PARQUET, COMPRESSION SNAPPY, ROW_GROUP_SIZE 100000);
      `);

      const fullBuf = new Uint8Array(await db.copyFileToBuffer('_full_500mb.parquet'));
      await db.dropFile('_full_500mb.parquet');
      const chunkBytes = 32 * 1024 * 1024;
      for (let off = 0; off < fullBuf.byteLength; off += chunkBytes) {
        const slice = fullBuf.subarray(off, Math.min(off + chunkBytes, fullBuf.byteLength));
        const res = await fetch(`${origin}/_chunk`, { method: 'POST', body: slice });
        if (!res.ok) throw new Error(`Chunk upload failed: ${res.status}`);
      }

      await c.close();
      await db.terminate();
      w.terminate();
      return { rows: targetRows, bytes: fullBuf.byteLength };
    }, genUrl);

    await new Promise((r) => outStream.end(r));
    return { filePath: outFile, bytes: statSync(outFile).size, rows: result.rows };
  } finally {
    await browser.close();
    server.close();
  }
}

function buildXlsxTestFiles(workDir) {
  const xlsx1900Path = join(workDir, 'ledger_1900.xlsx');
  writeFileSync(
    xlsx1900Path,
    buildSyntheticXlsx({
      date1904: false,
      sheets: [
        {
          name: 'Ledger',
          hiddenRows: [4],
          mergedRanges: ['A1:C1'],
          rows: [
            [{ value: 'Synthetic Ledger Banner' }],
            [{ value: 'tx_date' }, { value: 'phone' }, { value: 'amount' }],
            [
              { value: 45750, isDate: true },
              { value: '08012345678' },
              { value: '1500.50', formula: '1000+500.5' },
            ],
            [{ value: 45751, isDate: true }, { value: '08099998888' }, { value: 250 }],
          ],
        },
        {
          name: 'HiddenAudit',
          hidden: true,
          rows: [
            [{ value: 'audit_id' }, { value: 'tx_date' }],
            [{ value: 'AUD-1' }, { value: 45750, isDate: true }],
          ],
        },
      ],
    }),
  );

  // Windows-1252 bytes: "item,price\nCafé — 1,€50"
  const winPath = join(workDir, 'win1252_cafe.csv');
  writeFileSync(
    winPath,
    new Uint8Array([
      0x69, 0x74, 0x65, 0x6d, 0x2c, 0x70, 0x72, 0x69, 0x63, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9,
      0x20, 0x97, 0x20, 0x31, 0x2c, 0x80, 0x35, 0x30,
    ]),
  );

  return { xlsx1900Path, winPath };
}

async function waitForPreviewReady(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Preview server timeout at ${url}`);
}

function parseHeapMb(heapPillText) {
  if (!heapPillText) return 0;
  const mbMatch = /([\d.]+)\s*MB/i.exec(heapPillText);
  if (mbMatch) return Number(mbMatch[1]);
  const kbMatch = /([\d.]+)\s*KB/i.exec(heapPillText);
  if (kbMatch) return Number(kbMatch[1]) / 1024;
  return 0;
}

async function runM1Browser(name, browserType, fixtures) {
  console.log(`\n=== Running M1 DoD Suite on ${name} ===`);
  const browser = await browserType.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const errors = [];
    const externalReqs = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith(`${BASE_URL}/`) && !url.startsWith('data:') && !url.startsWith('blob:')) {
        externalReqs.push(`${req.method()} ${url}`);
      }
    });

    await page.goto(`${BASE_URL}/app/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Boot Engine' }).click();
    await page.locator('.wb-engine-pill', { hasText: 'Ready (' }).waitFor({ timeout: 30000 });

    // (a1) XLSX (merges + cached formulas + hidden sheet)
    await page.locator('input[type="file"]').setInputFiles(fixtures.xlsx.xlsx1900Path);
    await page
      .getByRole('button', { name: 'Commit Typed Load into DuckDB' })
      .waitFor({ timeout: 20000 });
    await page.getByText('1 merged range(s)').waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Commit Typed Load into DuckDB' }).click();
    await page
      .locator('.wb-table-item strong', { hasText: 'ledger_1900' })
      .waitFor({ timeout: 15000 });

    // Verify uPlot sparkline canvas + issue flags render on Profile
    await page.getByRole('tab', { name: 'Profile' }).click();
    await page.getByRole('button', { name: 'Run SUMMARIZE Profile' }).click();
    await page.locator('.wb-uplot-spark canvas').first().waitFor({ timeout: 15000 });

    // (a2) Win-1252 CSV + _rejects quarantine test on demo dataset with amount -> DOUBLE
    await page.getByRole('tab', { name: 'Data Grid' }).click();
    await page.locator('input[type="file"]').setInputFiles(fixtures.xlsx.winPath);
    await page.locator('.wb-tag', { hasText: 'windows-1252' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Commit Typed Load into DuckDB' }).click();
    await page
      .locator('.wb-table-item strong', { hasText: 'win1252_cafe' })
      .waitFor({ timeout: 10000 });
    await page.locator('.wb-data-table td', { hasText: 'Café — 1' }).waitFor({ timeout: 10000 });

    await page.getByRole('button', { name: 'Load Messy Demo (1,200 rows)' }).click();
    await page
      .getByRole('button', { name: 'Commit Typed Load into DuckDB' })
      .waitFor({ timeout: 15000 });
    await page.getByLabel('Type override for amount').selectOption('DOUBLE');
    await page.getByRole('button', { name: 'Commit Typed Load into DuckDB' }).click();
    await page
      .locator('.wb-table-item strong', { hasText: '_rejects' })
      .waitFor({ timeout: 15000 });
    const rejectsMeta = await page
      .locator('.wb-table-item', { hasText: '_rejects' })
      .locator('small')
      .textContent();
    assert(
      rejectsMeta?.includes('4 rows'),
      `${name}: expected 4 quarantined rows in _rejects, got ${rejectsMeta}`,
    );

    // (b) 50 MB CSV (385k x 15) -> Commit + Profile < 3 s
    await page.getByRole('button', { name: 'Wipe Session' }).click();
    await page
      .locator('.wb-empty-note', { hasText: 'No tables committed yet.' })
      .waitFor({ timeout: 10000 });

    const sampleStart = Date.now();
    await page.locator('input[type="file"]').setInputFiles(fixtures.fiftyMb.filePath);
    await page
      .getByRole('button', { name: 'Commit Typed Load into DuckDB' })
      .waitFor({ timeout: 30000 });
    const sampleMs = Date.now() - sampleStart;

    const pipeStart = Date.now();
    await page.getByRole('button', { name: 'Commit Typed Load into DuckDB' }).click();
    await page
      .locator('.wb-table-item small', {
        hasText: `${fixtures.fiftyMb.rows.toLocaleString('en-US')} rows`,
      })
      .waitFor({ timeout: 30000 });
    const load50Ms = Date.now() - pipeStart;

    await page.getByRole('tab', { name: 'Profile' }).click();
    const profStart = Date.now();
    await page.getByRole('button', { name: 'Run SUMMARIZE Profile' }).click();
    await page.locator('.wb-uplot-spark canvas').first().waitFor({ timeout: 30000 });
    const profile50Ms = Date.now() - profStart;
    const total50Ms = sampleMs + load50Ms + profile50Ms;
    assert(load50Ms < 5000, `${name}: 50 MB CSV typed load took too long (${load50Ms} ms)`);
    assert(profile50Ms < 3000, `${name}: 50 MB CSV profile exceeded 3s DoD (${profile50Ms} ms)`);

    // (c) 500 MB Parquet lazy mode (< 25 MB DuckDB RAM)
    await page.getByRole('button', { name: 'Wipe Session' }).click();
    await page
      .locator('.wb-empty-note', { hasText: 'No tables committed yet.' })
      .waitFor({ timeout: 10000 });

    await page.locator('input[type="file"]').setInputFiles(fixtures.parquet.filePath);
    await page
      .locator('.wb-table-item strong', { hasText: 'm1_500mb' })
      .waitFor({ timeout: 30000 });
    await page.getByRole('tab', { name: 'SQL Query' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(
      'SELECT "channel", count(*)::BIGINT AS cnt, round(avg("amount"), 2) AS avg_amt FROM "m1_500mb" GROUP BY "channel" ORDER BY cnt DESC;',
      { delay: 1 },
    );
    const pqStart = Date.now();
    await page.getByRole('button', { name: 'Run Query' }).click();
    await page.locator('.wb-data-table tbody tr[data-index]').first().waitFor({ timeout: 30000 });
    const pqQueryMs = Date.now() - pqStart;
    const heapText = await page.locator('.wb-mem-pill').textContent();
    const heapMb = parseHeapMb(heapText);
    assert(
      heapMb < 25,
      `${name}: 500 MB Parquet DuckDB heap ${heapMb.toFixed(2)} MB >= 25 MB DoD cap!`,
    );

    assert(
      externalReqs.length === 0,
      `${name}: unexpected external requests: ${externalReqs.join(', ')}`,
    );
    assert(errors.length === 0, `${name}: console/page errors: ${errors.join(' | ')}`);

    console.log(
      JSON.stringify({
        browser: name,
        xlsxAndWin1252: 'ok',
        rejectsCount: rejectsMeta,
        fiftyMbSampleMs: sampleMs,
        fiftyMbLoadMs: load50Ms,
        fiftyMbProfileMs: profile50Ms,
        fiftyMbEndToEndMs: total50Ms,
        parquetBytes: fixtures.parquet.bytes,
        parquetGroupByMs: pqQueryMs,
        parquetHeapMb: Number(heapMb.toFixed(2)),
        externalReqs: 0,
      }),
    );

    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!existsSync(CACHE_BASE)) mkdirSync(CACHE_BASE, { recursive: true });
  const workDir = mkdtempSync(join(CACHE_BASE, 'dewpond-m1-dod-'));
  const srv = spawn(
    'pnpm',
    [
      '--filter',
      '@dewpond/web',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--strictPort',
    ],
    { stdio: 'ignore' },
  );

  try {
    await waitForPreviewReady(`${BASE_URL}/`);

    const fiftyMb = buildFiftyMbFifteenColCsv(workDir);
    const xlsx = buildXlsxTestFiles(workDir);
    console.log(
      `Built 50 MB CSV (${(fiftyMb.bytes / (1024 * 1024)).toFixed(2)} MB, ${fiftyMb.rows} rows). Generating 500 MB Parquet on NVMe via browser DuckDB...`,
    );
    const parquet = await generateFiveHundredMbParquet(workDir);
    console.log(
      `Built 500 MB Snappy Parquet (${(parquet.bytes / (1024 * 1024)).toFixed(2)} MB, ${parquet.rows.toLocaleString('en-US')} rows).`,
    );

    const fixtures = { fiftyMb, xlsx, parquet };
    await runM1Browser('Chromium', chromium, fixtures);
    await runM1Browser('Firefox', firefox, fixtures);

    console.log('\nALL MILESTONE M1 DOD CHECKS PASSED ACROSS CHROMIUM & FIREFOX.');
  } finally {
    srv.kill('SIGTERM');
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
