import nextConfig from 'eslint-config-next';

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'],
  },
];

export default eslintConfig;
