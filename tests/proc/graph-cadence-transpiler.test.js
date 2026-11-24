// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Cadence emission tests for the graph loop transpiler.
 *
 * A continuous graph must keep the configured period between iteration starts
 * (deadline scheduling), and an interval of `0` must end the loop in a bare
 * `await asyncio.sleep_ms(0)` instead of a fixed sleep.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

/** Minimal node data shape consumed by the transpiler. */
class MockNodeData {
    constructor({ id, type, inputs = [], outputs = [], controls = [], controlValues = {} }) {
        this.id = id;
        this.type = type;
        this.title = type;
        this.inputs = inputs;
        this.outputs = outputs;
        this.controls = controls;
        this.controlValues = controlValues;
        this.inputDefaults = {};
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }
}

/** Minimal graph shape with a configurable interval accessor. */
class MockNodeGraph {
    constructor({
        id,
        name,
        executionType = 'continuous',
        triggerInterval = 500,
        omitIntervalAccessor = false,
    }) {
        this.id = id;
        this.name = name;
        this.executionType = executionType;
        this.triggerInterval = triggerInterval;
        this.nodes = new Map();
        this.connections = [];
        if (!omitIntervalAccessor) {
            this.getTriggerInterval = () => this.triggerInterval;
        }
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    getExecutionType() {
        return this.executionType;
    }

    getNodes() {
        const result = {};
        this.nodes.forEach((node, id) => {
            result[id] = node;
        });
        return result;
    }

    addNode(id, node) {
        this.nodes.set(id, node);
    }

    getConnections() {
        return this.connections.slice();
    }
}

/** Minimal collection shape consumed by the transpiler. */
class MockCollection {
    constructor() {
        this.graphs = new Map();
    }

    getId() {
        return 'cadence-collection';
    }

    getVersion() {
        return '1.0.0';
    }

    getVersionString() {
        return '1.0.0';
    }

    getTitle() {
        return 'Cadence';
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, id) => {
            result[id] = graph;
        });
        return result;
    }

    addGraph(id, graph) {
        this.graphs.set(id, graph);
    }
}

/** Runtime stub that resolves the single `emit` node definition. */
class MockRuntime {
    constructor() {
        this.defs = new Map();
    }

    addNodeDefinition(type, def) {
        this.defs.set(type, def);
    }

    getNodeType(type) {
        return this.defs.get(type) || null;
    }
}

/**
 * Build a runtime with one regex node whose statement marks the loop body.
 * @returns {MockRuntime} Runtime with the `emit` definition.
 */
function buildRuntime() {
    const runtime = new MockRuntime();
    runtime.addNodeDefinition('emit', {
        title: 'Emit',
        inputs: [],
        outputs: [{ id: 'out0', name: 'Out', outputType: 'float' }],
        controls: [{ id: 'value', type: 'number', default: 1 }],
        implementations: { python: { type: 'regex', value: 'print({{value}})' } },
    });
    return runtime;
}

/**
 * Build a graph containing one `emit` node that prints `1`.
 * @param {object} spec - Graph id/name plus interval and execution options.
 * @returns {MockNodeGraph} Graph ready for transpilation.
 */
function buildGraph(spec) {
    const { id, name, ...options } = spec;
    const graph = new MockNodeGraph({ id, name, ...options });
    graph.addNode(
        'node1',
        new MockNodeData({
            id: 'node1',
            type: 'emit',
            outputs: [{ id: 'out0', name: 'Out' }],
            controls: [{ id: 'value', type: 'number' }],
            controlValues: { value: 1 },
        })
    );
    return graph;
}

/**
 * Transpile a collection built from the given graph specifications.
 * @param {Array<object>} specs - Graph specifications (`name`, `triggerInterval`, ...).
 * @returns {Promise<string>} Generated Python code.
 */
async function transpileGraphs(specs) {
    const runtime = buildRuntime();
    const collection = new MockCollection();
    specs.forEach((spec, index) => {
        collection.addGraph(`graph${index}`, buildGraph({ id: `graph${index}`, ...spec }));
    });

    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
    return result.code;
}

/**
 * Transpile one continuous graph with the given raw interval value.
 * @param {unknown} value - Value returned by the graph's interval accessor.
 * @returns {Promise<string>} Generated Python code.
 */
async function transpileWithInterval(value) {
    return transpileGraphs([{ name: 'Cadence', triggerInterval: value }]);
}

/**
 * Slice one generated graph function out of the program.
 * @param {string} code - Generated Python code.
 * @param {string} name - Sanitized function name.
 * @returns {string} The function body, up to the next `async def`.
 */
function graphFunction(code, name) {
    const marker = `async def ${name}():`;
    const start = code.indexOf(marker);
    assert.ok(start >= 0, `expected the generated function ${name}()`);
    const next = code.indexOf('async def ', start + marker.length);
    return code.slice(start, next === -1 ? code.length : next);
}

/**
 * Count non-overlapping occurrences of a marker.
 * @param {string} code - Generated Python code.
 * @param {string} marker - Literal marker to count.
 * @returns {number} Occurrence count.
 */
function countOccurrences(code, marker) {
    return code.split(marker).length - 1;
}

/**
 * Assert the ordered deadline cadence for a positive interval.
 * @param {string} code - Generated Python code.
 * @param {number} interval - Expected cadence period in milliseconds.
 */
function assertCadence(code, interval) {
    const fn = graphFunction(code, 'cadence');
    const order = [
        '_next_run_ms = _utime.ticks_ms()',
        'while True:',
        'print(1)',
        `_next_run_ms = _utime.ticks_add(_next_run_ms, ${interval})`,
        '_wait_ms = _utime.ticks_diff(_next_run_ms, _utime.ticks_ms())',
        'if _wait_ms > 0:',
        'await asyncio.sleep_ms(_wait_ms)',
        'else:',
        'await asyncio.sleep_ms(0)',
    ];

    const indexes = order.map((marker) => {
        const index = fn.indexOf(marker);
        assert.ok(index >= 0, `expected "${marker}" in the cadence block:\n${fn}`);
        return index;
    });

    for (let i = 1; i < indexes.length; i += 1) {
        assert.ok(indexes[i - 1] < indexes[i], `expected "${order[i - 1]}" before "${order[i]}"`);
    }

    const elseIndex = indexes[indexes.length - 2];
    const resetIndex = fn.indexOf('_next_run_ms = _utime.ticks_ms()', elseIndex);
    assert.ok(
        resetIndex > elseIndex && resetIndex < indexes[indexes.length - 1],
        'else branch should reset the deadline before yielding'
    );
}

describe('graph cadence transpiler', () => {
    it('emits a deadline cadence for a positive interval', async () => {
        const code = await transpileWithInterval(500);

        assertCadence(code, 500);
        assert.equal(countOccurrences(code, 'import utime as _utime'), 1);
    });

    it('advances the deadline by the clamped interval', async () => {
        for (const [raw, expected] of [
            [1, 1],
            [250, 250],
            [60000, 60000],
            ['250.9', 250],
            [70000, 60000],
        ]) {
            const code = await transpileWithInterval(raw);
            assertCadence(code, expected);
        }
    });

    it('falls back to 500 ms when the graph exposes no usable interval', async () => {
        const withoutAccessor = await transpileGraphs([
            { name: 'Cadence', omitIntervalAccessor: true },
        ]);
        assertCadence(withoutAccessor, 500);

        const undefinedInterval = await transpileWithInterval(undefined);
        assertCadence(undefinedInterval, 500);

        const nonNumeric = await transpileWithInterval('abc');
        assertCadence(nonNumeric, 500);
    });

    it('treats 0 as a yield-only loop instead of falling back', async () => {
        const code = await transpileWithInterval(0);
        const fn = graphFunction(code, 'cadence');

        assert.ok(fn.includes('await asyncio.sleep_ms(0)'));
        assert.equal(fn.includes('_next_run_ms'), false);
        assert.equal(fn.includes('ticks_add'), false);
        assert.equal(code.includes('import utime as _utime'), false);
        assert.equal(countOccurrences(fn, 'await asyncio.sleep_ms'), 1);
    });

    it('clamps a negative interval to the yield path', async () => {
        const code = await transpileWithInterval(-25);
        const fn = graphFunction(code, 'cadence');

        assert.ok(fn.includes('await asyncio.sleep_ms(0)'));
        assert.equal(fn.includes('_next_run_ms'), false);
        assert.equal(code.includes('import utime as _utime'), false);
    });

    it('keeps startup graphs free of the cadence block', async () => {
        const code = await transpileGraphs([
            { name: 'Init', executionType: 'startup', triggerInterval: 1234 },
        ]);

        assert.ok(code.includes('async def init():'));
        assert.equal(code.includes('_next_run_ms'), false);
        assert.equal(code.includes('ticks_add'), false);
        assert.equal(code.includes('asyncio.sleep_ms(1234)'), false);
        assert.equal(code.includes('import utime as _utime'), false);
    });

    it('shares one cadence import and only cadences the non-zero graph', async () => {
        const code = await transpileGraphs([
            { name: 'YieldOnly', triggerInterval: 0 },
            { name: 'Timed', triggerInterval: 500 },
        ]);

        assert.equal(countOccurrences(code, 'import utime as _utime'), 1);

        const yieldOnly = graphFunction(code, 'yieldonly');
        assert.ok(yieldOnly.includes('await asyncio.sleep_ms(0)'));
        assert.equal(yieldOnly.includes('_next_run_ms'), false);

        const timed = graphFunction(code, 'timed');
        assert.ok(timed.includes('_next_run_ms = _utime.ticks_ms()'));
        assert.ok(timed.includes('_next_run_ms = _utime.ticks_add(_next_run_ms, 500)'));

        assert.equal(countOccurrences(code, 'ticks_add('), 1);
    });

    it('initializes one independent deadline per continuous graph', async () => {
        const code = await transpileGraphs([
            { name: 'First', triggerInterval: 500 },
            { name: 'Second', triggerInterval: 250 },
        ]);

        const first = graphFunction(code, 'first');
        const second = graphFunction(code, 'second');

        assert.equal(countOccurrences(first, '_next_run_ms = _utime.ticks_ms()'), 2);
        assert.equal(countOccurrences(second, '_next_run_ms = _utime.ticks_ms()'), 2);
        assert.equal(countOccurrences(code, 'ticks_add('), 2);
        assert.equal(countOccurrences(code, 'import utime as _utime'), 1);

        assert.ok(first.includes('ticks_add(_next_run_ms, 500)'));
        assert.ok(second.includes('ticks_add(_next_run_ms, 250)'));
    });
});
