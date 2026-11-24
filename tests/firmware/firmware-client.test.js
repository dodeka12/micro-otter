// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    FirmwareJobClient,
    resolveFirmwareSocketUrl,
} from '../../src/micro_otter/nodes/html/js/firmware/firmware-client.js';

function createFakeSocket() {
    const listeners = {};
    const socket = {
        readyState: 0,
        sent: [],
        closed: false,
        addEventListener(type, listener) {
            (listeners[type] = listeners[type] || []).push(listener);
        },
        send(data) {
            socket.sent.push(data);
        },
        close() {
            socket.closed = true;
        },
        emit(type, event = {}) {
            for (const listener of listeners[type] || []) {
                listener(event);
            }
        },
    };
    return socket;
}

async function openClient(socket) {
    const client = new FirmwareJobClient();
    const connecting = client.connect({ webSocketFactory: () => socket });
    socket.readyState = 1;
    socket.emit('open');
    await connecting;
    return client;
}

describe('resolveFirmwareSocketUrl', () => {
    it('rewrites localhost to 127.0.0.1 and uses ws', () => {
        assert.equal(
            resolveFirmwareSocketUrl({ protocol: 'http:', hostname: 'localhost', port: '5173' }),
            'ws://127.0.0.1:5173/firmware'
        );
    });

    it('uses wss for https and preserves other hostnames', () => {
        assert.equal(
            resolveFirmwareSocketUrl({ protocol: 'https:', hostname: 'example.com', port: '' }),
            'wss://example.com/firmware'
        );
        assert.equal(
            resolveFirmwareSocketUrl({ protocol: 'http:', hostname: '192.168.1.5', port: '8000' }),
            'ws://192.168.1.5:8000/firmware'
        );
    });
});

describe('FirmwareJobClient', () => {
    it('throws on requests before the socket is open', () => {
        const client = new FirmwareJobClient();
        assert.throws(() => client.startCompile({ runtimeId: 'general', board: 'esp32' }), /not open/);
        assert.throws(() => client.listFirmware(), /not open/);
        assert.throws(() => client.deleteFirmware({ firmwarePath: '/x.bin' }), /not open/);
        assert.throws(() => client.cancel(), /not open/);
    });

    it('serialises compile.start with exactly the given keys', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        client.startCompile({
            runtimeId: 'general',
            board: 'esp32',
            packageIds: ['core'],
            modulePackagingMode: 'compiled-mpy',
            cleanBuild: false,
        });
        assert.deepEqual(JSON.parse(socket.sent[0]), {
            type: 'compile.start',
            runtimeId: 'general',
            board: 'esp32',
            packageIds: ['core'],
            modulePackagingMode: 'compiled-mpy',
            cleanBuild: false,
        });
    });

    it('sends a bare cancel frame', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        client.cancel();
        assert.deepEqual(JSON.parse(socket.sent[0]), { type: 'cancel' });
    });

    it('sends firmware.list and firmware.delete frames', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        client.listFirmware();
        client.deleteFirmware({ firmwarePath: '/opt/fw/a.bin' });
        assert.deepEqual(JSON.parse(socket.sent[0]), { type: 'firmware.list' });
        assert.deepEqual(JSON.parse(socket.sent[1]), {
            type: 'firmware.delete',
            firmwarePath: '/opt/fw/a.bin',
        });
    });

    it('sends a firmware.import frame with a path or url', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        client.importFirmware({ path: '/opt/fw/a.firmware.zip', force: true });
        client.importFirmware({ url: 'https://x/a.firmware.zip' });
        assert.deepEqual(JSON.parse(socket.sent[0]), {
            type: 'firmware.import',
            path: '/opt/fw/a.firmware.zip',
            force: true,
        });
        assert.deepEqual(JSON.parse(socket.sent[1]), {
            type: 'firmware.import',
            url: 'https://x/a.firmware.zip',
        });
    });

    it('sends a firmware.import-binary frame with a path or url and targetId', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        client.importFirmwareBinary({ path: '/opt/fw/esp32.bin', targetId: 'esp32', force: true });
        client.importFirmwareBinary({ url: 'https://x/esp32.bin', targetId: 'esp32' });
        assert.deepEqual(JSON.parse(socket.sent[0]), {
            type: 'firmware.import-binary',
            path: '/opt/fw/esp32.bin',
            targetId: 'esp32',
            force: true,
        });
        assert.deepEqual(JSON.parse(socket.sent[1]), {
            type: 'firmware.import-binary',
            url: 'https://x/esp32.bin',
            targetId: 'esp32',
        });
    });

    it('sends a firmware.export frame', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        client.exportFirmware({ firmwarePath: '/opt/fw/a.bin', destinationDir: '/tmp/out' });
        assert.deepEqual(JSON.parse(socket.sent[0]), {
            type: 'firmware.export',
            firmwarePath: '/opt/fw/a.bin',
            destinationDir: '/tmp/out',
        });
    });

    it('sends addon.install frames with and without force', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        client.installAddon({ path: '/tmp/my-nodes.zip' });
        client.installAddon({ url: 'https://x/my-nodes.zip', force: true });
        assert.deepEqual(JSON.parse(socket.sent[0]), {
            type: 'addon.install',
            path: '/tmp/my-nodes.zip',
        });
        assert.deepEqual(JSON.parse(socket.sent[1]), {
            type: 'addon.install',
            url: 'https://x/my-nodes.zip',
            force: true,
        });
    });

    it('sends an addon.uninstall frame with the ids', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        client.uninstallAddon({ packageIds: ['pulse', 'flashy'] });
        assert.deepEqual(JSON.parse(socket.sent[0]), {
            type: 'addon.uninstall',
            packageIds: ['pulse', 'flashy'],
        });
    });

    it('throws on add-on frames before the socket is open', () => {
        const client = new FirmwareJobClient();
        assert.throws(() => client.installAddon({ path: 'a.zip' }), /not open/);
        assert.throws(() => client.uninstallAddon({ packageIds: ['pulse'] }), /not open/);
    });

    it('is idempotent on connect while open', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        await client.connect({ webSocketFactory: () => socket });
        assert.equal(client.isOpen(), true);
    });

    it('emits frame for object messages and ignores non-JSON/null', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        const frames = [];
        client.on('frame', (event) => frames.push(event.detail.frame));

        socket.emit('message', { data: JSON.stringify({ type: 'status', state: 'running' }) });
        socket.emit('message', { data: 'not json' });
        socket.emit('message', { data: 'null' });
        socket.emit('message', { data: JSON.stringify('a string') });

        assert.equal(frames.length, 1);
        assert.deepEqual(frames[0], { type: 'status', state: 'running' });
    });

    it('emits socketState false on close()', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        const states = [];
        client.on('socketState', (event) => states.push(event.detail));
        client.close();
        assert.equal(states[0].open, false);
        assert.equal(states[0].reason, 'closed-by-client');
        assert.equal(socket.closed, true);
    });

    it('emits socketState false on an unexpected server hang-up', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        const states = [];
        client.on('socketState', (event) => states.push(event.detail));
        socket.emit('close');
        assert.equal(states[0].open, false);
        assert.equal(states[0].reason, 'closed');
        assert.equal(client.isOpen(), false);
    });
});


describe('FirmwareJobClient.listDirectory', () => {
    it('resolves on the matching requestId and ignores a foreign one', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        const pending = client.listDirectory({ requestId: 'r1', path: '/tmp' });
        socket.emit('message', {
            data: JSON.stringify({
                type: 'fs.list.result',
                requestId: 'other',
                path: '/other',
                entries: [],
            }),
        });
        socket.emit('message', {
            data: JSON.stringify({
                type: 'fs.list.result',
                requestId: 'r1',
                path: '/tmp',
                parent: '/',
                roots: [{ id: 'home', path: '/home' }],
                entries: [{ name: 'a.zip', path: '/tmp/a.zip', kind: 'file', sizeBytes: 1, modifiedAt: '1.0' }],
            }),
        });
        const result = await pending;
        assert.equal(result.path, '/tmp');
        assert.equal(result.entries.length, 1);
    });

    it('rejects fs.list.error with the code attached', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        const pending = client.listDirectory({ requestId: 'r1', path: '/missing' });
        socket.emit('message', {
            data: JSON.stringify({
                type: 'fs.list.error',
                requestId: 'r1',
                code: 'fs-not-found',
                message: 'does not exist',
                hint: 'pick another',
            }),
        });
        await assert.rejects(pending, (error) => error.code === 'fs-not-found');
    });

    it('rejects a pending listing when the socket closes', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        const pending = client.listDirectory({ requestId: 'r1', path: '/tmp' });
        socket.emit('close');
        await assert.rejects(pending, /closed/);
    });

    it('serialises an fs.list frame with only the provided fields', async () => {
        const socket = createFakeSocket();
        const client = await openClient(socket);
        const pending = client.listDirectory({ requestId: 'r1' });
        assert.deepEqual(JSON.parse(socket.sent[0]), { type: 'fs.list', requestId: 'r1' });
        socket.emit('message', {
            data: JSON.stringify({ type: 'fs.list.result', requestId: 'r1', path: '/tmp', entries: [] }),
        });
        await pending;
    });
});

