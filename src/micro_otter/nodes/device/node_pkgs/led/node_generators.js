// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// LED node generators: hardware output drivers.

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

    function num(context, key, fallback) {
        const value = Number(controlValues(context)[key]);
        return Number.isFinite(value) ? value : fallback;
    }

    function inputRef(context, index, fallback) {
        const inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        const value = inputs[index];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    }

    const COLOR_ORDERS = new Set(['GRB', 'RGB', 'BRG', 'RBG', 'GBR', 'BGR']);

    function normalizeOrder(rawOrder) {
        if (rawOrder === undefined || rawOrder === null || rawOrder === '') {
            return 'GRB';
        }
        const value = String(rawOrder).toUpperCase();
        if (COLOR_ORDERS.has(value)) {
            return value;
        }
        console.warn(`led: unknown color order '${rawOrder}'; falling back to 'GRB'`);
        return 'GRB';
    }

    globalScope.NodeInitGenerators.ledNeopixelOutput = function (context) {
        registerImport(context, 'from otter_led.drivers.neopixel import NeoPixel');
        const raw = String((context && context.node && context.node.id) ?? 'node').replace(/[^A-Za-z0-9_]/g, '_');
        const driver = `_np_${raw}`;
        const controls = controlValues(context);
        const pin = controls.pin === undefined || controls.pin === null ? 2 : controls.pin;
        const count = Math.max(0, Math.trunc(num(context, 'count', 60)));
        const order = formatLiteral(normalizeOrder(controls.order, context), context);
        const hasWhite = (controls.colorModel || 'rgb') === 'rgbw';
        return {
            statement: `${driver} = NeoPixel(pin=${formatLiteral(pin, context)}, count=${count}, order=${order}, has_white=${formatLiteral(hasWhite, context)})`,
        };
    };

    globalScope.NodeCodeGenerators.ledNeopixelOutput = function (context) {
        const raw = String((context && context.node && context.node.id) ?? 'node').replace(/[^A-Za-z0-9_]/g, '_');
        const driver = `_np_${raw}`;
        const colorModel = controlValues(context).colorModel || 'rgb';
        const c0 = inputRef(context, 1, 'None');
        const c1 = inputRef(context, 2, 'None');
        const c2 = inputRef(context, 3, 'None');
        const c3 = inputRef(context, 4, 'None');
        let channels;
        if (colorModel === 'single') {
            channels = `[${c0}, ${c0}, ${c0}]`;
        } else if (colorModel === 'rgbw') {
            channels = `[${c0}, ${c1}, ${c2}, ${c3}]`;
        } else {
            channels = `[${c0}, ${c1}, ${c2}]`;
        }
        const enabled = inputRef(context, 0, 'True');
        return {
            statement: `if bool(${enabled}):\n    ${driver}.write(${channels})`,
            outputs: [],
        };
    };

    globalScope.NodeInitGenerators.ledPwmStripOutput = function (context) {
        registerImport(context, 'from otter_led.drivers.pwm_strip import PwmStrip');
        const raw = String((context && context.node && context.node.id) ?? 'node').replace(/[^A-Za-z0-9_]/g, '_');
        const driver = `_strip_${raw}`;
        const controls = controlValues(context);
        const redPin = controls.redPin === undefined || controls.redPin === null ? 0 : controls.redPin;
        const greenPin = controls.greenPin === undefined || controls.greenPin === null ? 1 : controls.greenPin;
        const bluePin = controls.bluePin === undefined || controls.bluePin === null ? 2 : controls.bluePin;
        return {
            statement: `${driver} = PwmStrip(red_pin=${formatLiteral(redPin, context)}, green_pin=${formatLiteral(greenPin, context)}, blue_pin=${formatLiteral(bluePin, context)})`,
        };
    };

    globalScope.NodeCodeGenerators.ledPwmStripOutput = function (context) {
        const raw = String((context && context.node && context.node.id) ?? 'node').replace(/[^A-Za-z0-9_]/g, '_');
        const driver = `_strip_${raw}`;
        const r = inputRef(context, 1, '0');
        const g = inputRef(context, 2, '0');
        const b = inputRef(context, 3, '0');
        const enabled = inputRef(context, 0, 'True');
        return {
            statement: `if bool(${enabled}):\n    ${driver}.write(${r}, ${g}, ${b})`,
            outputs: [],
        };
    };

    globalScope.NodeInitGenerators.ledSingleOutput = function (context) {
        registerImport(context, 'from otter_led.drivers.single import SingleLed');
        const raw = String((context && context.node && context.node.id) ?? 'node').replace(/[^A-Za-z0-9_]/g, '_');
        const driver = `_single_${raw}`;
        const pin = controlValues(context).pin === undefined || controlValues(context).pin === null ? 2 : controlValues(context).pin;
        return { statement: `${driver} = SingleLed(pin=${formatLiteral(pin, context)})` };
    };

    globalScope.NodeCodeGenerators.ledSingleOutput = function (context) {
        const raw = String((context && context.node && context.node.id) ?? 'node').replace(/[^A-Za-z0-9_]/g, '_');
        const driver = `_single_${raw}`;
        const value = inputRef(context, 1, '0');
        const enabled = inputRef(context, 0, 'True');
        return {
            statement: `if bool(${enabled}):\n    ${driver}.write(${value})`,
            outputs: [],
        };
    };
})();
