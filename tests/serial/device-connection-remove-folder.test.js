// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// `DeviceConnection.removeFolder()` must report how many entries it removed, because the deploy
// uses that number to decide whether a package folder removal counts as a device change.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

/**
 * Build a connected `DeviceConnection` whose `executeCode` is stubbed.
 * @param {string} [output] - Device output returned for any command
 * @returns {{connection: DeviceConnection, commands: string[], logs: Array<object>}} Fixture
 */
function makeConnection(output = 'REMOVED: 1') {
    const commands = [];
    const logs = [];

    const connection = new DeviceConnection({
        providers: {},
        logger: {
            log: (message, data) => logs.push({ message, data }),
            warn: () => {},
            error: () => {},
        },
    });

    connection._state = ConnectionState.CONNECTED;
    connection._activeConnection = {
        async send() {},
        async disconnect() {},
        isConnected() {
            return true;
        },
        addEventListener() {},
        removeEventListener() {},
    };

    connection.executeCode = async (command) => {
        commands.push(command);
        if (output instanceof Error) {
            throw output;
        }
        return output;
    };

    return { connection, commands, logs };
}

describe('DeviceConnection.removeFolder', () => {
    it('returns the removed entry count reported by the device', async () => {
        const { connection, commands } = makeConnection('REMOVED: 4');

        const removed = await connection.removeFolder('otter_vars');

        assert.equal(removed, 4);
        assert.equal(commands.length, 1);
        assert.ok(
            commands[0].includes('_otter_remove("otter_vars", True)'),
            `script must remove recursively: ${commands[0]}`
        );
    });

    it('returns 0 when the folder does not exist', async () => {
        const { connection } = makeConnection('REMOVED: 0');

        assert.equal(await connection.removeFolder('otter_vars'), 0);
    });

    it('passes recursive=False for empty-only removal', async () => {
        const { connection, commands } = makeConnection('REMOVED: 1');

        const removed = await connection.removeFolder('otter_vars', { recursive: false });

        assert.equal(removed, 1);
        assert.ok(
            commands[0].includes('_otter_remove("otter_vars", False)'),
            `script must not walk the tree: ${commands[0]}`
        );
    });

    it('rejects with the device error message and logs folder-delete-failed', async () => {
        const { connection, logs } = makeConnection('ERROR: EPERM');

        await assert.rejects(() => connection.removeFolder('otter_vars'), /EPERM/);

        const failure = logs.find((entry) =>
            String(entry.message).includes('folder-delete-failed')
        );
        assert.ok(failure, 'failure must be logged');
        assert.equal(failure.data.path, 'otter_vars');
    });

    it('rejects when the device output cannot be parsed', async () => {
        const { connection } = makeConnection('OK');

        await assert.rejects(
            () => connection.removeFolder('otter_vars'),
            /Unexpected removeFolder output/
        );
    });

    it('rejects when not connected and never executes code', async () => {
        const { connection, commands } = makeConnection('REMOVED: 1');
        connection._state = ConnectionState.DISCONNECTED;

        await assert.rejects(() => connection.removeFolder('otter_vars'), /Not connected/);
        assert.deepEqual(commands, []);
    });

    it('escapes the folder path in the generated script', async () => {
        const { connection, commands } = makeConnection('REMOVED: 1');

        await connection.removeFolder('my folder');

        assert.ok(
            commands[0].includes('_otter_remove("my folder", True)'),
            `path must be quoted: ${commands[0]}`
        );
    });
});
