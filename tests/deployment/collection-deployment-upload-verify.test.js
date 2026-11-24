// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

function createDeployment(deviceConnectionOverrides = {}) {
    const sentFiles = [];

    const deployment = new CollectionDeployment({
        deviceConnection: {
            isExecutionRunning() {
                return false;
            },
            async readTextFile() {
                throw new Error('ENOENT: no such file');
            },
            async writeTextFile() {},
            async sendFile(path) {
                sentFiles.push(path);
            },
            async calculateHash() {
                return null;
            },
            async softReset() {},
            async deleteFile() {},
            async deleteFolderRecursive() {},
            ...deviceConnectionOverrides,
        },
        deviceState: {
            connected: true,
            runtimeInstalled: true,
            runtimeId: 'general',
        },
        updateDeviceState() {},
        collectionManager: {
            async transpileCollection() {
                return { code: 'print(1)', assets: {} };
            },
        },
        runtimeCollection: {
            getRuntime() {
                return { id: 'general', resolvedFilesystem: [] };
            },
        },
        transpiler: {},
    });

    deployment._hashManager = {
        async load() {},
        getFiles() {
            return {};
        },
        prepareFile() {
            return { needsUpload: true, hash: 'a'.repeat(64) };
        },
        getFilesToUpload() {
            return [];
        },
        getStagedHash() {
            return null;
        },
        commitStaging() {},
        async save() {},
    };

    return { deployment, sentFiles };
}

describe('CollectionDeployment upload verification', () => {
    it('uploads once when the device hash matches the expected hash', async () => {
        const expectedHash = 'a'.repeat(64);
        const { deployment, sentFiles } = createDeployment({
            async calculateHash() {
                return expectedHash;
            },
        });

        await deployment._uploadAndVerify('app/main_loop.py', 'print(1)', expectedHash);

        assert.deepEqual(sentFiles, ['app/main_loop.py']);
    });

    it('retries and succeeds when the first device hash mismatches', async () => {
        const expectedHash = 'a'.repeat(64);
        const wrongHash = 'b'.repeat(64);
        let calculateHashCalls = 0;

        const { deployment, sentFiles } = createDeployment({
            async calculateHash() {
                calculateHashCalls++;
                return calculateHashCalls === 1 ? wrongHash : expectedHash;
            },
        });

        await deployment._uploadAndVerify('app/main_loop.py', 'print(1)', expectedHash);

        assert.equal(sentFiles.length, 2);
        assert.equal(calculateHashCalls, 2);
    });

    it('throws after exhausting verification retries', async () => {
        const expectedHash = 'a'.repeat(64);
        const wrongHash = 'b'.repeat(64);

        const { deployment, sentFiles } = createDeployment({
            async calculateHash() {
                return wrongHash;
            },
        });

        await assert.rejects(
            () => deployment._uploadAndVerify('app/main_loop.py', 'print(1)', expectedHash),
            /Upload verification failed for app\/main_loop.py after 4 attempts/
        );

        assert.equal(sentFiles.length, 4);
    });

    it('skips verification when calculateHash is unavailable', async () => {
        const { deployment, sentFiles } = createDeployment({
            calculateHash: undefined,
        });

        await deployment._uploadAndVerify('app/main_loop.py', 'print(1)');

        assert.equal(sentFiles.length, 1);
    });

    it('skips verification when the device hash is not a valid sha256 digest', async () => {
        const { deployment, sentFiles } = createDeployment({
            async calculateHash() {
                return 'not-a-real-hash';
            },
        });

        await deployment._uploadAndVerify('app/main_loop.py', 'print(1)');

        assert.equal(sentFiles.length, 1);
    });
});
