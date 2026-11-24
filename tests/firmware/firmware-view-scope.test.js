// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const jsRoot = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'js');

function read(relativePath) {
    return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listFiles(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFiles(full));
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
            files.push(full);
        }
    }
    return files;
}

describe('firmware view scope guard', () => {
    it('firmware view and firmware modules never import from deployment/', () => {
        const viewSource = read('src/micro_otter/nodes/html/js/views/firmware-build-view.ts');
        assert.equal(/from\s+['"][^'"]*deployment\//.test(viewSource), false);

        const firmwareFiles = listFiles(path.join(jsRoot, 'firmware'));
        for (const file of firmwareFiles) {
            const content = readFileSync(file, 'utf8');
            assert.equal(
                /from\s+['"][^'"]*deployment\//.test(content),
                false,
                `${path.relative(repoRoot, file)} imports from deployment/`
            );
        }
    });

    it('deployment/ never references the firmware job client or socket', () => {
        const deploymentFiles = listFiles(path.join(jsRoot, 'deployment'));
        for (const file of deploymentFiles) {
            const content = readFileSync(file, 'utf8');
            assert.equal(
                /FirmwareJobClient|\/firmware/.test(content),
                false,
                `${path.relative(repoRoot, file)} references the firmware job surface`
            );
        }
    });

    it('collection-deployment.ts still contains the source-upload fallback literals', () => {
        const source = read('src/micro_otter/nodes/html/js/deployment/collection-deployment.ts');
        assert.ok(source.includes('dynamic'));
        assert.ok(source.includes('override-embedded'));
    });
});
