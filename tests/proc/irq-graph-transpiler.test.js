import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const irqDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/irq/node_definitions.json'
);
const irqGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/irq/node_generators.js'
);

class MockNodeData {
    constructor({
        id,
        type,
        inputs = [],
        outputs = [],
        controls = [],
        controlValues = {},
        inputDefaults = {},
    }) {
        this.id = id;
        this.type = type;
        this.title = type;
        this.inputs = inputs;
        this.outputs = outputs;
        this.controls = controls;
        this.controlValues = controlValues;
        this.inputDefaults = inputDefaults;
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }
}

class MockGraph {
    constructor(id, name, executionType, { triggerName = '', triggerInterval = 100, enabled = true } = {}) {
        this.id = id;
        this.name = name;
        this.executionType = executionType;
        this.triggerName = triggerName;
        this.triggerInterval = triggerInterval;
        this.enabled = enabled;
        this.nodes = new Map();
        this.connections = [];
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    getTriggerInterval() {
        return this.triggerInterval;
    }

    getExecutionType() {
        return this.executionType;
    }

    getTriggerName() {
        return this.triggerName;
    }

    getEnabled() {
        return this.enabled;
    }

    getNodes() {
        const result = {};
        this.nodes.forEach((node, nodeId) => {
            result[nodeId] = node;
        });
        return result;
    }

    addNode(nodeId, node) {
        this.nodes.set(nodeId, node);
    }

    getConnections() {
        return this.connections.slice();
    }
}

class MockCollection {
    constructor(id) {
        this.id = id;
        this.graphs = new Map();
    }

    getId() {
        return this.id;
    }

    getVersion() {
        return '1.0.0';
    }

    getVersionString() {
        return '1.0.0';
    }

    getTitle() {
        return this.id;
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, graphId) => {
            result[graphId] = graph;
        });
        return result;
    }

    addGraph(graphId, graph) {
        this.graphs.set(graphId, graph);
    }
}

class MockRuntime {
    constructor() {
        this.definitions = new Map();
    }

    addNodeDefinition(type, definition) {
        this.definitions.set(type, definition);
    }

    getNodeType(type) {
        return this.definitions.get(type) || null;
    }
}

function buildRuntime() {
    const runtime = new MockRuntime();
    const defs = JSON.parse(readFileSync(irqDefsPath, 'utf8')).nodeTypes;
    for (const [type, def] of Object.entries(defs)) {
        runtime.addNodeDefinition(type, { ...def, packageId: 'irq' });
    }
    runtime.addNodeDefinition('emit', {
        title: 'Emit',
        inputs: [],
        outputs: [],
        controls: [],
        implementations: { python: { type: 'regex', value: '_ = 1' } },
    });
    // Non-interrupt fixture with a `pin` control, so the duplicate-GPIO tests can prove the
    // check only looks at `interrupt-input` declarations.
    runtime.addNodeDefinition('digital-output', {
        title: 'Digital Output',
        inputs: [],
        outputs: [],
        controls: [{ id: 'pin', type: 'number', default: 0 }],
        implementations: { python: { type: 'regex', value: '_ = 1' } },
    });
    return runtime;
}

function buildNode(type, id, runtime, controlValues = {}) {
    const def = runtime.getNodeType(type);
    const inputs = (def.inputs || []).map((input) => ({ ...input }));
    const outputs = (def.outputs || []).map((output) => ({ ...output }));
    const controls = (def.controls || []).map((control) => ({ ...control }));
    return new MockNodeData({ id, type, inputs, outputs, controls, controlValues });
}

async function transpile(collection) {
    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    return transpiler.transpile(collection, { deviceRuntime: buildRuntime() });
}

/** Wrap graphs into one collection, the unit the transpiler merges shared-init blocks over. */
function collectionOf(graphs) {
    const collection = new MockCollection('c');
    graphs.forEach((graph) => collection.addGraph(graph.id, graph));
    return collection;
}

describe('irq graph transpiler', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        await import(`${pathToFileURL(irqGeneratorsPath).href}?test=irq-graph-transpiler`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        if (originalNodeInitGenerators === undefined) delete globalThis.NodeInitGenerators;
        else globalThis.NodeInitGenerators = originalNodeInitGenerators;
    });

    it('emits the interrupt wait before the first node statement', async () => {
        const runtime = buildRuntime();
        const graph = new MockGraph('g1', 'Init', 'irq', { triggerName: 'button' });
        graph.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: 'button' }));
        graph.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('irq');
        collection.addGraph('g1', graph);

        const result = await transpile(collection);
        const code = result.code;
        const lines = code.split('\n');

        const whileIndex = lines.indexOf('    while True:');
        assert.ok(whileIndex >= 0, 'expected an irq while loop');
        assert.equal(lines[whileIndex + 1], "        await _otter_irq.wait('button')");
        assert.ok(code.includes('import otter_irq.interrupts as _otter_irq'));
        assert.ok(!code.includes('_utime'), 'an irq graph must not pull in utime');
        assert.ok(!code.includes('asyncio.sleep_ms'), 'an irq graph must not cadence');
        assert.ok(
            code.indexOf("await _otter_irq.wait('button')") < code.indexOf('_ = 1'),
            'the wait must precede the loop body'
        );
    });

    it('escapes a trigger name containing an apostrophe', async () => {
        const runtime = buildRuntime();
        const graph = new MockGraph('g1', 'Init', 'irq', { triggerName: "O'Brien" });
        graph.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: "O'Brien" }));
        graph.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('irq');
        collection.addGraph('g1', graph);

        const result = await transpile(collection);
        assert.ok(result.code.includes("await _otter_irq.wait('O\\'Brien')"));
    });


    it('treats an unknown execution type as continuous', async () => {
        const runtime = buildRuntime();
        const graph = new MockGraph('g1', 'Main', 'unknown', { triggerInterval: 100 });
        graph.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('c');
        collection.addGraph('g1', graph);

        const result = await transpile(collection);
        assert.ok(result.code.includes('import utime as _utime'));
        assert.ok(!result.code.includes('_otter_irq'));
    });

    it('keeps irqTriggerName null for startup and continuous blocks', async () => {
        const runtime = buildRuntime();
        const startup = new MockGraph('s', 'Start', 'startup');
        startup.addNode('emit', buildNode('emit', 'emit', runtime));
        const continuous = new MockGraph('c', 'Loop', 'continuous');
        continuous.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('c');
        collection.addGraph('s', startup);
        collection.addGraph('c', continuous);

        const result = await transpile(collection);
        assert.ok(!result.code.includes('_otter_irq'));
    });

    it('dispatches one irq and one continuous graph as concurrent tasks', async () => {
        const runtime = buildRuntime();
        const irq = new MockGraph('i', 'OnButton', 'irq', { triggerName: 'button' });
        irq.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: 'button' }));
        irq.addNode('emit', buildNode('emit', 'emit', runtime));
        const loop = new MockGraph('c', 'Loop', 'continuous');
        loop.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('c');
        collection.addGraph('i', irq);
        collection.addGraph('c', loop);

        const result = await transpile(collection);
        const code = result.code;
        assert.ok(code.includes('tasks = ['));
        assert.ok(code.includes('await asyncio.gather(*tasks)'));
        assert.equal((code.match(/asyncio\.create_task\(/g) || []).length, 2);
    });

    it('still runs a startup graph before the tasks', async () => {
        const runtime = buildRuntime();
        const startup = new MockGraph('s', 'Start', 'startup');
        startup.addNode('emit', buildNode('emit', 'emit', runtime));
        const irq = new MockGraph('i', 'OnButton', 'irq', { triggerName: 'button' });
        irq.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: 'button' }));
        irq.addNode('emit', buildNode('emit', 'emit', runtime));
        const loop = new MockGraph('c', 'Loop', 'continuous');
        loop.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('c');
        collection.addGraph('s', startup);
        collection.addGraph('i', irq);
        collection.addGraph('c', loop);

        const result = await transpile(collection);
        assert.ok(result.code.indexOf('await start()') < result.code.indexOf('tasks = ['));
    });

    it('ignores a leftover cadence interval on an irq graph', async () => {
        const runtime = buildRuntime();
        const graph = new MockGraph('g1', 'Init', 'irq', {
            triggerName: 'button',
            triggerInterval: 500,
        });
        graph.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: 'button' }));
        graph.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('irq');
        collection.addGraph('g1', graph);

        const result = await transpile(collection);
        assert.ok(!result.code.includes('import utime as _utime'));
    });

    it('emits begin_generation exactly once before create_input', async () => {
        const runtime = buildRuntime();
        const graph = new MockGraph('g1', 'Init', 'irq', { triggerName: 'button' });
        graph.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: 'button' }));
        graph.addNode('emit', buildNode('emit', 'emit', runtime));

        const collection = new MockCollection('irq');
        collection.addGraph('g1', graph);

        const result = await transpile(collection);
        const code = result.code;
        assert.equal(code.split('begin_generation()').length - 1, 1);
        assert.ok(code.indexOf('begin_generation()') < code.indexOf('create_input('));
    });


    describe('interrupt binding validation', () => {
        it('rejects a blank interrupt-input name', async () => {
            const runtime = buildRuntime();
            const graph = new MockGraph('g1', 'Init', 'continuous');
            graph.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: '' }));
            graph.addNode('emit', buildNode('emit', 'emit', runtime));

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /Graph "Init": interrupt input node "in" has no interrupt name/
            );
        });

        it('rejects a duplicate interrupt-input name', async () => {
            const runtime = buildRuntime();
            const graph = new MockGraph('g1', 'Init', 'continuous');
            graph.addNode('a', buildNode('interrupt-input', 'a', runtime, { triggerName: 'btn' }));
            graph.addNode('b', buildNode('interrupt-input', 'b', runtime, { triggerName: 'btn' }));
            graph.addNode('emit', buildNode('emit', 'emit', runtime));

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /the interrupt name 'btn' is declared by more than one interrupt input/
            );
        });

        it('rejects a dangling interrupt-enable name', async () => {
            const runtime = buildRuntime();
            const graph = new MockGraph('g1', 'Init', 'continuous');
            graph.addNode('e', buildNode('interrupt-enable', 'e', runtime, { triggerName: 'ghost' }));
            graph.addNode('emit', buildNode('emit', 'emit', runtime));

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /Graph "Init": interrupt enable node "e" names 'ghost', but no interrupt input declares it/
            );
        });

        it('rejects a blank interrupt-enable name', async () => {
            const runtime = buildRuntime();
            const graph = new MockGraph('g1', 'Init', 'continuous');
            graph.addNode('e', buildNode('interrupt-enable', 'e', runtime, { triggerName: '' }));
            graph.addNode('emit', buildNode('emit', 'emit', runtime));

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /Graph "Init": interrupt enable node "e" has no interrupt name/
            );
        });


        it('rejects an irq graph without a trigger name', async () => {
            const runtime = buildRuntime();
            const graph = new MockGraph('g1', 'Init', 'irq', { triggerName: '' });
            graph.addNode('emit', buildNode('emit', 'emit', runtime));

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /Graph "Init": this irq-mode graph has no interrupt name/
            );
        });

        it('rejects an irq graph whose name has no declaration', async () => {
            const runtime = buildRuntime();
            const graph = new MockGraph('g1', 'Init', 'irq', { triggerName: 'ghost' });
            graph.addNode('emit', buildNode('emit', 'emit', runtime));

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /Graph "Init": the interrupt name 'ghost' is not declared by an interrupt input/
            );
        });

        it('rejects an irq graph whose declaration lives in another graph', async () => {
            const runtime = buildRuntime();
            const declaring = new MockGraph('d', 'Decl', 'continuous');
            declaring.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: 'btn' }));
            declaring.addNode('emit', buildNode('emit', 'emit', runtime));
            const irq = new MockGraph('i', 'Init', 'irq', { triggerName: 'btn' });
            irq.addNode('emit', buildNode('emit', 'emit', runtime));

            await assert.rejects(
                () => transpile(collectionOf([declaring, irq])),
                /Graph "Init": the interrupt name 'btn' is declared by an interrupt input in a different graph/
            );
        });

        it('rejects two irq graphs bound to the same name', async () => {
            const runtime = buildRuntime();
            const first = new MockGraph('a', 'First', 'irq', { triggerName: 'btn' });
            first.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: 'btn' }));
            first.addNode('emit', buildNode('emit', 'emit', runtime));
            const second = new MockGraph('b', 'Second', 'irq', { triggerName: 'btn' });
            second.addNode('emit', buildNode('emit', 'emit', runtime));

            await assert.rejects(
                () => transpile(collectionOf([first, second])),
                /the interrupt name 'btn' is used by more than one irq-mode graph/
            );
        });

        it('accepts the happy path: one declaration, one same-graph irq, one enable elsewhere', async () => {
            const runtime = buildRuntime();
            const main = new MockGraph('m', 'Main', 'irq', { triggerName: 'btn' });
            main.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: 'btn' }));
            main.addNode('emit', buildNode('emit', 'emit', runtime));
            const other = new MockGraph('o', 'Other', 'continuous');
            other.addNode('e', buildNode('interrupt-enable', 'e', runtime, { triggerName: 'btn' }));
            other.addNode('emit', buildNode('emit', 'emit', runtime));

            const result = await transpile(collectionOf([main, other]));
            assert.ok(result.code.includes('import otter_irq.interrupts as _otter_irq'));
        });

        it('ignores a disabled graph', async () => {
            const runtime = buildRuntime();
            const enabled = new MockGraph('e', 'Enabled', 'continuous');
            enabled.addNode('emit', buildNode('emit', 'emit', runtime));
            const disabled = new MockGraph('d', 'Disabled', 'continuous', { enabled: false });
            disabled.addNode('in', buildNode('interrupt-input', 'in', runtime, { triggerName: '' }));

            const result = await transpile(collectionOf([enabled, disabled]));
            assert.ok(result.code.includes('_ = 1'));
        });
    });

    describe('duplicate interrupt GPIO', () => {
        function graphWithInputs(id, name, inputs) {
            const runtime = buildRuntime();
            const graph = new MockGraph(id, name, 'continuous');
            for (const [nodeId, controlValues] of Object.entries(inputs)) {
                graph.addNode(nodeId, buildNode('interrupt-input', nodeId, runtime, controlValues));
            }
            graph.addNode('emit', buildNode('emit', 'emit', runtime));
            return graph;
        }

        it('rejects two interrupt inputs on one GPIO in the same graph', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn', pin: 4 },
                b: { triggerName: 'knob', pin: 4 },
            });

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /Graph "Init": GPIO 4 is claimed by more than one interrupt input/
            );
        });

        it('rejects two interrupt inputs on one GPIO across graphs', async () => {
            const first = graphWithInputs('f', 'First', {
                a: { triggerName: 'btn', pin: 4 },
            });
            const second = graphWithInputs('s', 'Second', {
                b: { triggerName: 'knob', pin: 4 },
            });

            await assert.rejects(
                () => transpile(collectionOf([first, second])),
                /GPIO 4 is claimed by more than one interrupt input \(Graph "First" node "a", Graph "Second" node "b"\)\. Only one interrupt can own a GPIO\./
            );
        });

        it('lists every claim when three inputs share one GPIO', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn', pin: 4 },
                b: { triggerName: 'knob', pin: 4 },
                c: { triggerName: 'reed', pin: 4 },
            });

            await assert.rejects(() => transpile(collectionOf([graph])), (error) => {
                const claims = error.message.match(/node "[a-c]"/g) ?? [];
                assert.deepEqual(claims, ['node "a"', 'node "b"', 'node "c"']);
                return true;
            });
        });

        it('accepts two inputs on different GPIOs', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn', pin: 4 },
                b: { triggerName: 'knob', pin: 5 },
            });

            const result = await transpile(collectionOf([graph]));
            assert.equal((result.code.match(/create_input\(/g) || []).length, 2);
        });

        it('rejects two inputs with no pin as a collision on GPIO 0', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn' },
                b: { triggerName: 'knob' },
            });

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /GPIO 0 is claimed by more than one interrupt input/
            );
        });

        it('treats a missing pin and an explicit 0 as the same GPIO', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn' },
                b: { triggerName: 'knob', pin: 0 },
            });

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /GPIO 0 is claimed by more than one interrupt input/
            );
        });

        it('accepts an unset pin alongside a real GPIO', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn' },
                b: { triggerName: 'knob', pin: 4 },
            });

            const result = await transpile(collectionOf([graph]));
            assert.equal((result.code.match(/create_input\(/g) || []).length, 2);
        });

        it('compares a numeric string with its number', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn', pin: '4' },
                b: { triggerName: 'knob', pin: 4 },
            });

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /GPIO 4 is claimed by more than one interrupt input/
            );
        });

        it('reports an unsupported pin value by its trimmed text', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn', pin: ' abc ' },
                b: { triggerName: 'knob', pin: 'abc' },
            });

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /GPIO abc is claimed by more than one interrupt input/
            );
        });

        it('reports a duplicate name before a duplicate GPIO', async () => {
            const graph = graphWithInputs('g1', 'Init', {
                a: { triggerName: 'btn', pin: 4 },
                b: { triggerName: 'btn', pin: 4 },
            });

            await assert.rejects(
                () => transpile(collectionOf([graph])),
                /the interrupt name 'btn' is declared by more than one interrupt input/
            );
        });

        it('accepts a non-interrupt node on the same GPIO', async () => {
            const runtime = buildRuntime();
            const graph = new MockGraph('g1', 'Init', 'continuous');
            graph.addNode(
                'a',
                buildNode('interrupt-input', 'a', runtime, { triggerName: 'btn', pin: 4 })
            );
            graph.addNode('out', buildNode('digital-output', 'out', runtime, { pin: 4 }));
            graph.addNode('emit', buildNode('emit', 'emit', runtime));

            const result = await transpile(collectionOf([graph]));
            assert.equal((result.code.match(/create_input\(/g) || []).length, 1);
        });
    });

    describe('graph-scoped shared init', () => {
        /**
         * An irq-mode graph whose interrupt-enable node consumes its own input's `triggered`
         * output, so the loop body contains a reference to the channel.
         */
        function graphWithInterrupt(id, name, triggerName, pin) {
            const runtime = buildRuntime();
            const graph = new MockGraph(id, name, 'irq', { triggerName });
            graph.addNode('2', buildNode('interrupt-input', '2', runtime, { triggerName, pin }));
            graph.addNode('3', buildNode('interrupt-enable', '3', runtime, { triggerName }));
            graph.connections.push({ fromNode: '2', fromIndex: 0, toNode: '3', toIndex: 0 });
            return graph;
        }

        /**
         * The emitted code of one graph function, sliced up to the next `async def`.
         * @param {string} code - Generated module code.
         * @param {string} functionName - Graph function name to slice.
         * @returns {string} The function body including its `async def` line.
         */
        function bodyOf(code, functionName) {
            const start = code.indexOf(`async def ${functionName}():`);
            assert.notEqual(start, -1, `expected async def ${functionName}()`);
            const next = code.indexOf('\nasync def ', start + 1);
            return code.slice(start, next === -1 ? code.length : next);
        }

        it('keeps same-id interrupt channels apart across graphs', async () => {
            const first = graphWithInterrupt('a', 'Button A', 'buttonA', 4);
            const second = graphWithInterrupt('b', 'Button B', 'buttonB', 5);

            const result = await transpile(collectionOf([first, second]));
            const code = result.code;

            // Both graphs share one merged `init_irq_generation`, so both channels appear there.
            assert.equal((code.match(/_otter_irq\.create_input\(/g) || []).length, 2);
            assert.equal((code.match(/begin_generation\(\)/g) || []).length, 1);

            // No unscoped global survives: the two graphs would otherwise overwrite each other.
            assert.ok(!code.includes('_irq_2 ='));
            assert.ok(!code.includes('_irq_pin_2 ='));

            assert.ok(code.includes('async def button_a():'));
            assert.ok(code.includes('async def button_b():'));
            assert.ok(code.includes('_irq_button_a_2 = _otter_irq.create_input('));
            assert.ok(code.includes('_irq_pin_button_a_2 = Pin('));
            assert.ok(code.includes('_irq_button_b_2 = _otter_irq.create_input('));
            assert.ok(code.includes('_irq_pin_button_b_2 = Pin('));

            // The body reference is scoped too; only the output variable is graph-local.
            const bodyA = bodyOf(code, 'button_a');
            const bodyB = bodyOf(code, 'button_b');
            assert.ok(bodyA.includes('node_2_out0 = _irq_button_a_2.take()'));
            assert.ok(bodyB.includes('node_2_out0 = _irq_button_b_2.take()'));
            assert.ok(!bodyA.includes('_irq_button_b_2'));
            assert.ok(!bodyB.includes('_irq_button_a_2'));
        });

        it('keeps scopes distinct when two graph names sanitize the same', async () => {
            const first = graphWithInterrupt('a', 'Loop', 'buttonA', 4);
            const second = graphWithInterrupt('b', 'Loop', 'buttonB', 5);

            const result = await transpile(collectionOf([first, second]));
            const code = result.code;

            assert.ok(code.includes('async def loop():'));
            assert.ok(code.includes('async def loop_2():'));
            // Full assignment lines: `_irq_loop_2` is a prefix of `_irq_loop_2_2`.
            assert.ok(code.includes('_irq_loop_2 = _otter_irq.create_input('));
            assert.ok(code.includes('_irq_loop_2_2 = _otter_irq.create_input('));
            assert.ok(code.includes('_irq_pin_loop_2 = Pin('));
            assert.ok(code.includes('_irq_pin_loop_2_2 = Pin('));
        });
    });
});

