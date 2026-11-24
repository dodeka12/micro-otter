// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

/**
 * Helper that mimics the TypeScript parsing logic in _readEmbeddedMetadataBundleFromDevice.
 * This allows unit-testing the parse behaviour without spinning up a real DeviceConnection.
 * @param {unknown} rawValue - Value returned by the embedded metadata probe
 * @returns {{files: Array<object>}|null} Parsed inventory or null when the value is not an array
 */
function parseEmbeddedInventory(rawValue) {
    if (!Array.isArray(rawValue)) return null;
    return {
        files: rawValue
            .filter((e) => e != null && typeof e === 'object')
            .map((e) => ({
                path: typeof e.path === 'string' ? e.path : '',
                packageId: typeof e.packageId === 'string' ? e.packageId : null,
                packageVersion: typeof e.packageVersion === 'string' ? e.packageVersion : null,
                fileKind: typeof e.fileKind === 'string' ? e.fileKind : '',
                source: typeof e.source === 'string' ? e.source : '',
            })),
    };
}

describe('Embedded inventory probe parsing', () => {
    describe('parseEmbeddedInventory (probe payload → EmbeddedInventory)', () => {
        it('returns null when rawValue is null', () => {
            assert.equal(parseEmbeddedInventory(null), null);
        });

        it('returns null when rawValue is undefined', () => {
            assert.equal(parseEmbeddedInventory(undefined), null);
        });

        it('returns null when rawValue is a dict (not a list)', () => {
            // MicroPython would set 'embeddedInventory' to null if the value isn't a list,
            // but guard here anyway.
            assert.equal(parseEmbeddedInventory({ files: [] }), null);
        });

        it('returns null when rawValue is a string', () => {
            assert.equal(parseEmbeddedInventory('invalid'), null);
        });

        it('returns an inventory with empty files when rawValue is an empty list', () => {
            const result = parseEmbeddedInventory([]);
            assert.deepEqual(result, { files: [] });
        });

        it('maps a well-formed entry correctly', () => {
            const raw = [
                {
                    path: 'lib/otter/nodes/tile.py',
                    packageId: 'otter-tile',
                    packageVersion: '1.2.3',
                    fileKind: 'py',
                    source: 'embedded',
                },
            ];
            const result = parseEmbeddedInventory(raw);
            assert.deepEqual(result, {
                files: [
                    {
                        path: 'lib/otter/nodes/tile.py',
                        packageId: 'otter-tile',
                        packageVersion: '1.2.3',
                        fileKind: 'py',
                        source: 'embedded',
                    },
                ],
            });
        });

        it('maps multiple entries', () => {
            const raw = [
                {
                    path: 'a.py',
                    packageId: 'pkg-a',
                    packageVersion: '1.0.0',
                    fileKind: 'py',
                    source: 'embedded',
                },
                {
                    path: 'b.mpy',
                    packageId: 'pkg-b',
                    packageVersion: '2.0.0',
                    fileKind: 'mpy',
                    source: 'precompiled',
                },
            ];
            const result = parseEmbeddedInventory(raw);
            assert.equal(result.files.length, 2);
            assert.equal(result.files[0].path, 'a.py');
            assert.equal(result.files[1].path, 'b.mpy');
        });

        it('uses empty string for missing path field', () => {
            const raw = [
                { packageId: 'pkg-a', packageVersion: '1.0.0', fileKind: 'py', source: 'embedded' },
            ];
            const result = parseEmbeddedInventory(raw);
            assert.equal(result.files[0].path, '');
        });

        it('uses null for missing packageId field', () => {
            const raw = [
                { path: 'a.py', packageVersion: '1.0.0', fileKind: 'py', source: 'embedded' },
            ];
            const result = parseEmbeddedInventory(raw);
            assert.equal(result.files[0].packageId, null);
        });

        it('uses null for missing packageVersion field', () => {
            const raw = [{ path: 'a.py', packageId: 'pkg-a', fileKind: 'py', source: 'embedded' }];
            const result = parseEmbeddedInventory(raw);
            assert.equal(result.files[0].packageVersion, null);
        });

        it('uses null for non-string packageId', () => {
            const raw = [
                {
                    path: 'a.py',
                    packageId: 42,
                    packageVersion: '1.0.0',
                    fileKind: 'py',
                    source: 'embedded',
                },
            ];
            const result = parseEmbeddedInventory(raw);
            assert.equal(result.files[0].packageId, null);
        });

        it('uses empty string for missing fileKind', () => {
            const raw = [
                { path: 'a.py', packageId: 'pkg-a', packageVersion: '1.0.0', source: 'embedded' },
            ];
            const result = parseEmbeddedInventory(raw);
            assert.equal(result.files[0].fileKind, '');
        });

        it('uses empty string for missing source', () => {
            const raw = [
                { path: 'a.py', packageId: 'pkg-a', packageVersion: '1.0.0', fileKind: 'py' },
            ];
            const result = parseEmbeddedInventory(raw);
            assert.equal(result.files[0].source, '');
        });

        it('filters out non-object entries in the list', () => {
            const raw = [
                null,
                'bad',
                42,
                {
                    path: 'good.py',
                    packageId: 'pkg',
                    packageVersion: '1.0.0',
                    fileKind: 'py',
                    source: 'embedded',
                },
            ];
            const result = parseEmbeddedInventory(raw);
            assert.equal(result.files.length, 1);
            assert.equal(result.files[0].path, 'good.py');
        });
    });

    describe('DeviceState.fromDeviceInfo with embeddedInventory', () => {
        it('stores embeddedInventory when provided', () => {
            const inventory = {
                files: [
                    {
                        path: 'lib/tile.py',
                        packageId: 'otter-tile',
                        packageVersion: '1.0.0',
                        fileKind: 'py',
                        source: 'embedded',
                    },
                ],
            };
            const state = DeviceState.fromDeviceInfo({
                runtime: { id: 'rt', name: 'RT', version: '1.0.0' },
                embeddedInventory: inventory,
            });
            assert.deepEqual(state.embeddedInventory, inventory);
        });

        it('stores null embeddedInventory when not provided', () => {
            const state = DeviceState.fromDeviceInfo({
                runtime: { id: 'rt', name: 'RT', version: '1.0.0' },
            });
            assert.equal(state.embeddedInventory, null);
        });

        it('stores null embeddedInventory when explicitly null', () => {
            const state = DeviceState.fromDeviceInfo({
                runtime: { id: 'rt', name: 'RT', version: '1.0.0' },
                embeddedInventory: null,
            });
            assert.equal(state.embeddedInventory, null);
        });

        it('embeddedInventory is included in toObject()', () => {
            const inventory = { files: [] };
            const state = DeviceState.fromDeviceInfo({ embeddedInventory: inventory });
            assert.deepEqual(state.toObject().embeddedInventory, inventory);
        });

        it('embeddedInventory is preserved through update()', () => {
            const inventory = {
                files: [
                    {
                        path: 'a.py',
                        packageId: null,
                        packageVersion: null,
                        fileKind: 'py',
                        source: 'embedded',
                    },
                ],
            };
            const state = DeviceState.fromDeviceInfo({ embeddedInventory: inventory });
            const updated = state.update({ runtimeId: 'new-id' });
            assert.deepEqual(updated.embeddedInventory, inventory);
        });

        it('getChangedFields detects embeddedInventory change', () => {
            const inv1 = { files: [] };
            const inv2 = {
                files: [
                    {
                        path: 'a.py',
                        packageId: null,
                        packageVersion: null,
                        fileKind: 'py',
                        source: 'embedded',
                    },
                ],
            };
            const state1 = DeviceState.fromDeviceInfo({ embeddedInventory: inv1 });
            const state2 = DeviceState.fromDeviceInfo({ embeddedInventory: inv2 });
            const changed = state1.getChangedFields(state2);
            assert.ok(
                changed.includes('embeddedInventory'),
                'embeddedInventory should be in changed fields'
            );
        });

        it('getChangedFields does not flag embeddedInventory when same reference', () => {
            const inv = { files: [] };
            const state1 = DeviceState.fromDeviceInfo({ embeddedInventory: inv });
            const state2 = DeviceState.fromDeviceInfo({ embeddedInventory: inv });
            const changed = state1.getChangedFields(state2);
            assert.ok(
                !changed.includes('embeddedInventory'),
                'embeddedInventory should not be in changed fields'
            );
        });
    });
});
