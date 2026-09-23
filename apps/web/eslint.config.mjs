import nextConfig from 'eslint-config-next';
import reactHooks from 'eslint-plugin-react-hooks';

const eslintConfig = [
  ...nextConfig,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      'node_modules/**',
      'next-env.d.ts',
      'coverage/**',
      'postcss.config.mjs',
    ],
  },
];

export default eslintConfig;
