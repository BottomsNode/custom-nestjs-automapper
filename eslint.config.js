import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config({
    files: ['src/**/*.ts', '__tests__/**/*.ts'],
    languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
            project: './tsconfig.eslint.json'
        },
        globals: {
            ...globals.node,
            ...globals.jest
        }
    },
    plugins: {
        '@typescript-eslint': tseslint.plugin
    },
    rules: {
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-function-type': 'warn',
        'prefer-const': 'error',
        'no-prototype-builtins': 'error'
    }
});
