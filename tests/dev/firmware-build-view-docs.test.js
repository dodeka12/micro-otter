// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const archPage = path.join(repoRoot, 'docs', 'dev', 'view-system', 'firmware-build-view-architecture.md');

describe('firmware build view docs', () => {
    it('has an architecture page', () => {
        assert.ok(existsSync(archPage));
    });

    it('resolves every relative Markdown link inside the page', () => {
        const content = readFileSync(archPage, 'utf8');
        const pageDir = path.dirname(archPage);
        const linkRegex = /\]\(([^)]+)\)/g;
        for (const match of content.matchAll(linkRegex)) {
            const target = match[1];
            if (target.startsWith('http') || target.startsWith('#')) {
                continue;
            }
            const targetPath = target.split('#')[0];
            const resolved = path.resolve(pageDir, targetPath);
            assert.ok(
                existsSync(resolved),
                `broken link in architecture page: ${target}`
            );
        }
    });

    it('is linked from docs/dev/README.md and docs/dev/view-system/index.md', () => {
        const readme = readFileSync(path.join(repoRoot, 'docs', 'dev', 'README.md'), 'utf8');
        const index = readFileSync(path.join(repoRoot, 'docs', 'dev', 'view-system', 'index.md'), 'utf8');
        assert.ok(readme.includes('firmware-build-view-architecture.md'));
        assert.ok(index.includes('firmware-build-view-architecture.md'));
    });
});
