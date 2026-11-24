import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const generatorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/webview/generator_value_store.js'
);

function formatLiteral(value) {
    if (value === undefined || value === null) return 'None';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (typeof value === 'string') return `'${value}'`;
    return String(value);
}

describe('webview value-store node generators', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=webview-store-generators`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
    });

    function loopContext(overrides = {}) {
        const imports = [];
        return {
            node: { id: 'node-1', controlValues: { name: 'speed' } },
            inputs: [],
            outputs: ['node_1_out0'],
            outputsMeta: [{ connected: true }],
            helpers: {
                registerImport(statement) {
                    imports.push(statement);
                },
                formatLiteral,
            },
            _imports: imports,
            ...overrides,
        };
    }

    it('webStoreRead emits a get on the reserved store and imports the store module', () => {
        const ctx = loopContext();
        const result = globalThis.NodeCodeGenerators.webStoreRead(ctx);

        assert.equal(result.statement, "node_1_out0 = _store.get('_webcontrol', 'speed', 0)");
        assert.deepEqual(result.outputs, ['node_1_out0']);
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('webStoreRead uses a connected fallback input expression', () => {
        const ctx = loopContext({ inputs: ['node_7_out0'] });
        const result = globalThis.NodeCodeGenerators.webStoreRead(ctx);

        assert.equal(
            result.statement,
            "node_1_out0 = _store.get('_webcontrol', 'speed', node_7_out0)"
        );
    });

    it('webStoreRead reports an unconnected output without emitting a statement', () => {
        const ctx = loopContext({ outputs: [] });
        const result = globalThis.NodeCodeGenerators.webStoreRead(ctx);

        assert.equal(result.statement, '# web-store-read output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('webStoreWrite emits a set on the reserved store and returns no outputs', () => {
        const ctx = loopContext({ inputs: ['', 'node_3_out0'], outputs: [] });
        const result = globalThis.NodeCodeGenerators.webStoreWrite(ctx);

        assert.equal(
            result.statement,
            "if bool(True):\n    _store.set('_webcontrol', 'speed', node_3_out0)"
        );
        assert.deepEqual(result.outputs, []);
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('webStoreWrite defaults an unconnected value input to None', () => {
        const ctx = loopContext({ outputs: [] });
        const result = globalThis.NodeCodeGenerators.webStoreWrite(ctx);

        assert.equal(
            result.statement,
            "if bool(True):\n    _store.set('_webcontrol', 'speed', None)"
        );
    });

    it('webStoreWrite gates the set on the enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.webStoreWrite(loopContext({ inputs, outputs: [] }))
                .statement;

        assert.equal(
            statementFor(['node_2_out0', 'node_3_out0']),
            "if bool(node_2_out0):\n    _store.set('_webcontrol', 'speed', node_3_out0)"
        );
        assert.equal(
            statementFor(['False', 'node_3_out0']),
            "if bool(False):\n    _store.set('_webcontrol', 'speed', node_3_out0)"
        );
        assert.equal(
            statementFor(['', 'node_3_out0']),
            "if bool(True):\n    _store.set('_webcontrol', 'speed', node_3_out0)"
        );
        assert.equal(
            statementFor([undefined, 'node_3_out0']),
            "if bool(True):\n    _store.set('_webcontrol', 'speed', node_3_out0)"
        );
    });

    it('an empty name control emits an empty string key', () => {
        const ctx = loopContext({ node: { id: 'node-1', controlValues: {} } });
        const result = globalThis.NodeCodeGenerators.webStoreRead(ctx);

        assert.equal(result.statement, "node_1_out0 = _store.get('_webcontrol', '', 0)");
    });

    it('the store literal is fixed and cannot be replaced by an input', () => {
        const ctx = loopContext({ inputs: ['node_x_out0'] });
        const result = globalThis.NodeCodeGenerators.webStoreRead(ctx);

        assert.ok(result.statement.startsWith("node_1_out0 = _store.get('_webcontrol', "));
        assert.ok(!result.statement.includes('_store.get(node_x_out0'));
    });

    it('webStoreSave emits an edge-triggered save of the reserved store', () => {
        const ctx = loopContext({
            graph: { id: 'graph1' },
            inputs: ['', 'node_btn_out0'],
            outputs: [],
        });
        const result = globalThis.NodeCodeGenerators.webStoreSave(ctx);

        assert.equal(
            result.statement,
            'if bool(True):\n' +
                "    if _store.edge_trigger('save:graph1:node-1', node_btn_out0):\n" +
                "        _store.save('_webcontrol')"
        );
        assert.deepEqual(result.outputs, []);
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('webStoreSave gates the whole edge-trigger block', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.webStoreSave(
                loopContext({ graph: { id: 'graph1' }, inputs, outputs: [] })
            ).statement;

        assert.ok(
            statementFor(['node_2_out0', 'node_btn_out0']).startsWith(
                "if bool(node_2_out0):\n    if _store.edge_trigger('save:graph1:node-1'"
            )
        );
        assert.ok(
            statementFor(['False', 'node_btn_out0']).startsWith(
                "if bool(False):\n    if _store.edge_trigger('save:graph1:node-1'"
            )
        );
        assert.ok(
            statementFor(['', 'node_btn_out0']).startsWith(
                "if bool(True):\n    if _store.edge_trigger('save:graph1:node-1'"
            )
        );
    });

    it('webStoreLoad emits an edge-triggered load of the reserved store', () => {
        const ctx = loopContext({
            graph: { id: 'graph1' },
            inputs: ['node_btn_out0'],
            outputs: [],
        });
        const result = globalThis.NodeCodeGenerators.webStoreLoad(ctx);

        assert.equal(
            result.statement,
            "if _store.edge_trigger('load:graph1:node-1', node_btn_out0):\n" +
                "    _store.load('_webcontrol')"
        );
        assert.deepEqual(result.outputs, []);
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('save and load default an unconnected trigger to False', () => {
        const saveCtx = loopContext({ outputs: [] });
        const loadCtx = loopContext({ outputs: [] });

        assert.equal(
            globalThis.NodeCodeGenerators.webStoreSave(saveCtx).statement,
            'if bool(True):\n' +
                "    if _store.edge_trigger('save:node-1', False):\n" +
                "        _store.save('_webcontrol')"
        );
        assert.equal(
            globalThis.NodeCodeGenerators.webStoreLoad(loadCtx).statement,
            "if _store.edge_trigger('load:node-1', False):\n    _store.load('_webcontrol')"
        );
    });

    it('save and load keys are scoped to the graph and node id', () => {
        const saveCtx = loopContext({
            graph: { id: 'graph2' },
            node: { id: 'node-9', controlValues: {} },
            inputs: ['', 'node_btn_out0'],
            outputs: [],
        });
        const loadCtx = loopContext({
            graph: { id: 'graph2' },
            node: { id: 'node-9', controlValues: {} },
            inputs: ['node_btn_out0'],
            outputs: [],
        });

        assert.ok(
            globalThis.NodeCodeGenerators.webStoreSave(saveCtx).statement.includes(
                "edge_trigger('save:graph2:node-9'"
            )
        );
        assert.ok(
            globalThis.NodeCodeGenerators.webStoreLoad(loadCtx).statement.includes(
                "edge_trigger('load:graph2:node-9'"
            )
        );
    });
});
