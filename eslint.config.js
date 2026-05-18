// Flat ESLint config (ESLint 9+). Uses @typescript-eslint parser + plugin directly
// so the root devDependency set stays minimal.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      // The dashboard is a Next.js app: it self-lints with its own flat
      // config (next/core-web-vitals + next/typescript). Linting its TSX with
      // the root's minimal typescript-eslint set would only produce noise.
      'dashboard/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },
];
