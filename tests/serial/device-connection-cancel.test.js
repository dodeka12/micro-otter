// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
    isConnectCancelled,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

/** A promise with exposed resolve/reject, so a test can settle it on demand. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Yield to the next macrotask turn. */
function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

/** Provider double with a controllable connect. */
class FakeProvider extends EventTarget {
    constructor() {
        super();
        this.connectCalls = 0;
        this.disconnectCalls = 0;
        this.cancelCalls = 0;
        this.connected = false;
        this.connectDeferred = null;
    }

    async connect() {
        this.connectCalls += 1;
        if (this.connectDeferred) {
            return this.connectDeferred.promise;
        }
        this.connected = true;
    }

    async disconnect() {
        this.disconnectCalls += 1;
        this.connected = false;
    }

    cancelConnect() {
        this.cancelCalls += 1;
    }

    isConnected() {
        return this.connected;
    }
}

/** Build a DeviceConnection over a fresh provider. */
function createConnection(provider) {
    return new DeviceConnection({
        providers: {
            test: {
                name: 'Test',
                description: 'Test provider',
                instance: provider,
            },
        },
        defaultProvider: 'test',
        logger: { log: () => {} },
    });
}

describe('DeviceConnection cancellation and single-flight', () => {
    it('joins a second connect with the in-flight attempt (one provider connect)', async () => {
        const provider = new FakeProvider();
        provider.connectDeferred = deferred();
        const connection = createConnection(provider);
        connection._enterRawRepl = async () => {};

        const first = connection.connect();
        const second = connection.connect();

        assert.equal(provider.connectCalls, 1);

        provider.connectDeferred.resolve();
        await Promise.all([first, second]);

        assert.equal(connection.getState(), ConnectionState.CONNECTED);
    });

    it('cancelConnect rejects the pending connect and tears the transport down', async () => {
        const provider = new FakeProvider();
        provider.connectDeferred = deferred();
        const connection = createConnection(provider);

        const connectPromise = connection.connect();

        assert.equal(connection.cancelConnect(), true);
        await assert.rejects(connectPromise, (error) => isConnectCancelled(error));

        assert.equal(provider.cancelCalls, 1);
        assert.equal(provider.disconnectCalls, 1);
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
    });

    it('a second cancelConnect is a no-op that reports false', async () => {
        const provider = new FakeProvider();
        provider.connectDeferred = deferred();
        const connection = createConnection(provider);

        const connectPromise = connection.connect();
        connection.cancelConnect();
        await assert.rejects(connectPromise, (error) => isConnectCancelled(error));

        const states = [];
        connection.addEventListener('statechange', (event) => states.push(event.detail.state));
        assert.equal(connection.cancelConnect(), false);
        assert.equal(states.length, 0);
    });

    it('a late provider rejection after cancel does not latch ERROR', async () => {
        const provider = new FakeProvider();
        const gate = deferred();
        provider.connectDeferred = gate;
        const connection = createConnection(provider);

        const states = [];
        connection.addEventListener('statechange', (event) => states.push(event.detail.state));

        const connectPromise = connection.connect();
        connection.cancelConnect();
        await assert.rejects(connectPromise, (error) => isConnectCancelled(error));

        gate.reject(new Error('port busy'));
        await flush();

        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
        assert.equal(states.includes('error'), false);
    });

    it('connects again after a cancellation', async () => {
        const provider = new FakeProvider();
        const gate = deferred();
        provider.connectDeferred = gate;
        const connection = createConnection(provider);
        connection._enterRawRepl = async () => {};

        const first = connection.connect();
        connection.cancelConnect();
        await assert.rejects(first, (error) => isConnectCancelled(error));

        provider.connectDeferred = null;
        await connection.connect();

        assert.equal(connection.getState(), ConnectionState.CONNECTED);
        assert.equal(provider.connectCalls, 2);
    });

    it('disconnect during a connect cancels the attempt', async () => {
        const provider = new FakeProvider();
        provider.connectDeferred = deferred();
        const connection = createConnection(provider);

        const connectPromise = connection.connect();
        await connection.disconnect();

        await assert.rejects(connectPromise, (error) => isConnectCancelled(error));
        assert.equal(provider.cancelCalls, 1);
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
    });
});
