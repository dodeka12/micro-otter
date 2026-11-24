import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.browser.test.{js,ts}',
    timeout: 30000,
    reporter: 'list',
    webServer: {
        command: 'npm run dev:all',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 180000,
    },
    use: {
        baseURL: 'http://localhost:5173',
        headless: true,
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
    },
});
