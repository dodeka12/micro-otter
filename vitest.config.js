import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: [
            'tests/**/*.vitest.test.js',
            'tests/**/*.vitest.spec.js',
            'tests/**/*.vitest.test.ts',
            'tests/**/*.vitest.spec.ts',
        ],
        environment: 'jsdom',
        globals: true,
        passWithNoTests: true,
    },
});
