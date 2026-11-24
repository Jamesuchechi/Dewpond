import { spawn } from 'node:child_process';
import { chromium, firefox } from 'playwright-core';

const PORT = 4189;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`M2 DoD Assertion Failed: ${msg}`);
  }
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

async function runM2Browser(name, browserType) {
  console.log(`\n=== Running M2 DoD Suite on ${name} ===`);
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
    await page.getByRole('button', { name: 'Load Messy Demo (1,200 rows)' }).click();
    await page
      .getByRole('button', { name: 'Commit Typed Load into DuckDB' })
      .waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Commit Typed Load into DuckDB' }).click();
    await page
      .locator('.wb-table-item strong', { hasText: 'payroll_export_q4_messy' })
      .waitFor({ timeout: 15000 });

    // Apply 10 deterministic Clean steps
    await page.getByRole('tab', { name: 'Clean' }).click();
    const applyStep = async (opLabel, setup) => {
      await page.getByRole('button', { name: opLabel, exact: true }).click();
      if (setup) await setup();
      await page.locator('.wb-live-sql code').waitFor({ timeout: 5000 });
      await page.getByRole('button', { name: 'Apply Clean Step' }).click();
    };

    await applyStep('Trim Text');
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 1 / 1' }).waitFor();

    await applyStep('Case', async () => {
      await page.getByLabel('Target / Key Column').selectOption('email');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 2 / 2' }).waitFor();

    await applyStep('Filter Rows', async () => {
      await page.getByLabel('Target / Key Column').selectOption('email');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 3 / 3' }).waitFor();

    await applyStep('Replace', async () => {
      await page.getByLabel('Target / Key Column').selectOption('department');
      await page.getByLabel('Find').fill('Ops');
      await page.getByLabel('Replace With').fill('Operations');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 4 / 4' }).waitFor();

    // 5th step triggers automatic TABLE checkpoint
    await applyStep('Derive', async () => {
      await page.getByLabel('New Column Name').fill('fee_est');
      await page.getByLabel('SQL Expression').fill('10');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 5 / 5' }).waitFor();

    await applyStep('Fill Nulls', async () => {
      await page.getByLabel('Target / Key Column').selectOption('amount');
      await page.getByLabel('Strategy').selectOption('value');
      await page.getByLabel('Fill Value').fill('0');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 6 / 6' }).waitFor();

    await applyStep('Split', async () => {
      await page.getByLabel('Target / Key Column').selectOption('email');
      await page.getByLabel('Delimiter').fill('@');
      await page.getByLabel('Output Columns (comma-separated)').fill('email_user, email_domain');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 7 / 7' }).waitFor();

    await applyStep('Merge', async () => {
      await page.getByLabel('Columns (comma-separated)').fill('department, email_domain');
      await page.getByLabel('Separator').fill(' | ');
      await page.getByLabel('Output Column').fill('dept_domain');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 8 / 8' }).waitFor();

    await applyStep('Rename', async () => {
      await page.getByLabel('Target / Key Column').selectOption('dept_domain');
      await page.getByLabel('New Column Name').fill('dept_host');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 9 / 9' }).waitFor();

    await applyStep('Exact Dedupe', async () => {
      await page.getByLabel('Target / Key Column').selectOption('email');
    });
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 10 / 10' }).waitFor();

    // Reload browser page and verify IndexedDB autosaved 10-step Recipe restores & replays identically
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .getByRole('button', { name: /Restore Autosaved Recipe \(10 steps\)/ })
      .waitFor({ timeout: 10000 });

    await page.getByRole('button', { name: 'Load Messy Demo (1,200 rows)' }).click();
    await page
      .getByRole('button', { name: 'Commit Typed Load into DuckDB' })
      .waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Commit Typed Load into DuckDB' }).click();
    await page
      .locator('.wb-table-item strong', { hasText: 'payroll_export_q4_messy' })
      .waitFor({ timeout: 15000 });

    await page.getByRole('button', { name: /Restore Autosaved Recipe \(10 steps\)/ }).click();
    await page.getByRole('button', { name: 'Replay Imported Recipe' }).click();
    await page.locator('.wb-drawer-head strong', { hasText: 'Head: 10 / 10' }).waitFor({
      timeout: 20000,
    });

    // Test hostile #r= link rejection + wipe all local data
    await page.goto(`${BASE_URL}/app/#r=invalid_payload_$$$`, { waitUntil: 'networkidle' });
    await page.locator('.wb-statusbar', { hasText: 'Blocked shared #r= Recipe' }).waitFor({
      timeout: 10000,
    });

    await page.getByRole('button', { name: 'Wipe all local data' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    const restoreBtnCount = await page
      .getByRole('button', { name: /Restore Autosaved Recipe/ })
      .count();
    assert(restoreBtnCount === 0, `${name}: IndexedDB recipe was not wiped!`);
    assert(externalReqs.length === 0, `${name}: external requests: ${externalReqs.join(', ')}`);
    assert(errors.length === 0, `${name}: console/page errors: ${errors.join(' | ')}`);

    console.log(
      JSON.stringify({
        browser: name,
        tenStepReplay: 'ok',
        reloadRestore: 'ok',
        hostileShareBlocked: 'ok',
        wipeAllLocalData: 'ok',
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
    await runM2Browser('Chromium', chromium);
    await runM2Browser('Firefox', firefox);
    console.log('\nALL MILESTONE M2 DOD CHECKS PASSED ACROSS CHROMIUM & FIREFOX.');
  } finally {
    srv.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
