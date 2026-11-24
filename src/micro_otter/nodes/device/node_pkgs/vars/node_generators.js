// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Variable store and array node generators.

(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }
    if (!globalScope.NodeInitGenerators) {
        globalScope.NodeInitGenerators = {};
    }

    function registerImport(context, statement) {
        const helpers = (context && context.helpers) || {};
        if (helpers && typeof helpers.registerImport === 'function') {
            helpers.registerImport(statement);
        }
    }

    function formatLiteral(value, context) {
        const helpers = (context && context.helpers) || {};
        if (helpers && typeof helpers.formatLiteral === 'function') {
            return helpers.formatLiteral(value);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : '0';
        }
        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }
        if (value === null || value === undefined) {
            return 'None';
        }
        return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }

    function controlValues(context) {
        return (context && context.node && context.node.controlValues) || {};
    }

    /** Option value that means "the user types a new name" (same as the UI sentinel). */
    const NEW_SENTINEL = '__new__';

    /**
     * Control id paired with a sentinel picker that reveals it (`name` → `customName`).
     * Mirrors `customTopicControlId()` in graph-topics.ts.
     *
     * @param {string} controlId - Id of the dropdown control.
     * @returns {string} Id of the free-text control holding a newly typed value.
     */
    function customControlId(controlId) {
        return `custom${controlId.charAt(0).toUpperCase()}${controlId.slice(1)}`;
    }

    /**
     * Text stored in the companion control of a picker (`name` → `customName`).
     *
     * @param {object} context - Generator context
     * @param {string} controlId - Id of the dropdown control
     * @returns {string} The trimmed companion text, or an empty string when unset
     */
    function companionControlText(context, controlId) {
        return String(controlValues(context)[customControlId(controlId)] ?? '').trim();
    }

    /**
     * Text a picker stands for: a plain value as typed, or the sentinel's companion control.
     *
     * The sentinel is a UI value only — the transpiler reads `controlValues` verbatim, so the
     * generator is the place where "__new__" becomes the text the user actually typed.
     *
     * @param {object} context - Generator context
     * @param {string} controlId - Id of the dropdown control
     * @returns {string} The effective text, or an empty string when nothing is typed yet
     */
    function effectiveControlText(context, controlId) {
        const raw = String(controlValues(context)[controlId] ?? '').trim();
        if (raw !== NEW_SENTINEL) {
            return raw;
        }
        return companionControlText(context, controlId);
    }

    function nameLiteral(context) {
        return formatLiteral(effectiveControlText(context, 'name') || '', context);
    }

    /**
     * Resolve the store namespace expression from an input connector.
     *
     * Falls back to the default namespace when the input is unconnected or
     * empty (the transpiler emits `None` for inputs without a usable value).
     * A sentinel input value ("new store…") resolves through `customStore`, and empty
     * companion text falls back to the default namespace as well.
     *
     * @param {object} context - Generator context
     * @param {number} index - Input connector index of the store name
     * @returns {string} Python expression for the store namespace
     */
    function storeNameExpression(context, index) {
        const store = inputRef(context, index, null);
        if (store === null || store === 'None') {
            return formatLiteral('default', context);
        }
        if (store === formatLiteral(NEW_SENTINEL, context)) {
            // The namespace itself lives in the *input*, so the sentinel arrives as the
            // formatted input expression; only the typed companion value sits in
            // `controlValues.customStore`.
            const typed = companionControlText(context, 'store');
            return formatLiteral(typed || 'default', context);
        }
        return store;
    }

    function outputRef(context, index) {
        const outputs = Array.isArray(context && context.outputs) ? context.outputs : [];
        return outputs[index] ?? null;
    }

    function inputRef(context, index, fallback) {
        const inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        const value = inputs[index];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    }

    function ensureImport(context) {
        registerImport(context, 'import otter_vars.store as _store');
    }

    globalScope.NodeCodeGenerators.varRead = function (context) {
        ensureImport(context);
        const out = outputRef(context, 0);
        if (!out) {
            return { statement: '# var-read output not connected', outputs: [] };
        }
        const value = inputRef(context, 1, '0');
        return { statement: `${out} = _store.get(${storeNameExpression(context, 0)}, ${nameLiteral(context)}, ${value})`, outputs: [out] };
    };

    globalScope.NodeCodeGenerators.varWrite = function (context) {
        ensureImport(context);
        const value = inputRef(context, 2, 'None');
        const enabled = inputRef(context, 0, 'True');
        return {
            statement: `if bool(${enabled}):\n    _store.set(${storeNameExpression(context, 1)}, ${nameLiteral(context)}, ${value})`,
            outputs: [],
        };
    };

    function buildScopedNodeId(graphId, nodeId) {
        const normalizedNodeId =
            nodeId === undefined || nodeId === null ? '' : String(nodeId).trim();
        if (!normalizedNodeId) {
            return 'unknown';
        }
        const normalizedGraphId =
            graphId === undefined || graphId === null ? '' : String(graphId).trim();
        return normalizedGraphId ? `${normalizedGraphId}:${normalizedNodeId}` : normalizedNodeId;
    }

    globalScope.NodeCodeGenerators.varStoreSave = function (context) {
        ensureImport(context);
        const saveExpr = inputRef(context, 1, 'False');
        const nameExpr = storeNameExpression(context, 2);
        const enabled = inputRef(context, 0, 'True');
        const nodeId = (context && context.node && context.node.id) || 'unknown';
        const graphId = context && context.graph && context.graph.id;
        const scopedNodeId = buildScopedNodeId(graphId, nodeId);
        const keyLiteral = formatLiteral(`save:${scopedNodeId}`, context);
        // While disabled the trigger is not observed, so a held trigger may fire once
        // on the first enabled tick; no hidden state preserves trigger history.
        return {
            statement: [
                `if bool(${enabled}):`,
                `    if _store.edge_trigger(${keyLiteral}, ${saveExpr}):`,
                `        _store.save(${nameExpr})`,
            ].join('\n'),
            outputs: [],
        };
    };

    globalScope.NodeCodeGenerators.varStoreLoad = function (context) {
        ensureImport(context);
        const loadExpr = inputRef(context, 0, 'False');
        const nameExpr = storeNameExpression(context, 1);
        const nodeId = (context && context.node && context.node.id) || 'unknown';
        const graphId = context && context.graph && context.graph.id;
        const scopedNodeId = buildScopedNodeId(graphId, nodeId);
        const keyLiteral = formatLiteral(`load:${scopedNodeId}`, context);
        return {
            statement: [
                `if _store.edge_trigger(${keyLiteral}, ${loadExpr}):`,
                `    _store.load(${nameExpr})`,
            ].join('\n'),
            outputs: [],
        };
    };

    function ensureSignalsImport(context) {
        registerImport(context, 'import otter_vars.signals as _signals');
    }

    /**
     * Signal name the `signal-post` node posts, applying the `__new__` sentinel.
     *
     * A plain `signal` control value is used as-is; the sentinel resolves to the
     * companion `customSignal` text. Returns an empty string when nothing is set.
     *
     * @param {object} context - Generator context
     * @returns {string} The effective signal name, or an empty string
     */
    function signalNameExpression(context) {
        const raw = String(controlValues(context).signal ?? '').trim();
        if (raw !== NEW_SENTINEL) {
            return raw;
        }
        return companionControlText(context, 'signal');
    }

    globalScope.NodeCodeGenerators.signalPost = function (context) {
        const name = signalNameExpression(context);
        if (!name) {
            return { statement: '# signal-post: no signal name selected', outputs: [] };
        }
        ensureSignalsImport(context);
        const enabled = inputRef(context, 0, 'True');
        const fire = inputRef(context, 1, 'False');
        const nodeId = (context && context.node && context.node.id) || 'unknown';
        const graphId = context && context.graph && context.graph.id;
        const scopedNodeId = buildScopedNodeId(graphId, nodeId);
        const keyLiteral = formatLiteral(`post:${scopedNodeId}`, context);
        const nameLiteral = formatLiteral(name, context);
        // While disabled the trigger is not observed, so a held fire may post once
        // on the first enabled tick; no hidden state preserves trigger history.
        const condition =
            controlValues(context).once === false
                ? `if bool(${fire}):`
                : `if _signals.edge(${keyLiteral}, bool(${fire})):`;
        return {
            statement: [
                `if bool(${enabled}):`,
                `    ${condition}`,
                `        _signals.post(${nameLiteral})`,
            ].join('\n'),
            outputs: [],
        };
    };
    function ensureArraysImport(context) {
        registerImport(context, 'import otter_vars.arrays as _arr');
    }

    function boolLiteral(context, key, fallback) {
        const raw = controlValues(context)[key];
        const value = raw === undefined ? fallback : Boolean(raw);
        return formatLiteral(value, context);
    }

    const ARRAY_MATH_BINARY_OPS = {
        add: 'add',
        subtract: 'sub',
        multiply: 'mul',
        divide: 'div',
        modulus: 'mod',
        power: 'power',
        root: 'root',
        log: 'log',
    };
    const ARRAY_MATH_UNARY_OPS = new Set([
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
    ]);
    const ARRAY_MATH_TRIG_OPS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan']);

    /** Reduction operations the array math node can perform. */
    const ARRAY_MATH_REDUCTION_OPS = new Set(['length', 'min', 'max', 'mean', 'median']);

    /** Runtime names for reductions whose node id differs from the runtime function. */
    const ARRAY_MATH_REDUCTION_RUNTIME_OPS = {
        min: 'mo_min',
        max: 'mo_max',
    };

    /** Largest percentage the min/max reductions accept. */
    const MAX_PERCENT = 100;

    /** Largest number of decimal places the array round operation accepts. */
    const MAX_DECIMAL_PLACES = 6;

    /**
     * Read the `decimalPlaces` control of the array math node.
     *
     * Normalised to an integer in `0..MAX_DECIMAL_PLACES`; a missing or non-numeric control value
     * falls back to whole-number rounding.
     *
     * @param {object} context - Generator context
     * @returns {number} Number of decimal places kept by the round operation
     */
    function decimalPlacesValue(context) {
        const raw = controlValues(context).decimalPlaces;
        if (raw === undefined || raw === null || raw === '') {
            return 0;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.min(Math.max(Math.trunc(value), 0), MAX_DECIMAL_PLACES);
    }

    /**
     * Read the `percent` control of the array math node.
     *
     * Normalised to `0..100`; a missing or non-numeric control value falls back
     * to the full array.
     *
     * @param {object} context - Generator context
     * @returns {number} Percentage used by the min/max reductions
     */
    function percentValue(context) {
        const raw = controlValues(context).percent;
        if (raw === undefined || raw === null || raw === '') {
            return MAX_PERCENT;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return MAX_PERCENT;
        }
        return Math.min(Math.max(value, 0), MAX_PERCENT);
    }

    const ARRAY_SET_RUNTIME_OPS = {
        sin: 'sin_wave',
        square: 'square_wave',
        sawtooth: 'sawtooth_wave',
        setIndices: 'set_indices',
        randomUniform: 'random_uniform',
        randomNormal: 'random_normal',
    };

    /** Operations the array set node can perform. */
    const ARRAY_SET_TYPES = new Set([
        'set',
        'setIndices',
        'fill',
        'ramp',
        'steps',
        'hat',
        'sin',
        'square',
        'sawtooth',
        'randomUniform',
        'randomNormal',
    ]);

    /** Runtime names for array modify operations whose id differs from the runtime function. */
    const ARRAY_MODIFY_RUNTIME_OPS = {
        pingPong: 'ping_pong',
    };

    /** Operations the array modify node can perform. */
    const ARRAY_MODIFY_TYPES = new Set(['shift', 'repeat', 'pingPong', 'concat', 'interlace']);

    /** Distributions the random value node can sample from. */
    const RANDOM_DISTRIBUTIONS = new Set(['uniform', 'normal']);

    /** Index modes the array select node resolves out-of-range reads with. */
    const ARRAY_SELECT_MODES = new Set(['default', 'clamp', 'wrap']);

    globalScope.NodeInitGenerators.arrayGenerate = function (context) {
        const out = outputRef(context, 0);
        if (!out) {
            return '';
        }
        ensureArraysImport(context);
        return `${out} = None`;
    };

    globalScope.NodeCodeGenerators.arrayGenerate = function (context) {
        ensureArraysImport(context);
        const out = outputRef(context, 0);
        if (!out) {
            return { statement: '# array-generate output not connected', outputs: [] };
        }
        const count = inputRef(context, 0, '60');
        return { statement: `${out} = _arr.generate(${out}, ${count})`, outputs: [out] };
    };

    globalScope.NodeCodeGenerators.arrayMath = function (context) {
        ensureArraysImport(context);
        const out = outputRef(context, 0);
        if (!out) {
            return { statement: '# array-math output not connected', outputs: [] };
        }
        const a = inputRef(context, 0, '0');
        const b = inputRef(context, 1, '0');
        const controls = controlValues(context);
        const requested = controls.operation || 'add';
        const supported =
            Object.prototype.hasOwnProperty.call(ARRAY_MATH_BINARY_OPS, requested) ||
            ARRAY_MATH_UNARY_OPS.has(requested) ||
            ARRAY_MATH_TRIG_OPS.has(requested) ||
            ARRAY_MATH_REDUCTION_OPS.has(requested) ||
            requested === 'atan2' ||
            requested === 'round';
        const operation = supported ? requested : 'add';
        if (!supported && requested !== 'add') {
            console.warn('Unsupported array math operation:', requested, '- defaulting to add.');
        }
        const clamp = boolLiteral(context, 'clamp', false);

        if (ARRAY_MATH_REDUCTION_OPS.has(operation)) {
            if (operation === 'length') {
                return { statement: `${out} = _arr.length(${a})`, outputs: [out] };
            }
            if (operation === 'min' || operation === 'max') {
                const runtimeOp = ARRAY_MATH_REDUCTION_RUNTIME_OPS[operation];
                const percent = formatLiteral(percentValue(context), context);
                return {
                    statement: `${out} = _arr.${runtimeOp}(${a}, percent=${percent}, clamp=${clamp})`,
                    outputs: [out],
                };
            }
            return {
                statement: `${out} = _arr.${operation}(${a}, clamp=${clamp})`,
                outputs: [out],
            };
        }

        if (operation === 'atan2') {
            const angleUnit = formatLiteral(controls.angleUnit || 'degrees', context);
            return {
                statement: `${out} = _arr.atan2(${a}, ${b}, angle_unit=${angleUnit}, clamp=${clamp})`,
                outputs: [out],
            };
        }
        if (operation === 'round') {
            const decimals = formatLiteral(decimalPlacesValue(context), context);
            return {
                statement: `${out} = _arr.round(${a}, decimals=${decimals}, clamp=${clamp})`,
                outputs: [out],
            };
        }
        if (ARRAY_MATH_TRIG_OPS.has(operation)) {
            const angleUnit = formatLiteral(controls.angleUnit || 'degrees', context);
            return {
                statement: `${out} = _arr.${operation}(${a}, angle_unit=${angleUnit}, clamp=${clamp})`,
                outputs: [out],
            };
        }
        if (ARRAY_MATH_UNARY_OPS.has(operation)) {
            return {
                statement: `${out} = _arr.${operation}(${a}, clamp=${clamp})`,
                outputs: [out],
            };
        }
        return {
            statement: `${out} = _arr.${ARRAY_MATH_BINARY_OPS[operation]}(${a}, ${b}, clamp=${clamp})`,
            outputs: [out],
        };
    };

    globalScope.NodeCodeGenerators.arrayModify = function (context) {
        ensureArraysImport(context);
        const out = outputRef(context, 0);
        if (!out) {
            return { statement: '# array-modify output not connected', outputs: [] };
        }
        const src = inputRef(context, 0, 'None');
        const requested = controlValues(context).modifyType || 'shift';
        const supported = ARRAY_MODIFY_TYPES.has(requested);
        const op = supported ? requested : 'shift';
        if (!supported) {
            console.warn('Unsupported array modify type:', requested, "- defaulting to 'shift'.");
        }
        const runtimeOp = ARRAY_MODIFY_RUNTIME_OPS[op] || op;

        // Shift is the only mode with wrap/inplace, so the other branches never read those
        // controls and an inactive control value cannot leak into the emitted statement.
        if (op === 'shift') {
            const amount = inputRef(context, 1, '0');
            const wrap = boolLiteral(context, 'wrap', true);
            const clamp = boolLiteral(context, 'clamp', false);
            const inplace = boolLiteral(context, 'inplace', false);
            return {
                statement: `${out} = _arr.shift(${src}, ${amount}, wrap=${wrap}, clamp=${clamp}, inplace=${inplace})`,
                outputs: [out],
            };
        }

        const clamp = boolLiteral(context, 'clamp', false);
        if (op === 'repeat' || op === 'pingPong') {
            const count = inputRef(context, 3, '1');
            return {
                statement: `${out} = _arr.${runtimeOp}(${src}, ${count}, clamp=${clamp})`,
                outputs: [out],
            };
        }

        const other = inputRef(context, 2, 'None');
        if (op === 'interlace') {
            const step = inputRef(context, 4, '2');
            const offset = inputRef(context, 5, '0');
            return {
                statement: `${out} = _arr.${runtimeOp}(${src}, ${other}, ${step}, ${offset}, clamp=${clamp})`,
                outputs: [out],
            };
        }

        return {
            statement: `${out} = _arr.${runtimeOp}(${src}, ${other}, clamp=${clamp})`,
            outputs: [out],
        };
    };

    globalScope.NodeCodeGenerators.arraySet = function (context) {
        ensureArraysImport(context);
        const out = outputRef(context, 0);
        if (!out) {
            return { statement: '# array-set output not connected', outputs: [] };
        }
        const src = inputRef(context, 0, 'None');
        const requested = controlValues(context).setType || 'set';
        const supported = ARRAY_SET_TYPES.has(requested);
        const op = supported ? requested : 'set';
        if (!supported) {
            console.warn('Unsupported array set type:', requested, "- defaulting to 'set'.");
        }
        const clamp = boolLiteral(context, 'clamp', false);
        const inplace = boolLiteral(context, 'inplace', false);
        const value = inputRef(context, 2, '0');
        const runtimeOp = ARRAY_SET_RUNTIME_OPS[op] || op;

        if (op === 'set' || op === 'setIndices') {
            const requestedMode = controlValues(context).indexMode || 'clamp';
            const mode = formatLiteral(requestedMode, context);
            const indexArg = op === 'set' ? inputRef(context, 1, '0') : inputRef(context, 3, 'None');
            const fillArg = requestedMode === 'shift' ? `, fill=${inputRef(context, 17, '0')}` : '';
            return {
                statement: `${out} = _arr.${runtimeOp}(${src}, ${indexArg}, ${value}, mode=${mode}${fillArg}, clamp=${clamp}, inplace=${inplace})`,
                outputs: [out],
            };
        }

        let args;
        if (op === 'fill') {
            args = `${src}, ${value}, ${inputRef(context, 4, '0')}, ${inputRef(context, 5, '-1')}`;
        } else if (op === 'ramp') {
            args = `${src}, ${inputRef(context, 4, '0')}, ${inputRef(context, 5, '-1')}, ${inputRef(context, 8, '0')}, ${inputRef(context, 9, '1')}`;
        } else if (op === 'steps') {
            args = `${src}, ${inputRef(context, 4, '0')}, ${inputRef(context, 6, '1')}, ${inputRef(context, 7, '2')}, ${inputRef(context, 8, '0')}, ${inputRef(context, 9, '1')}`;
        } else if (op === 'hat') {
            args = `${src}, ${inputRef(context, 4, '0')}, ${inputRef(context, 5, '-1')}, ${inputRef(context, 8, '0')}, ${inputRef(context, 9, '1')}`;
        } else if (op === 'sin' || op === 'square' || op === 'sawtooth') {
            args = `${src}, ${inputRef(context, 4, '0')}, ${inputRef(context, 10, '30')}, ${inputRef(context, 11, '1')}, ${inputRef(context, 12, '0')}, ${inputRef(context, 13, '0.5')}, ${inputRef(context, 14, '0.5')}`;
        } else if (op === 'randomUniform') {
            args = `${src}, ${inputRef(context, 8, '0')}, ${inputRef(context, 9, '1')}`;
        } else if (op === 'randomNormal') {
            args = `${src}, ${inputRef(context, 15, '0.5')}, ${inputRef(context, 16, '0.15')}, ${inputRef(context, 8, '0')}, ${inputRef(context, 9, '1')}`;
        } else {
            args = `${src}`;
        }
        return { statement: `${out} = _arr.${runtimeOp}(${args}, clamp=${clamp}, inplace=${inplace})`, outputs: [out] };
    };

    globalScope.NodeCodeGenerators.randomValue = function (context) {
        ensureArraysImport(context);
        const out = outputRef(context, 0);
        if (!out) {
            return { statement: '# random-value output not connected', outputs: [] };
        }
        const requested = controlValues(context).distribution || 'uniform';
        const supported = RANDOM_DISTRIBUTIONS.has(requested);
        const distribution = supported ? requested : 'uniform';
        if (!supported) {
            console.warn('Unsupported random distribution:', requested, "- defaulting to 'uniform'.");
        }
        const integer = formatLiteral(controlValues(context).valueType === 'int', context);
        const lo = inputRef(context, 0, '0');
        const hi = inputRef(context, 1, '1');
        const statement =
            distribution === 'normal'
                ? `${out} = _arr.random_normal_value(${inputRef(context, 2, '0.5')}, ${inputRef(context, 3, '0.15')}, ${lo}, ${hi}, integer=${integer})`
                : `${out} = _arr.random_uniform_value(${lo}, ${hi}, integer=${integer})`;
        return { statement, outputs: [out] };
    };

    globalScope.NodeCodeGenerators.randomSeed = function (context) {
        ensureArraysImport(context);
        const enabled = inputRef(context, 0, 'True');
        const seed = inputRef(context, 1, '0');
        const nodeId = (context && context.node && context.node.id) || 'unknown';
        const graphId = context && context.graph && context.graph.id;
        const keyLiteral = formatLiteral(`seed:${buildScopedNodeId(graphId, nodeId)}`, context);
        return {
            statement: `_arr.reseed(${enabled}, ${seed}, key=${keyLiteral})`,
            outputs: [],
        };
    };

    globalScope.NodeCodeGenerators.arraySelect = function (context) {
        ensureArraysImport(context);
        const out = outputRef(context, 0);
        if (!out) {
            return { statement: '# array-select output not connected', outputs: [] };
        }
        const src = inputRef(context, 0, 'None');
        const index = inputRef(context, 1, '0');
        const fallback = inputRef(context, 2, '0');
        const requested = controlValues(context).indexMode || 'default';
        let mode = requested;
        if (!ARRAY_SELECT_MODES.has(requested)) {
            console.warn('Unsupported array select index mode:', requested, "- defaulting to 'default'.");
            mode = 'default';
        }
        return {
            statement: `${out} = _arr.select(${src}, ${index}, ${fallback}, mode=${formatLiteral(mode, context)})`,
            outputs: [out],
        };
    };
})();
