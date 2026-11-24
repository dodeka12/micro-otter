import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

class LifecycleProvider extends EventTarget {
    constructor() {
        super();
        this.connected = false;
        this.connectCalls = 0;
        this.disconnectCalls = 0;
        this.sent = [];
    }

    async connect() {
        this.connectCalls += 1;
        this.connected = true;
        this.dispatchEvent(
            new CustomEvent('statechange', {
                detail: {
                    state: 'connected',
                    newState: 'connected',
                    previousState: 'connecting',
                },
            })
        );
    }

    async disconnect() {
        this.disconnectCalls += 1;
        this.connected = false;
        this.dispatchEvent(
            new CustomEvent('statechange', {
                detail: {
                    state: 'disconnected',
                    newState: 'disconnected',
                    previousState: 'connected',
                },
            })
        );
    }

    isConnected() {
        return this.connected;
    }

    async send(payload) {
        this.sent.push(payload);

        if (payload === '\r\x01') {
            const marker = new TextEncoder().encode('raw REPL; CTRL-B to exit\r\n>');
            this.dispatchEvent(new CustomEvent('data', { detail: { data: marker } }));
        }
    }
}

describe('DeviceConnection lifecycle behavior', () => {
    let provider;
    let connection;

    beforeEach(() => {
        provider = new LifecycleProvider();
        connection = new DeviceConnection({
            providers: {
                mock: {
                    name: 'Mock',
                    description: 'Lifecycle provider',
                    instance: provider,
                },
                secondary: {
                    name: 'Secondary',
                    description: 'Secondary provider',
                    instance: new LifecycleProvider(),
                },
            },
            defaultProvider: 'mock',
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });
    });

    it('starts disconnected with configured default provider', () => {
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
        assert.equal(connection.isConnected(), false);
        assert.equal(connection.getActiveProviderKey(), 'mock');
    });

    it('connects and emits connecting -> connected state transitions', async () => {
        const states = [];
        connection.addEventListener('statechange', (event) => {
            states.push(event.detail);
        });

        await connection.connect();

        assert.equal(provider.connectCalls, 1);
        assert.equal(connection.getState(), ConnectionState.CONNECTED);
        assert.equal(connection.isConnected(), true);
        assert.equal(states[0].state, ConnectionState.CONNECTING);
        assert.equal(states[0].previousState, ConnectionState.DISCONNECTED);
        assert.equal(states[1].state, ConnectionState.CONNECTED);
        assert.equal(states[1].previousState, ConnectionState.CONNECTING);
    });

    it('is idempotent for repeated connect calls while already connected', async () => {
        await connection.connect();
        await connection.connect();

        assert.equal(provider.connectCalls, 1);
        assert.equal(connection.getState(), ConnectionState.CONNECTED);
    });

    it('disconnects and returns to disconnected state', async () => {
        await connection.connect();
        await connection.disconnect();

        assert.equal(provider.disconnectCalls, 1);
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
        assert.equal(connection.isConnected(), false);
    });

    it('rejects provider switching while connected and allows it when disconnected', async () => {
        await connection.connect();

        assert.throws(() => {
            connection.setActiveProvider('secondary');
        }, /Cannot change provider while connected/);

        await connection.disconnect();
        connection.setActiveProvider('secondary');
        assert.equal(connection.getActiveProviderKey(), 'secondary');
    });

    it('rejects connect without selected provider', async () => {
        const noProviderConnection = new DeviceConnection({
            providers: {},
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        await assert.rejects(async () => {
            await noProviderConnection.connect();
        }, /No provider selected/);
    });
});
