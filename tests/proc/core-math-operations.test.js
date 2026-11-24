import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const nodeDefinitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);
const mathGeneratorPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/generator_math_processor.js'
);

function getMathOperationOptions() {
    const definitions = JSON.parse(readFileSync(nodeDefinitionsPath, 'utf8'));
    const controls = definitions?.nodeTypes?.math?.controls || [];
    const operationControl = controls.find((control) => control.id === 'operation');
    return operationControl?.options || [];
}

function createGeneratorContext(
    operation,
    input0 = 'in0_value',
    input1 = 'in1_value',
    controlOverrides = {}
) {
    return {
        inputs: [input0, input1],
        outputs: ['node_math_out0'],
        outputsMeta: [{ id: 'out0', connected: true }],
        node: {
            controlValues: {
                operation,
                angleUnit: 'degrees',
                ...controlOverrides,
            },
        },
        helpers: {
            registerImport() {},
            formatLiteral(value) {
                return String(value);
            },
            getNullLiteral() {
                return 'None';
            },
        },
    };
}

describe('core math node definition', () => {
    it('defines modulus and fraction operation options with expected active input behavior', () => {
        const options = getMathOperationOptions();

        const modulusOption = options.find((option) => option.value === 'modulus');
        assert.ok(modulusOption, 'Expected modulus operation in math node dropdown options');
        assert.deepEqual(modulusOption.activeInputs, ['in0', 'in1']);

        const fractionOption = options.find((option) => option.value === 'fraction');
        assert.ok(fractionOption, 'Expected fraction operation in math node dropdown options');
        assert.deepEqual(fractionOption.activeInputs, ['in0']);
        assert.deepEqual(fractionOption.activeControls, []);
    });

    it('defines round as a unary operation next to fraction', () => {
        const options = getMathOperationOptions();
        const roundIndex = options.findIndex((option) => option.value === 'round');
        const fractionIndex = options.findIndex((option) => option.value === 'fraction');

        assert.ok(roundIndex >= 0, 'Expected round operation in math node dropdown options');
        assert.equal(roundIndex, fractionIndex + 1);

        const roundOption = options[roundIndex];
        assert.equal(roundOption.label.en, 'Round');
        assert.equal(roundOption.label.de, 'Runden');
        assert.deepEqual(roundOption.activeInputs, ['in0']);
        assert.deepEqual(roundOption.activeControls, ['decimalPlaces']);
        assert.equal(roundOption.activeInputs.length, 1);
    });

    it('defines floor and ceiling as unary operations without extra controls', () => {
        const options = getMathOperationOptions();

        const floorOption = options.find((option) => option.value === 'floor');
        assert.ok(floorOption, 'Expected floor operation in math node dropdown options');
        assert.equal(floorOption.label.en, 'Floor');
        assert.equal(floorOption.label.de, 'Abrunden');
        assert.deepEqual(floorOption.activeInputs, ['in0']);
        assert.deepEqual(floorOption.activeControls, []);

        const ceilOption = options.find((option) => option.value === 'ceil');
        assert.ok(ceilOption, 'Expected ceil operation in math node dropdown options');
        assert.equal(ceilOption.label.en, 'Ceiling');
        assert.equal(ceilOption.label.de, 'Aufrunden');
        assert.deepEqual(ceilOption.activeInputs, ['in0']);
        assert.deepEqual(ceilOption.activeControls, []);
    });

    it('defines power, ln, and log with expected inputs and ordering', () => {
        const options = getMathOperationOptions();
        const modulusIndex = options.findIndex((option) => option.value === 'modulus');
        const powerIndex = options.findIndex((option) => option.value === 'power');
        const expIndex = options.findIndex((option) => option.value === 'exp');
        const lnIndex = options.findIndex((option) => option.value === 'ln');
        const logIndex = options.findIndex((option) => option.value === 'log');
        const sinIndex = options.findIndex((option) => option.value === 'sin');

        assert.ok(powerIndex >= 0, 'Expected power operation in math node dropdown options');
        assert.equal(powerIndex, modulusIndex + 1);
        assert.ok(lnIndex >= 0, 'Expected ln operation in math node dropdown options');
        assert.equal(lnIndex, expIndex + 1);
        assert.ok(logIndex >= 0, 'Expected log operation in math node dropdown options');
        assert.equal(logIndex, lnIndex + 1);
        assert.equal(sinIndex, logIndex + 1);

        const powerOption = options[powerIndex];
        assert.equal(powerOption.label.en, 'Power');
        assert.equal(powerOption.label.de, 'Potenz');
        assert.deepEqual(powerOption.activeInputs, ['in0', 'in1']);
        assert.deepEqual(powerOption.activeControls, []);

        const lnOption = options[lnIndex];
        assert.equal(lnOption.label.en, 'Natural Log');
        assert.equal(lnOption.label.de, 'Natürlicher Logarithmus');
        assert.deepEqual(lnOption.activeInputs, ['in0']);
        assert.deepEqual(lnOption.activeControls, []);

        const logOption = options[logIndex];
        assert.equal(logOption.label.en, 'Logarithm');
        assert.equal(logOption.label.de, 'Logarithmus');
        assert.deepEqual(logOption.activeInputs, ['in0', 'in1']);
        assert.deepEqual(logOption.activeControls, []);
    });

    it('defines nth root after power and the hyperbolic operations after atan2', () => {
        const options = getMathOperationOptions();
        const powerIndex = options.findIndex((option) => option.value === 'power');
        const rootIndex = options.findIndex((option) => option.value === 'root');
        const atan2Index = options.findIndex((option) => option.value === 'atan2');

        assert.ok(rootIndex >= 0, 'Expected root operation in math node dropdown options');
        assert.equal(rootIndex, powerIndex + 1, 'root must follow power');

        const rootOption = options[rootIndex];
        assert.equal(rootOption.label.en, 'Nth Root');
        assert.equal(rootOption.label.de, 'N-te Wurzel');
        assert.deepEqual(rootOption.activeInputs, ['in0', 'in1']);
        assert.deepEqual(rootOption.activeControls, []);

        const hyperbolicValues = ['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'];

        assert.ok(atan2Index >= 0, 'Expected atan2 operation in math node dropdown options');
        hyperbolicValues.forEach((value, offset) => {
            const index = options.findIndex((option) => option.value === value);
            assert.ok(index >= 0, `Expected ${value} operation in math node dropdown options`);
            assert.equal(index, atan2Index + 1 + offset, `${value} must follow atan2`);

            const option = options[index];
            assert.equal(option.label.en, value);
            assert.equal(option.label.de, value);
            assert.deepEqual(option.activeInputs, ['in0']);
            assert.deepEqual(option.activeControls, []);
        });
    });

    it('defines a unary atan between acos and atan2', () => {
        const options = getMathOperationOptions();
        const acosIndex = options.findIndex((option) => option.value === 'acos');
        const atanIndex = options.findIndex((option) => option.value === 'atan');
        const atan2Index = options.findIndex((option) => option.value === 'atan2');

        assert.ok(atanIndex >= 0, 'Expected atan operation in math node dropdown options');
        assert.equal(atanIndex, acosIndex + 1, 'atan must follow acos');
        assert.equal(atan2Index, atanIndex + 1, 'atan2 must follow atan');

        const atanOption = options[atanIndex];
        assert.equal(atanOption.label.en, 'atan');
        assert.equal(atanOption.label.de, 'atan');
        assert.deepEqual(atanOption.activeInputs, ['in0']);
        assert.deepEqual(atanOption.activeControls, ['angleUnit']);
    });

    it('labels the trigonometric and hyperbolic operations with their shorthand names', () => {
        const options = getMathOperationOptions();
        const shorthandValues = [
            'sin',
            'cos',
            'tan',
            'asin',
            'acos',
            'atan',
            'atan2',
            'sinh',
            'cosh',
            'tanh',
            'asinh',
            'acosh',
            'atanh',
        ];

        for (const value of shorthandValues) {
            const option = options.find((candidate) => candidate.value === value);
            assert.ok(option, `Expected ${value} operation in math node dropdown options`);
            assert.equal(option.label.en, value, `${value} must use the English shorthand label`);
            assert.equal(option.label.de, value, `${value} must use the German shorthand label`);
        }
    });

    it('exposes a decimalPlaces control that defaults to whole-number rounding', () => {
        const definitions = JSON.parse(readFileSync(nodeDefinitionsPath, 'utf8'));
        const controls = definitions?.nodeTypes?.math?.controls || [];
        const decimalControl = controls.find((control) => control.id === 'decimalPlaces');

        assert.ok(decimalControl, 'Expected a decimalPlaces control on the math node');
        assert.equal(decimalControl.type, 'number');
        assert.equal(decimalControl.default, 0);
        assert.equal(decimalControl.min, 0);
        assert.equal(decimalControl.max, 6);
        assert.equal(decimalControl.step, 1);
    });
});

describe('core math processor generator', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;
    let mathProcessor;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;

        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};

        const generatorUrl = pathToFileURL(mathGeneratorPath);
        await import(`${generatorUrl.href}?test=core-math-operations`);

        mathProcessor = globalThis.NodeCodeGenerators.mathProcessor;
        assert.equal(typeof mathProcessor, 'function');
    });

    after(() => {
        if (originalSelf === undefined) {
            delete globalThis.self;
        } else {
            globalThis.self = originalSelf;
        }

        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }

        if (originalNodeCodeGenerators === undefined) {
            delete globalThis.NodeCodeGenerators;
        } else {
            globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        }

        if (originalNodeInitGenerators === undefined) {
            delete globalThis.NodeInitGenerators;
        } else {
            globalThis.NodeInitGenerators = originalNodeInitGenerators;
        }
    });

    it('emits Python modulus statement for integer inputs', () => {
        const result = mathProcessor(createGeneratorContext('modulus', '10', '3'));

        assert.equal(result.statement, 'node_math_out0 = (10) % (3)');
        assert.deepEqual(result.outputs, ['node_math_out0']);
    });

    it('emits Python modulus statement for floating-point inputs', () => {
        const result = mathProcessor(createGeneratorContext('modulus', '10.5', '4.2'));

        assert.equal(result.statement, 'node_math_out0 = (10.5) % (4.2)');
        assert.deepEqual(result.outputs, ['node_math_out0']);
    });

    it('emits Python fraction statement for integer and floating-point inputs', () => {
        const integerResult = mathProcessor(createGeneratorContext('fraction', '8', 'ignored'));
        assert.equal(integerResult.statement, 'node_math_out0 = (8) % 1');
        assert.deepEqual(integerResult.outputs, ['node_math_out0']);

        const floatResult = mathProcessor(createGeneratorContext('fraction', '8.75', 'ignored'));
        assert.equal(floatResult.statement, 'node_math_out0 = (8.75) % 1');
        assert.deepEqual(floatResult.outputs, ['node_math_out0']);
    });

    it('emits a Python round statement for a plain value', () => {
        const result = mathProcessor(createGeneratorContext('round', '21.7', 'ignored'));

        assert.equal(result.statement, 'node_math_out0 = round(21.7)');
        assert.deepEqual(result.outputs, ['node_math_out0']);
    });

    it('wraps a round expression input exactly once', () => {
        const result = mathProcessor(createGeneratorContext('round', '(a) + (b)', 'ignored'));

        assert.equal(result.statement, 'node_math_out0 = round((a) + (b))');
        assert.equal(result.statement.split('round(').length - 1, 1);
    });

    it('passes the decimal places of the round operation as second argument', () => {
        const result = mathProcessor(
            createGeneratorContext('round', '21.678', 'ignored', { decimalPlaces: 2 })
        );

        assert.equal(result.statement, 'node_math_out0 = round(21.678, 2)');
        assert.deepEqual(result.outputs, ['node_math_out0']);
    });

    it('normalises the decimal places to an integer in 0..6', () => {
        const truncate = mathProcessor(
            createGeneratorContext('round', '1.2345', 'ignored', { decimalPlaces: 2.9 })
        );
        assert.equal(truncate.statement, 'node_math_out0 = round(1.2345, 2)');

        const negative = mathProcessor(
            createGeneratorContext('round', '1.2345', 'ignored', { decimalPlaces: -3 })
        );
        assert.equal(negative.statement, 'node_math_out0 = round(1.2345)');

        const tooLarge = mathProcessor(
            createGeneratorContext('round', '1.2345', 'ignored', { decimalPlaces: 42 })
        );
        assert.equal(tooLarge.statement, 'node_math_out0 = round(1.2345, 6)');

        const garbage = mathProcessor(
            createGeneratorContext('round', '1.2345', 'ignored', { decimalPlaces: 'two' })
        );
        assert.equal(garbage.statement, 'node_math_out0 = round(1.2345)');
    });

    it('emits a Python floor statement and registers the math import', () => {
        const imports = [];
        const context = createGeneratorContext('floor', '4.7', 'ignored');
        context.helpers.registerImport = (statement) => imports.push(statement);

        const result = mathProcessor(context);

        assert.equal(result.statement, 'node_math_out0 = math.floor(4.7)');
        assert.deepEqual(result.outputs, ['node_math_out0']);
        assert.ok(
            imports.includes('import math'),
            `expected import math, got ${imports.join(', ')}`
        );
    });

    it('emits a Python ceil statement and registers the math import', () => {
        const imports = [];
        const context = createGeneratorContext('ceil', '-4.7', 'ignored');
        context.helpers.registerImport = (statement) => imports.push(statement);

        const result = mathProcessor(context);

        assert.equal(result.statement, 'node_math_out0 = math.ceil(-4.7)');
        assert.deepEqual(result.outputs, ['node_math_out0']);
        assert.ok(
            imports.includes('import math'),
            `expected import math, got ${imports.join(', ')}`
        );
    });

    it('keeps floor and ceil independent of the decimal places control', () => {
        const floorResult = mathProcessor(
            createGeneratorContext('floor', '4.7', 'ignored', { decimalPlaces: 3 })
        );
        const ceilResult = mathProcessor(
            createGeneratorContext('ceil', '4.2', 'ignored', { decimalPlaces: 3 })
        );

        assert.equal(floorResult.statement, 'node_math_out0 = math.floor(4.7)');
        assert.equal(ceilResult.statement, 'node_math_out0 = math.ceil(4.2)');
    });

    it('emits power as math.pow with both operands and the math import', () => {
        const imports = [];
        const context = createGeneratorContext('power', '10', '3');
        context.helpers.registerImport = (statement) => imports.push(statement);

        const result = mathProcessor(context);

        assert.equal(result.statement, 'node_math_out0 = math.pow(10, 3)');
        assert.deepEqual(result.outputs, ['node_math_out0']);
        assert.ok(
            imports.includes('import math'),
            `expected import math, got ${imports.join(', ')}`
        );
    });

    it('emits ln as a single-argument math.log and ignores the second input', () => {
        const imports = [];
        const context = createGeneratorContext('ln', '8.75', 'ignored');
        context.helpers.registerImport = (statement) => imports.push(statement);

        const result = mathProcessor(context);

        assert.equal(result.statement, 'node_math_out0 = math.log(8.75)');
        assert.ok(!result.statement.includes('ignored'));
        assert.deepEqual(result.outputs, ['node_math_out0']);
        assert.ok(
            imports.includes('import math'),
            `expected import math, got ${imports.join(', ')}`
        );
    });

    it('emits root as math.pow with the reciprocal degree and the math import', () => {
        const imports = [];
        const context = createGeneratorContext('root', '10', '3');
        context.helpers.registerImport = (statement) => imports.push(statement);

        const result = mathProcessor(context);

        assert.equal(result.statement, 'node_math_out0 = math.pow(10, 1.0 / (3))');
        assert.deepEqual(result.outputs, ['node_math_out0']);
        assert.ok(
            imports.includes('import math'),
            `expected import math, got ${imports.join(', ')}`
        );
    });

    it('preserves parenthesised root inputs', () => {
        const result = mathProcessor(createGeneratorContext('root', '(a) + (b)', '(c) * (d)'));

        assert.equal(
            result.statement,
            'node_math_out0 = math.pow((a) + (b), 1.0 / ((c) * (d)))'
        );
    });

    it('emits log as math.log with the value and base operands', () => {
        const imports = [];
        const context = createGeneratorContext('log', '8', '2');
        context.helpers.registerImport = (statement) => imports.push(statement);

        const result = mathProcessor(context);

        assert.equal(result.statement, 'node_math_out0 = math.log(8, 2)');
        assert.deepEqual(result.outputs, ['node_math_out0']);
        assert.ok(
            imports.includes('import math'),
            `expected import math, got ${imports.join(', ')}`
        );
    });

    it('preserves parenthesised power and logarithm inputs', () => {
        const power = mathProcessor(createGeneratorContext('power', '(a) + (b)', '(c) * (d)'));
        assert.equal(power.statement, 'node_math_out0 = math.pow((a) + (b), (c) * (d))');

        const ln = mathProcessor(createGeneratorContext('ln', '(a) + (b)', 'ignored'));
        assert.equal(ln.statement, 'node_math_out0 = math.log((a) + (b))');

        const log = mathProcessor(createGeneratorContext('log', '(a) + (b)', '(c) * (d)'));
        assert.equal(log.statement, 'node_math_out0 = math.log((a) + (b), (c) * (d))');
    });

    it('emits the hyperbolic operations as single-argument math calls', () => {
        for (const operation of ['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']) {
            const imports = [];
            const context = createGeneratorContext(operation, 'in0_value', 'ignored');
            context.helpers.registerImport = (statement) => imports.push(statement);

            const result = mathProcessor(context);

            assert.equal(result.statement, `node_math_out0 = math.${operation}(in0_value)`);
            assert.ok(!result.statement.includes('ignored'), `${operation} must ignore input in1`);
            assert.deepEqual(result.outputs, ['node_math_out0']);
            assert.ok(
                imports.includes('import math'),
                `expected import math for ${operation}, got ${imports.join(', ')}`
            );
        }
    });
});
