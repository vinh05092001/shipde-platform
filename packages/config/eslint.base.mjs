import tsParser from '@typescript-eslint/parser';

export const baseEslintConfig = [
  {
    ignores: [
      'dist/**',
      'build/**',
      'out/**',
      '.next/**',
      'node_modules/**',
      '*.tsbuildinfo',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {},
  },
];

export default baseEslintConfig;
