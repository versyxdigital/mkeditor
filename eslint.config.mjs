import typescriptEslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/build',
      '**/releases',
      '**/docs',
      '**/webpack.config.js',
    ],
  },
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ),
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },

      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },

    rules: {
      // Indentation is owned by Prettier (`.prettierrc` + `prettier-fix`
      // in the build pipeline). ESLint's `indent` rule disagrees with
      // Prettier on a few real cases — ternary-with-object-literal
      // bodies, deeply-nested JSX arrow callbacks (it stack-overflows
      // on EditorToolbar.tsx) — and the two trade reformats back and
      // forth otherwise. Turning the rule off everywhere matches what
      // we already did for `.tsx` and keeps Prettier as the single
      // source of truth for formatting.
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
      'no-constant-condition': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          disallowTypeAnnotations: false,
        },
      ],
    },
  },
];
