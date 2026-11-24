import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { WebSocketConnection } from '../../src/micro_otter/nodes/html/js/serial/websocket-connection.js';

class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static lastInstance = null;

    constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.binaryType = 'blob';
        this.sentFrames = [];
        this._listeners = new Map();
        FakeWebSocket.lastInstance = this;
    }

    addEventListener(type, listener) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, []);
        }
        this._listeners.get(type).push(listener);
    }

    send(data) {
        this.sentFrames.push(data);
    }

    close() {
        this.readyState = FakeWebSocket.CLOSED;
        this._emit('close', { code: 1000, reason: '', wasClean: true });
    }

    _emit(type, event) {
        for (const listener of this._listeners.get(type) || []) {
            listener(event);
        }
    }

    _open() {
        this.readyState = FakeWebSocket.OPEN;
        this._emit('open', {});
    }

    _receiveBinary(bytes) {
        this._emit('message', { data: bytes.buffer });
    }

    _receiveText(text) {
        this._emit('message', { data: text });
    }
}

async function connect() {
    const connection = new WebSocketConnection();
    const connectPromise = connection.connect();
    FakeWebSocket.lastInstance._open();
    FakeWebSocket.lastInstance._receiveText(JSON.stringify({ type: 'ready' }));
    await connectPromise;
    return connection;
}

describe('WebSocketConnection', () => {
    beforeEach(() => {
        globalThis.WebSocket = FakeWebSocket;
    });

    afterEach(() => {
        delete globalThis.WebSocket;
    });

    describe('Lifecycle', () => {
        it('transitions to connecting then connected', async () => {
            const connection = new WebSocketConnection();
            const connectPromise = connection.connect();

            assert.equal(connection.getState(), 'connecting');

            FakeWebSocket.lastInstance._open();
            assert.equal(connection.getState(), 'connecting');

            FakeWebSocket.lastInstance._receiveText(JSON.stringify({ type: 'ready' }));
            await connectPromise;

            assert.equal(connection.getState(), 'connected');
            assert.equal(connection.isConnected(), true);
        });

        it('sends binary frames through the socket', async () => {
            const connection = await connect();

            await connection.send(new Uint8Array([1, 2, 3]));

            const frame = FakeWebSocket.lastInstance.sentFrames[0];
            assert.ok(frame instanceof Uint8Array);
            assert.deepEqual(Array.from(frame), [1, 2, 3]);
        });

        it('disconnects and reaches disconnected state', async () => {
            const connection = await connect();

            await connection.disconnect();

            assert.equal(connection.getState(), 'disconnected');
            assert.equal(connection.isConnected(), false);
        });
    });

    describe('Event wiring', () => {
        it('emits a data event for binary messages', async () => {
            const connection = await connect();
            let received = null;
            connection.addEventListener('data', (event) => {
                received = event.detail.data;
            });

            FakeWebSocket.lastInstance._receiveBinary(new Uint8Array([5, 6]));

            assert.deepEqual(Array.from(received), [5, 6]);
        });

        it('emits an error event for error text frames', async () => {
            const connection = await connect();
            let error = null;
            connection.addEventListener('error', (event) => {
                error = event.detail.error;
            });

            FakeWebSocket.lastInstance._receiveText(JSON.stringify({ type: 'error', message: 'boom' }));

            assert.ok(error instanceof Error);
            assert.equal(error.message, 'boom');
        });

        it('emits a disconnected event on socket close', async () => {
            const connection = await connect();
            let reason = null;
            connection.addEventListener('disconnected', (event) => {
                reason = event.detail.reason;
            });

            FakeWebSocket.lastInstance.close();

            assert.equal(reason, 'device-disconnect');
            assert.equal(connection.getState(), 'disconnected');
        });

        it('rejects connect when the bridge reports an error before ready', async () => {
            const connection = new WebSocketConnection();
            const connectPromise = connection.connect();

            FakeWebSocket.lastInstance._open();
            FakeWebSocket.lastInstance._receiveText(
                JSON.stringify({ type: 'error', message: 'serial open failed' })
            );

            await assert.rejects(connectPromise, /serial open failed/);
            assert.equal(connection.getState(), 'error');
        });

        it('rejects connect when the socket closes before ready', async () => {
            const connection = new WebSocketConnection();
            const connectPromise = connection.connect();

            FakeWebSocket.lastInstance._open();
            FakeWebSocket.lastInstance.close();

            await assert.rejects(connectPromise, /closed before the serial port was ready/);
        });
    });

    describe('Single-flight and cancellation', () => {
        it('joins a second connect with the in-flight attempt (one socket)', async () => {
            const connection = new WebSocketConnection();
            const first = connection.connect();
            const socket = FakeWebSocket.lastInstance;
            const second = connection.connect();

            socket._open();
            socket._receiveText(JSON.stringify({ type: 'ready' }));

            await Promise.all([first, second]);

            // The second connect must not have opened a second socket.
            assert.equal(FakeWebSocket.lastInstance, socket);
            assert.equal(connection.getState(), 'connected');
            assert.equal(connection.isConnected(), true);
        });

        it('cancelConnect rejects the pending connect and closes the socket', async () => {
            const connection = new WebSocketConnection();
            const connectPromise = connection.connect();
            const socket = FakeWebSocket.lastInstance;

            connection.cancelConnect();

            await assert.rejects(
                connectPromise,
                (error) => error.name === 'ConnectCancelledError'
            );
            assert.equal(connection.getState(), 'disconnected');
            assert.equal(socket.readyState, FakeWebSocket.CLOSED);
        });

        it('ignores a ready frame that arrives after cancelConnect', async () => {
            const connection = new WebSocketConnection();
            const connectPromise = connection.connect();
            const socket = FakeWebSocket.lastInstance;

            connection.cancelConnect();
            await assert.rejects(
                connectPromise,
                (error) => error.name === 'ConnectCancelledError'
            );

            socket._open();
            socket._receiveText(JSON.stringify({ type: 'ready' }));

            assert.equal(connection.getState(), 'disconnected');
            assert.equal(connection.isConnected(), false);
        });

        it('settles a pending connect when disconnect runs during the handshake', async () => {
            const connection = new WebSocketConnection();
            const connectPromise = connection.connect();

            await connection.disconnect();

            await assert.rejects(
                connectPromise,
                (error) => error.name === 'ConnectCancelledError'
            );
            assert.equal(connection.getState(), 'disconnected');
        });
    });
});
