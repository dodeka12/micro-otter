// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Time node generators: one configuration statement for the NTP service plus pure
// clock/date/window/format conversions on top of `otter_time.parts` and
// `otter_time.service`. Nothing here fetches or blocks: the service owns its own
// background task.

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

    // The transpiler hands unresolved inputs over as the Python `None` literal.
    const NULL_LITERAL = 'None';

    function ensureServiceImport(context) {
        registerImport(context, 'import otter_time.service as _time_srv');
    }

    function ensurePartsImport(context) {
        registerImport(context, 'import otter_time.parts as _parts');
    }

    function inputRef(context, index, fallback) {
        const inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        const value = inputs[index];
        if (value === undefined || value === null) {
            return fallback;
        }
        if (typeof value === 'string' && value.trim() === NULL_LITERAL) {
            return fallback;
        }
        return value;
    }

    // `-1` means "use the device clock"; both a literal and an unconnected input
    // resolve through the one runtime function.
    function epochExpression(context) {
        return `_time_srv.epoch_or_now(${inputRef(context, 0, '-1')})`;
    }

    // `-100` means "inherit the time-service timezone".
    function timezoneExpression(context) {
        return `_time_srv.timezone_from_argument(${inputRef(context, 1, '-100')})`;
    }

    function controlExpression(context, controlId, fallback) {
        const value = controlValues(context)[controlId];
        return formatLiteral(value === undefined || value === null ? fallback : value, context);
    }

    globalScope.NodeInitGenerators.timeService = function (context) {
        ensureServiceImport(context);
        return { init: { block: '', priority: 20, execute: '_time_srv.start()' } };
    };

    globalScope.NodeCodeGenerators.timeService = function (context) {
        ensureServiceImport(context);
        const keywordInputs = [
            ['server', 0],
            ['interval_minutes', 1],
            ['timezone_hours', 2],
            ['enabled', 3],
        ];
        const args = [];
        for (const [keyword, index] of keywordInputs) {
            const value = inputRef(context, index, null);
            if (value === null || value === undefined) {
                continue;
            }
            args.push(`${keyword}=${value}`);
        }
        // No fetch, no sleep, no branching: a pure configuration update, safe for
        // the loop body.
        return { statement: `_time_srv.configure(${args.join(', ')})`, outputs: [] };
    };

    globalScope.NodeCodeGenerators.timeStatus = function (context) {
        ensureServiceImport(context);
        const outs = Array.isArray(context.outputs) ? context.outputs : [];
        const lines = [
            `${outs[0]} = _time_srv.now()`,
            `${outs[1]} = _time_srv.synced()`,
            `${outs[2]} = _time_srv.age()`,
        ];
        return { statement: lines.join('\n'), outputs: outs };
    };

    globalScope.NodeCodeGenerators.timeClockParts = function (context) {
        ensurePartsImport(context);
        ensureServiceImport(context);
        return {
            expression: `_parts.clock_parts(${epochExpression(context)}, ${timezoneExpression(context)})`,
        };
    };

    globalScope.NodeCodeGenerators.timeDateParts = function (context) {
        ensurePartsImport(context);
        ensureServiceImport(context);
        return {
            expression: `_parts.date_parts(${epochExpression(context)}, ${timezoneExpression(context)})`,
        };
    };

    globalScope.NodeCodeGenerators.timeBetween = function (context) {
        ensurePartsImport(context);
        ensureServiceImport(context);
        const start = controlExpression(context, 'start', '08:00');
        const end = controlExpression(context, 'end', '17:00');
        return {
            expression:
                `_parts.between(${epochExpression(context)}, ${timezoneExpression(context)}, ` +
                `${start}, ${end})`,
        };
    };

    globalScope.NodeCodeGenerators.timeFormat = function (context) {
        ensurePartsImport(context);
        ensureServiceImport(context);
        const pattern = controlExpression(context, 'pattern', '%Y-%m-%d %H:%M:%S');
        return {
            expression:
                `_parts.format_time(${epochExpression(context)}, ${timezoneExpression(context)}, ` +
                `${pattern})`,
        };
    };
})();
