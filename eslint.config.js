// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

/**
 * Dependency-rule enforcement (defense-in-depth on top of package.json deps + TS project refs).
 * See docs/architecture/03-service-boundaries.md and ADR-0002.
 */
const elementTypes = [
  { type: 'domain', pattern: 'packages/domain/src/**' },
  { type: 'application', pattern: 'packages/application/src/**' },
  { type: 'shared', pattern: 'packages/shared/*/src/**' },
  { type: 'infrastructure', pattern: 'packages/infrastructure/*/src/**' },
  { type: 'plugin', pattern: 'plugins/*/src/**' },
  { type: 'app', pattern: 'apps/*/src/**' },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/*.tsbuildinfo',
      '**/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elementTypes,
      'boundaries/ignore': ['**/*.test.ts', '**/*.spec.ts'],
    },
    rules: {
      'boundaries/no-unknown': 'off',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'domain', allow: ['domain'] },
            { from: 'application', allow: ['application', 'domain', 'shared'] },
            { from: 'shared', allow: ['shared', 'domain'] },
            {
              from: 'infrastructure',
              allow: ['infrastructure', 'application', 'domain', 'shared'],
            },
            {
              from: 'plugin',
              allow: ['plugin', 'infrastructure', 'application', 'domain', 'shared'],
            },
            {
              from: 'app',
              allow: ['app', 'plugin', 'infrastructure', 'application', 'domain', 'shared'],
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
);
