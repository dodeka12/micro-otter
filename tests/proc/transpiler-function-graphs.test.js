// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Function-graph emission tests for the transpiler.
 *
 * A function graph is emitted as an `async def` body: parameters come from the input
 * node, the body has no `while True`, and the output node contributes the `return`.
 * Call sites are awaited and reuse the callee's hoisted init, and the function never
 * appears in `run()` as a task.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    MockNodeData,
    createCallingGraph,
    createEmitGraph,
    createFunctionGraph,
    createStatefulFunctionGraph,
    transpile,
} from '../helpers/transpiler-function-harness.js';

/**
 * Slice one generated coroutine out of the program.
 * @param {string} code - Generated Python code.
 * @param {string} name - Generated function name.
 * @returns {string} The function text, up to the next top-level `async def`.
 */
function coroutine(code, name) {
    const marker = `async def ${name}(`;
    const start = code.indexOf(marker);
    assert.ok(start >= 0, `expected the generated coroutine ${name}()`);
    const next = code.indexOf('\nasync def ', start + marker.length);
    return code.slice(start, next === -1 ? code.length : next);
}

describe('transpiler function graphs', () => {
    it('emits the function body, its hoisted init and the awaited call site', async () => {
        const fn = createFunctionGraph({ name: 'Sensor Read' });
        const main = createCallingGraph({ name: 'Read Sensors' });
        const code = await transpile([main, fn]);

        const init = coroutine(code, '_init__fn_sensor_read');
        assert.match(init, /global sensor/);
        assert.match(init, /sensor = make_sensor\(\)/);

        const body = coroutine(code, '_fn_sensor_read');
        assert.match(body, /async def _fn_sensor_read\(_in0_channel\):/);
        assert.match(body, /node_sensor0_out0 = sensor\.read\(_in0_channel\)/);
        assert.match(body, /return node_sensor0_out0/);
        assert.doesNotMatch(body, /while True/);
        assert.doesNotMatch(body, /asyncio\.sleep_ms/);

        assert.match(code, /node_call_out0 = await _fn_sensor_read\(3\)/);

        const runFn = coroutine(code, 'run');
        assert.ok(
            runFn.indexOf('await _init__fn_sensor_read()') < runFn.indexOf('await read_sensors()'),
            'the init must run before the first graph'
        );
        assert.match(runFn, /await read_sensors\(\)/);
    });

    it('declares hoisted state global in the body that reads and writes it', async () => {
        const fn = createStatefulFunctionGraph({ id: 'fn-buffer', name: 'Buffer' });
        const main = createCallingGraph({ name: 'Main', calleeGraphId: 'fn-buffer' });
        const code = await transpile([main, fn]);

        const init = coroutine(code, '_init__fn_buffer');
        assert.match(init, /global node_stateful0_out0/);
        assert.match(init, /node_stateful0_out0 = None/);

        const body = coroutine(code, '_fn_buffer');
        assert.match(body, /global node_stateful0_out0/);
        assert.match(body, /node_stateful0_out0 = push\(node_stateful0_out0, _in0_step\)/);
        assert.ok(
            body.indexOf('global node_stateful0_out0') < body.indexOf('push('),
            'the declaration must precede the first read of the shared state'
        );
    });

    it('leaves a read-only init global undeclared in the body', async () => {
        const fn = createFunctionGraph({ id: 'fn-1', name: 'Sensor Read' });
        const main = createCallingGraph({ name: 'Read Sensors' });
        const code = await transpile([main, fn]);

        const body = coroutine(code, '_fn_sensor_read');
        assert.doesNotMatch(body, /global sensor/);
        assert.match(body, /node_sensor0_out0 = sensor\.read\(_in0_channel\)/);
    });

    it('emits no parameters and `return None` without declared ports', async () => {
        const fn = createFunctionGraph({
            id: 'fn-void',
            name: 'Notify',
            inputNames: [],
            outputNames: [],
        });
        const main = createCallingGraph({
            name: 'Main',
            calleeGraphId: 'fn-void',
            arguments: [],
        });
        const code = await transpile([main, fn]);

        const body = coroutine(code, '_fn_notify');
        assert.match(body, /async def _fn_notify\(\):/);
        assert.match(body, /return None/);
        assert.match(code, /await _fn_notify\(\)/);
    });

    it('emits one parameter per declared input, in signature order', async () => {
        const fn = createFunctionGraph({
            id: 'fn-two',
            name: 'Two Inputs',
            inputNames: ['first', 'second'],
            outputNames: ['value'],
            sensorCount: 2,
        });
        const main = createCallingGraph({
            name: 'Main',
            calleeGraphId: 'fn-two',
            arguments: [1, 2],
        });
        const code = await transpile([main, fn]);

        assert.match(
            coroutine(code, '_fn_two_inputs'),
            /async def _fn_two_inputs\(_in0_first, _in1_second\):/
        );
        assert.match(code, /await _fn_two_inputs\(1, 2\)/);
    });

    it('emits the default literal of an unwired constrained input', async () => {
        const fn = createFunctionGraph({
            id: 'fn-default',
            name: 'Default Value',
            inputNames: ['amount'],
            outputNames: [],
        });
        const main = createEmitGraph({ name: 'Main' });
        main.addNode(
            'call',
            new MockNodeData({
                id: 'call',
                type: 'function_graph.fn-default',
                inputs: [
                    {
                        id: 'in_0',
                        name: 'amount',
                        defaultControl: { type: 'number', default: 4, min: 1, max: 10 },
                    },
                ],
                outputs: [],
                inputDefaults: {},
            })
        );

        const code = await transpile([main, fn]);

        assert.match(code, /await _fn_default_value\(4\)/);
    });

    it('returns a tuple for several declared outputs', async () => {
        const fn = createFunctionGraph({
            id: 'fn-pair',
            name: 'Pair',
            inputNames: ['channel'],
            outputNames: ['left', 'right'],
        });
        const main = createCallingGraph({ name: 'Main', calleeGraphId: 'fn-pair' });
        const code = await transpile([main, fn]);

        assert.match(
            coroutine(code, '_fn_pair'),
            /return \(node_sensor0_out0, node_sensor1_out0\)/
        );
    });

    it('supports transitive calls between function graphs', async () => {
        const inner = createFunctionGraph({
            id: 'fn-inner',
            name: 'Inner',
            inputNames: ['channel'],
            outputNames: ['value'],
        });
        const outer = createFunctionGraph({
            id: 'fn-outer',
            name: 'Outer',
            inputNames: ['channel'],
            outputNames: ['value'],
            sensorCount: 0,
        });
        outer.addNode(
            'innercall',
            new MockNodeData({
                id: 'innercall',
                type: 'function_graph.fn-inner',
                inputs: [{ id: 'in_0', name: 'in_0' }],
                outputs: [{ id: 'out_0', name: 'result' }],
                inputDefaults: { in_0: 7 },
            })
        );
        outer.connections = [
            { fromNode: 'in', fromIndex: 0, toNode: 'innercall', toIndex: 0 },
            { fromNode: 'innercall', fromIndex: 0, toNode: 'out', toIndex: 0 },
        ];

        const main = createCallingGraph({ name: 'Main', calleeGraphId: 'fn-outer' });
        const code = await transpile([main, outer, inner]);

        assert.match(
            coroutine(code, '_fn_outer'),
            /node_innercall_out0 = await _fn_inner\(_in0_channel\)/
        );
        assert.match(code, /await _fn_outer\(3\)/);
    });

    it('never schedules a function graph as a task', async () => {
        const fn = createFunctionGraph({ id: 'fn-1', name: 'Sensor Read' });
        const main = createCallingGraph({ name: 'Read Sensors' });
        const second = createCallingGraph({ id: 'graph-2', name: 'Other', calleeGraphId: 'fn-1' });
        const code = await transpile([main, second, fn]);

        const runFn = coroutine(code, 'run');
        assert.doesNotMatch(runFn, /create_task\(_fn_/);
        assert.match(runFn, /create_task\(read_sensors\(\)\)/);
        assert.match(runFn, /create_task\(other\(\)\)/);
        assert.match(runFn, /await asyncio\.gather\(\*tasks\)/);
    });

    it('initializes a shared function once for two call sites', async () => {
        const fn = createFunctionGraph({ id: 'fn-1', name: 'Sensor Read' });
        const first = createCallingGraph({ name: 'First' });
        const second = createCallingGraph({ id: 'graph-2', name: 'Second' });
        const code = await transpile([first, second, fn]);

        assert.equal(code.split('async def _init__fn_sensor_read()').length - 1, 1);
        assert.equal(code.split('await _init__fn_sensor_read()').length - 1, 1);
        assert.equal(code.split('sensor = make_sensor()').length - 1, 1);
    });

    it('does not hoist the init of an unreachable function graph', async () => {
        const unused = createFunctionGraph({ id: 'fn-unused', name: 'Unused' });
        const main = createEmitGraph({ name: 'Main' });
        const code = await transpile([main, unused]);

        assert.match(code, /async def _fn_unused\(_in0_channel\):/);
        assert.doesNotMatch(code, /async def _init__fn_unused\(\):/);
        assert.doesNotMatch(code, /await _init__fn_unused\(\)/);
    });

    it('keeps the output of a collection without function graphs', async () => {
        const code = await transpile([createEmitGraph({ name: 'Main', value: 5 })]);

        assert.doesNotMatch(code, /# Function/);
        assert.doesNotMatch(code, /_fn_/);
        assert.doesNotMatch(code, /graph\.function/);
        assert.match(code, /print\(5\)/);
        assert.match(code, /async def main\(\):/);
        assert.match(code, /while True:/);
    });
});
