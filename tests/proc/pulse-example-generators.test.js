import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const pulseGeneratorsPath = path.resolve(
    'examples/addons/node_pkgs/pulse/node_generators.js'
);

const IMPORT_BLOCK = [
    'try:',
    '    import moa_pulse as _moa_pulse',
    'except ImportError:',
    '    import moa_pulse_viper as _moa_pulse',
].join('\n');

describe('pulse example node generator', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;

        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};

        await import(`${pathToFileURL(pulseGeneratorsPath).href}?test=pulse-generators`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
    });

    function createContext({ controlValues = {}, inputs = [] } = {}) {
        const imports = new Set();
        return {
            node: { id: '1', controlValues },
            inputs,
            outputs: ['out0'],
            helpers: {
                registerImport(statement) {
                    imports.add(statement);
                },
            },
            _imports: imports,
        };
    }

    it('emits the high gate for wired inputs', () => {
        const context = createContext({
            inputs: ['sig', '500'],
            controlValues: { duty: 50 },
        });
        const result = globalThis.NodeCodeGenerators.moaPulseTick(context);
        assert.equal(
            result.expression,
            '(sig if _moa_pulse.high(time.ticks_ms(), 500, 50) else 0)'
        );
    });

    it('inverts the condition when the invert control is set', () => {
        const context = createContext({
            inputs: ['sig', '500'],
            controlValues: { duty: 50, invert: true },
        });
        const result = globalThis.NodeCodeGenerators.moaPulseTick(context);
        assert.equal(
            result.expression,
            '(sig if not _moa_pulse.high(time.ticks_ms(), 500, 50) else 0)'
        );
    });

    it('clamps and normalises the duty control', () => {
        const cases = [
            [{ duty: 150 }, 100],
            [{ duty: -5 }, 0],
            [{ duty: 'abc' }, 50],
            [{}, 50],
            [{ duty: '37.6' }, 38],
        ];
        for (const [controlValues, expected] of cases) {
            const context = createContext({ inputs: ['sig', '500'], controlValues });
            const result = globalThis.NodeCodeGenerators.moaPulseTick(context);
            assert.equal(
                result.expression,
                `(sig if _moa_pulse.high(time.ticks_ms(), 500, ${expected}) else 0)`
            );
        }
    });

    it('falls back to defaults for unwired inputs', () => {
        const context = createContext();
        const result = globalThis.NodeCodeGenerators.moaPulseTick(context);
        assert.equal(
            result.expression,
            '(1 if _moa_pulse.high(time.ticks_ms(), 1000, 50) else 0)'
        );
    });

    it('registers the time import and the guarded module import', () => {
        const context = createContext({ inputs: ['sig', '500'] });
        globalThis.NodeCodeGenerators.moaPulseTick(context);
        assert.ok(context._imports.has('import time'));
        assert.ok(context._imports.has(IMPORT_BLOCK));
    });
});
