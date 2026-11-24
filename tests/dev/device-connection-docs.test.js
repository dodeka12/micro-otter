// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const docsRoot = path.join(repoRoot, 'docs', 'dev');

const PAGES = {
    ui: path.join(docsRoot, 'device-communication', 'device-connection-ui.md'),
    dialog: path.join(docsRoot, 'view-system', 'device-connection-dialog.md'),
    progress: path.join(docsRoot, 'view-system', 'connecting-progress-dialog.md'),
};

describe('device connection docs', () => {
    it('has both pages', () => {
        assert.ok(existsSync(PAGES.ui), 'device-connection-ui.md must exist');
        assert.ok(existsSync(PAGES.dialog), 'device-connection-dialog.md must exist');
        assert.ok(existsSync(PAGES.progress), 'connecting-progress-dialog.md must exist');
    });

    it('resolves every relative Markdown link inside both pages', () => {
        for (const page of Object.values(PAGES)) {
            const content = readFileSync(page, 'utf8');
            const pageDir = path.dirname(page);
            for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
                const target = match[1];
                if (target.startsWith('http') || target.startsWith('#')) {
                    continue;
                }
                const targetPath = target.split('#')[0];
                assert.ok(
                    existsSync(path.resolve(pageDir, targetPath)),
                    `broken link in ${path.basename(page)}: ${target}`
                );
            }
        }
    });

    it('is linked from the docs map, both indexes and the reuse map', () => {
        const readme = readFileSync(path.join(docsRoot, 'README.md'), 'utf8');
        const deviceIndex = readFileSync(
            path.join(docsRoot, 'device-communication', 'index.md'),
            'utf8'
        );
        const viewIndex = readFileSync(path.join(docsRoot, 'view-system', 'index.md'), 'utf8');
        const reuse = readFileSync(
            path.join(docsRoot, 'view-system', 'view-reuse-rules.md'),
            'utf8'
        );

        assert.ok(readme.includes('device-connection-ui.md'), 'docs/dev/README.md links the page');
        assert.ok(deviceIndex.includes('device-connection-ui.md'), 'the device index links the page');
        assert.ok(viewIndex.includes('device-connection-dialog.md'), 'the view index links the page');
        assert.ok(
            viewIndex.includes('connecting-progress-dialog.md'),
            'the view index links the progress page'
        );
        assert.ok(
            reuse.includes('device-connection-dialog-view.ts'),
            'the reuse map names the dialog'
        );
        assert.ok(
            reuse.includes('connecting-progress-dialog-view.ts'),
            'the reuse map names the progress dialog'
        );
    });
});
