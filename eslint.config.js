import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const jsFiles = ['src/**/*.js', 'tests/**/*.js'];
const tsFiles = ['src/**/*.ts'];

export default [
    {
        ignores: [
            'dist/**',
            // `npm run build` writes the bundled app and the vendored marked/prism
            // trees to the repo-root `_dist/webapp`. `src/dist/**` stays ignored so a
            // leftover bundle from an older checkout is never linted either.
            '_dist/**',
            'src/dist/**',
            'build/**',
            '**/device/**',
            'src/micro_otter/nodes/html/js/core/_legacy/**',
            'src/micro_otter/nodes/html/vendor/**',
        ],
    },
    { ...js.configs.recommended, files: jsFiles },
    { ...importPlugin.flatConfigs.recommended, files: jsFiles },
    { ...jsdoc.configs['flat/recommended'], files: jsFiles },
    // Type-aware linting (configs.recommendedTypeChecked + parserOptions.projectService) is
    // deliberately NOT enabled: it needs a TypeScript program for every run, which multiplies
    // CI time before this baseline is even clean. Tracked as a follow-up.
    ...tseslint.configs.recommended.map((config) => ({ ...config, files: tsFiles })),
    {
        files: jsFiles,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
        },
        settings: {
            // Sources are TypeScript while the tests import them with TypeScript-style
            // specifiers ('../../src/.../app-event.js' resolves to 'app-event.ts'), exactly
            // like the tsx-based test runner does. Without this resolver every such import
            // is a false 'import/no-unresolved' error.
            'import/resolver': {
                typescript: { project: './tsconfig.json' },
            },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'jsdoc/require-returns': 'off',
        },
    },
    {
        // Tests describe behaviour instead of exposing a documented API, so the jsdoc
        // preset costs hundreds of 'Missing JSDoc comment' findings without adding value.
        files: ['tests/**/*.js'],
        rules: {
            'jsdoc/require-jsdoc': 'off',
        },
    },
    {
        files: tsFiles,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            // The core rule misreports type-only usage and does not understand TS syntax,
            // so the TypeScript-aware variant replaces it rather than duplicating findings.
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            // 165 `any` sites are a type-design backlog, not a lint defect: turning this into
            // an error today would only invite eslint-disable comments.
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
    { ...prettier, files: [...jsFiles, ...tsFiles] },
];
