import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const generatorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/vars/node_generators.js'
);

function formatLiteral(value) {
    if (value === undefined || value === null) return 'None';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (typeof value === 'string') return `'${value}'`;
    return String(value);
}

describe('vars node generators', () => {
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
        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=vars-generators`);
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
            node: { id: '1', controlValues: { name: 'buf', ...(overrides.controlValues || {}) } },
            inputs: [],
            outputs: ['node_1_out0'],
            outputsMeta: [{ connected: true }],
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

    it('varRead loop emits get with a store namespace and int 0 fallback', () => {
        const ctx = loopContext();
        const result = globalThis.NodeCodeGenerators.varRead(ctx);
        assert.ok(result.statement.includes("node_1_out0 = _store.get('default', 'buf', 0)"));
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('varRead uses the connected fallback input value', () => {
        const ctx = loopContext({ inputs: ['None', 'node_fallback'] });
        const result = globalThis.NodeCodeGenerators.varRead(ctx);
        assert.ok(result.statement.includes("_store.get('default', 'buf', node_fallback)"));
    });

    it('varWrite loop emits set with a store namespace', () => {
        const ctx = loopContext({ inputs: ['', 'None', 'node_2_out0'], outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.varWrite(ctx);
        assert.ok(result.statement.startsWith('if bool(True):\n    '));
        assert.ok(result.statement.includes("_store.set('default', 'buf', node_2_out0)"));
    });

    it('varWrite gates the set on the enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.varWrite(
                loopContext({ inputs, outputs: [], outputsMeta: [] })
            ).statement;

        assert.equal(
            statementFor(['node_2_out0', 'None', 'node_1_out0']),
            "if bool(node_2_out0):\n    _store.set('default', 'buf', node_1_out0)"
        );
        assert.equal(
            statementFor(['False', 'None', 'node_1_out0']),
            "if bool(False):\n    _store.set('default', 'buf', node_1_out0)"
        );
        assert.equal(
            statementFor(['', 'None', 'node_1_out0']),
            "if bool(True):\n    _store.set('default', 'buf', node_1_out0)"
        );
        assert.equal(
            statementFor([undefined, 'None', 'node_1_out0']),
            "if bool(True):\n    _store.set('default', 'buf', node_1_out0)"
        );
    });

    it('varRead and varWrite take the store namespace from the store input', () => {
        const readCtx = loopContext({ inputs: ['node_store_out0', '0'] });
        assert.ok(
            globalThis.NodeCodeGenerators.varRead(readCtx).statement.includes(
                "_store.get(node_store_out0, 'buf', 0)"
            )
        );
        const writeCtx = loopContext({
            inputs: ['', "'presets'", 'x'],
            outputs: [],
            outputsMeta: [],
        });
        assert.ok(
            globalThis.NodeCodeGenerators.varWrite(writeCtx).statement.includes(
                "_store.set('presets', 'buf', x)"
            )
        );
    });

    it('varRead and varWrite fall back to the default namespace for empty store inputs', () => {
        const readCtx = loopContext({ inputs: ['None', '0'] });
        assert.ok(
            globalThis.NodeCodeGenerators.varRead(readCtx).statement.includes(
                "_store.get('default', 'buf', 0)"
            )
        );
        const writeCtx = loopContext({
            inputs: ['', '', 'x'],
            outputs: [],
            outputsMeta: [],
        });
        assert.ok(
            globalThis.NodeCodeGenerators.varWrite(writeCtx).statement.includes(
                "_store.set('default', 'buf', x)"
            )
        );
    });

    it('varRead and varWrite keep a plain control value verbatim', () => {
        const readCtx = loopContext({ controlValues: { name: 'buf' }, inputs: ['None', '0'] });
        assert.equal(
            globalThis.NodeCodeGenerators.varRead(readCtx).statement,
            "node_1_out0 = _store.get('default', 'buf', 0)"
        );

        const writeCtx = loopContext({
            controlValues: { name: 'buf' },
            inputs: ['', 'None', 'x'],
            outputs: [],
            outputsMeta: [],
        });
        assert.equal(
            globalThis.NodeCodeGenerators.varWrite(writeCtx).statement,
            "if bool(True):\n    _store.set('default', 'buf', x)"
        );
    });

    it('varRead and varWrite resolve a new-name sentinel through customName', () => {
        const readCtx = loopContext({
            controlValues: { name: '__new__', customName: 'temp' },
            inputs: ['None', '0'],
        });
        assert.equal(
            globalThis.NodeCodeGenerators.varRead(readCtx).statement,
            "node_1_out0 = _store.get('default', 'temp', 0)"
        );

        const writeCtx = loopContext({
            controlValues: { name: '__new__', customName: 'temp' },
            inputs: ['', 'None', 'node_2_out0'],
            outputs: [],
            outputsMeta: [],
        });
        assert.equal(
            globalThis.NodeCodeGenerators.varWrite(writeCtx).statement,
            "if bool(True):\n    _store.set('default', 'temp', node_2_out0)"
        );
    });

    it('varRead emits an empty name for a sentinel without companion text', () => {
        const ctx = loopContext({ controlValues: { name: '__new__' }, inputs: ['None', '0'] });
        assert.equal(
            globalThis.NodeCodeGenerators.varRead(ctx).statement,
            "node_1_out0 = _store.get('default', '', 0)"
        );
    });

    it('varRead and varWrite resolve a new-store sentinel through customStore', () => {
        const readCtx = loopContext({
            controlValues: { name: 'x', customStore: 'presets' },
            inputs: ["'__new__'", '0'],
        });
        assert.equal(
            globalThis.NodeCodeGenerators.varRead(readCtx).statement,
            "node_1_out0 = _store.get('presets', 'x', 0)"
        );

        const writeCtx = loopContext({
            controlValues: { name: 'x', customStore: 'presets' },
            inputs: ['', "'__new__'", 'node_2_out0'],
            outputs: [],
            outputsMeta: [],
        });
        assert.equal(
            globalThis.NodeCodeGenerators.varWrite(writeCtx).statement,
            "if bool(True):\n    _store.set('presets', 'x', node_2_out0)"
        );
    });

    it('varRead falls back to the default namespace for an empty new-store text', () => {
        const ctx = loopContext({ inputs: ["'__new__'", '0'] });
        assert.equal(
            globalThis.NodeCodeGenerators.varRead(ctx).statement,
            "node_1_out0 = _store.get('default', 'buf', 0)"
        );
    });

    it('varStoreSave emits an edge-triggered save call', () => {
        const ctx = loopContext({ inputs: ['', 'node_btn_out0'], outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.varStoreSave(ctx);
        assert.equal(
            result.statement,
            'if bool(True):\n' +
                "    if _store.edge_trigger('save:1', node_btn_out0):\n" +
                "        _store.save('default')"
        );
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('varStoreSave gates the whole edge-trigger block', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.varStoreSave(
                loopContext({ inputs, outputs: [], outputsMeta: [] })
            ).statement;

        assert.ok(
            statementFor(['node_2_out0', 'node_btn_out0', 'node_name_out0']).startsWith(
                'if bool(node_2_out0):\n    if _store.edge_trigger('
            )
        );
        assert.ok(
            statementFor(['False', 'node_btn_out0', 'node_name_out0']).startsWith(
                'if bool(False):\n    if _store.edge_trigger('
            )
        );
        assert.ok(
            statementFor(['', 'node_btn_out0']).startsWith(
                'if bool(True):\n    if _store.edge_trigger('
            )
        );
    });

    it('varStoreLoad emits an edge-triggered load call', () => {
        const ctx = loopContext({ inputs: ['node_btn_out0'], outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.varStoreLoad(ctx);
        assert.equal(
            result.statement,
            "if _store.edge_trigger('load:1', node_btn_out0):\n" + "    _store.load('default')"
        );
    });

    it('varStoreSave honors a connected store name input', () => {
        const ctx = loopContext({
            inputs: ['', 'False', 'node_name_out0'],
            outputs: [],
            outputsMeta: [],
        });
        const result = globalThis.NodeCodeGenerators.varStoreSave(ctx);
        assert.ok(
            result.statement.includes(
                "    if _store.edge_trigger('save:1', False):\n        _store.save(node_name_out0)"
            )
        );
    });

    it('arrayGenerate init emits a None assignment', () => {
        const ctx = loopContext();
        const result = globalThis.NodeInitGenerators.arrayGenerate(ctx);
        assert.equal(result, 'node_1_out0 = None');
        assert.ok(ctx._imports.includes('import otter_vars.arrays as _arr'));
    });

    it('arrayGenerate init returns empty when its output is unconnected', () => {
        const ctx = loopContext({ outputs: [], outputsMeta: [] });
        assert.equal(globalThis.NodeInitGenerators.arrayGenerate(ctx), '');
    });

    it('arrayGenerate loop reuses its previous output buffer', () => {
        const ctx = loopContext({ inputs: ['4'] });
        const result = globalThis.NodeCodeGenerators.arrayGenerate(ctx);
        assert.ok(result.statement.includes('node_1_out0 = _arr.generate(node_1_out0, 4)'));
        assert.ok(ctx._imports.includes('import otter_vars.arrays as _arr'));
    });

    it('arrayModify emits a wrapped shift call', () => {
        const ctx = loopContext({
            inputs: ['src', '1'],
            controlValues: { wrap: true, clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(
            result.statement.includes('_arr.shift(src, 1, wrap=True, clamp=False, inplace=False)')
        );
    });

    it('arrayModify emits an unwrapped in-place shift', () => {
        const ctx = loopContext({
            inputs: ['src', '1'],
            controlValues: { wrap: false, clamp: true, inplace: true },
        });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(
            result.statement.includes('_arr.shift(src, 1, wrap=False, clamp=True, inplace=True)')
        );
    });

    it('arrayModify honours the shift modifyType selector', () => {
        const ctx = loopContext({
            inputs: ['src', '1'],
            controlValues: { modifyType: 'shift', wrap: true, clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(
            result.statement.includes('_arr.shift(src, 1, wrap=True, clamp=False, inplace=False)')
        );
    });

    it('arrayModify falls back to shift for an unknown modify type', () => {
        const ctx = loopContext({
            inputs: ['src', '1'],
            controlValues: { modifyType: 'bogus', wrap: true, clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(
            result.statement.includes('_arr.shift(src, 1, wrap=True, clamp=False, inplace=False)')
        );
    });

    it('arrayModify repeats an array the requested number of times', () => {
        const ctx = loopContext({
            inputs: ['src', '1', 'None', '3'],
            controlValues: { modifyType: 'repeat', clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(result.statement.includes('_arr.repeat(src, 3, clamp=False)'));
    });

    it('arrayModify maps pingPong onto the ping_pong runtime function', () => {
        const ctx = loopContext({
            inputs: ['src', '1', 'None', '2'],
            controlValues: { modifyType: 'pingPong', clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(result.statement.includes('_arr.ping_pong(src, 2, clamp=False)'));
    });

    it('arrayModify concatenates the second array', () => {
        const ctx = loopContext({
            inputs: ['src', '1', 'other', '1'],
            controlValues: { modifyType: 'concat', clamp: true },
        });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(result.statement.includes('_arr.concat(src, other, clamp=True)'));
    });

    it('arrayModify interlaces with step and offset', () => {
        const ctx = loopContext({
            inputs: ['src', '1', 'other', '1', '3', '2'],
            controlValues: { modifyType: 'interlace', clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(result.statement.includes('_arr.interlace(src, other, 3, 2, clamp=False)'));
    });

    it('arrayModify falls back to the documented defaults when only the source is wired', () => {
        const repeat = globalThis.NodeCodeGenerators.arrayModify(
            loopContext({ inputs: ['src'], controlValues: { modifyType: 'repeat' } })
        );
        assert.ok(repeat.statement.includes('_arr.repeat(src, 1, clamp=False)'));

        const interlace = globalThis.NodeCodeGenerators.arrayModify(
            loopContext({ inputs: ['src'], controlValues: { modifyType: 'interlace' } })
        );
        assert.ok(interlace.statement.includes('_arr.interlace(src, None, 2, 0, clamp=False)'));
    });

    it('arrayModify returns a comment when its output is unconnected', () => {
        const ctx = loopContext({ outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.arrayModify(ctx);
        assert.ok(result.statement.includes('array-modify output not connected'));
        assert.deepEqual(result.outputs, []);
    });

    it('arraySet emits a set call with a scalar value', () => {
        const ctx = loopContext({
            inputs: ['src', '2', '0.75'],
            controlValues: { setType: 'set', indexMode: 'clamp', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes(
                "_arr.set(src, 2, 0.75, mode='clamp', clamp=False, inplace=False)"
            )
        );
    });

    it('arraySet emits a set call with wrap mode', () => {
        const ctx = loopContext({
            inputs: ['src', '2', '0.75'],
            controlValues: { setType: 'set', indexMode: 'wrap', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(result.statement.includes("mode='wrap'"));
    });

    it('arraySet emits a setIndices call', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0.5', 'idx'],
            controlValues: { setType: 'setIndices', indexMode: 'clamp', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes(
                "_arr.set_indices(src, idx, 0.5, mode='clamp', clamp=False, inplace=False)"
            )
        );
    });

    /**
     * Builds the 18 pre-rendered input literals of `array-set` with `fill` at index 17.
     * @param {string} fill Rendered literal for the `fillValue` connector.
     * @returns {string[]} Input list in connector order.
     */
    function arraySetInputs(fill) {
        return [
            'src',
            '2',
            '0.75',
            'None',
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
            fill,
        ];
    }

    it('arraySet emits fill only for a shift mode set call with a wired fill value', () => {
        const ctx = loopContext({
            inputs: arraySetInputs('pad'),
            controlValues: { setType: 'set', indexMode: 'shift', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.equal(
            result.statement,
            "node_1_out0 = _arr.set(src, 2, 0.75, mode='shift', fill=pad, clamp=False, inplace=False)"
        );
    });

    it('arraySet falls back to a 0 fill for shift mode when fillValue is unwired', () => {
        const ctx = loopContext({
            inputs: ['src', '2', '0.75'],
            controlValues: { setType: 'set', indexMode: 'shift', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.equal(
            result.statement,
            "node_1_out0 = _arr.set(src, 2, 0.75, mode='shift', fill=0, clamp=False, inplace=False)"
        );
    });

    it('arraySet passes fill to setIndices in shift mode', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0.75', 'idx', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '-2'],
            controlValues: { setType: 'setIndices', indexMode: 'shift', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.equal(
            result.statement,
            "node_1_out0 = _arr.set_indices(src, idx, 0.75, mode='shift', fill=-2, clamp=False, inplace=False)"
        );
    });

    it('arraySet ignores fillValue outside shift mode', () => {
        const ctx = loopContext({
            inputs: arraySetInputs('pad'),
            controlValues: { setType: 'set', indexMode: 'clamp', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.equal(
            result.statement,
            "node_1_out0 = _arr.set(src, 2, 0.75, mode='clamp', clamp=False, inplace=False)"
        );
        assert.ok(!result.statement.includes('fill='));
    });

    it('arraySet emits a fill call with start and width', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0.5', '0', '2', '5'],
            controlValues: { setType: 'fill', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes('_arr.fill(src, 0.5, 2, 5, clamp=False, inplace=False)')
        );
    });

    it('arraySet emits a fill call with default bounds when unconnected', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0.5'],
            controlValues: { setType: 'fill', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes('_arr.fill(src, 0.5, 0, -1, clamp=False, inplace=False)')
        );
    });

    it('arraySet emits a ramp call with start, width, min and max', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0', '0', '2', '4', '0', '0', '-1', '2'],
            controlValues: { setType: 'ramp', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes('_arr.ramp(src, 2, 4, -1, 2, clamp=False, inplace=False)')
        );
    });

    it('arraySet emits a steps call with start, stepWidth, numSteps, min and max', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0', '0', '1', '0', '2', '3', '0', '1'],
            controlValues: { setType: 'steps', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes('_arr.steps(src, 1, 2, 3, 0, 1, clamp=False, inplace=False)')
        );
    });

    it('arraySet emits a hat call with start and width', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0', '0', '1', '4', '0', '0', '0', '1'],
            controlValues: { setType: 'hat', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes('_arr.hat(src, 1, 4, 0, 1, clamp=False, inplace=False)')
        );
    });

    it('arraySet maps sin, square and sawtooth to the runtime waveform names', () => {
        for (const [setType, runtimeOp] of [
            ['sin', 'sin_wave'],
            ['square', 'square_wave'],
            ['sawtooth', 'sawtooth_wave'],
        ]) {
            const ctx = loopContext({
                inputs: ['src', '0', '0', '0', '2', '0', '0', '0', '0', '0', '8', '2', '0', '0.5', '0.5', '0', '0', '0'],
                controlValues: { setType, clamp: false, inplace: false },
            });
            const result = globalThis.NodeCodeGenerators.arraySet(ctx);
            assert.ok(
                result.statement.includes(
                    `_arr.${runtimeOp}(src, 2, 8, 2, 0, 0.5, 0.5, clamp=False, inplace=False)`
                ),
                result.statement
            );
        }
    });

    it('arraySet emits a random_uniform call without a seed', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0', '0', '0', '0', '0', '0', '0', '1', '0', '0', '0', '0', '0', '0', '0', '42'],
            controlValues: { setType: 'randomUniform', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes('_arr.random_uniform(src, 0, 1, clamp=False, inplace=False)')
        );
    });

    it('arraySet emits a random_normal call with default arguments', () => {
        const ctx = loopContext({
            inputs: ['src'],
            controlValues: { setType: 'randomNormal', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes(
                '_arr.random_normal(src, 0.5, 0.15, 0, 1, clamp=False, inplace=False)'
            )
        );
    });

    it('arraySet falls back to set for an unknown set type', () => {
        const ctx = loopContext({
            inputs: ['src', '2', '0.5'],
            controlValues: { setType: 'bogus', indexMode: 'clamp', clamp: false, inplace: false },
        });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(
            result.statement.includes("_arr.set(src, 2, 0.5, mode='clamp', clamp=False, inplace=False)")
        );
    });

    it('arraySet returns a comment when its output is unconnected', () => {
        const ctx = loopContext({ outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.arraySet(ctx);
        assert.ok(result.statement.includes('array-set output not connected'));
        assert.deepEqual(result.outputs, []);
    });
    it('randomValue emits a uniform call by default', () => {
        const ctx = loopContext();
        const result = globalThis.NodeCodeGenerators.randomValue(ctx);
        assert.equal(
            result.statement,
            'node_1_out0 = _arr.random_uniform_value(0, 1, integer=False)'
        );
        assert.deepEqual(result.outputs, ['node_1_out0']);
        assert.ok(ctx._imports.includes('import otter_vars.arrays as _arr'));
    });

    it('randomValue emits a normal call with its wired inputs', () => {
        const ctx = loopContext({
            inputs: ['-2', '4', '1', '0.5'],
            controlValues: { distribution: 'normal' },
        });
        const result = globalThis.NodeCodeGenerators.randomValue(ctx);
        assert.equal(
            result.statement,
            'node_1_out0 = _arr.random_normal_value(1, 0.5, -2, 4, integer=False)'
        );
    });

    it('randomValue emits integer=True for the int value type', () => {
        const ctx = loopContext({
            inputs: ['0', '10'],
            controlValues: { valueType: 'int' },
        });
        const result = globalThis.NodeCodeGenerators.randomValue(ctx);
        assert.equal(
            result.statement,
            'node_1_out0 = _arr.random_uniform_value(0, 10, integer=True)'
        );
    });

    it('randomValue warns and falls back to uniform for an unknown distribution', () => {
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        try {
            const ctx = loopContext({ controlValues: { distribution: 'cauchy' } });
            const result = globalThis.NodeCodeGenerators.randomValue(ctx);
            assert.equal(
                result.statement,
                'node_1_out0 = _arr.random_uniform_value(0, 1, integer=False)'
            );
        } finally {
            console.warn = originalWarn;
        }
        assert.equal(warnings.length, 1);
        assert.ok(warnings[0].includes('cauchy'));
    });

    it('randomValue returns a comment when its output is unconnected', () => {
        const ctx = loopContext({ outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.randomValue(ctx);
        assert.ok(result.statement.includes('random-value output not connected'));
        assert.deepEqual(result.outputs, []);
    });

    it('randomSeed emits a scoped reseed call with defaults', () => {
        const ctx = loopContext({ outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.randomSeed(ctx);
        assert.equal(result.statement, "_arr.reseed(True, 0, key='seed:1')");
        assert.deepEqual(result.outputs, []);
        assert.ok(ctx._imports.includes('import otter_vars.arrays as _arr'));
    });

    it('randomSeed uses wired enabled and seed inputs', () => {
        const ctx = loopContext({
            node: { id: '1', controlValues: {} },
            graph: { id: 'vars' },
            inputs: ['False', '42'],
            outputs: [],
            outputsMeta: [],
        });
        const result = globalThis.NodeCodeGenerators.randomSeed(ctx);
        assert.equal(result.statement, "_arr.reseed(False, 42, key='seed:vars:1')");
    });

    it('randomSeed keeps distinct keys per node id', () => {
        const ctx = loopContext({
            node: { id: '2', controlValues: {} },
            graph: { id: 'vars' },
            inputs: ['True', '7'],
            outputs: [],
            outputsMeta: [],
        });
        const result = globalThis.NodeCodeGenerators.randomSeed(ctx);
        assert.equal(result.statement, "_arr.reseed(True, 7, key='seed:vars:2')");
    });

    it('arrayMath emits an add call with scalar operands', () => {
        const ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'add', clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.ok(result.statement.includes('_arr.add(a, b, clamp=False)'));
    });

    it('arrayMath maps modulus to the mod runtime function', () => {
        const ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'modulus', clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.ok(result.statement.includes('_arr.mod(a, b, clamp=False)'));
    });

    it('arrayMath emits power, root, and log as binary runtime calls', () => {
        for (const operation of ['power', 'root', 'log']) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation, clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.equal(
                result.statement,
                `node_1_out0 = _arr.${operation}(a, b, clamp=False)`,
                `unexpected statement for ${operation}: ${result.statement}`
            );
        }
    });

    it('arrayMath passes clamp to root and the hyperbolic operations', () => {
        for (const operation of ['root', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation, clamp: true },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            const expected =
                operation === 'root'
                    ? '_arr.root(a, b, clamp=True)'
                    : `_arr.${operation}(a, clamp=True)`;
            assert.ok(
                result.statement.includes(expected),
                `unexpected statement for ${operation}: ${result.statement}`
            );
        }
    });

    it('arrayMath emits one-argument calls for unary math operations', () => {
        for (const operation of [
            'sqrt',
            'square',
            'fraction',
            'exp',
            'ln',
            'floor',
            'ceil',
            'sinh',
            'cosh',
            'tanh',
            'asinh',
            'acosh',
            'atanh',
        ]) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation, clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.ok(
                result.statement.includes(`_arr.${operation}(a, clamp=False)`),
                `unexpected statement for ${operation}: ${result.statement}`
            );
            assert.ok(!result.statement.includes(', b,'), `${operation} must ignore input b`);
        }
    });

    it('arrayMath emits round with the configured decimal places', () => {
        const ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'round', decimalPlaces: 2, clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.ok(result.statement.includes('_arr.round(a, decimals=2, clamp=False)'));
    });

    it('arrayMath defaults the round decimal places to zero', () => {
        for (const decimalPlaces of [undefined, null, '', 'not-a-number']) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation: 'round', decimalPlaces, clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.ok(
                result.statement.includes('_arr.round(a, decimals=0, clamp=False)'),
                `unexpected statement for ${String(decimalPlaces)}: ${result.statement}`
            );
        }
    });

    it('arrayMath normalises the round decimal places to an integer in 0..6', () => {
        for (const [decimalPlaces, expected] of [
            [2.9, 2],
            [-4, 0],
            [42, 6],
        ]) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation: 'round', decimalPlaces, clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.ok(
                result.statement.includes(`_arr.round(a, decimals=${expected}, clamp=False)`),
                `unexpected statement for ${decimalPlaces}: ${result.statement}`
            );
        }
    });

    it('arrayMath passes clamp to round', () => {
        const ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'round', decimalPlaces: 3, clamp: true },
        });
        const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.ok(result.statement.includes('_arr.round(a, decimals=3, clamp=True)'));
    });

    it('arrayMath falls back to add and warns for an unsupported operation', () => {
        const originalWarn = console.warn;
        const warnings = [];
        console.warn = (...args) => warnings.push(args.join(' '));
        try {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation: 'not-an-operation', clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.ok(result.statement.includes('_arr.add(a, b, clamp=False)'));
            assert.equal(warnings.length, 1);
            assert.ok(warnings[0].includes('Unsupported array math operation'));
        } finally {
            console.warn = originalWarn;
        }
    });

    it('arrayMath returns a comment when its output is unconnected', () => {
        const ctx = loopContext({ outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.equal(result.statement, '# array-math output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('arrayMath registers the arrays import', () => {
        const ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'add', clamp: false },
        });
        globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.ok(ctx._imports.includes('import otter_vars.arrays as _arr'));
    });

    it('arrayMath emits sin with an explicit degrees angle unit', () => {
        const ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'sin', angleUnit: 'degrees', clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.ok(result.statement.includes("_arr.sin(a, angle_unit='degrees', clamp=False)"));
    });

    it('arrayMath defaults a missing angle unit to degrees', () => {
        const ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'sin', clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.ok(result.statement.includes("_arr.sin(a, angle_unit='degrees', clamp=False)"));
    });

    it('arrayMath honours a radians angle unit', () => {
        const ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'sin', angleUnit: 'radians', clamp: false },
        });
        const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
        assert.ok(result.statement.includes("_arr.sin(a, angle_unit='radians', clamp=False)"));
    });

    it('arrayMath emits every trigonometric operation with the selected angle unit', () => {
        for (const operation of ['cos', 'tan', 'asin', 'acos', 'atan']) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation, angleUnit: 'radians', clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.ok(
                result.statement.includes(
                    `_arr.${operation}(a, angle_unit='radians', clamp=False)`
                ),
                `unexpected statement for ${operation}: ${result.statement}`
            );
        }
    });

    it('arrayMath emits atan2 with both operands and the angle unit', () => {
        const degreesCtx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'atan2', angleUnit: 'degrees', clamp: false },
        });
        assert.ok(
            globalThis.NodeCodeGenerators.arrayMath(degreesCtx).statement.includes(
                "_arr.atan2(a, b, angle_unit='degrees', clamp=False)"
            )
        );

        const percentCtx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'atan2', angleUnit: 'percent', clamp: false },
        });
        assert.ok(
            globalThis.NodeCodeGenerators.arrayMath(percentCtx).statement.includes(
                "_arr.atan2(a, b, angle_unit='percent', clamp=False)"
            )
        );
    });

    it('arrayMath passes clamp=True for unary, trigonometric and atan2 operations', () => {
        const unaryCtx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'sqrt', clamp: true },
        });
        assert.ok(
            globalThis.NodeCodeGenerators.arrayMath(unaryCtx).statement.includes(
                '_arr.sqrt(a, clamp=True)'
            )
        );

        const trigCtx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'cos', angleUnit: 'degrees', clamp: true },
        });
        assert.ok(
            globalThis.NodeCodeGenerators.arrayMath(trigCtx).statement.includes(
                "_arr.cos(a, angle_unit='degrees', clamp=True)"
            )
        );

        const atan2Ctx = loopContext({
            inputs: ['a', 'b'],
            controlValues: { operation: 'atan2', angleUnit: 'degrees', clamp: true },
        });
        assert.ok(
            globalThis.NodeCodeGenerators.arrayMath(atan2Ctx).statement.includes(
                "_arr.atan2(a, b, angle_unit='degrees', clamp=True)"
            )
        );
    });

    it('arrayMath passes clamp=True for power, ln and log', () => {
        for (const [operation, expected] of [
            ['power', '_arr.power(a, b, clamp=True)'],
            ['ln', '_arr.ln(a, clamp=True)'],
            ['log', '_arr.log(a, b, clamp=True)'],
        ]) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation, clamp: true },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.ok(
                result.statement.includes(expected),
                `unexpected statement for ${operation}: ${result.statement}`
            );
        }
    });

    it('arrayMath emits length, mean and median reductions', () => {
        for (const [operation, expected] of [
            ['length', 'node_1_out0 = _arr.length(a)'],
            ['mean', 'node_1_out0 = _arr.mean(a, clamp=False)'],
            ['median', 'node_1_out0 = _arr.median(a, clamp=False)'],
        ]) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation, clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.equal(result.statement, expected, `unexpected statement for ${operation}`);
            assert.ok(!result.statement.includes(', b,'), `${operation} must ignore input b`);
        }
    });

    it('arrayMath maps min and max to mo_min and mo_max with percent', () => {
        for (const [operation, runtimeOp] of [
            ['min', 'mo_min'],
            ['max', 'mo_max'],
        ]) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation, percent: 25, clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.equal(
                result.statement,
                `node_1_out0 = _arr.${runtimeOp}(a, percent=25, clamp=False)`,
                `unexpected statement for ${operation}`
            );
            assert.ok(!result.statement.includes(', b,'), `${operation} must ignore input b`);
        }
    });

    it('arrayMath defaults the min/max percent to 100', () => {
        for (const percent of [undefined, null, '', 'not-a-number', Number.NaN]) {
            for (const [operation, runtimeOp] of [
                ['min', 'mo_min'],
                ['max', 'mo_max'],
            ]) {
                const ctx = loopContext({
                    inputs: ['a', 'b'],
                    controlValues: { operation, percent, clamp: false },
                });
                const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
                assert.equal(
                    result.statement,
                    `node_1_out0 = _arr.${runtimeOp}(a, percent=100, clamp=False)`,
                    `unexpected statement for ${operation} with ${String(percent)}`
                );
            }
        }
    });

    it('arrayMath clamps the min/max percent to 0..100', () => {
        for (const [percent, expected] of [
            [-10, 0],
            [150, 100],
            [12.5, 12.5],
        ]) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation: 'max', percent, clamp: false },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.equal(
                result.statement,
                `node_1_out0 = _arr.mo_max(a, percent=${expected}, clamp=False)`,
                `unexpected statement for ${percent}`
            );
        }
    });

    it('arrayMath passes clamp to reductions', () => {
        for (const [operation, expected] of [
            ['mean', '_arr.mean(a, clamp=True)'],
            ['median', '_arr.median(a, clamp=True)'],
            ['min', '_arr.mo_min(a, percent=100, clamp=True)'],
            ['max', '_arr.mo_max(a, percent=100, clamp=True)'],
        ]) {
            const ctx = loopContext({
                inputs: ['a', 'b'],
                controlValues: { operation, clamp: true },
            });
            const result = globalThis.NodeCodeGenerators.arrayMath(ctx);
            assert.ok(
                result.statement.includes(expected),
                `unexpected statement for ${operation}: ${result.statement}`
            );
        }
    });

    it('arraySelect emits the default mode call', () => {
        const ctx = loopContext({
            inputs: ['node_2_out0', '2', '0'],
            controlValues: { indexMode: 'default' },
        });
        const result = globalThis.NodeCodeGenerators.arraySelect(ctx);
        assert.equal(
            result.statement,
            "node_1_out0 = _arr.select(node_2_out0, 2, 0, mode='default')"
        );
        assert.deepEqual(result.outputs, ['node_1_out0']);
    });

    it('arraySelect emits clamp and wrap', () => {
        for (const indexMode of ['clamp', 'wrap']) {
            const ctx = loopContext({
                inputs: ['node_2_out0', '2', '0'],
                controlValues: { indexMode },
            });
            const result = globalThis.NodeCodeGenerators.arraySelect(ctx);
            assert.equal(
                result.statement,
                `node_1_out0 = _arr.select(node_2_out0, 2, 0, mode='${indexMode}')`
            );
        }
    });

    it('arraySelect defaults the mode when the control is missing', () => {
        const ctx = loopContext({ inputs: ['src', '0', '0.5'], controlValues: {} });
        const result = globalThis.NodeCodeGenerators.arraySelect(ctx);
        assert.ok(result.statement.includes("mode='default'"), result.statement);
    });

    it('arraySelect falls back to default mode when the mode is unknown', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0.5'],
            controlValues: { indexMode: 'mirror' },
        });
        const originalWarn = console.warn;
        const warnings = [];
        console.warn = (...args) => warnings.push(args);
        let result;
        try {
            result = globalThis.NodeCodeGenerators.arraySelect(ctx);
        } finally {
            console.warn = originalWarn;
        }
        assert.ok(result.statement.includes("mode='default'"), result.statement);
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0][0], 'Unsupported array select index mode:');
    });

    it('arraySelect uses None for an unconnected array', () => {
        const ctx = loopContext({
            inputs: [undefined, '0', '0'],
            controlValues: { indexMode: 'default' },
        });
        const result = globalThis.NodeCodeGenerators.arraySelect(ctx);
        assert.equal(result.statement, "node_1_out0 = _arr.select(None, 0, 0, mode='default')");
    });

    it('arraySelect returns a comment when its output is unconnected', () => {
        const ctx = loopContext({ outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.arraySelect(ctx);
        assert.ok(result.statement.includes('array-select output not connected'));
        assert.deepEqual(result.outputs, []);
    });

    it('arraySelect registers the arrays import', () => {
        const ctx = loopContext({
            inputs: ['src', '0', '0'],
            controlValues: { indexMode: 'wrap' },
        });
        globalThis.NodeCodeGenerators.arraySelect(ctx);
        assert.ok(ctx._imports.includes('import otter_vars.arrays as _arr'));
        assert.equal(ctx._imports.length, 1);
    });

describe('signal-post generator and definition', () => {
    const defsPath = path.resolve(
        'src/micro_otter/nodes/device/node_pkgs/vars/node_definitions.json'
    );

    function readSignalPost() {
        return JSON.parse(readFileSync(defsPath, 'utf8')).nodeTypes['signal-post'];
    }

    function escapingFormatLiteral(value) {
        if (typeof value === 'string') {
            return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        }
        return formatLiteral(value);
    }

    function signalContext(overrides = {}) {
        const imports = [];
        const controlValues = { signal: 'radar-run', once: true, ...(overrides.controlValues || {}) };
        return {
            node: { id: '1', controlValues, ...(overrides.node || {}) },
            graph: { id: 'g1', ...(overrides.graph || {}) },
            inputs: overrides.inputs !== undefined ? overrides.inputs : ['True', 'False'],
            outputs: overrides.outputs !== undefined ? overrides.outputs : [],
            outputsMeta: overrides.outputsMeta !== undefined ? overrides.outputsMeta : [],
            helpers: {
                registerImport(statement) {
                    imports.push(statement);
                },
                formatLiteral: escapingFormatLiteral,
            },
            _imports: imports,
        };
    }

    it('declares the enabled/fire inputs and the three controls', () => {
        const def = readSignalPost();
        assert.deepEqual(def.inputs.map((input) => input.id), ['enabled', 'fire']);
        assert.equal(def.inputs[0].name.en, 'Enabled');
        assert.equal(def.inputs[1].name.en, 'Fire');
        assert.deepEqual(
            def.controls.map((control) => control.id),
            ['signal', 'customSignal', 'once']
        );
        const signal = def.controls.find((control) => control.id === 'signal');
        assert.equal(signal.dynamicOptions.source, 'signalNames');
        assert.deepEqual(signal.dynamicOptions.newNameControls, ['customSignal']);
        assert.deepEqual(signal.dynamicOptions.newLabel, {
            en: 'Define signal…',
            de: 'Signal definieren…',
        });
        const once = def.controls.find((control) => control.id === 'once');
        assert.equal(once.default, true);
    });

    it('posts on the rising edge by default', () => {
        const ctx = signalContext();
        const result = globalThis.NodeCodeGenerators.signalPost(ctx);
        assert.ok(result.statement.includes('if bool(True):'));
        assert.ok(result.statement.includes("if _signals.edge('post:g1:1', bool(False)):"));
        assert.ok(result.statement.includes("_signals.post('radar-run')"));
        assert.ok(ctx._imports.includes('import otter_vars.signals as _signals'));
    });

    it('posts directly when once is false', () => {
        const ctx = signalContext({ controlValues: { signal: 'radar-run', once: false } });
        const result = globalThis.NodeCodeGenerators.signalPost(ctx);
        assert.ok(!result.statement.includes('_signals.edge'));
        assert.ok(result.statement.includes('if bool(False):'));
        assert.ok(result.statement.includes("_signals.post('radar-run')"));
    });

    it('resolves the sentinel through customSignal', () => {
        const ctx = signalContext({ controlValues: { signal: '__new__', customSignal: 'motion' } });
        const result = globalThis.NodeCodeGenerators.signalPost(ctx);
        assert.ok(result.statement.includes("_signals.post('motion')"));
    });

    it('emits only a comment for a blank name without importing', () => {
        const ctx = signalContext({ controlValues: { signal: '' } });
        const result = globalThis.NodeCodeGenerators.signalPost(ctx);
        assert.equal(result.statement, '# signal-post: no signal name selected');
        assert.deepEqual(result.outputs, []);
        assert.ok(!ctx._imports.includes('import otter_vars.signals as _signals'));
    });

    it('uses True/False defaults for enabled and fire', () => {
        const ctx = signalContext({ inputs: ['', ''] });
        const result = globalThis.NodeCodeGenerators.signalPost(ctx);
        assert.ok(result.statement.includes('if bool(True):'));
        assert.ok(result.statement.includes('bool(False)'));
    });

    it('scopes the edge key per graph and node', () => {
        const a = signalContext({ graph: { id: 'ga' } });
        const b = signalContext({ graph: { id: 'gb' }, node: { id: '2', controlValues: { signal: 's' } } });
        assert.ok(globalThis.NodeCodeGenerators.signalPost(a).statement.includes("'post:ga:1'"));
        assert.ok(globalThis.NodeCodeGenerators.signalPost(b).statement.includes("'post:gb:2'"));
    });

    it('escapes a quote in the signal name', () => {
        const ctx = signalContext({ controlValues: { signal: "O'Brien" } });
        const result = globalThis.NodeCodeGenerators.signalPost(ctx);
        assert.ok(result.statement.includes("_signals.post('O\\'Brien')"));
    });
});

});
