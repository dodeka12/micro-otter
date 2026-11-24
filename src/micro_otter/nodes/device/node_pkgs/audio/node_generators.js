// Audio node generators (Phase 4).
// Emits the shared AUDIO_CHAIN bootstrap, per-node chain registration (source /
// filters / sink), the `_audio_task` streaming loop, and per-tick parameter copies.
// Instance names are scoped to the graph (`_i2s_in_<scope>_<id>`): every graph's shared-init
// contribution is merged into one function while node ids restart per graph, so an unscoped name
// would let a second graph's instance overwrite the first. The fixed program-wide singletons
// (`AUDIO_CHAIN`, `_audio_task`, `_audio_started`) stay unscoped and are emitted once.

(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }
    if (!globalScope.NodeInitGenerators) {
        globalScope.NodeInitGenerators = {};
    }
    if (!globalScope.NodeHelperGenerators) {
        globalScope.NodeHelperGenerators = {};
    }

    function getHelpers(context) {
        return (context && context.helpers) || {};
    }

    function registerImport(context, statement) {
        const helpers = getHelpers(context);
        if (helpers && typeof helpers.registerImport === 'function') {
            helpers.registerImport(statement);
        }
    }

    function formatLiteral(value, context) {
        const helpers = getHelpers(context);
        if (helpers && typeof helpers.formatLiteral === 'function') {
            return helpers.formatLiteral(value);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : '0';
        }
        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }
        if (typeof value === 'string') {
            const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `'${escaped}'`;
        }
        if (value === null || value === undefined) {
            return 'None';
        }
        return String(value);
    }

    function nodeId(context) {
        return (context && context.node && context.node.id) ?? 'node';
    }

    /**
     * Graph scope for generator-owned module-level names.
     *
     * Every graph's shared-init contribution is merged into one collection-wide function while node
     * ids restart in each graph, so an unscoped instance name from two graphs would overwrite each
     * other. The transpiler passes the graph's generated function name as `context.graph.scope`,
     * which makes `<prefix>_<scope>_<id>` unique per graph. A context without a graph (unit tests,
     * generators run outside the transpiler) yields no scope and keeps the bare `<prefix>_<id>`
     * shape.
     *
     * Editor-created node ids are numeric, so `<scope>_<id>` cannot be misread; a hand-edited id
     * containing `_` is the one shape the delimiter could confuse.
     *
     * @param {object} context - Generator context.
     * @returns {string} Sanitized scope, or `''` when the context has none.
     */
    function graphScope(context) {
        const scope = context && context.graph ? context.graph.scope : undefined;
        if (typeof scope !== 'string' || scope.trim() === '') {
            return '';
        }
        return scope.trim().replace(/[^A-Za-z0-9_]/g, '_');
    }

    /**
     * Build a module-level name for a node, scoped to the current graph when one is available.
     * @param {object} context - Generator context.
     * @param {string} prefix - Name prefix such as `_i2s_in` or `_filter`.
     * @returns {string} `<prefix>_<scope>_<id>`, or `<prefix>_<id>` without a graph scope.
     */
    function varName(context, prefix) {
        const raw = String(nodeId(context)).replace(/[^A-Za-z0-9_]/g, '_');
        const scope = graphScope(context);
        return scope ? `${prefix}_${scope}_${raw}` : `${prefix}_${raw}`;
    }

    function controlValues(context) {
        return (context && context.node && context.node.controlValues) || {};
    }

    function inputRef(context, index, fallback) {
        const inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        const value = inputs[index];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    }

    function outputRef(context, index) {
        const outputs = Array.isArray(context && context.outputs) ? context.outputs : [];
        return outputs[index] ?? null;
    }
    function registerSource(context, className, modulePath, prefix, args) {
        registerImport(context, 'from otter_audio_viper.audio_chain import AudioChain');
        registerImport(context, `from ${modulePath} import ${className}`);

        const inst = varName(context, prefix);
        // AUDIO_CHAIN must exist before any filter/sink/source registration runs and
        // before _audio_task is started. Emit it as a shared-init block with the lowest
        // priority so it is always placed at the top of init_audio regardless of this
        // node's topological position (a filter/sink can precede the first source when
        // its block input is unwired). Identical blocks from multiple sources are
        // de-duplicated by the transpiler. Sources are appended in topological order,
        // so the first source naturally becomes the primary working buffer.
        const bootstrap = [
            'AUDIO_CHAIN = AudioChain()',
            'async def _audio_task():',
            '    while True:',
            '        try:',
            '            await AUDIO_CHAIN.run_block()',
            '        except Exception:',
            '            AUDIO_CHAIN.read_errors += 1',
            '            await asyncio.sleep_ms(1)',
        ].join('\n');
        const execute = [
            `${inst} = ${className}(${args.join(', ')})`,
            `AUDIO_CHAIN.add_source(${inst})`,
        ].join('\n');

        return { init: { block: bootstrap, priority: 0, execute } };
    }


    // The AUDIO_CHAIN bootstrap, `_audio_task`, and its one-time start are emitted
    // inline by NodeInitGenerators.i2sInput (init block + execute block), so no helper
    // artifact is required. Returning null skips the helper contribution.
    globalScope.NodeHelperGenerators.audioRuntime = function () {
        return null;
    };

    // ---- Init generators (shared `init_audio`, registered in topological order) ----

    globalScope.NodeInitGenerators.i2sInput = function (context) {
        const controls = controlValues(context);
        const args = [
            `i2s_id=${formatLiteral(controls.i2sId ?? 0, context)}`,
            `bclk_pin=${formatLiteral(controls.bclkPin ?? 4, context)}`,
            `ws_pin=${formatLiteral(controls.wsPin ?? 5, context)}`,
            `data_pin=${formatLiteral(controls.dataPin ?? 7, context)}`,
            `rate=${formatLiteral(controls.sampleRate ?? 16000, context)}`,
            `block_samples=${formatLiteral(controls.blockSamples ?? 256, context)}`,
        ];
        return registerSource(context, 'I2SInput', 'otter_audio_viper.i2s_input', '_i2s_in', args);
    };

    globalScope.NodeInitGenerators.oscillator = function (context) {
        const controls = controlValues(context);
        const osc = varName(context, '_osc');
        const args = [
            `rate=${formatLiteral(controls.sampleRate ?? 16000, context)}`,
            `block_samples=${formatLiteral(controls.blockSamples ?? 256, context)}`,
            `wave=${formatLiteral(controls.wave ?? 'sine', context)}`,
        ];
        const inputSources = Array.isArray(context && context.inputSources)
            ? context.inputSources
            : [];
        const blockConnected = !!(inputSources[0] && inputSources[0].fromNode);
        if (blockConnected) {
            registerImport(context, 'from otter_audio_viper.oscillator import Oscillator');
            return {
                init: {
                    execute: [
                        `${osc} = Oscillator(${args.join(', ')})`,
                        `AUDIO_CHAIN.add_filter(${osc})`,
                    ].join('\n'),
                },
            };
        }
        return registerSource(context, 'Oscillator', 'otter_audio_viper.oscillator', '_osc', args);
    };

    globalScope.NodeInitGenerators.i2sOutput = function (context) {
        registerImport(context, 'from otter_audio_viper.i2s_output import I2SOutput');

        const controls = controlValues(context);
        const speaker = varName(context, '_i2s_out');
        const sdPin = controls.sdPin == null ? 0 : Number(controls.sdPin);
        const sdArg = sdPin > 0 ? `sd_pin=${formatLiteral(sdPin, context)}` : 'sd_pin=None';
        const gainPin = controls.gainPin == null ? 0 : Number(controls.gainPin);
        const gainArg = gainPin > 0 ? `gain_pin=${formatLiteral(gainPin, context)}` : 'gain_pin=None';
        const args = [
            `i2s_id=${formatLiteral(controls.i2sId ?? 1, context)}`,
            `bclk_pin=${formatLiteral(controls.bclkPin ?? 4, context)}`,
            `ws_pin=${formatLiteral(controls.wsPin ?? 5, context)}`,
            `data_pin=${formatLiteral(controls.dataPin ?? 6, context)}`,
            `rate=${formatLiteral(controls.sampleRate ?? 16000, context)}`,
            `block_samples=${formatLiteral(controls.blockSamples ?? 256, context)}`,
            sdArg,
            gainArg,
        ].join(', ');

        const execute = [
            `${speaker} = I2SOutput(${args})`,
            `AUDIO_CHAIN.set_sink(${speaker})`,
            'asyncio.create_task(_audio_task())',
        ].join('\n');

        return { init: { execute } };
    };

    function makeFilterInit(className, modulePath, prefix) {
        return function (context) {
            registerImport(context, `from ${modulePath} import ${className}`);
            const inst = varName(context, prefix);
            const execute = [`${inst} = ${className}()`, `AUDIO_CHAIN.add_filter(${inst})`].join(
                '\n'
            );
            return { init: { execute } };
        };
    }

    globalScope.NodeInitGenerators.overdrive = makeFilterInit(
        'Overdrive',
        'otter_audio_viper.overdrive',
        '_od'
    );
    globalScope.NodeInitGenerators.bitcrusher = makeFilterInit(
        'Bitcrusher',
        'otter_audio_viper.bitcrusher',
        '_bit'
    );
    globalScope.NodeInitGenerators.squareFuzz = makeFilterInit(
        'SquareFuzz',
        'otter_audio_viper.square_fuzz',
        '_fuzz'
    );
    globalScope.NodeInitGenerators.downsampler = function (context) {
        registerImport(context, 'from otter_audio_viper.downsampler import Downsampler');
        const controls = controlValues(context);
        const inst = varName(context, '_ds');
        const args = [`rate=${formatLiteral(controls.sampleRate ?? 16000, context)}`];
        return {
            init: {
                execute: [
                    `${inst} = Downsampler(${args.join(', ')})`,
                    `AUDIO_CHAIN.add_filter(${inst})`,
                ].join('\n'),
            },
        };
    };
    globalScope.NodeInitGenerators.gain = makeFilterInit('Gain', 'otter_audio_viper.gain', '_gain');
    globalScope.NodeInitGenerators.pitchShifter = makeFilterInit(
        'PitchShifter',
        'otter_audio_viper.pitch_shifter',
        '_pitch'
    );
    globalScope.NodeInitGenerators.filter = function (context) {
        registerImport(context, 'from otter_audio_viper.filter import Filter');
        const controls = controlValues(context);
        const inst = varName(context, '_filter');
        const args = [`rate=${formatLiteral(controls.sampleRate ?? 16000, context)}`];
        return {
            init: {
                execute: [
                    `${inst} = Filter(${args.join(', ')})`,
                    `AUDIO_CHAIN.add_filter(${inst})`,
                ].join('\n'),
            },
        };
    };
    globalScope.NodeInitGenerators.ringMod = function (context) {
        registerImport(context, 'from otter_audio_viper.ring_mod import RingMod');
        const controls = controlValues(context);
        const inst = varName(context, '_ring');
        const args = [`rate=${formatLiteral(controls.sampleRate ?? 16000, context)}`];
        return {
            init: {
                execute: [
                    `${inst} = RingMod(${args.join(', ')})`,
                    `AUDIO_CHAIN.add_filter(${inst})`,
                ].join('\n'),
            },
        };
    };
    globalScope.NodeInitGenerators.noise = makeFilterInit('Noise', 'otter_audio_viper.noise', '_noise');

    // ---- Loop generators (per-tick parameter copy + metering) ----

    globalScope.NodeCodeGenerators.i2sInput = function (context) {
        const mic = varName(context, '_i2s_in');
        const enabled = inputRef(context, 0, 'True');
        const levelVar = outputRef(context, 1);
        const lines = [`${mic}.enabled = ${enabled}`];
        if (levelVar) {
            lines.push(`${levelVar} = ${mic}.level`);
        }
        return { statement: lines.join('\n') };
    };

    globalScope.NodeCodeGenerators.oscillator = function (context) {
        const osc = varName(context, '_osc');
        const frequency = inputRef(context, 1, '440');
        const phase = inputRef(context, 2, '0');
        const mix = inputRef(context, 3, '1');
        const saturate = inputRef(context, 4, 'True');
        const enabled = inputRef(context, 5, 'True');
        const levelVar = outputRef(context, 1);
        const lines = [
            `${osc}.frequency = ${frequency}`,
            `${osc}.phase = ${phase}`,
            `${osc}.mix = ${mix}`,
            `${osc}.saturate = ${saturate}`,
            `${osc}.enabled = ${enabled}`,
        ];
        if (levelVar) {
            lines.push(`${levelVar} = ${osc}.level`);
        }
        return { statement: lines.join('\n') };
    };

    globalScope.NodeCodeGenerators.i2sOutput = function (context) {
        const speaker = varName(context, '_i2s_out');
        const enabled = inputRef(context, 1, 'True');
        const gainHigh = inputRef(context, 2, 'True');
        return {
            statement: `${speaker}.enabled = ${enabled}\n${speaker}.gain_high = ${gainHigh}`,
        };
    };

    globalScope.NodeCodeGenerators.overdrive = function (context) {
        const inst = varName(context, '_od');
        return {
            statement: `${inst}.drive = ${inputRef(context, 1, '0')}\n${inst}.enabled = ${inputRef(context, 2, 'True')}`,
        };
    };

    globalScope.NodeCodeGenerators.bitcrusher = function (context) {
        const inst = varName(context, '_bit');
        return {
            statement: [
                `${inst}.bits = ${inputRef(context, 1, '4')}`,
                `${inst}.mix = ${inputRef(context, 2, '1')}`,
                `${inst}.enabled = ${inputRef(context, 3, 'True')}`,
            ].join('\n'),
        };
    };

    globalScope.NodeCodeGenerators.squareFuzz = function (context) {
        const inst = varName(context, '_fuzz');
        return {
            statement: [
                `${inst}.level = ${inputRef(context, 1, '-6')}`,
                `${inst}.mix = ${inputRef(context, 2, '0.5')}`,
                `${inst}.envelopeFollow = ${inputRef(context, 3, 'True')}`,
                `${inst}.enabled = ${inputRef(context, 4, 'True')}`,
            ].join('\n'),
        };
    };

    globalScope.NodeCodeGenerators.downsampler = function (context) {
        const inst = varName(context, '_ds');
        return {
            statement: [
                `${inst}.hold = ${inputRef(context, 1, '4')}`,
                `${inst}.mix = ${inputRef(context, 2, '1')}`,
                `${inst}.antiAlias = ${inputRef(context, 3, 'True')}`,
                `${inst}.enabled = ${inputRef(context, 4, 'True')}`,
            ].join('\n'),
        };
    };

    globalScope.NodeCodeGenerators.gain = function (context) {
        const inst = varName(context, '_gain');
        return {
            statement: `${inst}.volume = ${inputRef(context, 1, '0')}\n${inst}.enabled = ${inputRef(context, 2, 'True')}`,
        };
    };

    globalScope.NodeCodeGenerators.pitchShifter = function (context) {
        const inst = varName(context, '_pitch');
        return {
            statement: `${inst}.semitones = ${inputRef(context, 1, '0')}\n${inst}.enabled = ${inputRef(context, 2, 'True')}`,
        };
    };

    globalScope.NodeCodeGenerators.filter = function (context) {
        const inst = varName(context, '_filter');
        return {
            statement: [
                `${inst}.low_hz = ${inputRef(context, 1, '300')}`,
                `${inst}.high_hz = ${inputRef(context, 2, '3000')}`,
                `${inst}.enabled = ${inputRef(context, 3, 'True')}`,
            ].join('\n'),
        };
    };

    globalScope.NodeCodeGenerators.ringMod = function (context) {
        const inst = varName(context, '_ring');
        return {
            statement: [
                `${inst}.frequency = ${inputRef(context, 1, '150')}`,
                `${inst}.depth = ${inputRef(context, 2, '1.0')}`,
                `${inst}.enabled = ${inputRef(context, 3, 'True')}`,
            ].join('\n'),
        };
    };

    globalScope.NodeCodeGenerators.noise = function (context) {
        const inst = varName(context, '_noise');
        return {
            statement: [
                `${inst}.level = ${inputRef(context, 1, '-60')}`,
                `${inst}.threshold = ${inputRef(context, 2, '-60')}`,
                `${inst}.envelopeFollow = ${inputRef(context, 3, 'True')}`,
                `${inst}.enabled = ${inputRef(context, 4, 'True')}`,
            ].join('\n'),
        };
    };
})();

