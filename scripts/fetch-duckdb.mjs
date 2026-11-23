import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT_DIR, 'scripts', 'duckdb-hashes.json');
const DUCKDB_PKG_DIR = join(ROOT_DIR, 'apps', 'web', 'node_modules', '@duckdb', 'duckdb-wasm');
const TARGET_DIR = join(ROOT_DIR, 'apps', 'web', 'public', 'duckdb');
const EXT_TARGET_DIR = join(TARGET_DIR, 'extensions');

function sha256File(filePath) {
  const bytes = readFileSync(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { byteLength: bytes.length, sha256 };
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const installedPkg = JSON.parse(readFileSync(join(DUCKDB_PKG_DIR, 'package.json'), 'utf8'));

  if (installedPkg.name !== manifest.package || installedPkg.version !== manifest.version) {
    throw new Error(
      `Expected ${manifest.package}@${manifest.version}, found ${installedPkg.name}@${installedPkg.version}`,
    );
  }

  mkdirSync(TARGET_DIR, { recursive: true });

  const distDir = join(DUCKDB_PKG_DIR, 'dist');
  for (const [filename, expected] of Object.entries(manifest.files)) {
    const srcPath = join(distDir, filename);
    const dstPath = join(TARGET_DIR, filename);

    copyFileSync(srcPath, dstPath);
    const actual = sha256File(dstPath);

    if (actual.byteLength !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(
        `SHA-256 / size mismatch for ${filename}: expected ${expected.sha256} (${expected.bytes} B), got ${actual.sha256} (${actual.byteLength} B)`,
      );
    }

    console.log(`verified ${filename}: ${actual.byteLength} B sha256:${actual.sha256}`);
  }

  const extensions = manifest.extensions ?? {};
  for (const [relPath, expected] of Object.entries(extensions)) {
    const dstPath = join(EXT_TARGET_DIR, relPath);
    mkdirSync(dirname(dstPath), { recursive: true });

    if (!existsSync(dstPath)) {
      const url = `https://extensions.duckdb.org/${relPath}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to download DuckDB extension ${url}: HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(dstPath, buf);
    }

    const actual = sha256File(dstPath);
    if (actual.byteLength !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(
        `SHA-256 / size mismatch for extension ${relPath}: expected ${expected.sha256} (${expected.bytes} B), got ${actual.sha256} (${actual.byteLength} B)`,
      );
    }

    console.log(`verified extension ${relPath}: ${actual.byteLength} B sha256:${actual.sha256}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
