// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }
    if (!globalScope.NodeInitGenerators) {
        globalScope.NodeInitGenerators = {};
    }

    const OP_SYMBOLS = {
        add: '+',
        subtract: '-',
        multiply: '*',
        divide: '/',
        modulus: '%'
    };

    /** Largest number of decimal places the Round operation accepts. */
    const MAX_DECIMAL_PLACES = 6;

    const UNARY_OPERATION_HANDLERS = {
        sqrt(value) {
            return `(${value}) ** 0.5`;
        },
        square(value) {
            return `(${value}) ** 2`;
        },
        fraction(value) {
            return `(${value}) % 1`;
        },
        round(value, context) {
            const decimals = getDecimalPlaces(context);
            if (decimals === 0) {
                return `round(${value})`;
            }
            return `round(${value}, ${decimals})`;
        },
        floor(value, context) {
            ensurePythonMathImport(context);
            return `math.floor(${value})`;
        },
        ceil(value, context) {
            ensurePythonMathImport(context);
            return `math.ceil(${value})`;
        },
        exp(value) {
            return `pow(2.718281828459045, (${value}))`;
        },
        ln(value, context) {
            ensurePythonMathImport(context);
            return `math.log(${value})`;
        },
        sinh(value, context) {
            ensurePythonMathImport(context);
            return `math.sinh(${value})`;
        },
        cosh(value, context) {
            ensurePythonMathImport(context);
            return `math.cosh(${value})`;
        },
        tanh(value, context) {
            ensurePythonMathImport(context);
            return `math.tanh(${value})`;
        },
        asinh(value, context) {
            ensurePythonMathImport(context);
            return `math.asinh(${value})`;
        },
        acosh(value, context) {
            ensurePythonMathImport(context);
            return `math.acosh(${value})`;
        },
        atanh(value, context) {
            ensurePythonMathImport(context);
            return `math.atanh(${value})`;
        },
        sin(value, context) {
            return buildTrigExpression('sin', value, context);
        },
        cos(value, context) {
            return buildTrigExpression('cos', value, context);
        },
        tan(value, context) {
            return buildTrigExpression('tan', value, context);
        },
        asin(value, context) {
            return buildInverseTrigExpression('asin', [value], context);
        },
        acos(value, context) {
            return buildInverseTrigExpression('acos', [value], context);
        },
        atan(value, context) {
            return buildInverseTrigExpression('atan', [value], context);
        }
    };

    function ensureLiteral(value, fallback) {
        return value === undefined || value === null || value === '' ? fallback : value;
    }

    function defaultNullLiteral() {
        return 'None';
    }

    function defaultZeroLiteral() {
        return '0';
    }

    function getNullLiteral(helpers) {
        if (helpers && typeof helpers.getNullLiteral === 'function') {
            try {
                const explicit = helpers.getNullLiteral();
                if (explicit !== undefined && explicit !== null) {
                    return explicit;
                }
            } catch (err) {
                console.warn('Node generator null literal helper failed:', err);
            }
        }
        return defaultNullLiteral();
    }

    function getZeroLiteral(helpers) {
        if (helpers && typeof helpers.formatLiteral === 'function') {
            try {
                const literal = helpers.formatLiteral(0);
                if (literal !== undefined && literal !== null) {
                    return literal;
                }
            } catch (err) {
                console.warn('Node generator literal formatting failed:', err);
            }
        }
        return defaultZeroLiteral(language);
    }

    function buildDivideExpression(left, right, zeroLiteral) {
        return `(${zeroLiteral} if ((${right}) == 0) else ((${left}) / (${right})))`;
    }

    function getAngleUnit(context) {
        const defaultUnit = 'degrees';
        if (!context || !context.node || !context.node.controlValues) {
            return defaultUnit;
        }
        return context.node.controlValues.angleUnit || defaultUnit;
    }

    /**
     * Read the `decimalPlaces` control of the math node.
     *
     * The value is normalised to an integer between `0` and `MAX_DECIMAL_PLACES`, so a missing,
     * empty or non-numeric control value falls back to whole-number rounding.
     *
     * @param {object} context - Generator context carrying the node control values.
     * @returns {number} Number of decimal places the Round operation keeps.
     */
    function getDecimalPlaces(context) {
        const controls = (context && context.node && context.node.controlValues) || {};
        const raw = controls.decimalPlaces;
        if (raw === undefined || raw === null || raw === '') {
            return 0;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.min(Math.max(Math.trunc(value), 0), MAX_DECIMAL_PLACES);
    }

    function ensurePythonMathImport(context) {
        if (!context) {
            return;
        }
        const helpers = context.helpers || {};
        if (typeof helpers.registerImport === 'function') {
            helpers.registerImport('import math');
        }
    }

    function convertAngleInputToRadians(value, unit) {
        if (unit === 'radians') {
            return value;
        }
        if (unit === 'percent') {
            const factor = '(2 * math.pi)';
            return `(${value}) * ${factor}`;
        }
        const factor = '(math.pi / 180)';
        return `(${value}) * ${factor}`;
    }

    function convertRadiansToUnit(expression, unit) {
        if (unit === 'radians') {
            return expression;
        }
        if (unit === 'percent') {
            const divisor = '(2 * math.pi)';
            return `(${expression}) / ${divisor}`;
        }
        const divisor = 'math.pi';
        return `(${expression}) * (180 / ${divisor})`;
    }

    function buildTrigExpression(fnName, value, context) {
        ensurePythonMathImport(context);
        const unit = getAngleUnit(context);
        const angleExpression = convertAngleInputToRadians(value, unit);
        return `math.${fnName}(${angleExpression})`;
    }

    function buildInverseTrigExpression(fnName, args, context) {
        ensurePythonMathImport(context);
        const raw = `math.${fnName}(${args.join(', ')})`;
        const unit = getAngleUnit(context);
        return convertRadiansToUnit(raw, unit);
    }

    function isOutputConnected(context, index) {
        if (!context || !Array.isArray(context.outputsMeta)) {
            return false;
        }
        const meta = context.outputsMeta[index];
        return Boolean(meta && meta.connected);
    }

    globalScope.NodeCodeGenerators.mathProcessor = function (context) {
        if (!context) {
            throw new Error('mathProcessor generator requires context.');
        }

        const language = 'python';
        const inputs = Array.isArray(context.inputs) ? context.inputs.slice() : [];
        const helpers = context.helpers || {};
        const nullLiteral = getNullLiteral(helpers);
        const left = ensureLiteral(inputs[0], nullLiteral);
        const right = ensureLiteral(inputs[1], nullLiteral);
        const nodeControls = (context.node && context.node.controlValues) ? context.node.controlValues : {};
        let operation = nodeControls.operation || 'add';

        const outConnected = isOutputConnected(context, 0);
        if (!outConnected) {
            return { statement: '# math output not connected', outputs: [] };
        }

        const assignedOutputs = outConnected && Array.isArray(context.outputs) ? [context.outputs[0]] : [];

        if (operation === 'divide') {
            const zeroLiteral = getZeroLiteral(helpers);
            return { statement: `${context.outputs[0]} = ${buildDivideExpression(left, right, zeroLiteral)}`, outputs: assignedOutputs };
        }

        if (operation === 'atan2') {
            return { statement: `${context.outputs[0]} = ${buildInverseTrigExpression('atan2', [left, right], context)}`, outputs: assignedOutputs };
        }

        if (operation === 'power') {
            ensurePythonMathImport(context);
            return { statement: `${context.outputs[0]} = math.pow(${left}, ${right})`, outputs: assignedOutputs };
        }

        if (operation === 'root') {
            ensurePythonMathImport(context);
            return { statement: `${context.outputs[0]} = math.pow(${left}, 1.0 / (${right}))`, outputs: assignedOutputs };
        }

        if (operation === 'log') {
            ensurePythonMathImport(context);
            return { statement: `${context.outputs[0]} = math.log(${left}, ${right})`, outputs: assignedOutputs };
        }

        const unaryHandler = UNARY_OPERATION_HANDLERS[operation];
        if (typeof unaryHandler === 'function') {
            return { statement: `${context.outputs[0]} = ${unaryHandler(left, context)}`, outputs: assignedOutputs };
        }

        if (!Object.prototype.hasOwnProperty.call(OP_SYMBOLS, operation)) {
            console.warn('Unsupported binary math operation:', operation, '- defaulting to add.');
            operation = 'add';
        }

        const symbol = OP_SYMBOLS[operation];
        return { statement: `${context.outputs[0]} = (${left}) ${symbol} (${right})`, outputs: assignedOutputs };
    };

    globalScope.NodeInitGenerators.mathProcessor = function (context) {
        if (!context) {
            throw new Error('mathProcessor init generator requires context.');
        }
        const helpers = context.helpers || {};
        if (typeof helpers.registerImport === 'function') {
            helpers.registerImport('import math');
        }
        return { statement:'# No init for mathProcessor', outputs: [] };
    };
})();
