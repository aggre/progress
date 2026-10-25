import { fileURLToPath } from 'node:url';
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import functional from 'eslint-plugin-functional';
import svelte from 'eslint-plugin-svelte';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**', '**/dist/**', '**/.astro/**', '**/.wrangler/**',
    'work/**', 'apps/api/worker-configuration.d.ts',
  ]),
  {
    name: 'monorepo/functional',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,svelte,astro}'],
    extends: [js.configs.recommended, ts.configs.recommendedTypeChecked, functional.configs.all],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
        extraFileExtensions: ['.svelte', '.astro'],
      },
    },
    // "all" includes every nondeprecated rule and is a superset of "strict".
    rules: { 'functional/prefer-tacit': 'error' },
  },
  svelte.configs['flat/recommended'],
  astro.configs.recommended,
  {
    name: 'monorepo/framework-typescript',
    files: ['**/*.svelte', '**/*.astro', '**/*.svelte.{js,ts}'],
    languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte', '.astro'] } },
  },
  {
    name: 'web/lifecycle-and-reactivity',
    files: ['apps/web/**/*.{js,mjs,ts,svelte,astro}'],
    languageOptions: { globals: globals.browser },
    rules: {
      // Lifecycle callbacks, DOM effects, and Svelte bindings are effect boundaries.
      'functional/no-expression-statements': 'off',
      'functional/no-return-void': 'off',
      'functional/no-let': 'off',
      'functional/immutable-data': 'off',
      'functional/functional-parameters': ['error', {
        enforceParameterCount: { count: 'atLeastOne', ignoreLambdaExpression: true },
      }],
    },
  },
  {
    name: 'web/astro-virtual-scripts',
    files: ['apps/web/**/*.astro/*.{js,ts}'],
    // Extracted browser scripts are virtual files, outside the TypeScript project.
    extends: [ts.configs.disableTypeChecked, functional.configs.disableTypeChecked],
    languageOptions: { globals: globals.browser },
  },
);
