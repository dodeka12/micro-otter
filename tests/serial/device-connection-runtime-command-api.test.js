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
            const marker = new TextEncoder().encode('raw REPL; CTRL-B to exit\r\n>');
            this.dispatchEvent(new CustomEvent('data', { detail: { data: marker } }));
        }

        if (payload === '\x02') {
            const prompt = new TextEncoder().encode('>>> ');
            this.dispatchEvent(new CustomEvent('data', { detail: { data: prompt } }));
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

describe('DeviceConnection runtime command API surface', () => {
    it('executeCustomViewRefreshAction delegates through runtime refresh API with explicit impact', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const executionEvents = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        connection.addEventListener('execution-stopped', (event) => {
            executionEvents.push(event.detail);
        });

        connection._executeRawCommand = async (command) => {
            assert.equal(
                command,
                'import otter_runtime.custom_settings as custom_settings; print(custom_settings.check_wifi_status())'
            );
            return new TextEncoder().encode('{"status": "ok"}');
        };

        const output = await connection.executeCustomViewRefreshAction('check_wifi_status', [], {
            runtimeImpact: 'stop',
        });

        assert.equal(output, '{"status": "ok"}');
        assert.equal(executionEvents.length, 1);
        assert.equal(executionEvents[0].source, 'custom-view-action');
        assert.equal(executionEvents[0].cause, 'runtime-command-impact-stop');
    });

    it('executeRuntimeCommand defaults to no-impact execution for generic commands', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const executionEvents = [];

        connection._isExecuting = true;
        connection._isRawRepl = true;

        connection.addEventListener('execution-started', (event) => {
            executionEvents.push({ name: 'execution-started', detail: event.detail });
        });
        connection.addEventListener('execution-stopped', (event) => {
            executionEvents.push({ name: 'execution-stopped', detail: event.detail });
        });

        connection._executeRawCommand = async (command) => {
            assert.equal(command, 'print("status")');
            return new TextEncoder().encode('{"status": "ok"}');
        };

        const output = await connection.executeRuntimeCommand({
            intent: 'read-status',
            command: 'print("status")',
        });

        assert.equal(output, '{"status": "ok"}');
        assert.deepEqual(executionEvents, []);
        assert.equal(connection.isExecutionRunning(), true);
        assert.equal(connection.isRawRepl(), true);
    });

    it('executeRuntimeCommand applies canonical stop/restart semantics when runtimeImpact is restart', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const executionEvents = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        connection.addEventListener('execution-started', (event) => {
            executionEvents.push({ name: 'execution-started', detail: event.detail });
        });
        connection.addEventListener('execution-stopped', (event) => {
            executionEvents.push({ name: 'execution-stopped', detail: event.detail });
        });

        connection._executeRawCommand = async (command) => {
            assert.equal(command, 'print("refresh")');
            return new TextEncoder().encode('OK');
        };

        const output = await connection.executeRuntimeCommand({
            intent: 'refresh-status',
            command: 'print("refresh")',
            runtimeImpact: 'restart',
        });

        assert.equal(output, 'OK');
        assert.deepEqual(
            executionEvents.map((eventInfo) => ({
                name: eventInfo.name,
                source: eventInfo.detail.source,
                cause: eventInfo.detail.cause,
            })),
            [
                {
                    name: 'execution-stopped',
                    source: 'runtime-command',
                    cause: 'runtime-command-impact-restart-stop',
                },
                {
                    name: 'execution-started',
                    source: 'runtime-command',
                    cause: 'runtime-command-impact-restart-start',
                },
            ]
        );
    });

    it('executeRuntimeRefresh requires explicitly declared runtimeImpact', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);

        await assert.rejects(
            async () => {
                await connection.executeRuntimeRefresh({
                    intent: 'wifi-refresh',
                    command: 'print("wifi")',
                });
            },
            { message: 'Runtime refresh runtimeImpact must be declared explicitly' }
        );
    });

    it('executeRuntimeRefresh uses refresh source metadata for canonical events', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const executionEvents = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        connection.addEventListener('execution-stopped', (event) => {
            executionEvents.push(event.detail);
        });

        connection._executeRawCommand = async (command) => {
            assert.equal(command, 'print("wifi")');
            return new TextEncoder().encode('{"ok": true}');
        };

        const output = await connection.executeRuntimeRefresh({
            intent: 'wifi-refresh',
            command: 'print("wifi")',
            runtimeImpact: 'stop',
        });

        assert.equal(output, '{"ok": true}');
        assert.equal(executionEvents.length, 1);
        assert.equal(executionEvents[0].source, 'runtime-refresh');
        assert.equal(executionEvents[0].cause, 'runtime-command-impact-stop');
    });
});
