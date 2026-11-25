import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import functionSpacing from './scripts/eslint-function-spacing.cjs';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/releases/**',
      '**/out/**',
      '**/coverage/**',
      '**/docs/**',
    ],
  },
  {
    files: ['**/*.{js,cjs,mjs,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    // Existing lint exceptions refer to TypeScript rules even during this
    // formatting-only pass. Register them without enabling the lint preset.
    plugins: {
      '@typescript-eslint': typescriptEslint,
      mkeditor: { rules: { 'function-spacing': functionSpacing } },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'mkeditor/function-spacing': 'error' },
  },
];
