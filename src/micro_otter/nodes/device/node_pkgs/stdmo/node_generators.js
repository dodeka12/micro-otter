// Stdmo servo node generators
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }
    if (!globalScope.NodeInitGenerators) {
        globalScope.NodeInitGenerators = {};
    }

    function ensureStdmoImport(context) {
        const helpers = context?.helpers;
        if (helpers && typeof helpers.registerImport === 'function') {
            helpers.registerImport('from packages.stdmo.servo import Servo');
        }
    }

    function formatLiteral(value, helpers) {
        if (helpers && typeof helpers.formatLiteral === 'function') {
            return helpers.formatLiteral(value);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : '0';
        }
        return `${value}`;
    }

    // Legacy generators left intact for backward compatibility with snapshots
    // that still reference code-generator implementations. The active servo
    // node now uses a callable class via the `function` implementation path.
    globalScope.NodeInitGenerators.stdmoServo = function (context) {
        ensureStdmoImport(context);
        return '';
    };

    globalScope.NodeCodeGenerators.stdmoServo = function (context) {
        if (!context || !context.node) {
            throw new Error('stdmoServo generator requires context.node');
        }
        const outputsMeta = Array.isArray(context.outputsMeta) ? context.outputsMeta : [];
        if (!outputsMeta.some((entry) => entry && entry.connected)) {
            // No connected outputs; servo side effects unnecessary.
            return { statement: '# servo output not connected', outputs: [] };
        }
        ensureStdmoImport(context);
        const inputs = Array.isArray(context.inputs) ? context.inputs : [];
        const angleExpr = inputs[0] ?? '0';
        const controls = context.node.controlValues || {};
        const helpers = context.helpers || {};
        const pin = formatLiteral(controls.pin ?? 0, helpers);
        const minUs = formatLiteral(controls.minUs ?? 1000, helpers);
        const maxUs = formatLiteral(controls.maxUs ?? 2000, helpers);
        const rangeMin = formatLiteral(controls.rangeMin ?? -90, helpers);
        const rangeMax = formatLiteral(controls.rangeMax ?? 90, helpers);
        const maxRate = formatLiteral(controls.maxRate ?? 180, helpers);
        const varName = `servo_${context.node.id}`;

        const setup = `${varName} = Servo(${pin}, freq=50, min_us=${minUs}, max_us=${maxUs}, angle_range=[${rangeMin}, ${rangeMax}], max_angle_change_per_sec=${maxRate})`;
        const statement = `${varName}.set_angle(${angleExpr})`;
        return {
            statement,
            outputs: [],
            imports: ['from packages.stdmo.servo import Servo'],
            setup
        };
    };
})();
