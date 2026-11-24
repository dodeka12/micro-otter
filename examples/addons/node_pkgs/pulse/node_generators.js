// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Pulse example add-on: the code generator behind the `pulse.tick` node type.

(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }

    /**
     * The guarded import the generated program uses to reach the staged module.
     *
     * The default implementation stages ``moa_pulse`` and the viper variant stages
     * ``moa_pulse_viper``; exactly one is frozen into an image, while the generated
     * program is shared by every target. Importing whichever module exists keeps a
     * single program valid for both, and also for the collection-deploy source
     * upload fallback.
     */
    const IMPORT_BLOCK = [
        'try:',
        '    import moa_pulse as _moa_pulse',
        'except ImportError:',
        '    import moa_pulse_viper as _moa_pulse',
    ].join('\n');

    /**
     * Read the node's control values.
     * @param {object} context - Generator context from the transpiler.
     * @returns {object} Control values keyed by control id.
     */
    function controlValues(context) {
        const node = context && context.node;
        return (node && node.controlValues) || {};
    }

    /**
     * Read one input expression, returning a fallback when the input is unwired.
     * @param {object} context - Generator context from the transpiler.
     * @param {number} index - Position of the input in the node's input list.
     * @param {string} fallback - Literal used when the input is absent or empty.
     * @returns {string} The input expression or the fallback.
     */
    function inputRef(context, index, fallback) {
        const inputs = context && Array.isArray(context.inputs) ? context.inputs : [];
        const value = inputs[index];
        return value === undefined || value === null || value === '' ? fallback : value;
    }

    /**
     * Normalize the duty control into an integer percentage in the 0..100 range.
     * @param {*} raw - Raw control value (string, number, or undefined).
     * @returns {number} Clamped percentage; 50 when the value is not numeric.
     */
    function normalizeDuty(raw) {
        const duty = Number(raw);
        if (!Number.isFinite(duty)) {
            return 50;
        }
        return Math.max(0, Math.min(100, Math.round(duty)));
    }

    /**
     * Generate the loop expression for the ``pulse.tick`` node.
     *
     * Emits ``(value if _moa_pulse.high(time.ticks_ms(), interval, duty) else 0)``,
     * wrapping the condition in ``not`` when the ``invert`` control is set. The duty
     * is emitted as a literal so the device module never depends on control plumbing.
     *
     * @param {object} context - Generator context from the transpiler.
     * @returns {{expression: string}} The generated expression.
     */
    globalScope.NodeCodeGenerators.moaPulseTick = function (context) {
        const helpers = (context && context.helpers) || {};
        if (typeof helpers.registerImport === 'function') {
            helpers.registerImport('import time');
            helpers.registerImport(IMPORT_BLOCK);
        }

        const controls = controlValues(context);
        const interval = inputRef(context, 1, '1000');
        const value = inputRef(context, 0, '1');
        const duty = normalizeDuty(controls.duty);
        const high = `_moa_pulse.high(time.ticks_ms(), ${interval}, ${duty})`;
        const condition = Boolean(controls.invert) ? `not ${high}` : high;

        return { expression: `(${value} if ${condition} else 0)` };
    };
})();
