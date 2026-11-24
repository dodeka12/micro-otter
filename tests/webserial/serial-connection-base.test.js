import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    SerialConnectionBase,
    SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES,
    ConnectCancelledError,
    isConnectCancelled,
} from '../../src/micro_otter/nodes/html/js/serial/serial-connection-base.js';
import { MockSerialConnection } from '../../src/micro_otter/nodes/html/js/serial/mock-serial-connection.js';

/**
 * Yield to the macrotask queue so the continuations of promise-returning connection calls run
 * before the fake clock is advanced again or the connection state is read.
 *
 * `setImmediate` is not touched by `t.mock.timers.enable({ apis: ['setTimeout'] })`, so awaiting it
 * drains the microtasks queued by a tick while the mocked `setTimeout` stays frozen.
 *
 * @returns {Promise<void>} Resolves on the next macrotask turn.
 */
function flushMicrotasks() {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

describe('SerialConnectionBase', () => {
    describe('Abstract Class Enforcement', () => {
        it('should throw error when instantiated directly', () => {
            assert.throws(
                () => new SerialConnectionBase(),
                {
                    name: 'TypeError',
                    message: /Cannot construct abstract class/,
                }
            );
        });

        it('should allow subclass instantiation', () => {
            const connection = new MockSerialConnection();
            assert.ok(connection instanceof SerialConnectionBase);
            assert.ok(connection instanceof MockSerialConnection);
        });
    });

    describe('Abstract Methods', () => {
        class MinimalConnection extends SerialConnectionBase {
            constructor() {
                super();
            }
        }

        it('should throw error if connect() not implemented', async () => {
            const connection = new MinimalConnection();
            await assert.rejects(
                async () => await connection.connect(),
                {
                    message: /Method connect\(\) must be implemented/,
                }
            );
        });

        it('should throw error if disconnect() not implemented', async () => {
            const connection = new MinimalConnection();
            await assert.rejects(
                async () => await connection.disconnect(),
                {
                    message: /Method disconnect\(\) must be implemented/,
                }
            );
        });

        it('should throw error if send() not implemented', async () => {
            const connection = new MinimalConnection();
            await assert.rejects(
                async () => await connection.send('data'),
                {
                    message: /Method send\(\) must be implemented/,
                }
            );
        });

        it('cancelConnect() is a silent no-op by default', () => {
            const connection = new MinimalConnection();
            assert.doesNotThrow(() => connection.cancelConnect());
        });
    });

    describe('Cancellation primitive', () => {
        it('ConnectCancelledError carries the expected name', () => {
            const error = new ConnectCancelledError();
            assert.equal(error.name, 'ConnectCancelledError');
            assert.ok(error instanceof ConnectCancelledError);
            assert.ok(error instanceof Error);
        });

        it('isConnectCancelled() recognises the error across module reloads', () => {
            assert.equal(isConnectCancelled(new ConnectCancelledError()), true);

            // A foreign copy of the class still lands as an Error with the same name.
            const foreign = new Error('cancelled');
            foreign.name = 'ConnectCancelledError';
            assert.equal(isConnectCancelled(foreign), true);
        });

        it('isConnectCancelled() rejects unrelated values', () => {
            assert.equal(isConnectCancelled(new Error('boom')), false);
            assert.equal(isConnectCancelled(null), false);
            assert.equal(isConnectCancelled(undefined), false);
            assert.equal(isConnectCancelled('ConnectCancelledError'), false);
        });
    });

    describe('State Management', () => {
        let connection;

        beforeEach(() => {
            connection = new MockSerialConnection();
        });

        it('should start in disconnected state', () => {
            assert.equal(connection.getState(), 'disconnected');
            assert.equal(connection.isConnected(), false);
        });

        it('should transition to connecting state', async () => {
            const connectPromise = connection.connect();
            // State should be connecting before promise resolves
            assert.equal(connection.getState(), 'connecting');
            await connectPromise;
        });

        it('should transition to connected state after successful connect', async () => {
            await connection.connect();
            assert.equal(connection.getState(), 'connected');
            assert.equal(connection.isConnected(), true);
        });

        it('should transition to disconnecting state', async () => {
            await connection.connect();
            const disconnectPromise = connection.disconnect();
            // State should be disconnecting before promise resolves
            assert.equal(connection.getState(), 'disconnecting');
            await disconnectPromise;
        });

        it('should transition to disconnected state after disconnect', async () => {
            await connection.connect();
            await connection.disconnect();
            assert.equal(connection.getState(), 'disconnected');
            assert.equal(connection.isConnected(), false);
        });

        it('should transition to error state on error', async () => {
            await connection.connect();
            const error = new Error('Test error');
            connection._emitError(error, 'test');
            assert.equal(connection.getState(), 'error');
        });

        it('should not transition to error if already disconnected', async () => {
            await connection.connect();
            await connection.disconnect();
            const error = new Error('Test error');
            connection._emitError(error, 'test');
            assert.equal(connection.getState(), 'disconnected');
        });
    });

    describe('Event Emission', () => {
        let connection;

        beforeEach(() => {
            connection = new MockSerialConnection();
        });

        it('should emit connecting event', async () => {
            let eventFired = false;
            let eventDetail = null;

            connection.addEventListener('connecting', (e) => {
                eventFired = true;
                eventDetail = e.detail;
            });

            await connection.connect({ baudRate: 9600 });

            assert.equal(eventFired, true);
            assert.equal(
                eventDetail.payloadTypeId,
                SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES.connecting
            );
            assert.ok(eventDetail.options);
        });

        it('should emit connected event', async () => {
            let eventFired = false;
            let eventDetail = null;

            connection.addEventListener('connected', (e) => {
                eventFired = true;
                eventDetail = e.detail;
            });

            await connection.connect();

            assert.equal(eventFired, true);
            assert.equal(
                eventDetail.payloadTypeId,
                SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES.connected
            );
            assert.ok(eventDetail.connectionInfo);
            assert.equal(eventDetail.connectionInfo.type, 'mock');
        });

        it('should emit disconnecting event', async () => {
            let eventFired = false;
            let eventDetail = null;

            await connection.connect();

            connection.addEventListener('disconnecting', (e) => {
                eventFired = true;
                eventDetail = e.detail;
            });

            await connection.disconnect();

            assert.equal(eventFired, true);
            assert.equal(
                eventDetail.payloadTypeId,
                SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES.disconnecting
            );
        });

        it('should emit disconnected event', async () => {
            let eventFired = false;
            let eventDetail = null;

            await connection.connect();

            connection.addEventListener('disconnected', (e) => {
                eventFired = true;
                eventDetail = e.detail;
            });

            await connection.disconnect();

            assert.equal(eventFired, true);
            assert.equal(
                eventDetail.payloadTypeId,
                SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES.disconnected
            );
            assert.ok(eventDetail.reason);
        });

        it('should emit statechange events', async () => {
            const states = [];

            connection.addEventListener('statechange', (e) => {
                states.push({
                    payloadTypeId: e.detail.payloadTypeId,
                    previous: e.detail.previousState,
                    new: e.detail.newState,
                });
            });

            await connection.connect();
            await connection.disconnect();

            assert.equal(states.length >= 4, true); // connecting, connected, disconnecting, disconnected
            assert.equal(states[0].new, 'connecting');
            assert.equal(states[1].new, 'connected');
            assert.equal(
                states[0].payloadTypeId,
                SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES.statechange
            );
        });

        it('should emit data event', () => {
            let receivedData = null;
            let receivedTimestamp = null;

            connection.addEventListener('data', (e) => {
                receivedData = e.detail.data;
                receivedTimestamp = e.detail.timestamp;
                assert.equal(e.detail.payloadTypeId, SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES.data);
            });

            const testData = 'test data';
            connection._emitDataReceived(testData);

            assert.equal(receivedData, testData);
            assert.ok(receivedTimestamp);
            assert.equal(typeof receivedTimestamp, 'number');
        });

        it('should emit error event', () => {
            let errorDetail = null;

            connection.addEventListener('error', (e) => {
                errorDetail = e.detail;
            });

            const testError = new Error('Test error');
            connection._emitError(testError, 'test-context');

            assert.ok(errorDetail);
            assert.equal(errorDetail.payloadTypeId, SERIAL_CONNECTION_EVENT_PAYLOAD_TYPES.error);
            assert.equal(errorDetail.error, testError);
            assert.equal(errorDetail.context, 'test-context');
            assert.ok(errorDetail.state);
        });
    });

    describe('Connection Info', () => {
        let connection;

        beforeEach(() => {
            connection = new MockSerialConnection();
        });

        it('should return null initially', () => {
            assert.equal(connection.getConnectionInfo(), null);
        });

        it('should return connection info after connect', async () => {
            await connection.connect({ baudRate: 9600, portName: 'test-port' });

            const info = connection.getConnectionInfo();
            assert.ok(info);
            assert.equal(info.type, 'mock');
            assert.equal(info.port, 'test-port');
            assert.equal(info.baudRate, 9600);
        });

        it('should clear connection info after disconnect', async () => {
            await connection.connect();
            await connection.disconnect();

            assert.equal(connection.getConnectionInfo(), null);
        });
    });

    describe('Logging', () => {
        it('should call logger when provided', async () => {
            const logs = [];
            const logger = (...args) => logs.push(args);

            const connection = new MockSerialConnection({ logger });

            await connection.connect();

            assert.equal(logs.length > 0, true);
            assert.equal(logs[0][0], '[MockSerialConnection]');
        });

        it('should not throw when logger not provided', async () => {
            const connection = new MockSerialConnection();

            // Should not throw
            await connection.connect();
            await connection.disconnect();
        });
    });

    describe('MockSerialConnection Specifics', () => {
        let connection;

        beforeEach(() => {
            connection = new MockSerialConnection();
        });

        it('should reject send when not connected', async () => {
            await assert.rejects(
                async () => await connection.send('data'),
                {
                    message: /not connected/,
                }
            );
        });

        it('should store sent data', async () => {
            await connection.connect();

            await connection.send('test1');
            await connection.send('test2');

            const sentData = connection.getSentData();
            assert.equal(sentData.length, 2);
            assert.equal(sentData[0], 'test1');
            assert.equal(sentData[1], 'test2');
        });

        it('should simulate receiving data', async () => {
            await connection.connect();

            let receivedData = null;
            connection.addEventListener('data', (e) => {
                receivedData = e.detail.data;
            });

            connection.simulateReceive('incoming data');

            assert.equal(receivedData, 'incoming data');
        });

        it('should clear sent data log', async () => {
            await connection.connect();

            await connection.send('test');
            assert.equal(connection.getSentData().length, 1);

            connection.clearSentData();
            assert.equal(connection.getSentData().length, 0);
        });

        it('should simulate errors', () => {
            let errorDetail = null;
            connection.addEventListener('error', (e) => {
                errorDetail = e.detail;
            });

            connection.simulateError('test-context', 'Test error message');

            assert.ok(errorDetail);
            assert.equal(errorDetail.context, 'test-context');
            assert.equal(errorDetail.error.message, 'Test error message');
        });

        it('should handle custom connection delay', async (t) => {
            t.mock.timers.enable({ apis: ['setTimeout'] });
            const delayed = new MockSerialConnection({ connectionDelay: 50 });
            let connectedEvents = 0;
            delayed.addEventListener('connected', () => {
                connectedEvents += 1;
            });

            const connecting = delayed.connect();

            t.mock.timers.tick(49);
            await flushMicrotasks();
            assert.equal(delayed.getState(), 'connecting', 'still connecting one ms before 50 ms');
            assert.equal(connectedEvents, 0, 'no connected event before the delay elapses');

            t.mock.timers.tick(1);
            await connecting;
            assert.equal(delayed.getState(), 'connected');
            assert.equal(connectedEvents, 1, 'connected event fired once the delay elapsed');
        });

        it('should handle custom disconnection delay', async (t) => {
            t.mock.timers.enable({ apis: ['setTimeout'] });
            const delayed = new MockSerialConnection({ disconnectionDelay: 50 });

            const connecting = delayed.connect();
            t.mock.timers.tick(10);
            await connecting;

            let disconnectedEvents = 0;
            delayed.addEventListener('disconnected', () => {
                disconnectedEvents += 1;
            });

            const disconnecting = delayed.disconnect();

            t.mock.timers.tick(49);
            await flushMicrotasks();
            assert.equal(
                delayed.getState(),
                'disconnecting',
                'still disconnecting one ms before 50 ms'
            );
            assert.equal(disconnectedEvents, 0, 'no disconnected event before the delay elapses');

            t.mock.timers.tick(1);
            await disconnecting;
            assert.equal(delayed.getState(), 'disconnected');
            assert.equal(disconnectedEvents, 1, 'disconnected event fired once the delay elapsed');
        });
    });

    describe('EventTarget Integration', () => {
        let connection;

        beforeEach(() => {
            connection = new MockSerialConnection();
        });

        it('should support addEventListener', () => {
            let called = false;
            connection.addEventListener('data', () => {
                called = true;
            });

            connection._emitDataReceived('test');
            assert.equal(called, true);
        });

        it('should support removeEventListener', () => {
            let callCount = 0;
            const handler = () => {
                callCount++;
            };

            connection.addEventListener('data', handler);
            connection._emitDataReceived('test1');
            assert.equal(callCount, 1);

            connection.removeEventListener('data', handler);
            connection._emitDataReceived('test2');
            assert.equal(callCount, 1); // Should not increment
        });

        it('should support multiple listeners', () => {
            let count1 = 0;
            let count2 = 0;

            connection.addEventListener('data', () => count1++);
            connection.addEventListener('data', () => count2++);

            connection._emitDataReceived('test');

            assert.equal(count1, 1);
            assert.equal(count2, 1);
        });
    });

    describe('Full Connection Lifecycle', () => {
        it('should complete full lifecycle without errors', async () => {
            const connection = new MockSerialConnection();
            const events = [];

            connection.addEventListener('connecting', () => events.push('connecting'));
            connection.addEventListener('connected', () => events.push('connected'));
            connection.addEventListener('data', () => events.push('data'));
            connection.addEventListener('disconnecting', () => events.push('disconnecting'));
            connection.addEventListener('disconnected', () => events.push('disconnected'));

            // Connect
            await connection.connect();
            assert.equal(connection.isConnected(), true);

            // Send data
            await connection.send('test message');

            // Receive data
            connection.simulateReceive('response');

            // Disconnect
            await connection.disconnect();
            assert.equal(connection.isConnected(), false);

            // Verify event sequence
            assert.equal(events.includes('connecting'), true);
            assert.equal(events.includes('connected'), true);
            assert.equal(events.includes('data'), true);
            assert.equal(events.includes('disconnecting'), true);
            assert.equal(events.includes('disconnected'), true);
        });
    });
});
