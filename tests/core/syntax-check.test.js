// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOTS = [path.join(PROJECT_ROOT, 'src')];
const EXCLUDED_DIRS = new Set(['node_modules', '.venv', '.git', '__pycache__', 'dist', 'build']);

function collectJsFiles(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) {
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJsFiles(fullPath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

function assertSyntaxOk(filePath) {
    try {
        execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
    } catch (error) {
        const message = error?.stderr?.toString() || error?.message || 'Unknown syntax error';
        assert.fail(`Syntax error in ${filePath}: ${message}`);
    }
}

test('All project JavaScript files parse', async (t) => {
    const files = SCAN_ROOTS.flatMap((root) => collectJsFiles(root));
    // Keep scanning runtime JS assets; code generation itself is Python-only now.
    assert.ok(files.length > 0, 'No JavaScript files found to scan');

    for (const file of files) {
        await t.test(file.replace(PROJECT_ROOT + path.sep, ''), () => {
            assertSyntaxOk(file);
        });
    }
});
