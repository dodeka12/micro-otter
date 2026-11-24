import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConnectionState,
    DeviceConnection,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection.js';

class FailingProvider extends EventTarget {
    constructor() {
        super();
        this.connectCalls = 0;
        this.addCounts = new Map();
        this.removeCounts = new Map();
    }

    addEventListener(type, listener, options) {
        this.addCounts.set(type, (this.addCounts.get(type) || 0) + 1);
        return super.addEventListener(type, listener, options);
    }

    removeEventListener(type, listener, options) {
        this.removeCounts.set(type, (this.removeCounts.get(type) || 0) + 1);
        return super.removeEventListener(type, listener, options);
    }

    async connect() {
        this.connectCalls += 1;
        throw new Error('Access denied');
    }

    async disconnect() {
        return undefined;
    }

    isConnected() {
        return false;
    }
}

describe('DeviceConnection connect failure handling', () => {
    it('resets state to disconnected after connect failure', async () => {
        const provider = new FailingProvider();
        const connection = new DeviceConnection({
            providers: {
                test: {
                    name: 'Test',
                    description: 'Failing test provider',
                    instance: provider,
                },
            },
            defaultProvider: 'test',
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        const states = [];
        connection.addEventListener('statechange', (event) => {
            states.push(event.detail.state);
        });

        await assert.rejects(async () => {
            await connection.connect();
        }, /Access denied/);

        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
        assert.deepEqual(states, [
            ConnectionState.CONNECTING,
            ConnectionState.ERROR,
            ConnectionState.DISCONNECTED,
        ]);
    });

    it('allows retry after connect failure and removes provisional listeners', async () => {
        const provider = new FailingProvider();
        const connection = new DeviceConnection({
            providers: {
                test: {
                    name: 'Test',
                    description: 'Failing test provider',
                    instance: provider,
                },
            },
            defaultProvider: 'test',
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        for (let attempt = 0; attempt < 2; attempt += 1) {
            await assert.rejects(async () => {
                await connection.connect();
            }, /Access denied/);
            assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
        }

        assert.equal(provider.connectCalls, 2);
        assert.equal(provider.addCounts.get('data') || 0, 2);
        assert.equal(provider.addCounts.get('statechange') || 0, 2);
        assert.equal(provider.addCounts.get('error') || 0, 2);
        assert.equal(provider.removeCounts.get('data') || 0, 2);
        assert.equal(provider.removeCounts.get('statechange') || 0, 2);
        assert.equal(provider.removeCounts.get('error') || 0, 2);
    });

    it('disconnects the provider when raw-REPL setup fails after connect', async () => {
        class ConnectsThenFailsProvider extends EventTarget {
            constructor() {
                super();
                this.disconnectCalls = 0;
            }

            async connect() {}

            async disconnect() {
                this.disconnectCalls += 1;
            }

            isConnected() {
                return true;
            }
        }

        const provider = new ConnectsThenFailsProvider();
        const connection = new DeviceConnection({
            providers: {
                test: {
                    name: 'Test',
                    description: 'Connects then fails during raw REPL',
                    instance: provider,
                },
            },
            defaultProvider: 'test',
            logger: { log: () => {}, warn: () => {}, error: () => {} },
        });

        connection._enterRawRepl = async () => {
            throw new Error('raw repl timeout');
        };

        await assert.rejects(async () => {
            await connection.connect();
        }, /raw repl timeout/);

        assert.equal(provider.disconnectCalls, 1);
        assert.equal(connection.getState(), ConnectionState.DISCONNECTED);
    });
});
