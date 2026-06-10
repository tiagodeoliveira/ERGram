import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettier from 'eslint-config-prettier'

// Flat config (ESLint 9+). ERGram is a vanilla TS + Vite PWA — no React/Next, so
// this is just JS-recommended + typescript-eslint-recommended. `eslint-config-prettier`
// is last so it disables any stylistic rules that would fight Prettier; formatting
// is Prettier's job, ESLint's job is correctness and dead-code detection.
export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      // Browser + Node globals the app touches. `no-undef` is off below (TS already
      // resolves these), but listing the common ones keeps intent clear.
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript's own resolver handles undefined-symbol detection; the lint rule
      // only produces false positives for DOM/Node globals under the TS parser.
      'no-undef': 'off',
      // Dead-code gate: unused imports/vars/args block the commit. Prefix an
      // intentionally-unused arg with _ to opt out (e.g. `(_event) => ...`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node build/CI scripts (e.g. the network-whitelist guard) run under Node, not
    // the browser, so they need the Node globals the recommended config doesn't grant.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.remember/**',
      '.pi/**',
      '.claude/**',
      '.playwright-mcp/**',
      '.vite/**',
      '*.config.ts',
      '*.config.mjs',
    ],
  },
  prettier,
]
