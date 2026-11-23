import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(ROOT_DIR, 'apps', 'web', 'dist');
const MANIFEST_PATH = join(ROOT_DIR, 'scripts', 'duckdb-hashes.json');

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css']);

const FORBIDDEN_PATTERNS = [
  /cdn\.jsdelivr\.net/i,
  /unpkg\.com/i,
  /esm\.sh/i,
  /extensions\.duckdb\.org/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /<script[^>]+src=["']https?:/i,
  /<link[^>]+href=["']https?:/i,
  /url\(["']?https?:/i,
];

const ALLOWED_INERT_URLS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/XML/1998/namespace',
  'https://react.dev/errors',
  // Inert repository.url metadata compiled from @duckdb/duckdb-wasm@1.32.0's package.json
  'https://github.com/duckdb/duckdb-wasm.git',
]);

const LANDING_FORBIDDEN_ENGINE_CODE =
  /AsyncDuckDB|selectBundle|duckdb-eh|duckdb-mvp|duckdb-browser|@duckdb\/duckdb-wasm|\.wasm\b|WebAssembly\.(?:instantiate|compile)/i;

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function sha256File(filePath) {
  const buf = readFileSync(filePath);
  return {
    byteLength: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} missing required token: ${needle}`);
  }
}

function normalizeUrlToken(rawUrl) {
  let clean = rawUrl.replace(/[),.;'"]+$/, '');
  if (clean.startsWith('https://react.dev/errors/')) {
    return 'https://react.dev/errors';
  }
  return clean;
}

function main() {
  if (!existsSync(DIST_DIR)) {
    throw new Error(`Build output directory not found: ${DIST_DIR}`);
  }

  const landingHtmlPath = join(DIST_DIR, 'index.html');
  const appHtmlPath = join(DIST_DIR, 'app', 'index.html');
  const headersPath = join(DIST_DIR, '_headers');
  const swPath = join(DIST_DIR, 'sw.js');
  const precachePath = join(DIST_DIR, 'precache-manifest.json');
  if (!existsSync(landingHtmlPath)) throw new Error('Missing built landing page dist/index.html');
  if (!existsSync(appHtmlPath)) throw new Error('Missing built workbench dist/app/index.html');
  if (!existsSync(headersPath)) throw new Error('Missing HTTP CSP config dist/_headers');
  if (!existsSync(swPath)) throw new Error('Missing offline Service Worker dist/sw.js');
  if (!existsSync(precachePath)) throw new Error('Missing dist/precache-manifest.json');

  const landingHtml = readFileSync(landingHtmlPath, 'utf8');
  assertIncludes(landingHtml, 'http-equiv="Content-Security-Policy"', 'dist/index.html');
  assertIncludes(landingHtml, "connect-src 'none'", 'dist/index.html');
  if (/sw\.js|serviceWorker/i.test(landingHtml)) {
    throw new Error('Landing page dist/index.html should not reference sw.js.');
  }

  const headersText = readFileSync(headersPath, 'utf8');
  assertIncludes(headersText, '/app/*', 'dist/_headers');
  assertIncludes(headersText, '/duckdb/*', 'dist/_headers');
  assertIncludes(headersText, "connect-src 'self'", 'dist/_headers');

  const precacheManifest = JSON.parse(readFileSync(precachePath, 'utf8'));
  if (!Array.isArray(precacheManifest.assets) || precacheManifest.assets.length < 6) {
    throw new Error('dist/precache-manifest.json missing expected static assets.');
  }
  for (const entry of precacheManifest.assets) {
    if (/^https?:\/\//i.test(entry)) {
      throw new Error(`External origin in precache-manifest.json: ${entry}`);
    }
  }

  // Verify landing page HTML + all referenced local script/style assets pull zero WASM / DuckDB
  if (LANDING_FORBIDDEN_ENGINE_CODE.test(landingHtml)) {
    throw new Error('Landing page dist/index.html unexpectedly references DuckDB/WASM.');
  }
  const visitedLandingAssets = new Set();
  const pendingLandingAssets = [];
  const refMatches = landingHtml.matchAll(/(?:src|href)=["'](\.[^"']+|\/assets\/[^"']+)["']/g);
  for (const match of refMatches) {
    const rawRef = match[1];
    if (!rawRef || rawRef.startsWith('./app')) continue;
    pendingLandingAssets.push(rawRef.replace(/^\.?\//, ''));
  }

  while (pendingLandingAssets.length > 0) {
    const assetRel = pendingLandingAssets.pop();
    if (!assetRel || visitedLandingAssets.has(assetRel)) continue;
    visitedLandingAssets.add(assetRel);

    const assetPath = join(DIST_DIR, assetRel);
    if (!existsSync(assetPath)) {
      throw new Error(`Landing page references missing asset: ${assetRel}`);
    }
    const content = readFileSync(assetPath, 'utf8');
    if (LANDING_FORBIDDEN_ENGINE_CODE.test(content)) {
      throw new Error(`Landing page asset ${assetRel} unexpectedly contains DuckDB/WASM code.`);
    }

    if (extname(assetRel) === '.js' || extname(assetRel) === '.mjs') {
      const importMatches = content.matchAll(/(?:from|import)\s*["'](\.[^"']+\.m?js)["']/g);
      for (const imp of importMatches) {
        const nextRel = relative(DIST_DIR, resolve(dirname(assetPath), imp[1]));
        pendingLandingAssets.push(nextRel);
      }
    }
  }

  // Verify workbench CSP directives
  const appHtml = readFileSync(appHtmlPath, 'utf8');
  assertIncludes(appHtml, 'http-equiv="Content-Security-Policy"', 'dist/app/index.html');
  for (const directive of [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "connect-src 'self'",
  ]) {
    assertIncludes(appHtml, directive, 'dist/app/index.html');
  }

  // Verify self-hosted DuckDB WASM & worker digests in dist/duckdb/
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  for (const [filename, expected] of Object.entries(manifest.files)) {
    const distFile = join(DIST_DIR, 'duckdb', filename);
    if (!existsSync(distFile)) {
      throw new Error(`Missing built DuckDB asset: dist/duckdb/${filename}`);
    }
    const actual = sha256File(distFile);
    if (actual.byteLength !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(
        `Built dist/duckdb/${filename} digest mismatch: got ${actual.sha256} (${actual.byteLength} B)`,
      );
    }
  }

  for (const [relPath, expected] of Object.entries(manifest.extensions ?? {})) {
    const distExt = join(DIST_DIR, 'duckdb', 'extensions', relPath);
    if (!existsSync(distExt)) {
      throw new Error(`Missing built DuckDB extension: dist/duckdb/extensions/${relPath}`);
    }
    const actual = sha256File(distExt);
    if (actual.byteLength !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(
        `Built dist/duckdb/extensions/${relPath} digest mismatch: got ${actual.sha256} (${actual.byteLength} B)`,
      );
    }
  }

  // Scan all text assets (excluding dist/duckdb/ verified by SHA-256 above) for external origins
  const allFiles = walkFiles(DIST_DIR);
  for (const filePath of allFiles) {
    const rel = relative(DIST_DIR, filePath);
    if (rel.startsWith('duckdb/')) continue;
    if (!TEXT_EXTENSIONS.has(extname(filePath))) continue;

    const text = readFileSync(filePath, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) {
        throw new Error(`Forbidden external reference (${pattern}) in dist/${rel}`);
      }
    }

    const urlMatches = text.match(/https?:\/\/[^\s"'`<>)]+/g) ?? [];
    for (const rawUrl of urlMatches) {
      const normalized = normalizeUrlToken(rawUrl);
      if (!ALLOWED_INERT_URLS.has(normalized)) {
        throw new Error(`Unexpected external URL "${rawUrl}" found in dist/${rel}`);
      }
    }
  }

  console.log(
    'verify-build OK: zero external origins, zero-WASM landing /, strict CSP on /app/, DuckDB 1.32.0 SHA-256 verified.',
  );
}

main();
