import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function collectDuckdbEntries(duckdbDir: string, entries: Set<string>, prefix = './duckdb'): void {
  if (!existsSync(duckdbDir)) return;
  for (const name of readdirSync(duckdbDir).sort()) {
    const full = join(duckdbDir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectDuckdbEntries(full, entries, `${prefix}/${name}`);
    } else if (name.endsWith('.wasm') || name.endsWith('.worker.js')) {
      entries.add(`${prefix}/${name}`);
    }
  }
}

function dewpondDevCspPlugin(): Plugin {
  return {
    name: 'dewpond-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["'])([^"']+)(["'])/i,
        (_m, prefix: string, content: string, suffix: string) => {
          const updated = content
            .replace(
              "script-src 'self' 'wasm-unsafe-eval'",
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
            )
            .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace(
              "connect-src 'none'",
              "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
            )
            .replace(
              "connect-src 'self'",
              "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
            );
          return `${prefix}${updated}${suffix}`;
        },
      );
    },
  };
}

function dewpondPrecacheManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'dewpond-precache-manifest',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      const assetsDir = join(outDir, 'assets');
      const duckdbDir = join(outDir, 'duckdb');
      const entries = new Set(['./', './index.html', './app/', './app/index.html']);

      if (existsSync(assetsDir)) {
        for (const name of readdirSync(assetsDir).sort()) {
          if (name.endsWith('.js') || name.endsWith('.css')) {
            entries.add(`./assets/${name}`);
          }
        }
      }

      collectDuckdbEntries(duckdbDir, entries);

      const hash = createHash('sha256');
      const assetList = [...entries];
      for (const rel of assetList) {
        const clean =
          rel === './' ? 'index.html' : rel === './app/' ? 'app/index.html' : rel.slice(2);
        const full = join(outDir, clean);
        if (existsSync(full) && statSync(full).isFile()) {
          hash.update(rel);
          hash.update(String(statSync(full).size));
          if (!rel.endsWith('.wasm')) {
            hash.update(readFileSync(full));
          }
        }
      }

      const manifest = {
        version: hash.digest('hex').slice(0, 12),
        assets: assetList,
      };
      writeFileSync(join(outDir, 'precache-manifest.json'), JSON.stringify(manifest, null, 2));
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), dewpondDevCspPlugin(), dewpondPrecacheManifest()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    entries: ['index.html', 'app/index.html'],
  },
  worker: {
    format: 'iife',
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
});
