import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'action/dist/**',
      'node_modules/**',
      'artifacts/**',
      'site-dist/**',
      'site/dist/**',
      'marketplace/carlashub-plugin-marketplace/accessibility-audit/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        require: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
