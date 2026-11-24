// Power node generators (Phase 4).
// Battery monitor init (ADC + divider) and loop (update + voltage/low outputs).

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
        return String(value);
    }

    function varName(context, prefix) {
        const raw = String((context && context.node && context.node.id) ?? 'node').replace(
            /[^A-Za-z0-9_]/g,
            '_'
        );
        return `${prefix}_${raw}`;
    }

    function controlValues(context) {
        return (context && context.node && context.node.controlValues) || {};
    }

    function outputRef(context, index) {
        const outputs = Array.isArray(context && context.outputs) ? context.outputs : [];
        return outputs[index] ?? null;
    }

    globalScope.NodeInitGenerators.batteryMonitor = function (context) {
        registerImport(context, 'from otter_power.battery import BatteryMonitor');

        const controls = controlValues(context);
        const battery = varName(context, '_bat');
        const args = [
            `adc_pin=${formatLiteral(controls.adcPin ?? 1, context)}`,
            `top_k=${formatLiteral(controls.topK ?? 100.0, context)}`,
            `bottom_k=${formatLiteral(controls.bottomK ?? 22.0, context)}`,
            `cells=${formatLiteral(controls.cells ?? 4, context)}`,
            `warn_v_cell=${formatLiteral(controls.warnVPerCell ?? 3.4, context)}`,
            `cut_v_cell=${formatLiteral(controls.cutVPerCell ?? 3.1, context)}`,
        ].join(', ');

        return { statement: `${battery} = BatteryMonitor(${args})` };
    };

    globalScope.NodeCodeGenerators.batteryMonitor = function (context) {
        const battery = varName(context, '_bat');
        const voltageVar = outputRef(context, 0);
        const warnVar = outputRef(context, 1);
        const lowVar = outputRef(context, 2);
        const lines = [`${battery}.update()`];
        if (voltageVar) {
            lines.push(`${voltageVar} = ${battery}.voltage`);
        }
        if (warnVar) {
            lines.push(`${warnVar} = ${battery}.warn`);
        }
        if (lowVar) {
            lines.push(`${lowVar} = ${battery}.low`);
        }
        return { statement: lines.join('\n') };
    };
})();

