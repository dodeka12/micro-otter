// Core package generators (bootstrap existing globals)
(function () {
    var globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }
    if (!globalScope.NodeInitGenerators) {
        globalScope.NodeInitGenerators = {};
    }

    function getLiteral(value, helpers, fallback) {
        if (helpers && typeof helpers.formatLiteral === 'function') {
            try {
                var formatted = helpers.formatLiteral(value);
                if (formatted !== undefined && formatted !== null) {
                    return formatted;
                }
            } catch (err) {
                console.warn('constNode formatLiteral failed:', err);
            }
        }
        return fallback;
    }

    function normalizeConstantType(rawType) {
        if (
            rawType === 'int' ||
            rawType === 'float' ||
            rawType === 'bool' ||
            rawType === 'string'
        ) {
            return rawType;
        }
        return 'float';
    }

    // Special constants offered by the Constant node's Special mode.
    var SPECIAL_CONSTANT_VALUES = {
        pi: Math.PI,
        e: Math.E,
        deg_to_rad: Math.PI / 180,
        rad_to_deg: 180 / Math.PI,
    };

    // Returns true when the Constant node is set to emit a special constant.
    function isSpecialConstantMode(node) {
        var controls = node && node.controlValues ? node.controlValues : {};
        return controls.valueMode === 'special';
    }

    // Formats a special constant literal, falling back to Pi for unknown values.
    function resolveSpecialConstantLiteral(rawValue, helpers) {
        var value = Object.prototype.hasOwnProperty.call(SPECIAL_CONSTANT_VALUES, rawValue)
            ? SPECIAL_CONSTANT_VALUES[rawValue]
            : SPECIAL_CONSTANT_VALUES.pi;
        return getLiteral(value, helpers, String(value));
    }

    function resolveConstantSpec(node, helpers) {
        var controls = node && node.controlValues ? node.controlValues : {};
        var selectedType = normalizeConstantType(controls.valueType);

        if (isSpecialConstantMode(node)) {
            return {
                typeId: 'float',
                literal: resolveSpecialConstantLiteral(controls.specialValue, helpers),
            };
        }

        if (!controls.valueType && controls.inputValue !== undefined) {
            selectedType = 'float';
        }

        if (selectedType === 'int') {
            var intRaw = controls.intValue;
            if (intRaw === undefined && controls.inputValue !== undefined) {
                intRaw = controls.inputValue;
            }
            var intValue = Number(intRaw);
            if (!Number.isFinite(intValue)) {
                intValue = 0;
            }
            var safeInt = intValue < 0 ? Math.ceil(intValue) : Math.floor(intValue);
            return {
                typeId: 'int',
                literal: getLiteral(safeInt, helpers, String(safeInt)),
            };
        }

        if (selectedType === 'bool') {
            var boolRaw = controls.boolValue;
            if (boolRaw === undefined && controls.inputValue !== undefined) {
                boolRaw = controls.inputValue;
            }
            var boolValue = Boolean(boolRaw);
            return {
                typeId: 'bool',
                literal: boolValue ? 'True' : 'False',
            };
        }

        if (selectedType === 'string') {
            var stringRaw = controls.stringValue;
            if (stringRaw === undefined && controls.inputValue !== undefined) {
                stringRaw = controls.inputValue;
            }
            var stringValue =
                stringRaw === undefined || stringRaw === null ? '' : String(stringRaw);
            return {
                typeId: 'string',
                literal: getLiteral(stringValue, helpers, JSON.stringify(stringValue)),
            };
        }

        var floatRaw = controls.floatValue;
        if (floatRaw === undefined && controls.inputValue !== undefined) {
            floatRaw = controls.inputValue;
        }
        var floatValue = Number(floatRaw);
        if (!Number.isFinite(floatValue)) {
            floatValue = 0;
        }
        return {
            typeId: 'float',
            literal: getLiteral(floatValue, helpers, String(floatValue)),
        };
    }

    function buildConstName(node) {
        var baseId = node && node.id !== undefined ? String(node.id) : '0';
        return 'CONST_NODE_' + baseId.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    function isOutputConnected(context, index) {
        if (!context || !Array.isArray(context.outputsMeta)) {
            return false;
        }
        var meta = context.outputsMeta[index];
        return Boolean(meta && meta.connected);
    }

    // Returns true when the input connector at `index` receives data from another node.
    function isInputConnected(context, index) {
        if (!context || !Array.isArray(context.inputsMeta)) {
            return false;
        }
        var meta = context.inputsMeta[index];
        return Boolean(meta && meta.connected);
    }

    function resolveOutputName(context, index) {
        if (context && Array.isArray(context.outputs) && context.outputs[index]) {
            return context.outputs[index];
        }
        var helpers = context && context.helpers;
        if (helpers && typeof helpers.createOutputName === 'function') {
            return helpers.createOutputName(index);
        }
        return null;
    }

    // Emits the constant identifier for use in the main graph body.
    globalScope.NodeCodeGenerators.constNode = function (context) {
        if (!context || !context.node) {
            throw new Error('constNode generator requires context.node');
        }
        if (!isOutputConnected(context, 0)) {
            return { statement: '# const output not connected', outputs: [] };
        }
        var outputName = resolveOutputName(context, 0);
        if (!outputName) {
            return { statement: '# const output not connected', outputs: [] };
        }
        return {
            statement: outputName + ' = ' + buildConstName(context.node),
            outputs: [outputName],
        };
    };

    // Emits the console print, guarded by the optional `enabled` input (title, value, enabled order).
    globalScope.NodeCodeGenerators.printNode = function (context) {
        if (!context || !context.node) {
            throw new Error('printNode generator requires context.node');
        }
        var inputs = Array.isArray(context.inputs) ? context.inputs : [];
        var enabled = typeof inputs[0] === 'string' && inputs[0].length > 0 ? inputs[0] : 'True';
        var title = typeof inputs[1] === 'string' && inputs[1].length > 0 ? inputs[1] : "''";
        var value = typeof inputs[2] === 'string' && inputs[2].length > 0 ? inputs[2] : 'None';
        return {
            statement:
                'if bool(' +
                enabled +
                "):\n    print('[user] ', " +
                title +
                ", ': ', " +
                value +
                ')',
            outputs: [],
        };
    };

    // Defines the micropython const during init so the main body can reference it by name.
    globalScope.NodeInitGenerators.constNode = function (context) {
        if (!context || !context.node) {
            throw new Error('constNode init generator requires context.node');
        }
        var helpers = context.helpers || {};
        var constSpec = resolveConstantSpec(context.node, helpers);
        if (typeof helpers.registerImport === 'function') {
            helpers.registerImport('from micropython import const');
        }
        var node = context.node;
        var constName = buildConstName(node);
        return constName + ' = const(' + constSpec.literal + ')';
    };

    // Math processor implementation lives in packages/core/generator_math_processor.js.

    // --- Time node (uptime + delta) ---
    function resolveTimeUnit(context) {
        var unit =
            context && context.node && context.node.controlValues
                ? context.node.controlValues.unit
                : null;
        if (unit === 'milliseconds' || unit === 'microseconds' || unit === 'seconds') {
            return unit;
        }
        return 'seconds';
    }

    function buildTimeVarNames(node) {
        var base = node && node.id !== undefined ? String(node.id) : '0';
        var sanitized = base.replace(/[^a-zA-Z0-9_]/g, '_');
        return {
            prev: 'TIME_NODE_PREV_' + sanitized,
            curr: 'TIME_NODE_CURR_' + sanitized,
            delta: 'TIME_NODE_DELTA_' + sanitized,
        };
    }

    function getTickCall(unit) {
        if (unit === 'microseconds') {
            return 'time.ticks_us()';
        }
        return 'time.ticks_ms()';
    }

    /**
     * Applies default output names to an outputs array, ensuring it has at least 2 elements.
     *
     * @param {string[]|any} outputs - An array of output names, or any other value that will be treated as an empty array
     * @param {Object} [helpers] - An optional object containing helper functions
     * @param {Function} [helpers.createOutputName] - A function that generates output names based on the current index
     * @returns {string[]} An array with at least 2 output names, filled with generated names if necessary
     *
     * @description
     * If outputs is not an array, it's treated as empty. The function ensures the returned
     * array has at least 2 elements by generating names using the provided helper function
     * or falling back to the default pattern 'out' + index.
     */
    function applyOutputNames(outputs, helpers) {
        var resolved = Array.isArray(outputs) ? outputs.slice() : [];
        while (resolved.length < 2) {
            if (helpers && typeof helpers.createOutputName === 'function') {
                resolved.push(helpers.createOutputName(resolved.length));
            } else {
                resolved.push('out' + resolved.length);
            }
        }
        return resolved;
    }

    globalScope.NodeInitGenerators.timeNode = function (context) {
        if (!context || !context.node) {
            throw new Error('timeNode init generator requires context.node');
        }
        var helpers = context.helpers || {};
        if (typeof helpers.registerImport === 'function') {
            helpers.registerImport('import time');
        }
        var unit = resolveTimeUnit(context);
        var names = buildTimeVarNames(context.node);
        var tickCall = getTickCall(unit);
        return names.prev + ' = ' + tickCall;
    };

    globalScope.NodeCodeGenerators.timeNode = function (context) {
        if (!context || !context.node) {
            throw new Error('timeNode generator requires context.node');
        }
        var helpers = context.helpers || {};
        if (typeof helpers.registerImport === 'function') {
            helpers.registerImport('import time');
        }
        var unit = resolveTimeUnit(context);
        var names = buildTimeVarNames(context.node);
        var outputs = applyOutputNames(context.outputs, helpers);
        var tickCall = getTickCall(unit);

        var outputsMeta = Array.isArray(context.outputsMeta) ? context.outputsMeta : [];
        var nowConnected = Boolean(outputsMeta[0] && outputsMeta[0].connected);
        var deltaConnected = Boolean(outputsMeta[1] && outputsMeta[1].connected);
        if (!nowConnected && !deltaConnected) {
            return { statement: '# time outputs not connected', outputs: [] };
        }

        var lines = [];
        lines.push(names.curr + ' = ' + tickCall);
        lines.push(names.delta + ' = time.ticks_diff(' + names.curr + ', ' + names.prev + ')');
        lines.push(names.prev + ' = ' + names.curr);

        var absExpr;
        var deltaExpr;
        if (unit === 'seconds') {
            absExpr = '(' + names.curr + ' / 1000)';
            deltaExpr = '(' + names.delta + ' / 1000)';
        } else {
            absExpr = names.curr;
            deltaExpr = names.delta;
        }

        const assignedOutputs = [];
        if (nowConnected && outputs[0]) {
            lines.push(outputs[0] + ' = ' + absExpr);
            assignedOutputs.push(outputs[0]);
        }
        if (deltaConnected && outputs[1]) {
            lines.push(outputs[1] + ' = ' + deltaExpr);
            assignedOutputs.push(outputs[1]);
        }

        return { statement: lines.join('\n'), outputs: assignedOutputs };
    };

    globalScope.NodeCodeGenerators.memoryInfo = function (context) {
        if (!context || !context.node) {
            throw new Error('memoryInfo generator requires context.node');
        }

        if (!isOutputConnected(context, 0)) {
            return { statement: '# memoryInfo output not connected', outputs: [] };
        }

        var helpers = context.helpers || {};
        if (typeof helpers.registerImport === 'function') {
            helpers.registerImport('from otter_core.system import memory_info_kb');
        }

        var outputName = resolveOutputName(context, 0) || 'out0';
        var controls = context.node.controlValues || {};
        var runGcBeforeRead = controls.runGcBeforeRead;
        if (runGcBeforeRead === undefined || runGcBeforeRead === null) {
            runGcBeforeRead = true;
        } else {
            runGcBeforeRead = Boolean(runGcBeforeRead);
        }

        var runGcLiteral = getLiteral(runGcBeforeRead, helpers, runGcBeforeRead ? 'True' : 'False');
        return {
            statement: outputName + ' = memory_info_kb(' + runGcLiteral + ')',
            outputs: [outputName],
        };
    };

    globalScope.NodeCodeGenerators.compareNode = function (context) {
        if (!context || !context.node) {
            throw new Error('compareNode generator requires context.node');
        }

        if (!isOutputConnected(context, 0)) {
            return { statement: '# compare output not connected', outputs: [] };
        }

        var inputs = Array.isArray(context.inputs) ? context.inputs : [];
        var left = inputs[0] !== undefined ? inputs[0] : '0';
        var right = inputs[1] !== undefined ? inputs[1] : '0';
        var outputName = resolveOutputName(context, 0) || 'out0';
        var controls = context.node.controlValues || {};
        var operation = controls.operation || 'equal';
        var epsilonValue = Number(controls.epsilon);
        if (!Number.isFinite(epsilonValue) || epsilonValue < 0) {
            epsilonValue = 0;
        }
        var epsilonExpr = String(epsilonValue);
        var diffExpr = 'abs((' + left + ') - (' + right + '))';

        var condition;
        if (operation === 'less_than') {
            condition = '((' + left + ') < ((' + right + ') - (' + epsilonExpr + ')))';
        } else if (operation === 'less_than_equal') {
            condition = '((' + left + ') <= ((' + right + ') + (' + epsilonExpr + ')))';
        } else if (operation === 'greater_than') {
            condition = '((' + left + ') > ((' + right + ') + (' + epsilonExpr + ')))';
        } else if (operation === 'greater_than_equal') {
            condition = '((' + left + ') >= ((' + right + ') - (' + epsilonExpr + ')))';
        } else if (operation === 'near_equal') {
            condition = '(' + diffExpr + ' <= (' + epsilonExpr + '))';
        } else {
            condition = '(' + diffExpr + ' <= (' + epsilonExpr + '))';
        }

        return {
            statement: outputName + ' = (' + condition + ')',
            outputs: [outputName],
        };
    };

    globalScope.NodeCodeGenerators.logicNode = function (context) {
        if (!context || !context.node) {
            throw new Error('logicNode generator requires context.node');
        }

        if (!isOutputConnected(context, 0)) {
            return { statement: '# logic output not connected', outputs: [] };
        }

        var inputs = Array.isArray(context.inputs) ? context.inputs : [];
        var a = inputs[0] !== undefined ? inputs[0] : 'False';
        var b = inputs[1] !== undefined ? inputs[1] : 'False';
        var outputName = resolveOutputName(context, 0) || 'out0';
        var controls = context.node.controlValues || {};
        var operation = controls.operation || 'and';

        var expression;
        if (operation === 'or') {
            expression = '(bool(' + a + ') or bool(' + b + '))';
        } else if (operation === 'not') {
            expression = '(not bool(' + a + '))';
        } else if (operation === 'nor') {
            expression = '(not (bool(' + a + ') or bool(' + b + ')))';
        } else if (operation === 'nand') {
            expression = '(not (bool(' + a + ') and bool(' + b + ')))';
        } else if (operation === 'xor') {
            expression = '(bool(' + a + ') != bool(' + b + '))';
        } else {
            expression = '(bool(' + a + ') and bool(' + b + '))';
        }

        return {
            statement: outputName + ' = ' + expression,
            outputs: [outputName],
        };
    };

    // --- General pin and conversion nodes ---
    function registerImport(context, statement) {
        var helpers = context && context.helpers;
        if (helpers && typeof helpers.registerImport === 'function') {
            helpers.registerImport(statement);
        }
    }

    function controlValues(context) {
        return (context && context.node && context.node.controlValues) || {};
    }

    function varName(context, prefix) {
        var raw =
            context && context.node && context.node.id !== undefined
                ? String(context.node.id)
                : 'node';
        raw = raw.replace(/[^A-Za-z0-9_]/g, '_');
        return prefix + '_' + raw;
    }

    function inputRef(context, index, fallback) {
        var inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        var value = inputs[index];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    }

    // Reads the shared 2..8 dropdown count used by compose, decompose and select-index.
    function tuplePositionCount(context, fallback) {
        var count = Number(controlValues(context).count);
        if (!Number.isFinite(count)) {
            count = fallback;
        }
        count = Math.floor(count);
        if (count < 2) {
            return 2;
        }
        if (count > 8) {
            return 8;
        }
        return count;
    }

    globalScope.NodeInitGenerators.adcInput = function (context) {
        registerImport(context, 'from machine import ADC, Pin');

        var controls = controlValues(context);
        var pin = controls.pin === undefined || controls.pin === null ? 1 : controls.pin;
        var adc = varName(context, '_adc');

        return {
            statement:
                adc +
                ' = ADC(Pin(' +
                getLiteral(pin, context && context.helpers, String(pin)) +
                '))\n' +
                adc +
                '.atten(ADC.ATTN_11DB)',
        };
    };

    globalScope.NodeCodeGenerators.adcInput = function (context) {
        if (!isOutputConnected(context, 0)) {
            return { statement: '# adc input output not connected', outputs: [] };
        }

        var out = resolveOutputName(context, 0);
        var adc = varName(context, '_adc');
        return {
            statement: out + ' = ' + adc + '.read_u16() / 65535.0 * 3.3',
            outputs: [out],
        };
    };

    // --- ADC block node (paced multi-sample capture) ---

    // Block sizes mirrored from the adc-array definition; stale values fall back to the default.
    var ADC_BLOCK_SAMPLE_COUNTS = [16, 32, 64, 128];
    var ADC_BLOCK_DEFAULT_COUNT = 64;

    // Returns the adc-array block size, falling back to the definition default.
    function resolveAdcBlockSamples(context) {
        var raw = Number(controlValues(context).blockSamples);
        return ADC_BLOCK_SAMPLE_COUNTS.indexOf(raw) >= 0 ? raw : ADC_BLOCK_DEFAULT_COUNT;
    }

    globalScope.NodeInitGenerators.adcArray = function (context) {
        registerImport(context, 'from machine import ADC, Pin');
        registerImport(context, 'import array as _array');
        registerImport(context, 'import time');

        var controls = controlValues(context);
        var pin = controls.pin === undefined || controls.pin === null ? 1 : controls.pin;
        var adc = varName(context, '_adc_blk');
        var buf = varName(context, '_adc_blk_buf');

        return {
            statement:
                adc +
                ' = ADC(Pin(' +
                getLiteral(pin, context && context.helpers, String(pin)) +
                '))\n' +
                adc +
                '.atten(ADC.ATTN_11DB)\n' +
                buf +
                " = _array.array('f', [0.0] * " +
                resolveAdcBlockSamples(context) +
                ')',
        };
    };

    // Sample rates mirrored from the adc-array definition; stale values fall back to the default.
    var ADC_BLOCK_SAMPLE_RATES = [1000, 2000, 5000, 10000];
    var ADC_BLOCK_DEFAULT_RATE = 5000;

    // Returns the adc-array sample rate, falling back to the definition default.
    function resolveAdcBlockRate(context) {
        var raw = Number(controlValues(context).sampleRate);
        return ADC_BLOCK_SAMPLE_RATES.indexOf(raw) >= 0 ? raw : ADC_BLOCK_DEFAULT_RATE;
    }

    // Captures one paced block of ADC samples into the reused buffer from the init generator.
    globalScope.NodeCodeGenerators.adcArray = function (context) {
        if (!isOutputConnected(context, 0)) {
            return { statement: '# adc block output not connected', outputs: [] };
        }

        var out = resolveOutputName(context, 0);
        var adc = varName(context, '_adc_blk');
        var buf = varName(context, '_adc_blk_buf');
        var next = varName(context, '_adc_blk_next');
        var wait = varName(context, '_adc_blk_wait');
        var index = varName(context, '_adc_blk_i');
        var samples = resolveAdcBlockSamples(context);
        var periodUs = Math.round(1000000 / resolveAdcBlockRate(context));

        return {
            statement: [
                next + ' = time.ticks_us()',
                'for ' + index + ' in range(' + samples + '):',
                '    ' + buf + '[' + index + '] = ' + adc + '.read_u16() / 65535.0 * 3.3',
                '    ' + next + ' = time.ticks_add(' + next + ', ' + periodUs + ')',
                '    ' + wait + ' = time.ticks_diff(' + next + ', time.ticks_us())',
                '    if ' + wait + ' > 0:',
                '        time.sleep_us(' + wait + ')',
                out + ' = ' + buf,
            ].join('\n'),
            outputs: [out],
        };
    };

    globalScope.NodeInitGenerators.dacOutput = function (context) {
        registerImport(context, 'from machine import DAC, Pin');

        var controls = controlValues(context);
        var pin = controls.pin === undefined || controls.pin === null ? 25 : controls.pin;
        var dac = varName(context, '_dac');

        return {
            statement: dac + ' = DAC(Pin(' + getLiteral(pin, context && context.helpers, String(pin)) + '))',
        };
    };

    // The `enabled` input is first and gates only the loop write, matching printNode.
    globalScope.NodeCodeGenerators.dacOutput = function (context) {
        var dac = varName(context, '_dac');
        var value = inputRef(context, 1, '0');
        var enabled = inputRef(context, 0, 'True');
        return {
            statement:
                'if bool(' +
                enabled +
                '):\n    ' +
                dac +
                '.write(int(max(0.0, min(3.3, (' +
                value +
                '))) / 3.3 * 255))',
            outputs: [],
        };
    };

    globalScope.NodeInitGenerators.digitalInput = function (context) {
        registerImport(context, 'from machine import Pin');

        var controls = controlValues(context);
        var pin = controls.pin === undefined || controls.pin === null ? 0 : controls.pin;
        var pull = controls.pull;
        var pinName = varName(context, '_pin');

        var args = getLiteral(pin, context && context.helpers, String(pin)) + ', Pin.IN';
        if (pull === 'up') {
            args += ', Pin.PULL_UP';
        } else if (pull === 'down') {
            args += ', Pin.PULL_DOWN';
        }

        return { statement: pinName + ' = Pin(' + args + ')' };
    };

    globalScope.NodeCodeGenerators.digitalInput = function (context) {
        if (!isOutputConnected(context, 0)) {
            return { statement: '# digital input output not connected', outputs: [] };
        }

        var out = resolveOutputName(context, 0);
        var pinName = varName(context, '_pin');
        return { statement: out + ' = bool(' + pinName + '.value())', outputs: [out] };
    };

    globalScope.NodeInitGenerators.digitalOutput = function (context) {
        registerImport(context, 'from machine import Pin');

        var controls = controlValues(context);
        var pin = controls.pin === undefined || controls.pin === null ? 2 : controls.pin;
        var pinName = varName(context, '_pin');

        return {
            statement: pinName + ' = Pin(' + getLiteral(pin, context && context.helpers, String(pin)) + ', Pin.OUT)',
        };
    };

    // The `enabled` input is first and gates only the loop write, matching printNode.
    globalScope.NodeCodeGenerators.digitalOutput = function (context) {
        var pinName = varName(context, '_pin');
        var value = inputRef(context, 1, 'False');
        var enabled = inputRef(context, 0, 'True');
        return {
            statement: 'if bool(' + enabled + '):\n    ' + pinName + '.value(' + value + ')',
            outputs: [],
        };
    };

    globalScope.NodeCodeGenerators.voltageDivider = function (context) {
        if (!isOutputConnected(context, 0)) {
            return { statement: '# voltage divider output not connected', outputs: [] };
        }

        var out = resolveOutputName(context, 0);
        var value = inputRef(context, 0, '0');
        var controls = controlValues(context);
        var topK = controls.topK === undefined || controls.topK === null ? 100.0 : controls.topK;
        var bottomK =
            controls.bottomK === undefined || controls.bottomK === null ? 22.0 : controls.bottomK;
        var top = getLiteral(topK, context && context.helpers, String(topK));
        var bottom = getLiteral(bottomK, context && context.helpers, String(bottomK));

        return {
            statement:
                out +
                ' = (' +
                value +
                ') * ((' +
                top +
                ') + (' +
                bottom +
                ')) / (' +
                bottom +
                ')',
            outputs: [out],
        };
    };

    // Select: one boolean condition picks between the true and the false value.
    globalScope.NodeCodeGenerators.selectNode = function (context) {
        if (!context || !context.node) {
            throw new Error('selectNode generator requires context.node');
        }

        var outputName = resolveOutputName(context, 0);
        if (!isOutputConnected(context, 0) || !outputName) {
            return { statement: '# select output not connected', outputs: [] };
        }

        var condition = inputRef(context, 0, 'False');
        var trueValue = inputRef(context, 1, 'None');
        var falseValue = inputRef(context, 2, 'None');

        return {
            statement:
                outputName +
                ' = (' +
                trueValue +
                ') if bool(' +
                condition +
                ') else (' +
                falseValue +
                ')',
            outputs: [outputName],
        };
    };

    /**
     * Normalize the `mode` control into one of the four supported branches.
     *
     * Accepts snake_case and the legacy `pingpong` spelling and falls back to
     * `clamp` for unknown values so the generated code always has a safe branch.
     * Called only by `rangeAdaptNode`.
     * @param {*} rawMode - Raw `mode` control value.
     * @returns {string} One of `clamp`, `wrap`, `ping-pong`, or `to-default`.
     */
    function normalizeRangeAdaptMode(rawMode) {
        var mode = String(rawMode === undefined || rawMode === null ? '' : rawMode)
            .toLowerCase()
            .replace(/_/g, '-');
        if (mode === 'pingpong') {
            mode = 'ping-pong';
        }
        if (mode === 'wrap' || mode === 'ping-pong' || mode === 'to-default') {
            return mode;
        }
        return 'clamp';
    }

    // Range adapt: reads the bounds from the `min`/`max` connectors, optionally mirrors the value
    // from the `invert` connector, then applies the mode. Bounds are swapped first so a reversed
    // min/max behaves like max..min, invert mirrors the input across the range midpoint after that
    // swap, and every span-based mode guards a zero-width range so no modulo-by-zero can reach the
    // board. The connector order (value, default, min, max, invert) is fixed by the definition
    // because saved graphs address connectors by index.
    globalScope.NodeCodeGenerators.rangeAdaptNode = function (context) {
        if (!context || !context.node) {
            throw new Error('rangeAdaptNode generator requires context.node');
        }

        var outputName = resolveOutputName(context, 0);
        if (!isOutputConnected(context, 0) || !outputName) {
            return { statement: '# range-adapt output not connected', outputs: [] };
        }

        var mode = normalizeRangeAdaptMode(controlValues(context).mode);
        var invertExpr = inputRef(context, 4, 'False');

        var valueName = varName(context, '_range_value');
        var lowName = varName(context, '_range_low');
        var highName = varName(context, '_range_high');
        var spanName = varName(context, '_range_span');
        var offsetName = varName(context, '_range_offset');

        var lines = [
            valueName + ' = ' + inputRef(context, 0, '0'),
            lowName + ' = ' + inputRef(context, 2, '0'),
            highName + ' = ' + inputRef(context, 3, '100'),
            'if ' +
                highName +
                ' < ' +
                lowName +
                ': ' +
                lowName +
                ', ' +
                highName +
                ' = ' +
                highName +
                ', ' +
                lowName,
        ];

        // The checkbox default formats to `False`, so an uninverted node emits no dead branch. Any
        // other literal (a connection or `True`) keeps a runtime test, so the mirror follows the
        // graph on every loop.
        if (isInputConnected(context, 4) || invertExpr !== 'False') {
            lines.push(
                'if bool(' + invertExpr + '):',
                '    ' + valueName + ' = ' + lowName + ' + ' + highName + ' - ' + valueName
            );
        }

        if (mode === 'wrap') {
            lines.push(
                spanName + ' = ' + highName + ' - ' + lowName,
                'if ' + spanName + ' == 0:',
                '    ' + outputName + ' = ' + lowName,
                'else:',
                '    ' +
                    outputName +
                    ' = ' +
                    lowName +
                    ' + (' +
                    valueName +
                    ' - ' +
                    lowName +
                    ') % ' +
                    spanName
            );
        } else if (mode === 'ping-pong') {
            lines.push(
                spanName + ' = ' + highName + ' - ' + lowName,
                'if ' + spanName + ' == 0:',
                '    ' + outputName + ' = ' + lowName,
                'else:',
                '    ' +
                    offsetName +
                    ' = (' +
                    valueName +
                    ' - ' +
                    lowName +
                    ') % (' +
                    spanName +
                    ' * 2)',
                '    ' +
                    outputName +
                    ' = ' +
                    lowName +
                    ' + ' +
                    offsetName +
                    ' if ' +
                    offsetName +
                    ' <= ' +
                    spanName +
                    ' else ' +
                    lowName +
                    ' + ' +
                    spanName +
                    ' * 2 - ' +
                    offsetName
            );
        } else if (mode === 'to-default') {
            var defaultExpr = inputRef(context, 1, '0');
            lines.push(
                'if ' +
                    valueName +
                    ' < ' +
                    lowName +
                    ' or ' +
                    valueName +
                    ' > ' +
                    highName +
                    ':',
                '    ' + outputName + ' = ' + defaultExpr,
                'else:',
                '    ' + outputName + ' = ' + valueName
            );
        } else {
            lines.push(
                'if ' + valueName + ' < ' + lowName + ':',
                '    ' + outputName + ' = ' + lowName,
                'elif ' + valueName + ' > ' + highName + ':',
                '    ' + outputName + ' = ' + highName,
                'else:',
                '    ' + outputName + ' = ' + valueName
            );
        }

        return { statement: lines.join('\n'), outputs: [outputName] };
    };

    /**
     * Normalize the `conversion` control into one of the supported transfers.
     *
     * Accepts snake_case as well as the `gamma` and `exp` aliases and falls back to
     * `linear` for unknown values so the generated code always has a valid branch.
     * Called only by `rangeConvertNode`.
     * @param {*} rawConversion - Raw `conversion` control value.
     * @returns {string} One of `linear`, `power`, `exponential`, or `stepped`.
     */
    function normalizeRangeConvertMode(rawConversion) {
        var mode = String(rawConversion === undefined || rawConversion === null ? '' : rawConversion)
            .toLowerCase()
            .replace(/_/g, '-');
        if (mode === 'gamma') {
            mode = 'power';
        }
        if (mode === 'exp') {
            mode = 'exponential';
        }
        if (mode === 'power' || mode === 'exponential' || mode === 'stepped') {
            return mode;
        }
        return 'linear';
    }

    /**
     * Normalize the `quantization` control into one of the supported level selections.
     *
     * Accepts the `round`, `up`, and `ceiling` aliases and falls back to `floor` for unknown
     * values so the generated stepped transfer always resolves a level deterministically.
     * Called only by `rangeConvertNode`.
     * @param {*} rawQuantization - Raw `quantization` control value.
     * @returns {string} One of `floor`, `nearest`, or `ceil`.
     */
    function normalizeRangeConvertQuantization(rawQuantization) {
        var quantization = String(
            rawQuantization === undefined || rawQuantization === null ? '' : rawQuantization
        ).toLowerCase();
        if (quantization === 'nearest' || quantization === 'round') {
            return 'nearest';
        }
        if (quantization === 'ceil' || quantization === 'ceiling' || quantization === 'up') {
            return 'ceil';
        }
        return 'floor';
    }

    /**
     * Range convert: maps a value from the input range onto the output range and clamps it.
     *
     * The bounds are never swapped. The normalized position keeps the sign of a reversed
     * input span, and the signed output span inverts the result for reversed output bounds.
     * A zero-width input range maps everything to `outMin`, so the output always stays
     * inside the output bounds. The stepped transfer quantizes the scaled position with the
     * `quantization` control (`floor`, `nearest`, or `ceil`).
     * @param {object} context - Transpiler generator context.
     * @param {object} context.node - Node data carrying the `conversion` and `quantization` control values.
     * @param {string[]} [context.inputs] - Python expressions for inputs 0..7.
     * @param {string[]} [context.outputs] - Output variable names.
     * @param {object[]} [context.outputsMeta] - Output connection metadata.
     * @returns {{statement: string, outputs: string[]}} Generated statement and outputs.
     */
    globalScope.NodeCodeGenerators.rangeConvertNode = function (context) {
        if (!context || !context.node) {
            throw new Error('rangeConvertNode generator requires context.node');
        }

        var outputName = resolveOutputName(context, 0);
        if (!isOutputConnected(context, 0) || !outputName) {
            return { statement: '# range-convert output not connected', outputs: [] };
        }

        var mode = normalizeRangeConvertMode(controlValues(context).conversion);

        var valueName = varName(context, '_map_value');
        var inMinName = varName(context, '_map_in_min');
        var inMaxName = varName(context, '_map_in_max');
        var outMinName = varName(context, '_map_out_min');
        var outMaxName = varName(context, '_map_out_max');
        var positionName = varName(context, '_map_t');
        var outSpan = '(' + outMaxName + ' - ' + outMinName + ')';

        var lines = [
            valueName + ' = ' + inputRef(context, 0, '0'),
            inMinName + ' = ' + inputRef(context, 1, '0'),
            inMaxName + ' = ' + inputRef(context, 2, '100'),
            outMinName + ' = ' + inputRef(context, 3, '0'),
            outMaxName + ' = ' + inputRef(context, 4, '100'),
            'if ' + inMaxName + ' == ' + inMinName + ':',
            '    ' + positionName + ' = 0.0',
            'else:',
            '    ' +
                positionName +
                ' = (' +
                valueName +
                ' - ' +
                inMinName +
                ') / (' +
                inMaxName +
                ' - ' +
                inMinName +
                ')',
            'if ' + positionName + ' < 0:',
            '    ' + positionName + ' = 0.0',
            'elif ' + positionName + ' > 1:',
            '    ' + positionName + ' = 1.0',
        ];

        if (mode === 'power') {
            var powerName = varName(context, '_map_power');
            lines.push(
                powerName + ' = ' + inputRef(context, 5, '2'),
                'if ' + powerName + ' <= 0:',
                '    ' + powerName + ' = 1',
                outputName +
                    ' = ' +
                    outMinName +
                    ' + (' +
                    positionName +
                    ' ** ' +
                    powerName +
                    ') * ' +
                    outSpan
            );
        } else if (mode === 'exponential') {
            var sigmaName = varName(context, '_map_sigma');
            var denominatorName = varName(context, '_map_exp_den');
            lines.push(
                sigmaName + ' = ' + inputRef(context, 6, '0.5'),
                'if ' + sigmaName + ' < 0.01:',
                '    ' + sigmaName + ' = 0.01',
                denominatorName + ' = pow(2.718281828459045, 1 / ' + sigmaName + ') - 1',
                'if ' + denominatorName + ' == 0:',
                '    ' + outputName + ' = ' + outMinName + ' + ' + positionName + ' * ' + outSpan,
                'else:',
                '    ' +
                    outputName +
                    ' = ' +
                    outMinName +
                    ' + (pow(2.718281828459045, ' +
                    positionName +
                    ' / ' +
                    sigmaName +
                    ') - 1) / ' +
                    denominatorName +
                    ' * ' +
                    outSpan
            );
        } else if (mode === 'stepped') {
            var stepsName = varName(context, '_map_steps');
            var scaledName = varName(context, '_map_scaled');
            var levelName = varName(context, '_map_level');
            var quantization = normalizeRangeConvertQuantization(
                controlValues(context).quantization
            );
            lines.push(
                stepsName + ' = int(' + inputRef(context, 7, '4') + ')',
                'if ' + stepsName + ' < 1:',
                '    ' + stepsName + ' = 1',
                scaledName + ' = ' + positionName + ' * ' + stepsName
            );
            if (quantization === 'nearest') {
                lines.push(
                    outputName +
                        ' = ' +
                        outMinName +
                        ' + int(' +
                        scaledName +
                        ' + 0.5) / ' +
                        stepsName +
                        ' * ' +
                        outSpan
                );
            } else if (quantization === 'ceil') {
                lines.push(
                    levelName + ' = int(' + scaledName + ')',
                    'if ' + levelName + ' < ' + scaledName + ':',
                    '    ' + levelName + ' = ' + levelName + ' + 1',
                    outputName +
                        ' = ' +
                        outMinName +
                        ' + ' +
                        levelName +
                        ' / ' +
                        stepsName +
                        ' * ' +
                        outSpan
                );
            } else {
                lines.push(
                    outputName +
                        ' = ' +
                        outMinName +
                        ' + int(' +
                        scaledName +
                        ') / ' +
                        stepsName +
                        ' * ' +
                        outSpan
                );
            }
        } else {
            lines.push(outputName + ' = ' + outMinName + ' + ' + positionName + ' * ' + outSpan);
        }

        return { statement: lines.join('\n'), outputs: [outputName] };
    };

    // Compose: one immutable Python tuple literal with a trailing comma per position.
    globalScope.NodeCodeGenerators.composeNode = function (context) {
        if (!context || !context.node) {
            throw new Error('composeNode generator requires context.node');
        }

        var outputName = resolveOutputName(context, 0);
        if (!isOutputConnected(context, 0) || !outputName) {
            return { statement: '# compose output not connected', outputs: [] };
        }

        var count = tuplePositionCount(context, 2);
        var items = [];
        for (var index = 0; index < count; index += 1) {
            items.push(inputRef(context, index, 'None'));
        }

        return {
            statement: outputName + ' = (' + items.join(', ') + ',)',
            outputs: [outputName],
        };
    };

    // Decompose: guarded positional reads so short or non-tuple inputs yield None.
    globalScope.NodeCodeGenerators.decomposeNode = function (context) {
        if (!context || !context.node) {
            throw new Error('decomposeNode generator requires context.node');
        }

        var outputsMeta = Array.isArray(context.outputsMeta) ? context.outputsMeta : [];
        var hasConnectedOutput = false;
        for (var check = 0; check < outputsMeta.length; check += 1) {
            if (isOutputConnected(context, check)) {
                hasConnectedOutput = true;
                break;
            }
        }
        if (!hasConnectedOutput) {
            return { statement: '# decompose output not connected', outputs: [] };
        }

        var count = tuplePositionCount(context, 2);
        var tupleName = varName(context, '_tuple');
        var lines = [tupleName + ' = ' + inputRef(context, 0, 'None')];
        var outputNames = [];

        for (var index = 0; index < count; index += 1) {
            if (!isOutputConnected(context, index)) {
                continue;
            }

            var outputName = resolveOutputName(context, index);
            if (!outputName) {
                continue;
            }

            lines.push(
                outputName +
                    ' = ' +
                    tupleName +
                    '[' +
                    index +
                    '] if isinstance(' +
                    tupleName +
                    ', tuple) and len(' +
                    tupleName +
                    ') > ' +
                    index +
                    ' else None'
            );
            outputNames.push(outputName);
        }

        return { statement: lines.join('\n'), outputs: outputNames };
    };

    /** Index-resolution modes understood by `core.tuple-select`. */
    var TUPLE_SELECT_MODES = ['default', 'clamp', 'wrap'];

    /**
     * Normalize a requested tuple-select index mode.
     *
     * Accepts any casing and surrounding whitespace. Unknown, empty, and
     * non-string values fall back to `'default'`, so graphs saved before the
     * `indexMode` control existed keep reading a position instead of failing.
     *
     * @param {*} rawMode - Raw `indexMode` control value.
     * @returns {string} One of `'default'`, `'clamp'`, `'wrap'`.
     * @private
     */
    function normalizeTupleSelectMode(rawMode) {
        var mode = typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : '';
        return TUPLE_SELECT_MODES.indexOf(mode) >= 0 ? mode : 'default';
    }

    // Tuple select: one guarded, zero-based positional read resolved through the index mode.
    globalScope.NodeCodeGenerators.tupleSelectNode = function (context) {
        if (!context || !context.node) {
            throw new Error('tupleSelectNode generator requires context.node');
        }

        var outputName = resolveOutputName(context, 0);
        if (!isOutputConnected(context, 0) || !outputName) {
            return { statement: '# tuple-select output not connected', outputs: [] };
        }

        var mode = normalizeTupleSelectMode(controlValues(context).indexMode);
        var tupleName = varName(context, '_tuple');
        var indexName = varName(context, '_index');
        var rawIndex = inputRef(context, 1, '0');
        var indexExpression =
            indexName +
            ' = int(' +
            rawIndex +
            ') if isinstance(' +
            rawIndex +
            ', (int, float)) else ';

        var lines = [tupleName + ' = ' + inputRef(context, 0, 'None')];

        if (mode === 'default') {
            lines.push(indexExpression + '-1');
            lines.push(
                outputName +
                    ' = ' +
                    tupleName +
                    '[' +
                    indexName +
                    '] if isinstance(' +
                    tupleName +
                    ', tuple) and 0 <= ' +
                    indexName +
                    ' < len(' +
                    tupleName +
                    ') else ' +
                    inputRef(context, 2, '0')
            );
        } else if (mode === 'clamp') {
            lines.push(indexExpression + 'None');
            lines.push(
                outputName +
                    ' = ' +
                    tupleName +
                    '[max(0, min(' +
                    indexName +
                    ', len(' +
                    tupleName +
                    ') - 1))] if isinstance(' +
                    tupleName +
                    ', tuple) and ' +
                    indexName +
                    ' is not None and len(' +
                    tupleName +
                    ') > 0 else None'
            );
        } else {
            lines.push(indexExpression + 'None');
            lines.push(
                outputName +
                    ' = ' +
                    tupleName +
                    '[' +
                    indexName +
                    ' % len(' +
                    tupleName +
                    ')] if isinstance(' +
                    tupleName +
                    ', tuple) and ' +
                    indexName +
                    ' is not None and len(' +
                    tupleName +
                    ') > 0 else None'
            );
        }

        return { statement: lines.join('\n'), outputs: [outputName] };
    };

    // Select by index: forwards one active value input chosen at runtime. Every value connector
    // declares an integer default control, so an unwired value forwards that default (0).
    globalScope.NodeCodeGenerators.selectIndexNode = function (context) {
        if (!context || !context.node) {
            throw new Error('selectIndexNode generator requires context.node');
        }

        var outputName = resolveOutputName(context, 0);
        if (!isOutputConnected(context, 0) || !outputName) {
            return { statement: '# select-index output not connected', outputs: [] };
        }

        var count = tuplePositionCount(context, 2);
        var rawName = varName(context, '_select_raw');
        var indexName = varName(context, '_select_index');
        var rawIndex = inputRef(context, 0, '0');

        var lines = [
            rawName + ' = ' + rawIndex,
            indexName +
                ' = int(' + rawName + ') if isinstance(' + rawName +
                ', (int, float)) and -1 < ' + rawName + ' < ' + count + ' else -1',
            outputName + ' = None',
        ];

        for (var position = 0; position < count; position += 1) {
            // The transpiler already substitutes the connector's default control value; the
            // fallback only covers a context without an input entry and matches that default.
            lines.push(
                (position === 0 ? 'if ' : 'elif ') + indexName + ' == ' + position + ':',
                '    ' + outputName + ' = ' + inputRef(context, position + 1, '0')
            );
        }

        return { statement: lines.join('\n'), outputs: [outputName] };
    };

})();
