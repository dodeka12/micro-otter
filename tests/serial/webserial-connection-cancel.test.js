// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { WebSerialConnection } from '../../src/micro_otter/nodes/html/js/serial/webserial-connection.js';

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

/** Drain pending microtasks and one macrotask turn. */
function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

/** Minimal serial port double for the Web Serial API. */
class FakePort {
    constructor() {
        this.openCalls = 0;
        this.closeCalls = 0;
        this.openError = null;
        this.openNever = false;
        this.readable = {
            getReader: () => ({
                read: () => new Promise(() => {}),
                cancel: async () => {},
                releaseLock: () => {},
            }),
        };
        this.writable = {
            getWriter: () => ({
                write: async () => {},
                releaseLock: () => {},
                close: async () => {},
            }),
        };
    }

    async open() {
        this.openCalls += 1;
        if (this.openNever) {
            return new Promise(() => {});
        }
        if (this.openError) {
            throw this.openError;
        }
    }

    async close() {
        this.closeCalls += 1;
    }

    getInfo() {
        return { usbVendorId: 0x1234, usbProductId: 0x5678 };
    }
}

/**
 * Build a `navigator.serial` double.
 * @param {object} options Overrides.
 * @param {object} options.request Deferred controlling `requestPort`, or null for immediate resolution.
 * @param {FakePort} options.port Port `requestPort` hands back.
 */
function createSerialApi({ request = null, port = new FakePort() } = {}) {
    const api = {
        port,
        getPortsCalls: 0,
        requestPortCalls: 0,
        getPorts: async () => {
            api.getPortsCalls += 1;
            return [];
        },
        requestPort: () => {
            api.requestPortCalls += 1;
            return request ? request.promise : Promise.resolve(port);
        },
        addEventListener() {},
    };
    return api;
}

/**
 * Install a `navigator.serial` double.
 *
 * Node 21+ exposes `navigator` as a getter-only global, so plain assignment throws;
 * `defineProperty` replaces it regardless.
 * @param {object} serial The `serial` object to expose.
 */
function setNavigatorSerial(serial) {
    Object.defineProperty(globalThis, 'navigator', {
        value: { serial },
        configurable: true,
        writable: true,
    });
}

describe('WebSerialConnection cancellation', () => {
    beforeEach(() => {
        setNavigatorSerial(createSerialApi());
    });

    afterEach(() => {
        delete globalThis.navigator;
    });

    it('joins a second connect with the in-flight attempt (one requestPort)', async () => {
        const port = new FakePort();
        const api = createSerialApi({ port });
        setNavigatorSerial(api);
        const connection = new WebSerialConnection();

        const first = connection.connect();
        const second = connection.connect();

        await Promise.all([first, second]);

        assert.equal(api.requestPortCalls, 1);
        assert.equal(connection.getState(), 'connected');
        assert.equal(connection.isConnected(), true);
    });

    it('cancelConnect rejects a pending connect and releases a late port', async () => {
        const port = new FakePort();
        const request = deferred();
        const api = createSerialApi({ request, port });
        setNavigatorSerial(api);
        const connection = new WebSerialConnection();

        const connectPromise = connection.connect();
        connection.cancelConnect();

        await assert.rejects(
            connectPromise,
            (error) => error.name === 'ConnectCancelledError'
        );
        assert.equal(connection.getState(), 'disconnected');

        // The picker later returns a port; it must be closed, not used.
        request.resolve(port);
        await flush();

        assert.equal(port.closeCalls, 1);
        assert.equal(connection.getState(), 'disconnected');
    });

    it('cancelConnect closes an already-open port while open() hangs', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const port = new FakePort();
        port.openNever = true;
        const api = createSerialApi({ port });
        setNavigatorSerial(api);
        const connection = new WebSerialConnection();

        const connectPromise = connection.connect();
        await flush(); // reach the open() call

        connection.cancelConnect();
        await assert.rejects(
            connectPromise,
            (error) => error.name === 'ConnectCancelledError'
        );
        await flush(); // let the fire-and-forget cleanup run

        assert.equal(port.closeCalls, 1);
        assert.equal(connection.getState(), 'disconnected');
    });

    it('rejects connect when port.open() never settles', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const port = new FakePort();
        port.openNever = true;
        const api = createSerialApi({ port });
        setNavigatorSerial(api);
        const connection = new WebSerialConnection();

        const connectPromise = connection.connect();
        await flush();
        t.mock.timers.tick(15000);

        await assert.rejects(connectPromise, /Timed out opening the serial port/);
    });

    it('settles a pending connect when disconnect runs during the handshake', async () => {
        const request = deferred();
        const port = new FakePort();
        const api = createSerialApi({ request, port });
        setNavigatorSerial(api);
        const connection = new WebSerialConnection();

        const connectPromise = connection.connect();
        await connection.disconnect();

        await assert.rejects(
            connectPromise,
            (error) => error.name === 'ConnectCancelledError'
        );
        assert.equal(connection.getState(), 'disconnected');
    });
});

