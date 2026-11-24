// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HashManifestManager } from '../../src/micro_otter/nodes/html/js/deployment/hash-manifest-manager.js';

describe('HashManifestManager', () => {
    let manager;
    let mockConnection;

    beforeEach(() => {
        mockConnection = {
            readTextFile: async (_path) => {
                throw new Error('File not found');
            },
            writeTextFile: async (_path, _content) => {},
            stat: async (_path) => {
                throw new Error('File not found');
            },
        };
        manager = new HashManifestManager(mockConnection);
    });

    describe('constructor', () => {
        it('requires DeviceConnection parameter', () => {
            assert.throws(() => {
                new HashManifestManager();
            }, /DeviceConnection is required/);
        });

        it('initializes with null manifest and not dirty', () => {
            assert.equal(manager.isLoaded(), false);
            assert.equal(manager.isDirty(), false);
        });
    });

    describe('load()', () => {
        it('loads and parses manifest from device', async () => {
            const manifest = {
                version: '1.0.0',
                created: '2026-02-12T10:00:00Z',
                updated: '2026-02-12T10:00:00Z',
                runtime: {
                    runtimeId: 'general',
                    version: '1.0.0',
                    files: { 'main.py': 'hash123' },
                },
            };
            mockConnection.readTextFile = async () => JSON.stringify(manifest);

            await manager.load();

            assert.equal(manager.isLoaded(), true);
            assert.equal(manager.getHash('runtime', 'main.py'), 'hash123');
            assert.equal(manager.isDirty(), false);
        });

        it('sets manifest to null if file does not exist', async () => {
            mockConnection.readTextFile = async () => {
                const error = new Error('File not found');
                error.message = 'ENOENT: no such file';
                throw error;
            };

            await manager.load();

            assert.equal(manager.isLoaded(), false);
            assert.equal(manager.isDirty(), false);
        });

        it('throws on device read error (non-ENOENT)', async () => {
            mockConnection.readTextFile = async () => {
                throw new Error('Device disconnected');
            };

            await assert.rejects(async () => await manager.load(), /Failed to load hash manifest/);
        });

        it('treats low-memory read failure as missing manifest', async () => {
            mockConnection.readTextFile = async () => {
                throw new Error('memory allocation failed, allocating 4096 bytes');
            };

            await manager.load();

            assert.equal(manager.isLoaded(), false);
            assert.equal(manager.isDirty(), false);
        });

        it('treats invalid JSON as missing manifest', async () => {
            mockConnection.readTextFile = async () => 'invalid json';

            await manager.load();

            assert.equal(manager.isLoaded(), false);
            assert.equal(manager.isDirty(), false);
        });

        it('treats truncated JSON as missing manifest', async () => {
            mockConnection.readTextFile = async () =>
                '{"version":"1.0.0","created":"2026-01-01T00:00:00Z","updated":"2026-01-01T00:00:00Z","collection":{"files":{"app/main_loop.py":"abc123"}';

            await manager.load();

            assert.equal(manager.isLoaded(), false);
            assert.equal(manager.isDirty(), false);
        });

        it('parses manifest when payload has REPL/protocol noise around JSON', async () => {
            const manifest = {
                version: '1.0.0',
                created: '2026-02-12T10:00:00Z',
                updated: '2026-02-12T10:00:00Z',
                runtime: {
                    files: { 'main.py': 'hash123' },
                },
            };
            const noisy = `MPY: soft reboot\nraw REPL; CTRL-B to exit\r\n>${JSON.stringify(manifest)}\r\n>`;
            mockConnection.readTextFile = async () => noisy;

            await manager.load();

            assert.equal(manager.isLoaded(), true);
            assert.equal(manager.getHash('runtime', 'main.py'), 'hash123');
        });

        it('parses manifest when payload is Python bytes literal', async () => {
            const manifest = {
                version: '1.0.0',
                created: '2026-02-12T10:00:00Z',
                updated: '2026-02-12T10:00:00Z',
                tools: {
                    files: { 'tools/log.py': 'hash456' },
                },
            };
            const payload = `b'${JSON.stringify(manifest).replace(/'/g, "\\'")}'`;
            mockConnection.readTextFile = async () => payload;

            await manager.load();

            assert.equal(manager.isLoaded(), true);
            assert.equal(manager.getHash('tools', 'tools/log.py'), 'hash456');
        });
    });

    describe('save()', () => {
        it('writes manifest to device when dirty', async () => {
            let written = null;
            mockConnection.writeTextFile = async (path, content) => {
                written = { path, content };
            };

            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'hash123' });
            await manager.save();

            assert.equal(written.path, '/.micro-otter-sync-manifest');
            assert(written.content.includes('"main.py"'));
            assert(written.content.includes('"hash123"'));
            assert.equal(manager.isDirty(), false);
        });

        it('skips write when not dirty', async () => {
            let writeCount = 0;
            mockConnection.writeTextFile = async () => {
                writeCount++;
            };

            manager.createEmpty();
            await manager.save(); // First save marks dirty
            assert.equal(writeCount, 1);

            await manager.save(); // Second save should skip
            assert.equal(writeCount, 1);
        });

        it('updates timestamp on save', async () => {
            mockConnection.writeTextFile = async () => {};
            const before = new Date();

            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'hash' });
            await manager.save();

            const updated = new Date(manager.getUpdated());
            assert(updated >= before);
        });

        it('throws if manifest is null', async () => {
            await assert.rejects(async () => await manager.save(), /Cannot save null manifest/);
        });
    });

    describe('exists()', () => {
        it('returns true if manifest exists on device', async () => {
            mockConnection.readTextFile = async (path) => {
                assert.equal(path, '/.micro-otter-sync-manifest');
                return '{"version": 1}';
            };

            const result = await manager.exists();
            assert.equal(result, true);
        });

        it('returns false if manifest does not exist', async () => {
            mockConnection.readTextFile = async () => {
                throw new Error('File not found');
            };

            const result = await manager.exists();
            assert.equal(result, false);
        });
    });

    describe('createEmpty()', () => {
        it('creates empty manifest with version and timestamps', () => {
            const before = new Date();
            manager.createEmpty();
            const after = new Date();

            assert.equal(manager.isLoaded(), true);
            assert.equal(manager.getVersion(), '1.0.0');
            assert.equal(manager.isDirty(), true);

            const created = new Date(manager.getCreated());
            assert(created >= before && created <= after);
        });
    });

    describe('reset()', () => {
        it('resets to null manifest and not dirty', () => {
            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'hash' });

            manager.reset();

            assert.equal(manager.isLoaded(), false);
            assert.equal(manager.isDirty(), false);
        });
    });

    describe('needsUpload()', () => {
        beforeEach(() => {
            manager.createEmpty();
            manager.updateHashes('runtime', {
                'main.py': 'hash123',
                'boot.py': 'hash456',
            });
        });

        it('returns false if hash matches', () => {
            assert.equal(manager.needsUpload('runtime', 'main.py', 'hash123'), false);
        });

        it('returns true if hash differs', () => {
            assert.equal(manager.needsUpload('runtime', 'main.py', 'hash999'), true);
        });

        it('returns true if file not in manifest', () => {
            assert.equal(manager.needsUpload('runtime', 'new.py', 'hash123'), true);
        });

        it('returns true if section missing', () => {
            assert.equal(manager.needsUpload('tools', 'log.py', 'hash123'), true);
        });

        it('returns true if manifest not loaded', () => {
            manager.reset();
            assert.equal(manager.needsUpload('runtime', 'main.py', 'hash123'), true);
        });
    });

    describe('getHash()', () => {
        beforeEach(() => {
            manager.createEmpty();
            manager.updateHashes('runtime', {
                'main.py': 'hash123',
            });
        });

        it('returns hash for existing file', () => {
            assert.equal(manager.getHash('runtime', 'main.py'), 'hash123');
        });

        it('returns null for non-existent file', () => {
            assert.equal(manager.getHash('runtime', 'missing.py'), null);
        });

        it('returns null for non-existent section', () => {
            assert.equal(manager.getHash('tools', 'log.py'), null);
        });

        it('returns null if manifest not loaded', () => {
            manager.reset();
            assert.equal(manager.getHash('runtime', 'main.py'), null);
        });
    });

    describe('getFiles()', () => {
        beforeEach(() => {
            manager.createEmpty();
            manager.updateHashes('runtime', {
                'main.py': 'hash1',
                'boot.py': 'hash2',
            });
        });

        it('returns all files in section', () => {
            const files = manager.getFiles('runtime');
            assert.deepEqual(files, {
                'main.py': 'hash1',
                'boot.py': 'hash2',
            });
        });

        it('returns empty object for missing section', () => {
            const files = manager.getFiles('tools');
            assert.deepEqual(files, {});
        });

        it('returns empty object if manifest not loaded', () => {
            manager.reset();
            const files = manager.getFiles('runtime');
            assert.deepEqual(files, {});
        });
    });

    describe('updateHashes()', () => {
        it('creates manifest if null', () => {
            manager.updateHashes('runtime', { 'main.py': 'hash123' });

            assert.equal(manager.isLoaded(), true);
            assert.equal(manager.getHash('runtime', 'main.py'), 'hash123');
        });

        it('creates section if missing', () => {
            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'hash123' });

            assert.equal(manager.getHash('runtime', 'main.py'), 'hash123');
        });

        it('updates hashes for section', () => {
            manager.createEmpty();

            manager.updateHashes('runtime', {
                'main.py': 'hash123',
                'boot.py': 'hash456',
            });

            assert.equal(manager.getHash('runtime', 'main.py'), 'hash123');
            assert.equal(manager.getHash('runtime', 'boot.py'), 'hash456');
        });

        it('marks manifest as dirty', () => {
            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'hash123' });

            assert.equal(manager.isDirty(), true);
        });

        it('merges with existing section', () => {
            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'oldHash' });
            manager.updateHashes('runtime', { 'boot.py': 'newHash' });

            assert.equal(manager.getHash('runtime', 'main.py'), 'oldHash');
            assert.equal(manager.getHash('runtime', 'boot.py'), 'newHash');
        });

        it('updates section metadata', () => {
            manager.createEmpty();
            manager.updateHashes(
                'runtime',
                { 'main.py': 'hash' },
                {
                    runtimeId: 'general',
                    version: '1.0.0',
                }
            );

            const manifest = JSON.parse(
                JSON.stringify(manager._manifest) // Access internal for testing
            );
            assert.equal(manifest.runtime.runtimeId, 'general');
            assert.equal(manifest.runtime.version, '1.0.0');
        });
    });

    describe('removeSection()', () => {
        beforeEach(() => {
            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'hash1' });
            manager.updateHashes('tools', { 'log.py': 'hash2' });
        });

        it('removes section and marks dirty', () => {
            manager.removeSection('runtime');

            assert.equal(manager.getHash('runtime', 'main.py'), null);
            assert.equal(manager.getHash('tools', 'log.py'), 'hash2'); // Other section unaffected
            assert.equal(manager.isDirty(), true);
        });

        it('does nothing if section does not exist', () => {
            manager.removeSection('nonexistent');

            assert.equal(manager.isDirty(), true); // Still dirty from creation
        });

        it('does nothing if manifest not loaded', () => {
            manager.reset();
            manager.removeSection('runtime');

            assert.equal(manager.isLoaded(), false);
        });
    });

    describe('removeFile()', () => {
        beforeEach(() => {
            manager.createEmpty();
            manager.updateHashes('runtime', {
                'main.py': 'hash1',
                'boot.py': 'hash2',
            });
        });

        it('removes file and marks dirty', () => {
            manager.removeFile('runtime', 'main.py');

            assert.equal(manager.getHash('runtime', 'main.py'), null);
            assert.equal(manager.getHash('runtime', 'boot.py'), 'hash2'); // Other file unaffected
            assert.equal(manager.isDirty(), true);
        });

        it('does nothing if file does not exist', () => {
            manager.removeFile('runtime', 'nonexistent.py');

            assert.equal(manager.isDirty(), true); // Still dirty from creation
        });

        it('does nothing if section does not exist', () => {
            manager.removeFile('nonexistent', 'file.py');

            assert.equal(manager.isDirty(), true); // Still dirty from creation
        });
    });

    describe('state queries', () => {
        it('getVersion returns version when loaded', () => {
            manager.createEmpty();
            assert.equal(manager.getVersion(), '1.0.0');
        });

        it('getVersion returns null when not loaded', () => {
            assert.equal(manager.getVersion(), null);
        });

        it('getCreated returns timestamp when loaded', () => {
            manager.createEmpty();
            assert(typeof manager.getCreated() === 'string');
        });

        it('getCreated returns null when not loaded', () => {
            assert.equal(manager.getCreated(), null);
        });

        it('getUpdated returns timestamp when loaded', () => {
            manager.createEmpty();
            assert(typeof manager.getUpdated() === 'string');
        });

        it('getUpdated returns null when not loaded', () => {
            assert.equal(manager.getUpdated(), null);
        });
    });

    describe('multiple sections', () => {
        it('supports runtime, tools, and collection sections independently', () => {
            manager.createEmpty();

            manager.updateHashes('runtime', { 'main.py': 'hash1' });
            manager.updateHashes('tools', { 'tools/log.py': 'hash2' });
            manager.updateHashes('collection', { 'collection/main.py': 'hash3' });

            assert.equal(manager.getHash('runtime', 'main.py'), 'hash1');
            assert.equal(manager.getHash('tools', 'tools/log.py'), 'hash2');
            assert.equal(manager.getHash('collection', 'collection/main.py'), 'hash3');
        });

        it('isolates sections from each other', () => {
            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'hash1' });
            manager.updateHashes('tools', { 'main.py': 'hash2' });

            assert.equal(manager.getHash('runtime', 'main.py'), 'hash1');
            assert.equal(manager.getHash('tools', 'main.py'), 'hash2');
        });
    });

    describe('full workflow', () => {
        it('handles complete load-modify-save cycle', async () => {
            let savedContent = null;
            mockConnection.writeTextFile = async (path, content) => {
                savedContent = content;
            };

            // Create and save initial manifest
            manager.createEmpty();
            manager.updateHashes('runtime', { 'main.py': 'hash1' });
            await manager.save();

            assert.equal(manager.isDirty(), false);

            // Load it back
            mockConnection.readTextFile = async () => savedContent;
            manager.reset();
            await manager.load();

            assert.equal(manager.getHash('runtime', 'main.py'), 'hash1');
            assert.equal(manager.isDirty(), false);

            // Modify and save again
            manager.updateHashes('tools', { 'tools/log.py': 'hash2' });
            assert.equal(manager.isDirty(), true);

            await manager.save();
            assert.equal(manager.isDirty(), false);

            // Verify both sections present
            const finalManifest = JSON.parse(savedContent);
            assert.equal(finalManifest.runtime.files['main.py'], 'hash1');
            assert.equal(finalManifest.tools.files['tools/log.py'], 'hash2');
        });
    });
});
