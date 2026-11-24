// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Interrupt node generators. `interrupt-input` builds the `Pin` and the
// `otter_irq.interrupts` channel once in the shared `init_irq_generation` block and reads the
// channel from the graph body; `interrupt-enable` toggles a channel by name from the loop.
// The runtime signatures are fixed by `otter_irq/interrupts.py` (phase 1 of the irq plan).
// Module-level names are scoped to the graph (`_irq_<scope>_<id>`, `_irq_pin_<scope>_<id>`):
// every graph's shared-init contribution is merged into one function while node ids restart per
// graph, so an unscoped name would let one graph read another graph's channel.

(function () {
    const globalScope =
        typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
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

    /**
     * Graph scope for generator-owned module-level names.
     *
     * Every graph's shared-init contribution is merged into one collection-wide function while node
     * ids restart in each graph, so `_irq_<id>` from two graphs would overwrite each other. The
     * transpiler passes the graph's generated function name as `context.graph.scope`, which makes
     * `_irq_<scope>_<id>` unique per graph. A context without a graph (unit tests, generators run
     * outside the transpiler) yields no scope and keeps the bare `_irq_<id>` shape.
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
     * @param {string} prefix - Name prefix such as `_irq` or `_irq_pin`.
     * @returns {string} `<prefix>_<scope>_<id>`, or `<prefix>_<id>` without a graph scope.
     */
    function varName(context, prefix) {
        let raw =
            context && context.node && context.node.id !== undefined
                ? String(context.node.id)
                : 'node';
        raw = raw.replace(/[^A-Za-z0-9_]/g, '_');
        const scope = graphScope(context);
        return scope ? prefix + '_' + scope + '_' + raw : prefix + '_' + raw;
    }

    function inputRef(context, index, fallback) {
        const inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        const value = inputs[index];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    }

    function isOutputConnected(context, index) {
        if (!context || !Array.isArray(context.outputsMeta)) {
            return false;
        }
        const meta = context.outputsMeta[index];
        return Boolean(meta && meta.connected);
    }

    function resolveOutputName(context, index) {
        if (context && Array.isArray(context.outputs) && context.outputs[index]) {
            return context.outputs[index];
        }
        const helpers = context && context.helpers;
        if (helpers && typeof helpers.createOutputName === 'function') {
            return helpers.createOutputName(index);
        }
        return null;
    }

    // `interrupt` control value -> the `Pin.IRQ_*` trigger mask the runtime expects.
    const TRIGGER_CONSTANTS = {
        rising: 'Pin.IRQ_RISING',
        falling: 'Pin.IRQ_FALLING',
        change: 'Pin.IRQ_RISING | Pin.IRQ_FALLING',
        low: 'Pin.IRQ_LOW_LEVEL',
        high: 'Pin.IRQ_HIGH_LEVEL',
    };

    const DEFAULT_TRIGGER = 'rising';
    const MAX_DEBOUNCE_MS = 10000;

    function triggerConstant(controls) {
        const trigger = controls.trigger === undefined ? DEFAULT_TRIGGER : String(controls.trigger);
        return TRIGGER_CONSTANTS[trigger] || TRIGGER_CONSTANTS[DEFAULT_TRIGGER];
    }

    // Floors the debounce into `0 … 10000`; a missing or non-numeric value disables it.
    function clampDebounceMs(raw) {
        let value = Number(raw);
        if (!Number.isFinite(value)) {
            value = 0;
        }
        value = Math.floor(value);
        if (value < 0) {
            return 0;
        }
        if (value > MAX_DEBOUNCE_MS) {
            return MAX_DEBOUNCE_MS;
        }
        return value;
    }

    function triggerNameOf(controls) {
        const raw = controls.triggerName === undefined ? '' : controls.triggerName;
        return String(raw).trim();
    }

    globalScope.NodeInitGenerators.interruptInput = function (context) {
        registerImport(context, 'from machine import Pin');
        registerImport(context, 'import otter_irq.interrupts as _otter_irq');

        const controls = controlValues(context);
        const pin = controls.pin === undefined || controls.pin === null ? 0 : controls.pin;
        const pull = controls.pull;
        const pinName = varName(context, '_irq_pin');
        const channelName = varName(context, '_irq');

        let pinArgs = formatLiteral(pin, context) + ', Pin.IN';
        if (pull === 'up') {
            pinArgs += ', Pin.PULL_UP';
        } else if (pull === 'down') {
            pinArgs += ', Pin.PULL_DOWN';
        }
        const pinLine = pinName + ' = Pin(' + pinArgs + ')';

        const createLine =
            channelName +
            ' = _otter_irq.create_input(' +
            formatLiteral(triggerNameOf(controls), context) +
            ', ' +
            pinName +
            ', ' +
            triggerConstant(controls) +
            ', ' +
            clampDebounceMs(controls.debounceMs) +
            ')';

        return {
            init: {
                block: '_otter_irq.begin_generation()',
                priority: 0,
                execute: [pinLine, createLine].join('\n'),
            },
        };
    };

    // `executionPhase: "both"` runs this once during graph init as well, matching digital-input.
    // That is harmless for the channel: `take()` only advances the `_seen` cursor and never
    // clears the ThreadSafeFlag, so the edge that wakes an irq-mode graph is still latched.
    globalScope.NodeCodeGenerators.interruptInput = function (context) {
        const channelName = varName(context, '_irq');
        const lines = [];
        const outputs = [];

        if (isOutputConnected(context, 0)) {
            const triggered = resolveOutputName(context, 0);
            if (triggered) {
                lines.push(triggered + ' = ' + channelName + '.take()');
                outputs.push(triggered);
            }
        }
        if (isOutputConnected(context, 1)) {
            const count = resolveOutputName(context, 1);
            if (count) {
                lines.push(count + ' = ' + channelName + '.count()');
                outputs.push(count);
            }
        }
        if (isOutputConnected(context, 2)) {
            const state = resolveOutputName(context, 2);
            if (state) {
                lines.push(state + ' = ' + channelName + '.state()');
                outputs.push(state);
            }
        }

        if (lines.length === 0) {
            return { statement: '# interrupt input outputs not connected', outputs: [] };
        }
        return { statement: lines.join('\n'), outputs };
    };

    // The runtime looks the channel up by name, so an unknown name is a silent `False` on the
    // board; the transpiler reports the real error (phase 7).
    globalScope.NodeCodeGenerators.interruptEnable = function (context) {
        const name = triggerNameOf(controlValues(context));
        if (!name) {
            return { statement: '# interrupt enable has no interrupt name', outputs: [] };
        }

        registerImport(context, 'import otter_irq.interrupts as _otter_irq');

        const enabled = inputRef(context, 0, 'True');
        return {
            statement:
                '_otter_irq.set_enabled(' +
                formatLiteral(name, context) +
                ', bool(' +
                enabled +
                '))',
            outputs: [],
        };
    };
})();
