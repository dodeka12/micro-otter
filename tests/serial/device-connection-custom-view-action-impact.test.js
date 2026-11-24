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

function assertCanonicalExecutionEventDetailShape(detail) {
    assert.equal(typeof detail.timestamp, 'number');
    assert.equal(typeof detail.source, 'string');
    assert.equal(typeof detail.cause, 'string');
}

describe('DeviceConnection custom-view runtime impact semantics', () => {
    it('startMain emits execution-started after running state is set', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);

        let executionRunningAtStartEvent = false;
        connection.addEventListener('execution-started', () => {
            executionRunningAtStartEvent = connection.isExecutionRunning();
        });

        connection.softReset = async () => {};

        await connection.startMain();

        assert.equal(executionRunningAtStartEvent, true);
        assert.equal(connection.isExecutionRunning(), true);
    });

    it('none impact executes custom function without forced stop/restart transitions', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const callOrder = [];
        const executionEvents = [];

        connection._isExecuting = true;
        connection._isRawRepl = true;

        connection.addEventListener('execution-started', (event) => {
            executionEvents.push({ name: 'execution-started', detail: event.detail });
        });
        connection.addEventListener('execution-stopped', (event) => {
            executionEvents.push({ name: 'execution-stopped', detail: event.detail });
        });

        connection.stopExecution = async () => {
            callOrder.push('stop');
        };
        connection.startMain = async () => {
            callOrder.push('start');
        };

        connection._executeRawCommand = async (command) => {
            callOrder.push('execute');
            assert.equal(
                command,
                "import otter_runtime.custom_settings as custom_settings; print(custom_settings.set_mode(\"STA\", True))"
            );
            return new TextEncoder().encode('{"ok": true}');
        };

        const output = await connection.executeCustomViewAction('set_mode', ['STA', true], {
            runtimeImpact: 'none',
        });

        assert.equal(output, '{"ok": true}');
        assert.deepEqual(callOrder, ['execute']);
        assert.deepEqual(executionEvents, []);
        assert.equal(connection.isExecutionRunning(), true);
        assert.equal(connection.isRawRepl(), true);
    });

    it('omitted runtimeImpact remains backward compatible and emits no execution events', async () => {
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
            assert.equal(
                command,
                "import otter_runtime.custom_settings as custom_settings; print(custom_settings.write_setting(\"wifi_mode\", \"STA\"))"
            );
            return new TextEncoder().encode('{"saved": true}');
        };

        const output = await connection.executeCustomViewAction('write_setting', [
            'wifi_mode',
            'STA',
        ]);

        assert.equal(output, '{"saved": true}');
        assert.deepEqual(executionEvents, []);
        assert.equal(connection.isExecutionRunning(), true);
        assert.equal(connection.isRawRepl(), true);
    });

    it('stop impact applies stop-before semantics and leaves deterministic halted/raw state', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const callOrder = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        const baseStopExecution = connection.stopExecution.bind(connection);
        connection.stopExecution = async (eventContext) => {
            callOrder.push('stop');
            await baseStopExecution(eventContext);
        };

        connection._executeRawCommand = async (command) => {
            callOrder.push('execute');
            assert.equal(
                command,
                'import otter_runtime.custom_settings as custom_settings; print(custom_settings.apply_config())'
            );
            return new TextEncoder().encode('OK');
        };

        const output = await connection.executeCustomViewAction('apply_config', [], {
            runtimeImpact: 'stop',
        });

        assert.equal(output, 'OK');
        assert.deepEqual(callOrder, ['stop', 'execute']);
        assert.equal(connection.isExecutionRunning(), false);
        assert.equal(connection.isRawRepl(), true);
        assert.ok(transport.sent.includes('\x03'));
        assert.ok(transport.sent.includes('\r\x01'));
    });

    it('restart impact applies deterministic stop-before and restart-after via canonical APIs', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const callOrder = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        const baseStopExecution = connection.stopExecution.bind(connection);
        connection.stopExecution = async (eventContext) => {
            callOrder.push('stop');
            await baseStopExecution(eventContext);
        };

        const baseStartMain = connection.startMain.bind(connection);
        connection.startMain = async (eventContext) => {
            callOrder.push('start');
            await baseStartMain(eventContext);
        };

        connection._executeRawCommand = async (command) => {
            callOrder.push('execute');
            assert.equal(
                command,
                'import otter_runtime.custom_settings as custom_settings; print(custom_settings.deploy_runtime())'
            );
            return new TextEncoder().encode('{"deployed": true}');
        };

        const output = await connection.executeCustomViewAction('deploy_runtime', [], {
            runtimeImpact: 'restart',
        });

        assert.equal(output, '{"deployed": true}');
        assert.deepEqual(callOrder, ['stop', 'execute', 'start']);
        assert.equal(connection.isExecutionRunning(), true);
        assert.equal(connection.isRawRepl(), false);
        assert.ok(transport.sent.includes('\x04'));
    });

    it('response directive stop applies canonical stop transition/event path', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const callOrder = [];
        const executionEvents = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        const baseStopExecution = connection.stopExecution.bind(connection);
        connection.stopExecution = async (eventContext) => {
            callOrder.push('stop');
            await baseStopExecution(eventContext);
        };

        connection.addEventListener('execution-stopped', (event) => {
            executionEvents.push({ name: 'execution-stopped', detail: event.detail });
        });

        connection._executeRawCommand = async () => {
            callOrder.push('execute');
            return new TextEncoder().encode('{"ok": true, "runtimeImpact": "stop"}');
        };

        const output = await connection.executeCustomViewAction('apply_config', []);

        assert.equal(output, '{"ok": true, "runtimeImpact": "stop"}');
        assert.deepEqual(callOrder, ['execute', 'stop']);
        assert.equal(connection.isExecutionRunning(), false);
        assert.equal(connection.isRawRepl(), true);
        assert.ok(transport.sent.includes('\x03'));
        assert.equal(executionEvents.length, 1);
        assert.equal(executionEvents[0].detail.cause, 'custom-view-runtime-impact-stop');
        assert.equal(executionEvents[0].detail.source, 'custom-view-action');
    });

    it('response directive restart applies canonical restart transition/event path', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const callOrder = [];
        const executionEvents = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        const baseStopExecution = connection.stopExecution.bind(connection);
        connection.stopExecution = async (eventContext) => {
            callOrder.push('stop');
            await baseStopExecution(eventContext);
        };

        const baseStartMain = connection.startMain.bind(connection);
        connection.startMain = async (eventContext) => {
            callOrder.push('start');
            await baseStartMain(eventContext);
        };

        connection.addEventListener('execution-stopped', (event) => {
            executionEvents.push({ name: 'execution-stopped', detail: event.detail });
        });
        connection.addEventListener('execution-started', (event) => {
            executionEvents.push({ name: 'execution-started', detail: event.detail });
        });

        connection._executeRawCommand = async () => {
            callOrder.push('execute');
            return new TextEncoder().encode('{"ok": true, "runtimeImpact": "restart"}');
        };

        const output = await connection.executeCustomViewAction('deploy_runtime', []);

        assert.equal(output, '{"ok": true, "runtimeImpact": "restart"}');
        assert.deepEqual(callOrder, ['execute', 'stop', 'start']);
        assert.equal(connection.isExecutionRunning(), true);
        assert.equal(connection.isRawRepl(), false);
        assert.ok(transport.sent.includes('\x03'));
        assert.ok(transport.sent.includes('\x04'));
        assert.deepEqual(
            executionEvents.map((eventInfo) => eventInfo.detail.cause),
            ['custom-view-runtime-impact-restart-stop', 'custom-view-runtime-impact-restart-start']
        );
    });

    it('response without runtimeImpact directive preserves legacy behavior', async () => {
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

        connection._executeRawCommand = async () => {
            return new TextEncoder().encode('{"saved": true}');
        };

        const output = await connection.executeCustomViewAction('write_setting', [
            'wifi_mode',
            'STA',
        ]);

        assert.equal(output, '{"saved": true}');
        assert.deepEqual(executionEvents, []);
        assert.equal(connection.isExecutionRunning(), true);
        assert.equal(connection.isRawRepl(), true);
    });

    it('invalid response runtimeImpact directives are ignored safely', async () => {
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

        connection._executeRawCommand = async () => {
            return new TextEncoder().encode('{"ok": true, "runtimeImpact": "invalid"}');
        };

        const output = await connection.executeCustomViewAction('apply_config', []);

        assert.equal(output, '{"ok": true, "runtimeImpact": "invalid"}');
        assert.deepEqual(executionEvents, []);
        assert.equal(connection.isExecutionRunning(), true);
        assert.equal(connection.isRawRepl(), true);
    });

    it('explicit runtimeImpact takes precedence over response directive', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const callOrder = [];
        const executionEvents = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        const baseStopExecution = connection.stopExecution.bind(connection);
        connection.stopExecution = async (eventContext) => {
            callOrder.push('stop');
            await baseStopExecution(eventContext);
        };

        const baseStartMain = connection.startMain.bind(connection);
        connection.startMain = async (eventContext) => {
            callOrder.push('start');
            await baseStartMain(eventContext);
        };

        connection.addEventListener('execution-stopped', (event) => {
            executionEvents.push({ name: 'execution-stopped', detail: event.detail });
        });
        connection.addEventListener('execution-started', (event) => {
            executionEvents.push({ name: 'execution-started', detail: event.detail });
        });

        connection._executeRawCommand = async () => {
            callOrder.push('execute');
            return new TextEncoder().encode('{"ok": true, "runtimeImpact": "stop"}');
        };

        const output = await connection.executeCustomViewAction('deploy_runtime', [], {
            runtimeImpact: 'restart',
        });

        assert.equal(output, '{"ok": true, "runtimeImpact": "stop"}');
        assert.deepEqual(callOrder, ['stop', 'execute', 'start']);
        assert.deepEqual(
            executionEvents.map((eventInfo) => eventInfo.detail.cause),
            ['custom-view-runtime-impact-restart-stop', 'custom-view-runtime-impact-restart-start']
        );
    });

    it('stop impact pre-stop failure emits deterministic failure context and keeps flags consistent', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const events = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        connection.addEventListener('execution-stopped', (event) => {
            events.push(event.detail);
        });

        connection.stopExecution = async () => {
            throw new Error('stop transition failed');
        };

        await assert.rejects(
            async () => {
                await connection.executeCustomViewAction('apply_config', [], {
                    runtimeImpact: 'stop',
                });
            },
            { message: 'stop transition failed' }
        );

        assert.equal(connection.isExecutionRunning(), false);
        assert.equal(connection.isRawRepl(), true);

        assert.equal(events.length, 1);
        assert.equal(events[0].cause, 'custom-view-runtime-impact-stop-pre-stop-error');
        assert.equal(events[0].source, 'custom-view-action');
        assert.equal(events[0].error, 'stop transition failed');
        assert.equal(events[0].functionName, 'apply_config');
        assert.equal(events[0].runtimeImpact, 'stop');
        assert.equal(events[0].transitionStep, 'pre-stop');
    });

    it('stop impact function execution failure emits failure context after canonical stop event', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const events = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        connection.addEventListener('execution-stopped', (event) => {
            events.push(event.detail);
        });

        connection._executeRawCommand = async () => {
            throw new Error('custom function failed');
        };

        await assert.rejects(
            async () => {
                await connection.executeCustomViewAction('apply_config', [], {
                    runtimeImpact: 'stop',
                });
            },
            { message: 'custom function failed' }
        );

        assert.equal(connection.isExecutionRunning(), false);
        assert.equal(connection.isRawRepl(), true);

        assert.equal(events.length, 2);
        assert.equal(events[0].cause, 'custom-view-runtime-impact-stop');
        assert.equal(events[1].cause, 'custom-view-runtime-impact-stop-function-execution-error');
        assert.equal(events[1].source, 'custom-view-action');
        assert.equal(events[1].error, 'custom function failed');
        assert.equal(events[1].functionName, 'apply_config');
        assert.equal(events[1].runtimeImpact, 'stop');
        assert.equal(events[1].transitionStep, 'function-execution');
    });

    it('restart impact post-restart failure reports canonical failure context and deterministic recovery', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);
        const events = [];

        connection._isExecuting = true;
        connection._isRawRepl = false;

        connection.addEventListener('execution-started', (event) => {
            events.push({ name: 'execution-started', detail: event.detail });
        });
        connection.addEventListener('execution-stopped', (event) => {
            events.push({ name: 'execution-stopped', detail: event.detail });
        });

        connection._executeRawCommand = async () => new TextEncoder().encode('OK');
        connection.softReset = async () => {
            throw new Error('restart phase failed');
        };

        await assert.rejects(
            async () => {
                await connection.executeCustomViewAction('deploy_runtime', [], {
                    runtimeImpact: 'restart',
                });
            },
            { message: 'restart phase failed' }
        );

        assert.equal(connection.isExecutionRunning(), false);
        assert.equal(connection.isRawRepl(), true);

        const failureEvent = events.find(
            (eventInfo) =>
                eventInfo.name === 'execution-stopped' &&
                eventInfo.detail.cause === 'custom-view-runtime-impact-restart-start-error'
        );

        assert.ok(failureEvent);
        assert.equal(failureEvent.detail.source, 'custom-view-action');
        assert.equal(failureEvent.detail.error, 'restart phase failed');
        assert.equal(failureEvent.detail.functionName, 'deploy_runtime');
        assert.equal(failureEvent.detail.runtimeImpact, 'restart');
        assert.equal(failureEvent.detail.transitionStep, 'post-restart');
    });

    it('rejects unsupported runtimeImpact values', async () => {
        const transport = new MockTransport();
        const connection = createConnectedConnection(transport);

        await assert.rejects(
            async () => {
                await connection.executeCustomViewAction('set_mode', [], {
                    runtimeImpact: 'invalid',
                });
            },
            { message: 'Unsupported custom view runtimeImpact: invalid' }
        );
    });

    it('emits canonical execution events with deterministic payload shape for toolbar and custom-view flows', async () => {
        const toolbarTransport = new MockTransport();
        const toolbarConnection = createConnectedConnection(toolbarTransport);
        const toolbarEvents = [];

        toolbarConnection.addEventListener('execution-started', (event) => {
            toolbarEvents.push({ name: 'execution-started', detail: event.detail });
        });
        toolbarConnection.addEventListener('execution-stopped', (event) => {
            toolbarEvents.push({ name: 'execution-stopped', detail: event.detail });
        });

        toolbarConnection._isRawRepl = false;
        await toolbarConnection.startMain();
        await toolbarConnection.stopExecution();

        const customTransport = new MockTransport();
        const customConnection = createConnectedConnection(customTransport);
        const customEvents = [];

        customConnection.addEventListener('execution-started', (event) => {
            customEvents.push({ name: 'execution-started', detail: event.detail });
        });
        customConnection.addEventListener('execution-stopped', (event) => {
            customEvents.push({ name: 'execution-stopped', detail: event.detail });
        });

        customConnection._isExecuting = true;
        customConnection._isRawRepl = false;
        customConnection._executeRawCommand = async () => new TextEncoder().encode('OK');

        await customConnection.executeCustomViewAction('apply_config', [], {
            runtimeImpact: 'restart',
        });

        assert.deepEqual(
            toolbarEvents.map((eventInfo) => eventInfo.name),
            ['execution-started', 'execution-stopped']
        );
        assert.deepEqual(
            customEvents.map((eventInfo) => eventInfo.name),
            ['execution-stopped', 'execution-started']
        );

        for (const eventInfo of toolbarEvents) {
            assertCanonicalExecutionEventDetailShape(eventInfo.detail);
        }
        for (const eventInfo of customEvents) {
            assertCanonicalExecutionEventDetailShape(eventInfo.detail);
        }

        const toolbarPayloadKeys = Object.keys(toolbarEvents[0].detail).sort();
        const customPayloadKeys = Object.keys(customEvents[0].detail).sort();
        assert.deepEqual(toolbarPayloadKeys, ['cause', 'source', 'timestamp']);
        assert.deepEqual(customPayloadKeys, ['cause', 'source', 'timestamp']);

        assert.equal(toolbarEvents[0].detail.source, 'device-connection');
        assert.equal(toolbarEvents[0].detail.cause, 'toolbar-play');
        assert.equal(toolbarEvents[1].detail.source, 'device-connection');
        assert.equal(toolbarEvents[1].detail.cause, 'toolbar-stop');

        assert.equal(customEvents[0].detail.source, 'custom-view-action');
        assert.equal(customEvents[0].detail.cause, 'custom-view-runtime-impact-restart-stop');
        assert.equal(customEvents[1].detail.source, 'custom-view-action');
        assert.equal(customEvents[1].detail.cause, 'custom-view-runtime-impact-restart-start');
    });
});
