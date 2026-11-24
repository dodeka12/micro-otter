import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

class MockTransport extends EventTarget {
    constructor() {
        super();
        this.sent = [];
    }

    async send(payload) {
        this.sent.push(payload);

        if (payload === '\r\x01') {
            const encoder = new TextEncoder();
            const marker = encoder.encode('raw REPL; CTRL-B to exit\r\n>');
            this.dispatchEvent(new CustomEvent('data', { detail: { data: marker } }));
        }
    }

    async disconnect() {}

    isConnected() {
        return true;
    }
}

function createConnectedConnection(transport) {
    const connection = new DeviceConnection({
        providers: {},
        logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    connection._state = ConnectionState.CONNECTED;
    connection._activeConnection = transport;

    return connection;
}

describe('DeviceConnection startExecution behavior', () => {
    it('startMain uses soft reset startup path (no raw command execution)', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);

        let executeCodeCalled = false;
        connection.executeCode = async () => {
            executeCodeCalled = true;
        };

        let softResetCalls = 0;
        let softResetOptions = null;
        connection.softReset = async (options) => {
            softResetCalls += 1;
            softResetOptions = options || null;
        };

        connection._isRawRepl = true;

        await connection.startMain();

        assert.equal(executeCodeCalled, false);
        assert.equal(softResetCalls, 1);
        assert.deepEqual(softResetOptions, { startRunning: true });
        assert.equal(transport.sent.length, 0);
    });

    it('startExecution executes provided code path directly', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);

        let executeCodeArgs = null;
        connection.executeCode = async (code) => {
            executeCodeArgs = code;
        };

        let softResetCalls = 0;
        connection.softReset = async () => {
            softResetCalls += 1;
        };

        await connection.startExecution('print(123)');

        assert.equal(softResetCalls, 0);
        assert.equal(executeCodeArgs, 'print(123)');
    });

    it('stopExecution regains raw REPL control after Ctrl+C', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);

        connection._isRawRepl = false;

        await connection.stopExecution();

        assert.equal(connection.isRawRepl(), true);
        assert.ok(transport.sent.includes('\x03'));
        assert.ok(transport.sent.includes('\r\x01'));
    });

    it('coalesces concurrent _enterRawRepl transitions into one transport sequence', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);

        await Promise.all([connection._enterRawRepl(), connection._enterRawRepl()]);

        const ctrlACommands = transport.sent.filter((payload) => payload === '\r\x01');
        const interruptCommands = transport.sent.filter((payload) => payload === '\r\x03');

        assert.equal(ctrlACommands.length, 1);
        assert.equal(interruptCommands.length, 1);
        assert.equal(connection.isRawRepl(), true);
    });

    it('handles disconnect race during raw REPL entry without null transport crash', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);

        transport.send = async (payload) => {
            transport.sent.push(payload);

            if (payload === '\r\x03') {
                connection._activeConnection = null;
                throw new Error('disconnect during raw repl entry');
            }
        };

        await assert.rejects(() => connection._enterRawRepl(), /disconnect during raw repl entry/);

        assert.equal(connection._rawReplTransitionPromise, null);
    });
});
