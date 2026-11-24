// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Raw-REPL entry and teardown tests.
 *
 * Entry must behave like `mpremote.enter_raw_repl`: interrupt, wait for an idle
 * line, enter raw mode and resolve on the full banner including its prompt. A
 * failed attempt is retried, a transport failure is not, and teardown returns
 * the board to the friendly REPL instead of leaving it in raw mode.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

const encoder = new TextEncoder();

/** Banner including the prompt, as printed by the pinned runtime. */
const RAW_REPL_BANNER = 'raw REPL; CTRL-B to exit\r\n>';

/**
 * Transport double that answers raw-REPL entry control bytes.
 *
 * `onInterrupt` and `onEnter` let a test decide what each attempt produces, and
 * every write is timestamped so timing behaviour can be asserted.
 */
class EntryProvider extends EventTarget {
    /**
     * @param {{onInterrupt?: (provider: EntryProvider) => void, onEnter?: (provider: EntryProvider) => void}} handlers
     *        Callbacks for the Ctrl-C and Ctrl-A writes.
     */
    constructor(handlers = {}) {
        super();
        this.sent = [];
        this.writes = [];
        this.disconnectCalls = 0;
        this.handlers = handlers;
    }

    /**
     * Write bytes to the fake device.
     * @param {string} payload - Bytes written by the connection.
     * @returns {Promise<void>}
     */
    async send(payload) {
        this.sent.push(payload);
        this.writes.push({ payload, at: Date.now() });

        if (payload === '\r\x03' && this.handlers.onInterrupt) {
            this.handlers.onInterrupt(this);
        }

        if (payload === '\r\x01' && this.handlers.onEnter) {
            this.handlers.onEnter(this);
        }
    }

    /**
     * Emit one decoded chunk to data listeners.
     * @param {string} text - Chunk text.
     * @returns {void}
     */
    emit(text) {
        this.dispatchEvent(new CustomEvent('data', { detail: { data: encoder.encode(text) } }));
    }

    /**
     * Close the fake port.
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.disconnectCalls += 1;
    }

    /**
     * Report the fake port as open.
     * @returns {boolean} Always true.
     */
    isConnected() {
        return true;
    }

    /**
     * Timestamp at which a payload was written.
     * @param {string} payload - Payload to look up.
     * @returns {number} Milliseconds since epoch.
     */
    wroteAt(payload) {
        const write = this.writes.find((entry) => entry.payload === payload);
        return write ? write.at : -1;
    }

    /**
     * Number of times a payload was written.
     * @param {string} payload - Payload to count.
     * @returns {number} Write count.
     */
    count(payload) {
        return this.sent.filter((entry) => entry === payload).length;
    }
}

/**
 * Create a connection in the connected state on top of `provider`.
 * @param {EntryProvider} provider - Transport under test.
 * @returns {DeviceConnection} Connected connection.
 */
function createConnectedConnection(provider) {
    const connection = new DeviceConnection({
        providers: {},
        logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    connection._state = ConnectionState.CONNECTED;
    connection._activeConnection = provider;

    return connection;
}

describe('raw REPL entry', () => {
    it('enters raw REPL on the banner with its prompt', async () => {
        const provider = new EntryProvider({
            onEnter: (transport) => transport.emit(RAW_REPL_BANNER),
        });
        const connection = createConnectedConnection(provider);
        const entered = [];

        connection.addEventListener('raw-repl-entered', (event) => {
            entered.push(event.detail);
        });

        await connection._enterRawRepl();

        assert.equal(connection.isRawRepl(), true);
        assert.deepEqual(provider.sent, ['\r\x03', '\r\x01']);
        assert.equal(entered.length, 1);
        assert.equal(typeof entered[0].timestamp, 'number');
    });

    it('does not enter before the prompt byte arrives', async () => {
        const provider = new EntryProvider({
            onEnter: (transport) => transport.emit('raw REPL; CTRL-B to exit\r\n'),
        });
        const connection = createConnectedConnection(provider);

        const entry = connection._enterRawRepl();
        const settled = await Promise.race([
            entry.then(() => 'entered'),
            new Promise((resolve) => setTimeout(() => resolve('pending'), 200)),
        ]);

        assert.equal(settled, 'pending');
        assert.equal(connection.isRawRepl(), false);

        provider.emit('>');
        await entry;
        assert.equal(connection.isRawRepl(), true);
    });

    it('waits for an idle line before switching to raw REPL', async () => {
        const provider = new EntryProvider({
            onEnter: (transport) => transport.emit(RAW_REPL_BANNER),
        });
        const connection = createConnectedConnection(provider);

        await connection._enterRawRepl();

        const waited = provider.wroteAt('\r\x01') - provider.wroteAt('\r\x03');
        assert.ok(waited >= 25, `expected an idle window, waited ${waited} ms`);
    });

    it('retries when an attempt produces no banner', async () => {
        let attempts = 0;
        const provider = new EntryProvider({
            onEnter: (transport) => {
                attempts += 1;
                if (attempts > 1) {
                    transport.emit(RAW_REPL_BANNER);
                }
            },
        });
        const connection = createConnectedConnection(provider);

        await connection._enterRawRepl();

        assert.equal(connection.isRawRepl(), true);
        assert.equal(provider.count('\r\x01'), 2);
    });

    it('reports the attempt count when the banner never arrives', async () => {
        const provider = new EntryProvider();
        const connection = createConnectedConnection(provider);

        await assert.rejects(
            () => connection._enterRawRepl(),
            /raw REPL entry timed out after 3 attempts/
        );

        assert.equal(connection.isRawRepl(), false);
        assert.equal(provider.count('\r\x01'), 3);
    });

    it('aborts on a transport failure without another attempt', async () => {
        const provider = new EntryProvider();
        provider.send = async (payload) => {
            provider.sent.push(payload);
            throw new Error('port lost during entry');
        };
        const connection = createConnectedConnection(provider);

        await assert.rejects(() => connection._enterRawRepl(), /port lost during entry/);

        assert.equal(provider.count('\r\x01'), 0);
        assert.equal(connection._rawReplTransitionPromise, null);
    });

    it('coalesces concurrent entry calls into one transition', async () => {
        const provider = new EntryProvider({
            onEnter: (transport) => transport.emit(RAW_REPL_BANNER),
        });
        const connection = createConnectedConnection(provider);

        await Promise.all([connection._enterRawRepl(), connection._enterRawRepl()]);

        assert.equal(provider.count('\r\x03'), 1);
        assert.equal(provider.count('\r\x01'), 1);
        assert.equal(connection.isRawRepl(), true);
    });
});

describe('raw REPL teardown', () => {
    it('returns the board to the friendly REPL before the port closes', async () => {
        const provider = new EntryProvider();
        const connection = createConnectedConnection(provider);
        connection._isRawRepl = true;

        await connection.disconnect();

        assert.deepEqual(provider.sent, ['\x02']);
        assert.equal(provider.disconnectCalls, 1);
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
        assert.equal(connection.isRawRepl(), false);
    });

    it('does not send Ctrl-B when the board is already in the friendly REPL', async () => {
        const provider = new EntryProvider();
        const connection = createConnectedConnection(provider);
        connection._isRawRepl = false;

        await connection.disconnect();

        assert.deepEqual(provider.sent, []);
        assert.equal(provider.disconnectCalls, 1);
    });

    it('still disconnects when the Ctrl-B write fails', async () => {
        const provider = new EntryProvider();
        provider.send = async () => {
            throw new Error('write failed');
        };
        const connection = createConnectedConnection(provider);
        connection._isRawRepl = true;

        await connection.disconnect();

        assert.equal(provider.disconnectCalls, 1);
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
    });
});
