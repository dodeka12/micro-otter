import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    calculateFileHash,
    compareHashes,
    downloadHashManifest,
    resolveFirmwareBundledPackageIds,
    resolveFrozenAddonVersions,
    uploadHashManifest,
} from '../../src/micro_otter/nodes/html/js/deployment/deployment-utils.js';
import { createMockDeviceConnection } from '../helpers/mocks/device.js';

describe('deployment utils', () => {
    describe('resolveFirmwareBundledPackageIds()', () => {
        it('unions global, add-on and frozen-add-on package ids', () => {
            const ids = resolveFirmwareBundledPackageIds(['core'], {
                nodePackages: { core: '1.0.0' },
                addonPackages: { pulse: '1.0.0' },
                frozenAddons: { hello: { variant: 'py', version: '1.0.0' } },
            });

            assert.deepEqual([...ids].sort(), ['core', 'hello', 'pulse']);
        });

        it('returns only the global list when no constituent versions exist', () => {
            const ids = resolveFirmwareBundledPackageIds(['core'], null);
            assert.deepEqual([...ids], ['core']);
        });
    });

    describe('resolveFrozenAddonVersions()', () => {
        it('prefers the frozenAddons version and falls back to addonPackages', () => {
            const versions = resolveFrozenAddonVersions({
                addonPackages: { pulse: '1.0.0', hello: '0.9.0' },
                frozenAddons: { pulse: { variant: 'viper', version: '1.0.0' } },
            });

            assert.deepEqual(versions, { pulse: '1.0.0', hello: '0.9.0' });
        });

        it('returns an empty map without constituent versions', () => {
            assert.deepEqual(resolveFrozenAddonVersions(null), {});
        });
    });

    describe('calculateFileHash()', () => {
        it('returns expected SHA-256 for string and Uint8Array input', async () => {
            const text = 'test content';
            const asText = await calculateFileHash(text);
            const asBytes = await calculateFileHash(new TextEncoder().encode(text));

            assert.equal(
                asText,
                '6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72'
            );
            assert.equal(asBytes, asText);
        });

        it('returns a 64-character lowercase hex digest', async () => {
            const hash = await calculateFileHash('any content');

            assert.equal(hash.length, 64);
            assert.match(hash, /^[0-9a-f]{64}$/);
        });
    });

    describe('downloadHashManifest()', () => {
        it('parses plain JSON map from device output', async () => {
            const connection = createMockDeviceConnection({
                readTextFile: async () => '{"a.py":"h1","b.py":"h2"}',
            });

            const result = await downloadHashManifest(connection, '/tools/hashes.json');
            assert.deepEqual(result, { 'a.py': 'h1', 'b.py': 'h2' });
        });

        it('parses marker-wrapped payload and python bytes-literal payload', async () => {
            const wrapped = `MO_HASH_START b'{"file.py": "hash123"}' MO_HASH_END`;
            const connection = createMockDeviceConnection({
                readTextFile: async () => wrapped,
            });

            const result = await downloadHashManifest(connection, '/tools/hashes.json');
            assert.deepEqual(result, { 'file.py': 'hash123' });
        });

        it('returns empty object for malformed or non-string-value manifests', async () => {
            const malformedConnection = createMockDeviceConnection({
                readTextFile: async () => 'not json',
            });
            const wrongShapeConnection = createMockDeviceConnection({
                readTextFile: async () => '{"a.py":123}',
            });

            assert.deepEqual(
                await downloadHashManifest(malformedConnection, '/tools/hashes.json'),
                {}
            );
            assert.deepEqual(
                await downloadHashManifest(wrongShapeConnection, '/tools/hashes.json'),
                {}
            );
        });
    });

    describe('uploadHashManifest()', () => {
        it('ensures parent directory and writes pretty JSON manifest', async () => {
            const connection = createMockDeviceConnection();
            const hashes = {
                'tools/lib/a.py': 'h1',
                'tools/lib/b.py': 'h2',
            };

            await uploadHashManifest(connection, 'tools/hashes.json', hashes);

            assert.deepEqual(connection.calls.ensureDirectory, ['tools']);
            assert.equal(connection.calls.writeTextFile.length, 1);
            assert.equal(connection.calls.writeTextFile[0].path, 'tools/hashes.json');
            assert.equal(connection.calls.writeTextFile[0].content, JSON.stringify(hashes, null, 2));
        });

        it('does not ensure directory for root-level manifest path', async () => {
            const connection = createMockDeviceConnection();
            await uploadHashManifest(connection, 'hashes.json', { 'a.py': 'h' });

            assert.deepEqual(connection.calls.ensureDirectory, []);
            assert.equal(connection.calls.writeTextFile[0].path, 'hashes.json');
        });
    });

    describe('compareHashes()', () => {
        it('returns changed and new host files, ignores device-only files', () => {
            const hostHashes = {
                'a.py': 'same',
                'b.py': 'new-b',
                'c.py': 'new-c',
            };
            const deviceHashes = {
                'a.py': 'same',
                'b.py': 'old-b',
                'd.py': 'device-only',
            };

            const changed = compareHashes(hostHashes, deviceHashes);
            assert.deepEqual(changed.sort(), ['b.py', 'c.py']);
        });
    });
});
