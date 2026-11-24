import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const nodeDefinitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);
const coreGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_generators.js'
);

function loadCoreDefinitions() {
    return JSON.parse(readFileSync(nodeDefinitionsPath, 'utf8'));
}

describe('core pin & conversion node definitions', () => {
    it('defines the five general nodes', () => {
        const defs = loadCoreDefinitions().nodeTypes;
        for (const id of [
            'adc-input',
            'dac-output',
            'digital-input',
            'digital-output',
            'voltage-divider',
        ]) {
            assert.ok(defs[id], `missing ${id}`);
        }
    });

    it('declares pin resource usage', () => {
        const defs = loadCoreDefinitions().nodeTypes;
        assert.equal(defs['adc-input'].resourceUsage[0].capability, 'adc.wifiSafe');
        assert.equal(defs['dac-output'].resourceUsage[0].capability, 'dac');
        assert.equal(defs['digital-input'].resourceUsage[0].capability, 'digital.input');
        assert.equal(defs['digital-output'].resourceUsage[0].capability, 'digital.output');
    });

    it('digital-input declares a targetPinPull dynamic pull control', () => {
        const pull = loadCoreDefinitions().nodeTypes['digital-input'].controls.find(
            (control) => control.id === 'pull'
        );
        assert.equal(pull.type, 'dropdown');
        assert.equal(pull.default, null);
        assert.equal(pull.dynamicOptions.source, 'targetPinPull');
        assert.ok(pull.dynamicOptions.dependsOn.includes('pin'));
        assert.equal(pull.dynamicOptions.includeUndefined, true);
    });

    it('dac-output and digital-output lead with an enabled gate input', () => {
        const defs = loadCoreDefinitions().nodeTypes;
        for (const id of ['dac-output', 'digital-output']) {
            const inputs = defs[id].inputs;
            assert.deepEqual(
                inputs.map((input) => input.id),
                ['enabled', 'value']
            );
            const enabled = inputs[0];
            assert.deepEqual(enabled.allowedTypes, ['bool']);
            assert.deepEqual(enabled.initialTypes, ['bool']);
            assert.equal(enabled.defaultControl.type, 'checkbox');
            assert.equal(enabled.defaultControl.default, true);
            assert.equal(
                enabled.description.en,
                id === 'dac-output'
                    ? 'When off, the DAC output is not updated.'
                    : 'When off, the digital output is not driven.'
            );
            assert.equal(
                enabled.description.de,
                id === 'dac-output'
                    ? 'Wenn deaktiviert, wird der DAC-Ausgang nicht aktualisiert.'
                    : 'Wenn deaktiviert, wird der digitale Ausgang nicht angesteuert.'
            );
        }
    });

    it('voltage-divider defaults top/bottom to 100/22', () => {
        const controls = loadCoreDefinitions().nodeTypes['voltage-divider'].controls;
        assert.equal(controls.find((control) => control.id === 'topK').default, 100);
        assert.equal(controls.find((control) => control.id === 'bottomK').default, 22);
    });

    it('defines adc-array as a hardware block node', () => {
        const def = loadCoreDefinitions().nodeTypes['adc-array'];
        assert.ok(def, 'missing adc-array');
        assert.equal(def.category, 'hardware');
        assert.equal(def.executionPhase, 'both');
        assert.equal(def.color, '#5b7fc7');
        assert.equal(def.shape, 'square');
        assert.deepEqual(def.inputs, []);
    });

    it('adc-array declares one loop-phase vars.array output', () => {
        const outputs = loadCoreDefinitions().nodeTypes['adc-array'].outputs;
        assert.equal(outputs.length, 1);
        assert.equal(outputs[0].id, 'samples');
        assert.equal(outputs[0].outputType, 'vars.array');
        assert.deepEqual(outputs[0].initialTypes, ['vars.array']);
        assert.equal(outputs[0].phase, 'loop');
    });

    it('adc-array exposes pin, sampleRate and blockSamples controls', () => {
        const def = loadCoreDefinitions().nodeTypes['adc-array'];
        assert.deepEqual(
            def.controls.map((control) => control.id),
            ['pin', 'sampleRate', 'blockSamples']
        );

        const pin = def.controls.find((control) => control.id === 'pin');
        assert.equal(pin.type, 'dropdown');
        assert.equal(pin.default, 1);
        assert.deepEqual(def.resourceUsage, [
            { kind: 'pin', controlId: 'pin', capability: 'adc.wifiSafe' },
        ]);

        for (const control of def.controls) {
            const text = JSON.stringify([control.id, control.label, control.description]);
            assert.doesNotMatch(text, /atten/i, `${control.id} must not reference attenuation`);
        }
    });

    it('adc-array offers the locked rate and block-size options', () => {
        const controls = loadCoreDefinitions().nodeTypes['adc-array'].controls;
        const rate = controls.find((control) => control.id === 'sampleRate');
        const block = controls.find((control) => control.id === 'blockSamples');

        assert.deepEqual(
            rate.options.map((option) => option.value),
            [1000, 2000, 5000, 10000]
        );
        assert.equal(rate.default, 5000);
        assert.ok(rate.options.some((option) => option.value === rate.default));

        assert.deepEqual(
            block.options.map((option) => option.value),
            [16, 32, 64, 128]
        );
        assert.equal(block.default, 64);
        assert.ok(block.options.some((option) => option.value === block.default));
    });

    it('adc-array ships bilingual node text', () => {
        const def = loadCoreDefinitions().nodeTypes['adc-array'];
        const texts = [
            def.title,
            def.info,
            ...def.outputs.flatMap((output) => [output.name, output.description]),
        ];
        for (const control of def.controls) {
            texts.push(control.label, control.description);
            for (const option of control.options || []) {
                texts.push(option.label);
            }
        }

        for (const text of texts) {
            assert.equal(typeof text.en, 'string', 'missing en text');
            assert.ok(text.en.length > 0, 'empty en text');
            assert.equal(typeof text.de, 'string', 'missing de text');
            assert.ok(text.de.length > 0, 'empty de text');
        }
    });
});

describe('core pin & conversion node generators', () => {
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

        const url = pathToFileURL(coreGeneratorsPath);
        await import(`${url.href}?test=core-pin-nodes`);
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

    function initContext(overrides = {}) {
        const imports = [];
        return {
            node: { id: '1', controlValues: { pin: 1, ...(overrides.controlValues || {}) } },
            helpers: {
                registerImport(statement) {
                    imports.push(statement);
                },
            },
            _imports: imports,
            ...overrides,
        };
    }

    function loopContext(overrides = {}) {
        return {
            node: { id: '1', controlValues: { ...(overrides.controlValues || {}) } },
            inputs: [],
            outputs: ['out0'],
            outputsMeta: [{ connected: true }],
            helpers: {},
            ...overrides,
        };
    }

    it('adcInput init registers machine import and constructs ADC', () => {
        const ctx = initContext();
        const result = globalThis.NodeInitGenerators.adcInput(ctx);
        assert.ok(ctx._imports.includes('from machine import ADC, Pin'));
        assert.ok(result.statement.includes('_adc_1 = ADC(Pin(1))'));
        assert.ok(result.statement.includes('_adc_1.atten(ADC.ATTN_11DB)'));
    });

    it('adcInput loop emits voltage read expression', () => {
        const result = globalThis.NodeCodeGenerators.adcInput(loopContext());
        assert.equal(result.statement, 'out0 = _adc_1.read_u16() / 65535.0 * 3.3');
        assert.deepEqual(result.outputs, ['out0']);
    });

    it('adcArray init registers machine, array and time imports', () => {
        const ctx = initContext();
        globalThis.NodeInitGenerators.adcArray(ctx);

        for (const statement of [
            'from machine import ADC, Pin',
            'import array as _array',
            'import time',
        ]) {
            const matches = ctx._imports.filter((entry) => entry === statement);
            assert.equal(matches.length, 1, `expected exactly one "${statement}" import`);
        }
    });

    it('adcArray init constructs the ADC with fixed attenuation and a 64-sample buffer', () => {
        const result = globalThis.NodeInitGenerators.adcArray(initContext());
        assert.equal(
            result.statement,
            '_adc_blk_1 = ADC(Pin(1))\n' +
                '_adc_blk_1.atten(ADC.ATTN_11DB)\n' +
                "_adc_blk_buf_1 = _array.array('f', [0.0] * 64)"
        );
    });

    it('adcArray init honors the pin and block size controls', () => {
        const result = globalThis.NodeInitGenerators.adcArray(
            initContext({ controlValues: { pin: 34, blockSamples: 128 } })
        );

        assert.ok(result.statement.includes('_adc_blk_1 = ADC(Pin(34))'));
        assert.ok(result.statement.includes('* 128)'));
    });

    it('adcArray init falls back for stale control values', () => {
        const result = globalThis.NodeInitGenerators.adcArray(
            initContext({ controlValues: { pin: 1, blockSamples: 1024 } })
        );

        assert.ok(result.statement.includes('* 64)'));
    });

    it('adcArray init never emits a read or a loop', () => {
        const result = globalThis.NodeInitGenerators.adcArray(initContext());

        assert.ok(!result.statement.includes('read_u16'));
        assert.ok(!result.statement.includes('for '));
    });

    it('dacOutput init and loop', () => {
        const init = globalThis.NodeInitGenerators.dacOutput(
            initContext({ controlValues: { pin: 25 } })
        );
        assert.ok(init.statement.includes('_dac_1 = DAC(Pin(25))'));

        const loop = globalThis.NodeCodeGenerators.dacOutput(
            loopContext({ inputs: ['', 'volts'], outputs: [] })
        );
        assert.equal(
            loop.statement,
            'if bool(True):\n    _dac_1.write(int(max(0.0, min(3.3, (volts))) / 3.3 * 255))'
        );
    });

    it('dacOutput gates the write with a connected, literal, or missing enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.dacOutput(loopContext({ inputs, outputs: [] })).statement;
        const write = '_dac_1.write(int(max(0.0, min(3.3, (volts))) / 3.3 * 255))';

        assert.equal(statementFor(['node_2_out0', 'volts']), `if bool(node_2_out0):\n    ${write}`);
        assert.equal(statementFor(['False', 'volts']), `if bool(False):\n    ${write}`);
        assert.equal(statementFor([undefined, 'volts']), `if bool(True):\n    ${write}`);
        assert.equal(statementFor(['', 'volts']), `if bool(True):\n    ${write}`);
        assert.equal(statementFor(['', 'volts']).split(write).length - 1, 1);
    });

    it('digitalInput init emits pull variants', () => {
        const none = globalThis.NodeInitGenerators.digitalInput(
            initContext({ controlValues: { pin: 0, pull: null } })
        );
        assert.ok(none.statement.includes('_pin_1 = Pin(0, Pin.IN)'));

        const up = globalThis.NodeInitGenerators.digitalInput(
            initContext({ controlValues: { pin: 0, pull: 'up' } })
        );
        assert.ok(up.statement.includes(', Pin.PULL_UP'));

        const down = globalThis.NodeInitGenerators.digitalInput(
            initContext({ controlValues: { pin: 0, pull: 'down' } })
        );
        assert.ok(down.statement.includes(', Pin.PULL_DOWN'));
    });

    it('digitalInput loop emits bool read', () => {
        const result = globalThis.NodeCodeGenerators.digitalInput(loopContext());
        assert.equal(result.statement, 'out0 = bool(_pin_1.value())');
    });

    it('digitalOutput init and loop', () => {
        const init = globalThis.NodeInitGenerators.digitalOutput(
            initContext({ controlValues: { pin: 2 } })
        );
        assert.ok(init.statement.includes('_pin_1 = Pin(2, Pin.OUT)'));

        const loop = globalThis.NodeCodeGenerators.digitalOutput(
            loopContext({ inputs: ['', 'flag'], outputs: [] })
        );
        assert.equal(loop.statement, 'if bool(True):\n    _pin_1.value(flag)');
    });

    it('digitalOutput gates the write with a connected, literal, or missing enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.digitalOutput(loopContext({ inputs, outputs: [] }))
                .statement;
        const write = '_pin_1.value(flag)';

        assert.equal(statementFor(['node_2_out0', 'flag']), `if bool(node_2_out0):\n    ${write}`);
        assert.equal(statementFor(['False', 'flag']), `if bool(False):\n    ${write}`);
        assert.equal(statementFor([undefined, 'flag']), `if bool(True):\n    ${write}`);
        assert.equal(statementFor(['', 'flag']), `if bool(True):\n    ${write}`);
        assert.equal(statementFor(['', 'flag']).split(write).length - 1, 1);
    });

    it('voltageDivider emits divider expression', () => {
        const result = globalThis.NodeCodeGenerators.voltageDivider(
            loopContext({ inputs: ['mid'], controlValues: { topK: 100, bottomK: 22 } })
        );
        assert.equal(result.statement, 'out0 = (mid) * ((100) + (22)) / (22)');
        assert.deepEqual(result.outputs, ['out0']);
    });

    it('adcArray loop emits the paced capture for the default block', () => {
        const result = globalThis.NodeCodeGenerators.adcArray(
            loopContext({ controlValues: { sampleRate: 5000, blockSamples: 64 } })
        );

        assert.equal(
            result.statement,
            '_adc_blk_next_1 = time.ticks_us()\n' +
                'for _adc_blk_i_1 in range(64):\n' +
                '    _adc_blk_buf_1[_adc_blk_i_1] = _adc_blk_1.read_u16() / 65535.0 * 3.3\n' +
                '    _adc_blk_next_1 = time.ticks_add(_adc_blk_next_1, 200)\n' +
                '    _adc_blk_wait_1 = time.ticks_diff(_adc_blk_next_1, time.ticks_us())\n' +
                '    if _adc_blk_wait_1 > 0:\n' +
                '        time.sleep_us(_adc_blk_wait_1)\n' +
                'out0 = _adc_blk_buf_1'
        );
        assert.deepEqual(result.outputs, ['out0']);
    });

    it('adcArray loop scales the sample period with the rate', () => {
        for (const [sampleRate, periodUs] of Object.entries({
            1000: 1000,
            2000: 500,
            5000: 200,
            10000: 100,
        })) {
            const result = globalThis.NodeCodeGenerators.adcArray(
                loopContext({ controlValues: { sampleRate: Number(sampleRate) } })
            );
            assert.ok(
                result.statement.includes(
                    `_adc_blk_next_1 = time.ticks_add(_adc_blk_next_1, ${periodUs})`
                ),
                `sample rate ${sampleRate} should pace at ${periodUs} us`
            );
        }
    });

    it('adcArray loop honors the block size', () => {
        for (const blockSamples of [16, 32, 128]) {
            const result = globalThis.NodeCodeGenerators.adcArray(
                loopContext({ controlValues: { blockSamples } })
            );
            assert.ok(result.statement.includes(`in range(${blockSamples}):`));
        }
    });

    it('adcArray loop falls back for stale control values', () => {
        const result = globalThis.NodeCodeGenerators.adcArray(
            loopContext({ controlValues: { sampleRate: 44100, blockSamples: 1000 } })
        );

        assert.ok(result.statement.includes('in range(64):'));
        assert.ok(result.statement.includes('time.ticks_add(_adc_blk_next_1, 200)'));
    });

    it('adcArray loop is silent when the output is unconnected', () => {
        const result = globalThis.NodeCodeGenerators.adcArray(
            loopContext({ outputsMeta: [{ connected: false }] })
        );

        assert.deepEqual(result, { statement: '# adc block output not connected', outputs: [] });
    });

    it('adc-array output fits the graph-display series input', () => {
        const coreDefs = loadCoreDefinitions().nodeTypes;
        const webviewDefinitionsPath = path.resolve(
            'src/micro_otter/nodes/device/node_pkgs/webview/node_definitions.json'
        );
        const webviewDefs = JSON.parse(readFileSync(webviewDefinitionsPath, 'utf8')).nodeTypes;

        assert.equal(coreDefs['adc-array'].outputs[0].outputType, 'vars.array');

        const seriesInput = webviewDefs['graph-display'].inputs.find((input) => input.id === 'y');
        assert.ok(seriesInput, 'graph-display needs a y input');
        assert.deepEqual(seriesInput.allowedTypes, ['vars.array']);

        const maxPoints = webviewDefs['graph-display'].controls.find(
            (control) => control.id === 'maxPoints'
        );
        assert.equal(maxPoints.default, 256);
        assert.ok(maxPoints.default >= 128, 'default tail cap must hold a full 128-sample block');
    });
});
