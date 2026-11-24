import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

function createConnectionWithMockTransport() {
    const sent = [];
    let disconnectCalls = 0;

    const mockTransport = {
        async send(payload) {
            sent.push(payload);
        },
        async disconnect() {
            disconnectCalls += 1;
        },
        isConnected() {
            return true;
        },
        addEventListener() {},
        removeEventListener() {},
    };

    const connection = new DeviceConnection({
        providers: {},
        logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    connection._state = ConnectionState.CONNECTED;
    connection._activeConnection = mockTransport;

    return {
        connection,
        sent,
        getDisconnectCalls: () => disconnectCalls,
    };
}

describe('DeviceConnection hard reset', () => {
    it('sends raw-repl hard reset command and disconnects', async () => {
        const { connection, sent, getDisconnectCalls } = createConnectionWithMockTransport();
        connection._isRawRepl = true;

        await connection.hardReset();

        assert.equal(sent.length, 1);
        assert.equal(sent[0], 'import machine; machine.reset()\x04');
        assert.equal(getDisconnectCalls(), 1);
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
    });

    it('sends friendly-repl hard reset command and disconnects', async () => {
        const { connection, sent, getDisconnectCalls } = createConnectionWithMockTransport();
        connection._isRawRepl = false;

        await connection.hardReset();

        assert.equal(sent.length, 1);
        assert.equal(sent[0], 'import machine; machine.reset()\r\n');
        assert.equal(getDisconnectCalls(), 1);
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
    });
});
