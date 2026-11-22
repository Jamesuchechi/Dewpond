import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const NETWORK_RESTRICTION_MESSAGE =
  'Dewpond enforces a zero-network policy outside blob-worker.ts; network APIs are forbidden in app and library code.';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/web/public/duckdb/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', '*.config.{js,mjs,ts}', 'eslint.config.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/**/*.ts'],
    languageOptions: {
      globals: globals.es2022,
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: NETWORK_RESTRICTION_MESSAGE },
        { name: 'XMLHttpRequest', message: NETWORK_RESTRICTION_MESSAGE },
        { name: 'WebSocket', message: NETWORK_RESTRICTION_MESSAGE },
        { name: 'EventSource', message: NETWORK_RESTRICTION_MESSAGE },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'navigator',
          property: 'sendBeacon',
          message: NETWORK_RESTRICTION_MESSAGE,
        },
        {
          object: 'window',
          property: 'fetch',
          message: NETWORK_RESTRICTION_MESSAGE,
        },
        {
          object: 'self',
          property: 'fetch',
          message: NETWORK_RESTRICTION_MESSAGE,
        },
        {
          object: 'globalThis',
          property: 'fetch',
          message: NETWORK_RESTRICTION_MESSAGE,
        },
      ],
    },
  },
  {
    files: ['apps/web/src/workers/blob-worker.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'XMLHttpRequest', message: NETWORK_RESTRICTION_MESSAGE },
        { name: 'WebSocket', message: NETWORK_RESTRICTION_MESSAGE },
        { name: 'EventSource', message: NETWORK_RESTRICTION_MESSAGE },
      ],
    },
  },
];
