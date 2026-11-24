import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const generatorsPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/time/node_generators.js');

const SERVICE_IMPORT = 'import otter_time.service as _time_srv';
const PARTS_IMPORT = 'import otter_time.parts as _parts';

function formatLiteral(value) {
    if (value === undefined || value === null) return 'None';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    return String(value);
}

function makeContext({ inputs = [], controls = {}, outputs = ['node_1_out0'] } = {}) {
    const imports = [];
    return {
        node: { id: '1', controlValues: controls },
        inputs,
        outputs,
        helpers: {
            formatLiteral,
            registerImport(statement) {
                // The transpiler collects imports in a Set, so model that here.
                if (!imports.includes(statement)) {
                    imports.push(statement);
                }
            },
        },
        imports,
    };
}

describe('time node generators', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        await import(`${pathToFileURL(generatorsPath).href}?test=time-generators`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        if (originalNodeInitGenerators === undefined) delete globalThis.NodeInitGenerators;
        else globalThis.NodeInitGenerators = originalNodeInitGenerators;
    });

    it('registers six loop generators and one init generator', () => {
        assert.deepEqual(Object.keys(globalThis.NodeCodeGenerators).sort(), [
            'timeBetween',
            'timeClockParts',
            'timeDateParts',
            'timeFormat',
            'timeService',
            'timeStatus',
        ]);
        assert.deepEqual(Object.keys(globalThis.NodeInitGenerators), ['timeService']);
    });

    it('timeService init registers one service import and starts the task', () => {
        const context = makeContext();
        const first = globalThis.NodeInitGenerators.timeService(context);
        const second = globalThis.NodeInitGenerators.timeService(context);

        assert.equal(first.init.execute, '_time_srv.start()');
        assert.equal(first.init.block, '');
        assert.equal(first.init.priority, 20);
        assert.deepEqual(context.imports, [SERVICE_IMPORT]);
        assert.equal(second.init.execute, '_time_srv.start()');
    });

    it('timeService loop emits one configure statement with literal inputs', () => {
        const context = makeContext({ inputs: ["'pool.ntp.org'", '60', '0', 'True'] });
        const result = globalThis.NodeCodeGenerators.timeService(context);

        assert.equal(
            result.statement,
            "_time_srv.configure(server='pool.ntp.org', interval_minutes=60, timezone_hours=0, " +
                'enabled=True)'
        );
        assert.deepEqual(result.outputs, []);
        assert.deepEqual(context.imports, [SERVICE_IMPORT]);
        assert.ok(!result.statement.includes('query_ntp'));
        assert.ok(!result.statement.includes('sleep'));
        assert.ok(!result.statement.includes('while'));
    });

    it('timeService loop keeps connected inputs unchanged', () => {
        const context = makeContext({ inputs: ["'pool.ntp.org'", 'node_2_out0', '1.5', 'False'] });
        const result = globalThis.NodeCodeGenerators.timeService(context);

        assert.equal(
            result.statement,
            "_time_srv.configure(server='pool.ntp.org', interval_minutes=node_2_out0, " +
                'timezone_hours=1.5, enabled=False)'
        );
    });

    it('timeService loop drops inputs the transpiler could not resolve', () => {
        const context = makeContext({ inputs: ['None', '60', 'None', 'True'] });
        const result = globalThis.NodeCodeGenerators.timeService(context);

        assert.equal(result.statement, '_time_srv.configure(interval_minutes=60, enabled=True)');
    });

    it('timeService loop with no resolvable input still emits the call', () => {
        const context = makeContext({ inputs: ['None', 'None', 'None', 'None'] });
        const result = globalThis.NodeCodeGenerators.timeService(context);

        assert.equal(result.statement, '_time_srv.configure()');
    });

    it('timeClockParts wraps the sentinel inputs exactly once', () => {
        const context = makeContext({
            inputs: ['-1', '-100'],
            outputs: ['node_1_out0', 'node_1_out1', 'node_1_out2'],
        });
        const result = globalThis.NodeCodeGenerators.timeClockParts(context);

        assert.equal(
            result.expression,
            '_parts.clock_parts(_time_srv.epoch_or_now(-1), _time_srv.timezone_from_argument(-100))'
        );
        assert.equal(result.expression.split('epoch_or_now').length, 2);
        assert.deepEqual(context.imports, [PARTS_IMPORT, SERVICE_IMPORT]);
    });

    it('timeDateParts wraps a connected epoch and timezone', () => {
        const context = makeContext({
            inputs: ['node_2_out0', 'node_3_out0'],
            outputs: ['node_1_out0', 'node_1_out1', 'node_1_out2', 'node_1_out3'],
        });
        const result = globalThis.NodeCodeGenerators.timeDateParts(context);

        assert.equal(
            result.expression,
            '_parts.date_parts(_time_srv.epoch_or_now(node_2_out0), ' +
                '_time_srv.timezone_from_argument(node_3_out0))'
        );
        assert.deepEqual(context.imports, [PARTS_IMPORT, SERVICE_IMPORT]);
    });

    it('timeBetween embeds the control literals between quotes', () => {
        const context = makeContext({ inputs: ['-1', '-100'], controls: { start: '22:00', end: '06:00' } });
        const result = globalThis.NodeCodeGenerators.timeBetween(context);

        assert.equal(
            result.expression,
            "_parts.between(_time_srv.epoch_or_now(-1), _time_srv.timezone_from_argument(-100), " +
                "'22:00', '06:00')"
        );
        assert.deepEqual(context.imports, [PARTS_IMPORT, SERVICE_IMPORT]);
    });

    it('timeBetween falls back to the default window', () => {
        const context = makeContext({ inputs: ['-1', '-100'] });
        const result = globalThis.NodeCodeGenerators.timeBetween(context);

        assert.ok(result.expression.includes("'08:00', '17:00'"));
    });

    it('timeFormat embeds the pattern control', () => {
        const context = makeContext({ inputs: ['-1', '-100'], controls: { pattern: '%H:%M' } });
        const result = globalThis.NodeCodeGenerators.timeFormat(context);

        assert.equal(
            result.expression,
            "_parts.format_time(_time_srv.epoch_or_now(-1), " +
                "_time_srv.timezone_from_argument(-100), '%H:%M')"
        );
        assert.deepEqual(context.imports, [PARTS_IMPORT, SERVICE_IMPORT]);
    });

    it('timeFormat falls back to the default pattern', () => {
        const context = makeContext({ inputs: ['-1', '-100'] });
        const result = globalThis.NodeCodeGenerators.timeFormat(context);

        assert.ok(result.expression.includes("'%Y-%m-%d %H:%M:%S'"));
    });

    it('timeStatus emits three assignments in order', () => {
        const outputs = ['node_4_out0', 'node_4_out1', 'node_4_out2'];
        const context = makeContext({ outputs });
        const result = globalThis.NodeCodeGenerators.timeStatus(context);

        assert.deepEqual(result.outputs, outputs);
        assert.deepEqual(result.statement.split('\n'), [
            'node_4_out0 = _time_srv.now()',
            'node_4_out1 = _time_srv.synced()',
            'node_4_out2 = _time_srv.age()',
        ]);
    });

    it('escapes quotes in a control value', () => {
        const context = makeContext({ inputs: ['-1', '-100'], controls: { pattern: "o'clock" } });
        const result = globalThis.NodeCodeGenerators.timeFormat(context);

        assert.ok(result.expression.includes("'o\\'clock'"));
    });

    it('falls back to its own literal formatter without helpers', () => {
        const context = {
            node: { id: '1', controlValues: { pattern: '%H', start: '09:00', end: '10:00' } },
            inputs: ['-1', '-100'],
            outputs: ['node_1_out0'],
        };

        const result = globalThis.NodeCodeGenerators.timeFormat(context);

        assert.ok(result.expression.includes("'%H'"));
    });
});
