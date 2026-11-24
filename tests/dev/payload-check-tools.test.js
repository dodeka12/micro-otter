// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Contract tests for the payload documentation and emission tools.
 *
 * Both tools accept a `PAYLOAD_CHECK_ROOT` override so tests can point them at a
 * temporary JavaScript/TypeScript tree instead of the real source.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const JSDOC_TOOL = join(REPO_ROOT, 'tools/check-payload-jsdoc.mjs');
const EMISSION_TOOL = join(REPO_ROOT, 'tools/check-event-payload-emissions.mjs');

function runTool(tool, root = null) {
    const env = { ...process.env };
    if (root) {
        env.PAYLOAD_CHECK_ROOT = root;
    } else {
        delete env.PAYLOAD_CHECK_ROOT;
    }
    return spawnSync(process.execPath, [tool], {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf8',
    });
}

describe('payload contract tools', () => {
    let tempRoot;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'payload-check-tools-'));
    });

    afterEach(() => {
        rmSync(tempRoot, { recursive: true, force: true });
    });

    it('passes both checks against the real tree', () => {
        const jsdoc = runTool(JSDOC_TOOL);
        assert.equal(jsdoc.status, 0, jsdoc.stderr);
        assert.match(jsdoc.stdout, /passed/);
        assert.match(jsdoc.stdout, /JavaScript\/TypeScript/);

        const emissions = runTool(EMISSION_TOOL);
        assert.equal(emissions.status, 0, emissions.stderr);
        assert.match(emissions.stdout, /passed/);
        assert.match(emissions.stdout, /JavaScript\/TypeScript/);
    });

    it('accepts a TypeScript payload with a described @param', () => {
        writeFileSync(
            join(tempRoot, 'sample.ts'),
            [
                '/**',
                ' * Sample payload.',
                ' * @param {string} id - Identifier.',
                ' */',
                'class SamplePayload extends AppPayload {',
                '    constructor(id) {',
                "        super('Sample.Payload.v1');",
                '        this.id = id;',
                '    }',
                '}',
                '',
            ].join('\n')
        );

        const result = runTool(JSDOC_TOOL, tempRoot);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /passed/);
    });

    it('rejects a TypeScript @param without a description', () => {
        writeFileSync(
            join(tempRoot, 'sample.ts'),
            [
                '/**',
                ' * Sample payload.',
                ' * @param {string} id',
                ' */',
                'class SamplePayload extends AppPayload {',
                '    constructor(id) {',
                "        super('Sample.Payload.v1');",
                '        this.id = id;',
                '    }',
                '}',
                '',
            ].join('\n')
        );

        const result = runTool(JSDOC_TOOL, tempRoot);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /sample\.ts/);
        assert.match(result.stderr, /SamplePayload @param id/);
    });

    it('rejects a literal TypeScript payload emission', () => {
        writeFileSync(
            join(tempRoot, 'emitter.ts'),
            [
                'class SamplePayload extends AppPayload {}',
                'class Emitter {',
                '    emit() {',
                "        this._emit('x', { id: 1 });",
                '    }',
                '}',
                '',
            ].join('\n')
        );

        const result = runTool(EMISSION_TOOL, tempRoot);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /emitter\.ts/);
        assert.match(result.stderr, /\._emit\(/);
    });

    it('accepts a typed TypeScript payload emission', () => {
        writeFileSync(
            join(tempRoot, 'emitter.ts'),
            [
                'class SamplePayload extends AppPayload {}',
                'class Emitter {',
                '    emit(payload) {',
                "        this._emit('x', payload);",
                '    }',
                '    emitTyped() {',
                "        this._emit('y', new SamplePayload());",
                '    }',
                '}',
                '',
            ].join('\n')
        );

        const result = runTool(EMISSION_TOOL, tempRoot);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /passed/);
    });
});
