import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEST_ROOT = path.resolve('tests');
const TEST_MODES = Object.freeze({
    js: {
        suffix: '.test.js',
        excludedSuffixes: ['.browser.test.js', '.vitest.test.js'],
        runtimeArgs: ['--import', 'tsx', '--test'],
    },
    ts: {
        suffix: '.test.ts',
        excludedSuffixes: ['.browser.test.ts', '.vitest.test.ts'],
        runtimeArgs: ['--import', 'tsx', '--test'],
    },
});

function parseMode(argv) {
    const modeArg = argv.find((arg) => arg.startsWith('--mode='));
    const mode = modeArg ? modeArg.slice('--mode='.length) : 'ts';

    if (!Object.prototype.hasOwnProperty.call(TEST_MODES, mode)) {
        console.error(
            `Node test runner: invalid mode '${mode}'. Expected one of: ${Object.keys(TEST_MODES).join(', ')}`
        );
        process.exit(1);
    }

    return mode;
}

function collectTestFiles(directory, modeConfig, output = []) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectTestFiles(fullPath, modeConfig, output);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        if (!fullPath.endsWith(modeConfig.suffix)) {
            continue;
        }
        if (modeConfig.excludedSuffixes.some((suffix) => fullPath.endsWith(suffix))) {
            continue;
        }
        output.push(fullPath);
    }
    return output;
}

function main() {
    const mode = parseMode(process.argv.slice(2));
    const modeConfig = TEST_MODES[mode];

    if (!fs.existsSync(TEST_ROOT)) {
        console.error(`Node test runner: tests directory not found at ${TEST_ROOT}`);
        process.exit(1);
    }

    const testFiles = collectTestFiles(TEST_ROOT, modeConfig).sort();

    if (testFiles.length === 0) {
        console.log(`Node test runner: no matching ${mode.toUpperCase()} test files found.`);
        process.exit(0);
    }

    const result = spawnSync(process.execPath, [...modeConfig.runtimeArgs, ...testFiles], {
        stdio: 'inherit',
    });

    if (typeof result.status === 'number') {
        process.exit(result.status);
    }

    if (mode === 'ts' || mode === 'js') {
        console.error(
            'Node test runner: failed to execute test process. Ensure dev dependency "tsx" is installed.'
        );
    } else {
        console.error('Node test runner: failed to execute test process.');
    }
    process.exit(1);
}

main();
