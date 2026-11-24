import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const audioGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/audio/node_generators.js'
);
const powerGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/power/node_generators.js'
);

describe('audio/power node generators', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;
    let originalNodeHelperGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;
        originalNodeHelperGenerators = globalThis.NodeHelperGenerators;

        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        globalThis.NodeHelperGenerators = {};

        await import(`${pathToFileURL(audioGeneratorsPath).href}?test=audio-generators`);
        await import(`${pathToFileURL(powerGeneratorsPath).href}?test=power-generators`);
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
        if (originalNodeHelperGenerators === undefined) delete globalThis.NodeHelperGenerators;
        else globalThis.NodeHelperGenerators = originalNodeHelperGenerators;
    });

    function createContext({ id = '1', controlValues = {}, inputs = [], outputs = [], graph } = {}) {
        const imports = [];
        const context = {
            node: { id, controlValues },
            inputs,
            outputs,
            helpers: {
                registerImport(statement) {
                    imports.push(statement);
                },
            },
            _imports: imports,
        };
        // The transpiler passes `graph: { id, name, scope }`; tests omit it to exercise the fallback.
        if (graph !== undefined) {
            context.graph = graph;
        }
        return context;
    }

    it('audioRuntime helper is a no-op (bootstrap/task are emitted by i2sInput init)', () => {
        assert.equal(globalThis.NodeHelperGenerators.audioRuntime(createContext()), null);
    });

    it('i2sInput bootstrap wraps _audio_task in try/except with backoff', () => {
        const context = createContext({ outputs: ['out0', 'out1'] });
        const result = globalThis.NodeInitGenerators.i2sInput(context);
        assert.ok(result.init.block.includes('try:'));
        assert.ok(result.init.block.includes('except Exception:'));
        assert.ok(result.init.block.includes('AUDIO_CHAIN.read_errors += 1'));
        assert.ok(result.init.block.includes('await asyncio.sleep_ms(1)'));
    });

    it('i2sInput init emits the chain bootstrap block and source registration', () => {
        const context = createContext({ outputs: ['out0', 'out1'] });
        const result = globalThis.NodeInitGenerators.i2sInput(context);

        assert.ok(result.init.block.includes('AUDIO_CHAIN = AudioChain()'));
        assert.ok(result.init.execute.includes('_i2s_in_1 = I2SInput('));
        assert.ok(result.init.execute.includes('i2s_id=0'));
        assert.ok(result.init.execute.includes('data_pin=7'));
        assert.ok(result.init.execute.includes('AUDIO_CHAIN.add_source(_i2s_in_1)'));
        assert.ok(result.init.block.includes('async def _audio_task():'));
        assert.ok(result.init.block.includes('await AUDIO_CHAIN.run_block()'));
        assert.ok(!result.init.execute.includes("if 'AUDIO_CHAIN' not in locals():"));
        assert.ok(!result.init.execute.includes('AUDIO_CHAIN.set_source(_i2s_in_1)'));
        assert.ok(result.init.priority === 0);
        assert.ok(!result.init.execute.includes('asyncio.create_task'));

        assert.ok(context._imports.includes('from otter_audio_viper.audio_chain import AudioChain'));
        assert.ok(context._imports.includes('from otter_audio_viper.i2s_input import I2SInput'));
    });

    it('i2sInput scopes the instance name to the graph when a scope is present', () => {
        const context = createContext({
            outputs: ['out0', 'out1'],
            graph: { id: 'g', name: 'Init', scope: 'init' },
        });
        const result = globalThis.NodeInitGenerators.i2sInput(context);

        assert.ok(result.init.execute.includes('_i2s_in_init_1 = I2SInput('));
        assert.ok(result.init.execute.includes('AUDIO_CHAIN.add_source(_i2s_in_init_1)'));
        // Without a graph the instance keeps its bare name; the existing tests above cover it.
        assert.ok(!result.init.execute.includes('_i2s_in_1 ='));
    });

    it('i2sOutput init emits the sink registration', () => {
        const context = createContext({});
        const result = globalThis.NodeInitGenerators.i2sOutput(context);

        assert.ok(result.init.execute.includes('_i2s_out_1 = I2SOutput('));
        assert.ok(result.init.execute.includes('i2s_id=1'));
        assert.ok(result.init.execute.includes('sd_pin=None'));
        assert.ok(result.init.execute.includes('AUDIO_CHAIN.set_sink(_i2s_out_1)'));
        assert.ok(result.init.execute.includes('asyncio.create_task(_audio_task())'));
    });

    it('i2sOutput init emits an explicit sd pin when set', () => {
        const context = createContext({ controlValues: { sdPin: 27 } });
        const result = globalThis.NodeInitGenerators.i2sOutput(context);
        assert.ok(result.init.execute.includes('sd_pin=27'));
    });

    it('i2sOutput init defaults gain pin to none', () => {
        const context = createContext({});
        const result = globalThis.NodeInitGenerators.i2sOutput(context);
        assert.ok(result.init.execute.includes('gain_pin=None'));
        assert.ok(!result.init.execute.includes('gain_high'));
    });

    it('i2sOutput init emits an explicit gain pin without a static gain level', () => {
        const context = createContext({ controlValues: { gainPin: 26 } });
        const result = globalThis.NodeInitGenerators.i2sOutput(context);
        assert.ok(result.init.execute.includes('gain_pin=26'));
        assert.ok(!result.init.execute.includes('gain_high'));
    });

    it('effect init generators emit add_filter with wiring-order priority', () => {
        const cases = [
            ['overdrive', 'Overdrive', '_od'],
            ['bitcrusher', 'Bitcrusher', '_bit'],
            ['squareFuzz', 'SquareFuzz', '_fuzz'],
            ['gain', 'Gain', '_gain'],
            ['pitchShifter', 'PitchShifter', '_pitch'],
            ['noise', 'Noise', '_noise'],
        ];
        for (const [name, className, prefix] of cases) {
            const context = createContext({});
            const result = globalThis.NodeInitGenerators[name](context);
            assert.ok(
                result.init.execute.includes(`${prefix}_1 = ${className}()`),
                `${name}: expected construction of ${className}`
            );
            assert.ok(
                result.init.execute.includes(`AUDIO_CHAIN.add_filter(${prefix}_1)`),
                `${name}: expected add_filter`
            );
        }
    });

    it('downsampler init passes the sample rate so the anti-alias cutoff is known', () => {
        const context = createContext({});
        const result = globalThis.NodeInitGenerators.downsampler(context);
        assert.ok(result.init.execute.includes('_ds_1 = Downsampler(rate=16000)'));
        assert.ok(result.init.execute.includes('AUDIO_CHAIN.add_filter(_ds_1)'));
        assert.ok(
            context._imports.includes('from otter_audio_viper.downsampler import Downsampler')
        );
    });

    it('effect loop generators copy parameters and enabled flag only (no per-sample calls)', () => {
        const cases = [
            ['overdrive', '_od', 'drive', ['x', '2', 'True']],
            ['bitcrusher', '_bit', 'bits', ['x', '2', '0.5', 'False']],
            ['downsampler', '_ds', 'hold', ['x', '2', '0.5', 'False', 'True']],
            ['gain', '_gain', 'volume', ['x', '2', 'True']],
            ['pitchShifter', '_pitch', 'semitones', ['x', '2', 'True']],
            ['noise', '_noise', 'level', ['x', '2', '0.5', 'True', 'False']],
        ];
        for (const [name, prefix, param, inputs] of cases) {
            const context = createContext({ inputs });
            const result = globalThis.NodeCodeGenerators[name](context);
            assert.ok(result.statement.includes(`${prefix}_1.${param} = 2`), `${name} param`);
            const enabled = inputs[inputs.length - 1];
            assert.ok(
                result.statement.includes(`${prefix}_1.enabled = ${enabled}`),
                `${name} enabled`
            );
            assert.ok(!result.statement.includes('.process('), `${name}: no per-sample call`);
        }

        const fuzz = globalThis.NodeCodeGenerators.squareFuzz(
            createContext({ inputs: ['x', '-6', '0.25', 'True', 'True'] })
        );
        assert.ok(fuzz.statement.includes('_fuzz_1.level = -6'));
        assert.ok(fuzz.statement.includes('_fuzz_1.mix = 0.25'));
        assert.ok(fuzz.statement.includes('_fuzz_1.envelopeFollow = True'));
        assert.ok(fuzz.statement.includes('_fuzz_1.enabled = True'));
    });

    it('square fuzz loop defaults to a softened (0.5) mix when unwired', () => {
        const result = globalThis.NodeCodeGenerators.squareFuzz(
            createContext({ inputs: ['x', '-6', '', 'True', 'True'] })
        );
        assert.ok(result.statement.includes('_fuzz_1.mix = 0.5'));
    });

    it('bitcrusher loop defaults to 4 dropped bits and a full wet mix', () => {
        const result = globalThis.NodeCodeGenerators.bitcrusher(
            createContext({ inputs: ['x', '', '', 'True'] })
        );
        assert.ok(result.statement.includes('_bit_1.bits = 4'));
        assert.ok(result.statement.includes('_bit_1.mix = 1'));
        assert.ok(result.statement.includes('_bit_1.enabled = True'));
    });

    it('downsampler loop emits hold, mix, antiAlias and enabled in order', () => {
        const result = globalThis.NodeCodeGenerators.downsampler(
            createContext({ inputs: ['x', '3', '0.8', 'False', 'True'] })
        );
        let cursor = -1;
        for (const fragment of [
            '_ds_1.hold = 3',
            '_ds_1.mix = 0.8',
            '_ds_1.antiAlias = False',
            '_ds_1.enabled = True',
        ]) {
            const idx = result.statement.indexOf(fragment);
            assert.ok(idx > cursor, `expected ${fragment} after the previous assignment`);
            cursor = idx;
        }

        const defaults = globalThis.NodeCodeGenerators.downsampler(
            createContext({ inputs: ['x', '', '', '', 'True'] })
        );
        assert.ok(defaults.statement.includes('_ds_1.hold = 4'));
        assert.ok(defaults.statement.includes('_ds_1.mix = 1'));
        assert.ok(defaults.statement.includes('_ds_1.antiAlias = True'));
    });

    it('filter init and loop reference otter_audio_viper.filter with rate', () => {
        const initContext = createContext({ controlValues: { sampleRate: 16000 } });
        const initResult = globalThis.NodeInitGenerators.filter(initContext);
        assert.ok(initResult.init.execute.includes('_filter_1 = Filter(rate=16000)'));
        assert.ok(initResult.init.execute.includes('AUDIO_CHAIN.add_filter(_filter_1)'));
        assert.ok(initContext._imports.includes('from otter_audio_viper.filter import Filter'));

        const loopContext = createContext({ inputs: ['x', '300', '3000', 'True'] });
        const loopResult = globalThis.NodeCodeGenerators.filter(loopContext);
        assert.ok(loopResult.statement.includes('_filter_1.low_hz = 300'));
        assert.ok(loopResult.statement.includes('_filter_1.high_hz = 3000'));
        assert.ok(loopResult.statement.includes('_filter_1.enabled = True'));
    });

    it('ring-mod init and loop reference otter_audio_viper.ring_mod with rate', () => {
        const initContext = createContext({ controlValues: { sampleRate: 16000 } });
        const initResult = globalThis.NodeInitGenerators.ringMod(initContext);
        assert.ok(initResult.init.execute.includes('_ring_1 = RingMod(rate=16000)'));
        assert.ok(initResult.init.execute.includes('AUDIO_CHAIN.add_filter(_ring_1)'));
        assert.ok(
            initContext._imports.includes('from otter_audio_viper.ring_mod import RingMod')
        );

        const loopContext = createContext({ inputs: ['x', '150', '1.0', 'True'] });
        const loopResult = globalThis.NodeCodeGenerators.ringMod(loopContext);
        assert.ok(loopResult.statement.includes('_ring_1.frequency = 150'));
        assert.ok(loopResult.statement.includes('_ring_1.depth = 1.0'));
        assert.ok(loopResult.statement.includes('_ring_1.enabled = True'));
    });

    it('noise loop copies level, threshold, envelopeFollow, and enabled', () => {
        const context = createContext({ inputs: ['x', '-12', '-20', 'True', 'True'] });
        const result = globalThis.NodeCodeGenerators.noise(context);
        assert.ok(result.statement.includes('_noise_1.level = -12'));
        assert.ok(result.statement.includes('_noise_1.threshold = -20'));
        assert.ok(result.statement.includes('_noise_1.envelopeFollow = True'));
        assert.ok(result.statement.includes('_noise_1.enabled = True'));
    });

    it('i2sInput loop copies enabled and publishes the level output', () => {
        const context = createContext({ inputs: ['True'], outputs: ['out0', 'out1'] });
        const result = globalThis.NodeCodeGenerators.i2sInput(context);
        assert.ok(result.statement.includes('_i2s_in_1.enabled = True'));
        assert.ok(result.statement.includes('out1 = _i2s_in_1.level'));
    });

    it('i2sOutput loop copies the enabled and gain-high flags', () => {
        const context = createContext({ inputs: ['x', 'False', 'False'] });
        const result = globalThis.NodeCodeGenerators.i2sOutput(context);
        assert.ok(result.statement.includes('_i2s_out_1.enabled = False'));
        assert.ok(result.statement.includes('_i2s_out_1.gain_high = False'));
    });

    it('battery init and loop reference otter_power.battery', () => {
        const initContext = createContext({ controlValues: { adcPin: 1 } });
        const initResult = globalThis.NodeInitGenerators.batteryMonitor(initContext);
        assert.ok(initResult.statement.includes('_bat_1 = BatteryMonitor('));
        assert.ok(initResult.statement.includes('adc_pin=1'));
        assert.ok(
            initContext._imports.includes('from otter_power.battery import BatteryMonitor')
        );

        const loopContext = createContext({ outputs: ['out0', 'out1', 'out2'] });
        const loopResult = globalThis.NodeCodeGenerators.batteryMonitor(loopContext);
        assert.ok(loopResult.statement.includes('_bat_1.update()'));
        assert.ok(loopResult.statement.includes('out0 = _bat_1.voltage'));
        assert.ok(loopResult.statement.includes('out1 = _bat_1.warn'));
        assert.ok(loopResult.statement.includes('out2 = _bat_1.low'));
    });

    it('oscillator init and loop reference otter_audio_viper.oscillator', () => {
        const initContext = createContext({ controlValues: { wave: 'sine' } });
        const initResult = globalThis.NodeInitGenerators.oscillator(initContext);
        assert.ok(initResult.init.execute.includes('_osc_1 = Oscillator('));
        assert.ok(initResult.init.execute.includes("wave='sine'"));
        assert.ok(initResult.init.execute.includes('AUDIO_CHAIN.add_source(_osc_1)'));
        assert.ok(!initResult.init.execute.includes('AUDIO_CHAIN.set_source(_osc_1)'));
        assert.ok(
            initContext._imports.includes('from otter_audio_viper.oscillator import Oscillator')
        );

        const loopContext = createContext({
            inputs: ['x', '440', '0', '0.5', 'True', 'True'],
            outputs: ['out0', 'out1'],
        });
        const loopResult = globalThis.NodeCodeGenerators.oscillator(loopContext);
        assert.ok(loopResult.statement.includes('_osc_1.frequency = 440'));
        assert.ok(loopResult.statement.includes('_osc_1.phase = 0'));
        assert.ok(loopResult.statement.includes('_osc_1.mix = 0.5'));
        assert.ok(loopResult.statement.includes('_osc_1.saturate = True'));
        assert.ok(loopResult.statement.includes('_osc_1.enabled = True'));
        assert.ok(loopResult.statement.includes('out1 = _osc_1.level'));
    });

    it('oscillator init registers as a filter when a block input is connected', () => {
        const context = createContext({ controlValues: { wave: 'square' } });
        context.inputSources = [
            { fromNode: '2', fromIndex: 0, toIndex: 0, fromType: 'i2s-input' },
        ];
        const result = globalThis.NodeInitGenerators.oscillator(context);
        assert.ok(result.init.execute.includes('_osc_1 = Oscillator('));
        assert.ok(result.init.execute.includes('AUDIO_CHAIN.add_filter(_osc_1)'));
        assert.ok(!result.init.execute.includes('AUDIO_CHAIN.set_source(_osc_1)'));
        assert.ok(!result.init.execute.includes('AUDIO_CHAIN.add_source(_osc_1)'));
    });
});
