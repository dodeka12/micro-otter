import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const generatorsPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/irq/node_generators.js');

const PIN_IMPORT = 'from machine import Pin';
const IRQ_IMPORT = 'import otter_irq.interrupts as _otter_irq';

function formatLiteral(value) {
    if (value === undefined || value === null) return 'None';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function makeContext({
    id = '1',
    controls = {},
    inputs = [],
    outputs = [],
    connected = [],
    graph,
} = {}) {
    const imports = [];
    const context = {
        node: { id, controlValues: controls },
        inputs,
        outputs,
        outputsMeta: outputs.map((_, index) => ({ connected: connected[index] !== false })),
        helpers: {
            formatLiteral,
            registerImport(statement) {
                if (!imports.includes(statement)) {
                    imports.push(statement);
                }
            },
        },
        imports,
    };
    // The transpiler passes `graph: { id, name, scope }`; tests omit it to exercise the fallback.
    if (graph !== undefined) {
        context.graph = graph;
    }
    return context;
}

describe('irq node generators', () => {
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
        await import(`${pathToFileURL(generatorsPath).href}?test=irq-generators`);
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

    it('registers two code generators and one init generator', () => {
        assert.deepEqual(Object.keys(globalThis.NodeCodeGenerators).sort(), [
            'interruptEnable',
            'interruptInput',
        ]);
        assert.deepEqual(Object.keys(globalThis.NodeInitGenerators), ['interruptInput']);
    });

    it('interruptInput init builds the pin and the channel once', () => {
        const context = makeContext({
            controls: { pin: 4, trigger: 'rising', triggerName: 'button', debounceMs: 0 },
        });
        const result = globalThis.NodeInitGenerators.interruptInput(context);

        assert.equal(result.init.block, '_otter_irq.begin_generation()');
        assert.equal(result.init.priority, 0);
        assert.equal(
            result.init.execute,
            [
                '_irq_pin_1 = Pin(4, Pin.IN)',
                "_irq_1 = _otter_irq.create_input('button', _irq_pin_1, Pin.IRQ_RISING, 0)",
            ].join('\n')
        );
        assert.deepEqual(context.imports, [PIN_IMPORT, IRQ_IMPORT]);
    });

    it('interruptInput init maps every trigger to its Pin constant', () => {
        const expected = {
            rising: 'Pin.IRQ_RISING',
            falling: 'Pin.IRQ_FALLING',
            change: 'Pin.IRQ_RISING | Pin.IRQ_FALLING',
            low: 'Pin.IRQ_LOW_LEVEL',
            high: 'Pin.IRQ_HIGH_LEVEL',
        };
        for (const [trigger, constant] of Object.entries(expected)) {
            const context = makeContext({ controls: { pin: 2, trigger, triggerName: 'sig' } });
            const result = globalThis.NodeInitGenerators.interruptInput(context);
            assert.ok(
                result.init.execute.includes(`, ${constant}, 0)`),
                `${trigger} -> ${constant}\n${result.init.execute}`
            );
        }
    });

    it('interruptInput init falls back to rising for an unknown trigger', () => {
        const context = makeContext({ controls: { pin: 2, trigger: 'sideways' } });
        const result = globalThis.NodeInitGenerators.interruptInput(context);
        assert.ok(result.init.execute.includes('Pin.IRQ_RISING, 0)'));
    });

    it('interruptInput init applies the pull resistor only for up/down', () => {
        const up = makeContext({ controls: { pin: 5, pull: 'up' } });
        assert.ok(
            globalThis.NodeInitGenerators.interruptInput(up).init.execute.startsWith(
                '_irq_pin_1 = Pin(5, Pin.IN, Pin.PULL_UP)'
            )
        );

        const down = makeContext({ controls: { pin: 5, pull: 'down' } });
        assert.ok(
            globalThis.NodeInitGenerators.interruptInput(down).init.execute.startsWith(
                '_irq_pin_1 = Pin(5, Pin.IN, Pin.PULL_DOWN)'
            )
        );

        const none = makeContext({ controls: { pin: 5, pull: null } });
        assert.ok(
            globalThis.NodeInitGenerators.interruptInput(none).init.execute.startsWith(
                '_irq_pin_1 = Pin(5, Pin.IN)\n'
            )
        );
    });

    it('interruptInput init clamps the debounce into 0..10000 whole milliseconds', () => {
        const cases = [
            [undefined, 0],
            [-25, 0],
            [12.9, 12],
            [9999, 9999],
            [99999, 10000],
            ['abc', 0],
        ];
        for (const [debounceMs, expected] of cases) {
            const context = makeContext({ controls: { pin: 1, triggerName: 'x', debounceMs } });
            const result = globalThis.NodeInitGenerators.interruptInput(context);
            assert.ok(
                result.init.execute.endsWith(`, ${expected})`),
                `${String(debounceMs)} -> ${expected}\n${result.init.execute}`
            );
        }
    });

    it('interruptInput init trims and escapes the trigger name', () => {
        const context = makeContext({ controls: { pin: 1, triggerName: "  but'ton  " } });
        const result = globalThis.NodeInitGenerators.interruptInput(context);
        assert.ok(result.init.execute.includes("create_input('but\\'ton', _irq_pin_1"));
    });

    it('interruptInput reads only the connected outputs in connector order', () => {
        const context = makeContext({
            id: '7',
            controls: { pin: 3, triggerName: 'button' },
            outputs: ['node_7_triggered', 'node_7_count', 'node_7_state'],
            connected: [true, false, true],
        });
        const result = globalThis.NodeCodeGenerators.interruptInput(context);

        assert.equal(
            result.statement,
            ['node_7_triggered = _irq_7.take()', 'node_7_state = _irq_7.state()'].join('\n')
        );
        assert.deepEqual(result.outputs, ['node_7_triggered', 'node_7_state']);
        assert.deepEqual(context.imports, []);
    });

    it('interruptInput emits a comment when nothing is connected', () => {
        const context = makeContext({
            controls: { pin: 3, triggerName: 'button' },
            outputs: ['node_1_triggered', 'node_1_count', 'node_1_state'],
            connected: [false, false, false],
        });
        const result = globalThis.NodeCodeGenerators.interruptInput(context);

        assert.equal(result.statement, '# interrupt input outputs not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('interruptEnable toggles the named channel with the wired or default value', () => {
        const defaultContext = makeContext({ controls: { triggerName: 'button' } });
        const defaultResult = globalThis.NodeCodeGenerators.interruptEnable(defaultContext);
        assert.equal(defaultResult.statement, "_otter_irq.set_enabled('button', bool(True))");
        assert.deepEqual(defaultResult.outputs, []);
        assert.deepEqual(defaultContext.imports, [IRQ_IMPORT]);

        const wiredContext = makeContext({
            id: '4',
            controls: { triggerName: ' button ' },
            inputs: ['node_2_out0'],
        });
        const wiredResult = globalThis.NodeCodeGenerators.interruptEnable(wiredContext);
        assert.equal(wiredResult.statement, "_otter_irq.set_enabled('button', bool(node_2_out0))");
        assert.deepEqual(wiredContext.imports, [IRQ_IMPORT]);
    });

    it('interruptEnable emits a comment and no import without an interrupt name', () => {
        for (const triggerName of [undefined, '', '   ']) {
            const context = makeContext({ controls: { triggerName } });
            const result = globalThis.NodeCodeGenerators.interruptEnable(context);

            assert.equal(result.statement, '# interrupt enable has no interrupt name');
            assert.deepEqual(result.outputs, []);
            assert.deepEqual(context.imports, []);
        }
    });

    it('scopes module-level names to the graph when a scope is present', () => {
        const graph = { id: 'g', name: 'Init', scope: 'init' };

        const initContext = makeContext({
            controls: { pin: 4, triggerName: 'button' },
            graph,
        });
        const init = globalThis.NodeInitGenerators.interruptInput(initContext);
        assert.equal(
            init.init.execute,
            [
                '_irq_pin_init_1 = Pin(4, Pin.IN)',
                "_irq_init_1 = _otter_irq.create_input('button', _irq_pin_init_1, Pin.IRQ_RISING, 0)",
            ].join('\n')
        );

        const loopContext = makeContext({
            outputs: ['node_1_triggered'],
            connected: [true],
            graph,
        });
        const loop = globalThis.NodeCodeGenerators.interruptInput(loopContext);
        assert.equal(loop.statement, 'node_1_triggered = _irq_init_1.take()');
    });

    it('falls back to the unscoped name without a graph scope', () => {
        const noGraph = makeContext({ controls: { pin: 4, triggerName: 'button' } });
        assert.ok(
            globalThis.NodeInitGenerators.interruptInput(noGraph).init.execute.startsWith(
                '_irq_pin_1 = Pin(4, Pin.IN)'
            )
        );

        const blankScope = makeContext({
            controls: { pin: 4, triggerName: 'button' },
            graph: { scope: '   ' },
        });
        assert.ok(
            globalThis.NodeInitGenerators.interruptInput(blankScope).init.execute.startsWith(
                '_irq_pin_1 = Pin(4, Pin.IN)'
            )
        );

        const unsanitized = makeContext({
            controls: { pin: 4, triggerName: 'button' },
            graph: { scope: 'Graph 1' },
        });
        const result = globalThis.NodeInitGenerators.interruptInput(unsanitized);
        assert.equal(
            result.init.execute,
            [
                '_irq_pin_Graph_1_1 = Pin(4, Pin.IN)',
                "_irq_Graph_1_1 = _otter_irq.create_input('button', _irq_pin_Graph_1_1, Pin.IRQ_RISING, 0)",
            ].join('\n')
        );
    });
});
