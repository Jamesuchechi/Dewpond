import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';

const ROOT_DIR = resolve(fileURLToPath(import.meta.url), '../..');
const PORT = 4192;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`M3 DoD Assertion Failed: ${msg}`);
  }
}

async function waitForPreviewReady(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolveProbe) => {
      const req = httpGet(url, (res) => {
        res.resume();
        resolveProbe((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400);
      });
      req.on('error', () => resolveProbe(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolveProbe(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Preview server timeout at ${url}`);
}

async function runM3Browser(name, browserType) {
  console.log(`\n=== Running M3 DoD Suite on ${name} ===`);
  const browser = await browserType.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
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
    await page
      .getByRole('button', { name: 'Load Messy Demo (1,200 rows)' })
      .waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Load Messy Demo (1,200 rows)' }).click();
    await page
      .getByRole('button', { name: 'Commit Typed Load into DuckDB' })
      .waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Commit Typed Load into DuckDB' }).click();
    await page
      .locator('.wb-table-item strong', { hasText: 'payroll_export_q4_messy' })
      .waitFor({ timeout: 15000 });

    // (1) Redact workflow: Scan PII -> Mask + Salted SHA-256 -> Apply -> k-Anonymity -> Reports
    await page.getByRole('tab', { name: 'Redact (v1)' }).click();
    await page.getByRole('button', { name: 'Scan PII Columns' }).click();
    await page.getByLabel('Redaction mode for email').selectOption('hash_sha256');
    await page.getByRole('button', { name: 'Apply Redaction' }).click();
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 1 / 1' }).waitFor({
      timeout: 15000,
    });

    const jsonReportDlPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Report (.json)' }).click();
    const jsonReportDl = await jsonReportDlPromise;
    const jsonReportPath = await jsonReportDl.path();
    const jsonReport = JSON.parse(readFileSync(jsonReportPath, 'utf8'));
    assert(jsonReport.containsRawCellValues === false, `${name}: JSON report must omit raw values`);

    const mdReportDlPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Report (.md)' }).click();
    const mdReportDl = await mdReportDlPromise;
    const mdReportPath = await mdReportDl.path();
    const mdReport = readFileSync(mdReportPath, 'utf8');
    assert(
      mdReport.includes('# Dewpond Local Redaction & Privacy Audit Report'),
      `${name}: Markdown report heading missing`,
    );

    // (2) Export workflow: CSV, JSON, NDJSON, Parquet (PAR1), XLSX (PK)
    await page.getByRole('tab', { name: 'Export' }).click();
    for (const [btnName, ext, checkBytes] of [
      ['Export CSV', 'csv', (b) => b.length > 100],
      ['Export NDJSON', 'ndjson', (b) => b.length > 100],
      [
        'Export Parquet',
        'parquet',
        (b) =>
          b.subarray(0, 4).toString() === 'PAR1' && b.subarray(b.length - 4).toString() === 'PAR1',
      ],
      ['Export XLSX', 'xlsx', (b) => b[0] === 0x50 && b[1] === 0x4b],
    ]) {
      const dlPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: btnName }).click();
      const dl = await dlPromise;
      const dlPath = await dl.path();
      const bytes = readFileSync(dlPath);
      assert(checkBytes(bytes), `${name}: Export ${ext} failed magic/content validation`);
    }

    // (3) Crash recovery test: Hard Cancel terminates worker & replays active Recipe cleanly
    await page.getByRole('button', { name: 'Hard Cancel' }).click();
    await page
      .locator('.wb-statusbar', { hasText: 'Hard-cancelled worker & replayed' })
      .waitFor({ timeout: 20000 });
    await page.getByRole('tab', { name: 'Data Grid' }).click();
    await page.locator('.wb-data-table tbody tr[data-index]').first().waitFor({ timeout: 10000 });

    assert(externalReqs.length === 0, `${name}: external requests: ${externalReqs.join(', ')}`);
    assert(errors.length === 0, `${name}: console/page errors: ${errors.join(' | ')}`);

    console.log(
      JSON.stringify({
        browser: name,
        redactAndReports: 'ok',
        exportsCsvNdjsonParquetXlsx: 'ok',
        crashRecoveryReplay: 'ok',
        externalReqs: 0,
      }),
    );

    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const srv = spawn(
    join(ROOT_DIR, 'apps/web/node_modules/.bin/vite'),
    ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: join(ROOT_DIR, 'apps/web'), stdio: 'inherit' },
  );

  try {
    await waitForPreviewReady(`${BASE_URL}/`);
    await runM3Browser('Chromium', chromium);
    await runM3Browser('Firefox', firefox);
    await runM3Browser('WebKit', webkit);
    console.log('\nALL MILESTONE M3 DOD CHECKS PASSED ACROSS CHROMIUM, FIREFOX & WEBKIT.');
  } finally {
    srv.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
