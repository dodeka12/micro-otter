import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const generatorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/led/node_generators.js'
);

function formatLiteral(value) {
    if (value === undefined || value === null) return 'None';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (typeof value === 'string') return `'${value}'`;
    return String(value);
}

describe('led node generators', () => {
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
        await import(`${pathToFileURL(generatorsPath).href}?test=led-generators`);
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

    function loopContext(overrides = {}) {
        const imports = [];
        return {
            node: { id: '1', controlValues: { count: 60, ...(overrides.controlValues || {}) } },
            inputs: overrides.inputs || [],
            outputs: [],
            helpers: {
                registerImport(statement) {
                    imports.push(statement);
                },
                formatLiteral,
            },
            _imports: imports,
            ...overrides,
        };
    }

    it('ledNeopixelOutput init and loop reference the driver', () => {
        const initCtx = loopContext({
            controlValues: { pin: 2, count: 60, order: 'GRB', colorModel: 'rgb' },
        });
        const initResult = globalThis.NodeInitGenerators.ledNeopixelOutput(initCtx);
        assert.ok(
            initResult.statement.includes(
                "_np_1 = NeoPixel(pin=2, count=60, order='GRB', has_white=False)"
            )
        );
        assert.ok(initCtx._imports.includes('from otter_led.drivers.neopixel import NeoPixel'));

        const loopCtx = loopContext({
            inputs: ['', 'a', 'b', 'c', 'd'],
            controlValues: { colorModel: 'rgb' },
        });
        const loopResult = globalThis.NodeCodeGenerators.ledNeopixelOutput(loopCtx);
        assert.equal(loopResult.statement, 'if bool(True):\n    _np_1.write([a, b, c])');
    });

    it('ledNeopixelOutput init preserves order and derives has_white', () => {
        const rgbCtx = loopContext({
            controlValues: { pin: 2, count: 60, order: 'RGB', colorModel: 'rgb' },
        });
        const rgbResult = globalThis.NodeInitGenerators.ledNeopixelOutput(rgbCtx);
        assert.ok(
            rgbResult.statement.includes(
                "_np_1 = NeoPixel(pin=2, count=60, order='RGB', has_white=False)"
            )
        );

        const rgbwCtx = loopContext({
            controlValues: { pin: 2, count: 60, order: 'GRB', colorModel: 'rgbw' },
        });
        const rgbwResult = globalThis.NodeInitGenerators.ledNeopixelOutput(rgbwCtx);
        assert.ok(
            rgbwResult.statement.includes(
                "_np_1 = NeoPixel(pin=2, count=60, order='GRB', has_white=True)"
            )
        );
    });

    it('ledNeopixelOutput selects channels from colorModel and leaves unconnected inputs None', () => {
        const single = loopContext({ inputs: ['', 'a'], controlValues: { colorModel: 'single' } });
        assert.ok(
            globalThis.NodeCodeGenerators.ledNeopixelOutput(single).statement.includes(
                '_np_1.write([a, a, a])'
            )
        );

        const rgb = loopContext({ inputs: ['', 'a'], controlValues: { colorModel: 'rgb' } });
        assert.ok(
            globalThis.NodeCodeGenerators.ledNeopixelOutput(rgb).statement.includes(
                '_np_1.write([a, None, None])'
            )
        );

        const rgbw = loopContext({
            inputs: ['', 'a', 'b', 'c', 'd'],
            controlValues: { colorModel: 'rgbw' },
        });
        assert.ok(
            globalThis.NodeCodeGenerators.ledNeopixelOutput(rgbw).statement.includes(
                '_np_1.write([a, b, c, d])'
            )
        );

        const allNone = loopContext({ inputs: [], controlValues: { colorModel: 'rgb' } });
        assert.ok(
            globalThis.NodeCodeGenerators.ledNeopixelOutput(allNone).statement.includes(
                '_np_1.write([None, None, None])'
            )
        );
    });

    it('ledSingleOutput init and loop reference the single driver', () => {
        const initCtx = loopContext({ controlValues: { pin: 4 } });
        const initResult = globalThis.NodeInitGenerators.ledSingleOutput(initCtx);
        assert.ok(initResult.statement.includes('_single_1 = SingleLed(pin=4)'));
        assert.ok(initCtx._imports.includes('from otter_led.drivers.single import SingleLed'));

        const loopCtx = loopContext({ inputs: ['', 'node_9_out0'] });
        const loopResult = globalThis.NodeCodeGenerators.ledSingleOutput(loopCtx);
        assert.equal(loopResult.statement, 'if bool(True):\n    _single_1.write(node_9_out0)');
    });

    it('gates the neopixel write on the enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.ledNeopixelOutput(
                loopContext({ inputs, controlValues: { colorModel: 'rgb' } })
            ).statement;

        assert.equal(
            statementFor(['node_2_out0', 'a', 'b', 'c', 'd']),
            'if bool(node_2_out0):\n    _np_1.write([a, b, c])'
        );
        assert.equal(
            statementFor(['False', 'a', 'b', 'c', 'd']),
            'if bool(False):\n    _np_1.write([a, b, c])'
        );
        assert.equal(
            statementFor(['', 'a', 'b', 'c', 'd']),
            'if bool(True):\n    _np_1.write([a, b, c])'
        );
        assert.equal(
            statementFor([undefined, 'a', 'b', 'c', 'd']),
            'if bool(True):\n    _np_1.write([a, b, c])'
        );
        assert.equal(statementFor(['', 'a']).split('_np_1.write(').length - 1, 1);
    });

    it('gates the PWM strip write on the enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.ledPwmStripOutput(loopContext({ inputs })).statement;

        assert.equal(
            statementFor(['node_2_out0', 'r', 'g', 'b']),
            'if bool(node_2_out0):\n    _strip_1.write(r, g, b)'
        );
        assert.equal(
            statementFor(['False', 'r', 'g', 'b']),
            'if bool(False):\n    _strip_1.write(r, g, b)'
        );
        assert.equal(
            statementFor(['', 'r', 'g', 'b']),
            'if bool(True):\n    _strip_1.write(r, g, b)'
        );
        assert.equal(
            statementFor([undefined, 'r', 'g', 'b']),
            'if bool(True):\n    _strip_1.write(r, g, b)'
        );
        assert.equal(statementFor(['', 'r', 'g', 'b']).split('_strip_1.write(').length - 1, 1);
    });

    it('gates the single LED write on the enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.ledSingleOutput(loopContext({ inputs })).statement;

        assert.equal(
            statementFor(['node_2_out0', 'node_9_out0']),
            'if bool(node_2_out0):\n    _single_1.write(node_9_out0)'
        );
        assert.equal(
            statementFor(['False', 'node_9_out0']),
            'if bool(False):\n    _single_1.write(node_9_out0)'
        );
        assert.equal(
            statementFor(['', 'node_9_out0']),
            'if bool(True):\n    _single_1.write(node_9_out0)'
        );
        assert.equal(
            statementFor([undefined, 'node_9_out0']),
            'if bool(True):\n    _single_1.write(node_9_out0)'
        );
        assert.equal(statementFor(['', 'node_9_out0']).split('_single_1.write(').length - 1, 1);
    });

    it('ledNeopixelOutput clamps count and falls back on non-finite values', () => {
        const negative = loopContext({ controlValues: { pin: 2, count: -5 } });
        assert.ok(
            globalThis.NodeInitGenerators.ledNeopixelOutput(negative).statement.includes('count=0')
        );

        const stringCount = loopContext({ controlValues: { pin: 2, count: '8' } });
        assert.ok(
            globalThis.NodeInitGenerators.ledNeopixelOutput(stringCount).statement.includes(
                'count=8'
            )
        );

        const missing = loopContext({ controlValues: { pin: 2, count: undefined } });
        assert.ok(
            globalThis.NodeInitGenerators.ledNeopixelOutput(missing).statement.includes('count=60')
        );
    });

    it('ledNeopixelOutput whitelists color order and warns on unknown values', () => {
        const rgb = loopContext({
            controlValues: { pin: 2, count: 60, order: 'RGB', colorModel: 'rgb' },
        });
        assert.ok(
            globalThis.NodeInitGenerators.ledNeopixelOutput(rgb).statement.includes("order='RGB'")
        );

        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (message) => warnings.push(message);
        try {
            const unknown = loopContext({
                controlValues: { pin: 2, count: 60, order: 'XYZ', colorModel: 'rgb' },
            });
            assert.ok(
                globalThis.NodeInitGenerators.ledNeopixelOutput(unknown).statement.includes(
                    "order='GRB'"
                )
            );
        } finally {
            console.warn = originalWarn;
        }
        assert.ok(warnings.some((message) => message.includes("order 'XYZ'")));

        const rgbwBrg = loopContext({
            controlValues: { pin: 2, count: 60, order: 'BRG', colorModel: 'rgbw' },
        });
        assert.ok(
            globalThis.NodeInitGenerators.ledNeopixelOutput(rgbwBrg).statement.includes(
                "order='BRG', has_white=True"
            )
        );
    });
});
