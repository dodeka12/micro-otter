import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const definitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/mqtt/node_definitions.json'
);
const generatorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/mqtt/node_generators.js'
);

function loadDefinitions() {
    return JSON.parse(readFileSync(definitionsPath, 'utf8'));
}

const PACKAGE_ROOT = path.dirname(definitionsPath);

function assertLocalized(value, trail) {
    if (value === null || typeof value !== 'object') {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((entry, idx) => assertLocalized(entry, `${trail}[${idx}]`));
        return;
    }
    const keys = Object.keys(value);
    if (keys.includes('en') || keys.includes('de')) {
        assert.equal(typeof value.en, 'string', `${trail} is missing the en string`);
        assert.equal(typeof value.de, 'string', `${trail} is missing the de string`);
        return;
    }
    keys.forEach((key) => assertLocalized(value[key], `${trail}.${key}`));
}

function formatLiteral(value) {
    if (value === undefined || value === null) {
        return 'None';
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : 'None';
    }
    if (typeof value === 'boolean') {
        return value ? 'True' : 'False';
    }
    if (typeof value === 'string') {
        const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `'${escaped}'`;
    }
    return String(value);
}

describe('mqtt node definitions', () => {
    it('defines mqtt-read and mqtt-write with shared init_mqtt', () => {
        const nodeTypes = loadDefinitions().nodeTypes;
        for (const id of ['mqtt-read', 'mqtt-write']) {
            assert.ok(nodeTypes[id], `missing ${id}`);
            assert.equal(nodeTypes[id].implementations.python.type, 'code-generator');
            assert.equal(nodeTypes[id].initImplementations.python.type, 'code-generator');
            assert.equal(nodeTypes[id].initFunction, 'init_mqtt');
        }
    });

    it('gives mqtt-read a Default input with an inline default control', () => {
        const read = loadDefinitions().nodeTypes['mqtt-read'];
        assert.equal(read.inputs.length, 1);
        const input = read.inputs[0];
        assert.equal(input.id, 'default');
        assert.deepEqual(input.allowedTypes, ['float', 'int', 'bool', 'string']);
        assert.equal(input.defaultControl.type, 'number');
        assert.equal(input.defaultControl.default, 0);
    });

    it('adds the defaultWhenDisconnected checkbox to mqtt-read', () => {
        const controls = loadDefinitions().nodeTypes['mqtt-read'].controls;
        const control = controls.find((entry) => entry.id === 'defaultWhenDisconnected');
        assert.ok(control, 'missing defaultWhenDisconnected control');
        assert.equal(control.type, 'checkbox');
        assert.equal(control.id, 'defaultWhenDisconnected');
        assert.equal(control.label.en, 'Default on Dis.');
        assert.equal(control.label.de, 'Standard bei Trennung');
        assert.equal(control.default, false);
    });

    it('defaults the mqtt-write retain checkbox to true', () => {
        const controls = loadDefinitions().nodeTypes['mqtt-write'].controls;
        const control = controls.find((entry) => entry.id === 'retain');
        assert.ok(control, 'missing retain control');
        assert.equal(control.type, 'checkbox');
        assert.equal(control.default, true);
    });

    it('leads mqtt-write and mqtt-announce with the enabled gate', () => {
        const nodeTypes = loadDefinitions().nodeTypes;
        const expected = {
            'mqtt-write': ['enabled', 'value'],
            'mqtt-announce': ['enabled', 'payload'],
        };

        for (const [typeId, inputIds] of Object.entries(expected)) {
            const inputs = nodeTypes[typeId].inputs;
            assert.deepEqual(
                inputs.map((input) => input.id),
                inputIds
            );
            const enabled = inputs[0];
            assert.equal(enabled.id, 'enabled');
            assert.deepEqual(enabled.allowedTypes, ['bool']);
            assert.deepEqual(enabled.initialTypes, ['bool']);
            assert.equal(enabled.defaultControl.type, 'checkbox');
            assert.equal(enabled.defaultControl.default, true);
            assert.ok(enabled.description.en.length > 0);
            assert.ok(enabled.description.de.length > 0);
        }

        const will = nodeTypes['mqtt-will'];
        assert.ok(!will.inputs.some((input) => input.id === 'enabled'));
    });

    it('keeps en/de parity on every localized string', () => {
        const nodeTypes = loadDefinitions().nodeTypes;
        Object.keys(nodeTypes).forEach((id) => assertLocalized(nodeTypes[id], id));
    });

    it('defines mqtt-status as a pure status node', () => {
        const status = loadDefinitions().nodeTypes['mqtt-status'];
        assert.ok(status, 'missing mqtt-status');
        assert.equal(status.initFunction, undefined);
        assert.equal(status.initImplementations, undefined);
        assert.equal(status.implementations.python.value, 'NodeCodeGenerators.mqttStatus');
        assert.deepEqual(status.inputs, []);
        assert.equal(status.outputs.length, 1);
        assert.equal(status.outputs[0].id, 'connected');
        assert.equal(status.outputs[0].outputType, 'bool');
        assert.deepEqual(status.outputs[0].initialTypes, ['bool']);
    });

    it('ships every icon referenced by the node definitions', () => {
        const nodeTypes = loadDefinitions().nodeTypes;
        Object.keys(nodeTypes).forEach((id) => {
            const icon = nodeTypes[id].icon;
            assert.ok(icon, `${id} declares no icon`);
            assert.ok(
                existsSync(path.join(PACKAGE_ROOT, icon)),
                `${id} icon ${icon} is missing on disk`
            );
        });
    });
});

describe('mqtt node generators', () => {
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
        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=mqtt-generators`);
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

    function initContext(overrides = {}) {
        const imports = [];
        return {
            node: {
                id: '1',
                controlValues: { topic: 'sensors/temp', ...(overrides.controlValues || {}) },
            },
            inputs: [],
            outputs: ['node_1_out0', 'node_1_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
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

    function loopContext(overrides = {}) {
        const imports = [];
        return {
            node: {
                id: '1',
                controlValues: {
                    topic: 'sensors/temp',
                    valueType: 'string',
                    jsonKey: '',
                    defaultWhenDisconnected: false,
                    ...(overrides.controlValues || {}),
                },
            },
            inputs: ['input_val'],
            outputs: ['node_1_out0', 'node_1_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
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

    it('mqttRead init registers the subscription and starts the runtime', () => {
        const ctx = initContext();
        const result = globalThis.NodeInitGenerators.mqttRead(ctx);
        assert.equal(result.init.priority, 10);
        assert.equal(result.init.block, "_mqtt.register_subscription(topic='sensors/temp', qos=0)");
        assert.equal(result.init.execute, '_mqtt.start()');
        assert.ok(!result.init.block.includes('ensure_runtime()'));
        assert.ok(ctx._imports.includes('import otter_mqtt.runtime as _mqtt'));
    });

    it('mqttWrite init emits register_publish', () => {
        const ctx = initContext();
        const result = globalThis.NodeInitGenerators.mqttWrite(ctx);
        assert.equal(result.init.block, "_mqtt.register_publish(topic='sensors/temp', qos=0)");
        assert.equal(result.init.execute, '_mqtt.start()');
        assert.ok(!result.init.block.includes('ensure_runtime()'));
        assert.ok(ctx._imports.includes('import otter_mqtt.runtime as _mqtt'));
    });

    it('mqttRead loop reads the value before taking freshness with a per-node key', () => {
        const ctx = loopContext();
        const result = globalThis.NodeCodeGenerators.mqttRead(ctx);
        const statement = result.statement;

        assert.ok(
            statement.indexOf('_mqtt.latest_value(') >= 0,
            `missing latest_value in ${statement}`
        );
        assert.ok(
            statement.indexOf('_mqtt.latest_value(') < statement.indexOf('_mqtt.take_updated(')
        );
        assert.ok(statement.includes("key='_mqtt_read_1'"));
        assert.ok(statement.includes('require_connected=False'));
        assert.ok(statement.includes('default=(input_val)'));
        assert.ok(!statement.includes('_mqtt.take_latest('));
        assert.ok(!statement.includes('_mqtt.coerce('));
        assert.deepEqual(result.outputs, ['node_1_out0', 'node_1_out1']);
        assert.ok(ctx._imports.includes('import otter_mqtt.runtime as _mqtt'));
    });

    it('mqttRead loop requires a live connection when configured', () => {
        const ctx = loopContext({ controlValues: { defaultWhenDisconnected: true } });
        const result = globalThis.NodeCodeGenerators.mqttRead(ctx);
        assert.ok(result.statement.includes('require_connected=True'));
    });

    it('mqttRead loop only emits statements for connected outputs', () => {
        const valueOnly = globalThis.NodeCodeGenerators.mqttRead(
            loopContext({ outputs: ['node_1_out0', null], outputsMeta: [{ connected: true }, {}] })
        );
        assert.ok(valueOnly.statement.includes('_mqtt.latest_value('));
        assert.ok(!valueOnly.statement.includes('_mqtt.take_updated('));

        const updatedOnly = globalThis.NodeCodeGenerators.mqttRead(
            loopContext({
                outputs: [null, 'node_1_out1'],
                outputsMeta: [{ connected: false }, { connected: true }],
            })
        );
        assert.ok(updatedOnly.statement.includes('_mqtt.take_updated('));
        assert.ok(!updatedOnly.statement.includes('_mqtt.latest_value('));

        const nothingConnected = globalThis.NodeCodeGenerators.mqttRead(
            loopContext({ outputs: [null, null], outputsMeta: [{}, {}] })
        );
        assert.equal(nothingConnected.statement, '# mqtt read outputs not connected');
        assert.deepEqual(nothingConnected.outputs, []);
    });

    it('mqttRead loop emits the controls as literals', () => {
        const ctx = loopContext({ controlValues: { valueType: 'int', jsonKey: 'v' } });
        const result = globalThis.NodeCodeGenerators.mqttRead(ctx);
        assert.ok(result.statement.includes("value_type='int'"));
        assert.ok(result.statement.includes("json_key='v'"));
    });

    it('mqttStatus loop reports the runtime connection state', () => {
        const ctx = loopContext({
            outputs: ['node_9_out0'],
            outputsMeta: [{ connected: true }],
        });
        const result = globalThis.NodeCodeGenerators.mqttStatus(ctx);
        assert.equal(result.statement, 'node_9_out0 = _mqtt.is_connected()');
        assert.deepEqual(result.outputs, ['node_9_out0']);
        assert.ok(ctx._imports.includes('import otter_mqtt.runtime as _mqtt'));
    });

    it('mqttStatus loop skips unconnected outputs', () => {
        const result = globalThis.NodeCodeGenerators.mqttStatus(
            loopContext({ outputs: ['node_9_out0'], outputsMeta: [{ connected: false }] })
        );
        assert.equal(result.statement, '# mqtt status output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('mqttWrite loop emits publish with the per-node change key', () => {
        const ctx = loopContext({ inputs: ['', 'input_val'], outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.mqttWrite(ctx);
        assert.ok(result.statement.startsWith('if bool(True):\n    _mqtt.publish('));
        assert.ok(result.statement.includes("topic='sensors/temp'"));
        assert.ok(result.statement.includes("if_changed='_mqtt_last_1'"));
        assert.deepEqual(result.outputs, []);
    });

    it('mqttWrite loop gates the publish on the enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.mqttWrite(
                loopContext({ inputs, outputs: [], outputsMeta: [] })
            ).statement;

        assert.ok(
            statementFor(['node_2_out0', 'input_val']).startsWith(
                'if bool(node_2_out0):\n    _mqtt.publish('
            )
        );
        assert.ok(
            statementFor(['False', 'input_val']).startsWith('if bool(False):\n    _mqtt.publish(')
        );
        assert.ok(statementFor(['', 'input_val']).startsWith('if bool(True):\n    _mqtt.publish('));
        assert.ok(
            statementFor([undefined, 'input_val']).startsWith('if bool(True):\n    _mqtt.publish(')
        );
        assert.equal(statementFor(['', 'input_val']).split('_mqtt.publish(').length - 1, 1);
    });

    it('mqttWrite loop defaults retain to True when the control is absent', () => {
        const ctx = loopContext({ inputs: ['', 'input_val'], outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.mqttWrite(ctx);
        assert.ok(result.statement.includes('retain=True'));
    });

    it('mqttWrite loop honours retain false', () => {
        const ctx = loopContext({
            controlValues: { retain: false },
            inputs: ['', 'input_val'],
            outputs: [],
            outputsMeta: [],
        });
        const result = globalThis.NodeCodeGenerators.mqttWrite(ctx);
        assert.ok(result.statement.includes('retain=False'));
    });

    it('mqttWrite loop honours retain true', () => {
        const ctx = loopContext({
            controlValues: { retain: true },
            inputs: ['', 'input_val'],
            outputs: [],
            outputsMeta: [],
        });
        const result = globalThis.NodeCodeGenerators.mqttWrite(ctx);
        assert.ok(result.statement.includes('retain=True'));
    });
});

describe('mqtt topic authoring with graphTopics', () => {
    let originalSelf;
    let originalWindow;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=mqtt-topic-sentinel`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    });

    function contextWith(controlValues, overrides = {}) {
        const imports = [];
        return {
            node: { id: '7', controlValues },
            inputs: ['', 'input_val'],
            outputs: ['node_7_out0', 'node_7_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
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

    it('declares the graphTopics dropdown and the custom topic control', () => {
        const nodeTypes = loadDefinitions().nodeTypes;
        for (const id of ['mqtt-read', 'mqtt-write']) {
            const topic = nodeTypes[id].controls.find((control) => control.id === 'topic');
            assert.equal(topic.type, 'dropdown', `${id} topic is not a dropdown`);
            assert.equal(topic.affectsControls, true);
            assert.deepEqual(topic.dynamicOptions, {
                source: 'graphTopics',
                newTopicControls: ['customTopic'],
            });
            assert.ok(
                nodeTypes[id].controls.some((control) => control.id === 'customTopic'),
                `${id} has no customTopic control`
            );
        }
    });

    it('declares the payload modes of mqtt-read', () => {
        const controls = loadDefinitions().nodeTypes['mqtt-read'].controls;
        const mode = controls.find((control) => control.id === 'payloadMode');
        assert.equal(mode.type, 'dropdown');
        assert.equal(mode.default, 'value');
        assert.deepEqual(
            mode.options.map((option) => option.value),
            ['value', 'json-store']
        );
        assert.deepEqual(mode.options[0].activeControls, ['valueType', 'jsonKey']);
        assert.deepEqual(mode.options[1].activeControls, ['storeNamespace']);

        const store = controls.find((control) => control.id === 'storeNamespace');
        assert.equal(store.type, 'text');
        assert.equal(store.default, '');
    });

    it('keeps the mqtt-read init function and outputs', () => {
        const read = loadDefinitions().nodeTypes['mqtt-read'];
        assert.equal(read.initFunction, 'init_mqtt');
        assert.deepEqual(
            read.outputs.map((output) => output.id),
            ['value', 'updated']
        );
    });

    it('declares the payload modes of mqtt-write', () => {
        const controls = loadDefinitions().nodeTypes['mqtt-write'].controls;
        const mode = controls.find((control) => control.id === 'payloadMode');
        assert.equal(mode.default, 'value');
        assert.deepEqual(
            mode.options.map((option) => option.value),
            ['value', 'json-store']
        );
        assert.equal(mode.options[0].activeControls, undefined);
        assert.deepEqual(mode.options[1].activeControls, ['storeNamespace']);
    });

    it('generates the plain topic unchanged', () => {
        const ctx = contextWith({ topic: 'home/temp' });
        const init = globalThis.NodeInitGenerators.mqttRead(ctx);
        assert.equal(init.init.block, "_mqtt.register_subscription(topic='home/temp', qos=0)");
        const loop = globalThis.NodeCodeGenerators.mqttRead(ctx);
        assert.ok(loop.statement.includes("topic='home/temp'"));
    });

    it('resolves the new-topic sentinel in init and loop', () => {
        const ctx = contextWith({ topic: '__new__', customTopic: 'home/new' });
        const init = globalThis.NodeInitGenerators.mqttRead(ctx);
        assert.equal(init.init.block, "_mqtt.register_subscription(topic='home/new', qos=0)");
        const loop = globalThis.NodeCodeGenerators.mqttRead(ctx);
        assert.ok(loop.statement.includes("topic='home/new'"));
    });

    it('trims the typed topic and tolerates a missing one', () => {
        const trimmed = globalThis.NodeCodeGenerators.mqttRead(
            contextWith({ topic: '__new__', customTopic: '  home/new  ' })
        );
        assert.ok(trimmed.statement.includes("topic='home/new'"));

        const empty = globalThis.NodeCodeGenerators.mqttRead(contextWith({ topic: '__new__' }));
        assert.ok(empty.statement.includes("topic=''"));
    });
});

describe('mqtt payload modes', () => {
    let originalSelf;
    let originalWindow;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=mqtt-payload-modes`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    });

    function loopContext(overrides = {}) {
        const imports = [];
        return {
            node: {
                id: '4',
                controlValues: {
                    topic: 'sensors/state',
                    valueType: 'string',
                    jsonKey: '',
                    defaultWhenDisconnected: false,
                    ...(overrides.controlValues || {}),
                },
            },
            inputs: ['input_val'],
            outputs: ['node_4_out0', 'node_4_out1'],
            outputsMeta: [{ connected: true }, { connected: true }],
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

    it('keeps the value mode statement byte-identical', () => {
        const result = globalThis.NodeCodeGenerators.mqttRead(loopContext());
        assert.equal(
            result.statement,
            "node_4_out0 = _mqtt.latest_value(topic='sensors/state', value_type='string', " +
                "json_key='', require_connected=False, default=(input_val))\n" +
                "node_4_out1 = _mqtt.take_updated(topic='sensors/state', value_type='string', " +
                "json_key='', require_connected=False, key='_mqtt_read_4')"
        );
    });

    it('writes one JSON object into the configured store', () => {
        const ctx = loopContext({
            controlValues: { payloadMode: 'json-store', storeNamespace: 'sensors' },
        });
        const result = globalThis.NodeCodeGenerators.mqttRead(ctx);

        assert.ok(result.statement.includes('node_4_out1 = _mqtt.take_updated('));
        assert.ok(result.statement.includes('if node_4_out1:'));
        assert.ok(
            result.statement.includes(
                "    _mqtt_json_4 = _mqtt.json_value(_mqtt.latest('sensors/state'))"
            )
        );
        assert.ok(result.statement.includes('    if isinstance(_mqtt_json_4, dict):'));
        assert.ok(result.statement.includes("        _store.replace('sensors', _mqtt_json_4)"));
        assert.ok(!result.statement.includes('try:'));
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('emits only a comment for json-store without a namespace', () => {
        const ctx = loopContext({ controlValues: { payloadMode: 'json-store' } });
        const result = globalThis.NodeCodeGenerators.mqttRead(ctx);

        assert.equal(
            result.statement.split('\n').pop(),
            '# mqtt read: payload mode json-store without a store namespace'
        );
        assert.ok(!result.statement.includes('_store.replace'));
        assert.ok(!ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('does not write the store when only the value output is wired', () => {
        const ctx = loopContext({
            controlValues: { payloadMode: 'json-store', storeNamespace: 'sensors' },
            outputs: ['node_4_out0', null],
            outputsMeta: [{ connected: true }, {}],
        });
        const result = globalThis.NodeCodeGenerators.mqttRead(ctx);

        assert.ok(result.statement.includes('_mqtt.latest_value('));
        assert.ok(!result.statement.includes('_store.replace'));
        assert.ok(!ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('publishes the whole namespace as one JSON payload', () => {
        const ctx = loopContext({
            controlValues: {
                payloadMode: 'json-store',
                storeNamespace: 'sensors',
                publishMode: 'on-change',
            },
            inputs: ['', 'input_val'],
            outputs: [],
            outputsMeta: [],
        });
        const result = globalThis.NodeCodeGenerators.mqttWrite(ctx);

        assert.ok(result.statement.includes("value=(_mqtt.json_payload(_store.items('sensors')))"));
        assert.ok(result.statement.includes("if_changed='_mqtt_last_4'"));
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('emits no publish for json-store without a namespace', () => {
        const ctx = loopContext({
            controlValues: { payloadMode: 'json-store' },
            inputs: ['', 'input_val'],
            outputs: [],
            outputsMeta: [],
        });
        const result = globalThis.NodeCodeGenerators.mqttWrite(ctx);

        assert.equal(
            result.statement,
            '# mqtt write: payload mode json-store without a store namespace'
        );
        assert.ok(!ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('keeps the value mode publish byte-identical', () => {
        const ctx = loopContext({ inputs: ['', 'input_val'], outputs: [], outputsMeta: [] });
        const result = globalThis.NodeCodeGenerators.mqttWrite(ctx);

        assert.equal(
            result.statement,
            "if bool(True):\n    _mqtt.publish(topic='sensors/state', value=(input_val), " +
                "qos=0, retain=True, if_changed='_mqtt_last_4')"
        );
    });

    it('uses no change key in every-loop mode', () => {
        const ctx = loopContext({
            controlValues: {
                payloadMode: 'json-store',
                storeNamespace: 'sensors',
                publishMode: 'every-loop',
            },
            inputs: ['', 'input_val'],
            outputs: [],
            outputsMeta: [],
        });
        const result = globalThis.NodeCodeGenerators.mqttWrite(ctx);

        assert.ok(result.statement.includes('if_changed=None'));
    });
});

describe('mqtt-will and mqtt-announce', () => {
    let originalSelf;
    let originalWindow;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=mqtt-will-announce`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    });

    function context(controlValues, overrides = {}) {
        const imports = [];
        return {
            node: { id: '5', controlValues },
            inputs: ['', 'None'],
            inputsMeta: [{ connected: false }, { connected: false }],
            outputs: [],
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

    it('defines mqtt-will as an init-only node', () => {
        const will = loadDefinitions().nodeTypes['mqtt-will'];
        assert.equal(will.initImplementations.python.value, 'NodeInitGenerators.mqttWill');
        assert.equal(will.implementations.python.value, 'NodeCodeGenerators.mqttWill');
        assert.equal(will.initFunction, 'init_mqtt');
        assert.deepEqual(will.inputs, []);
        assert.deepEqual(will.outputs, []);
    });

    it('declares the will topic dropdown and defaults', () => {
        const controls = loadDefinitions().nodeTypes['mqtt-will'].controls;
        const topic = controls.find((control) => control.id === 'willTopic');
        assert.equal(topic.type, 'dropdown');
        assert.equal(topic.affectsControls, true);
        assert.deepEqual(topic.dynamicOptions, {
            source: 'graphTopics',
            newTopicControls: ['customWillTopic'],
        });
        assert.ok(controls.some((control) => control.id === 'customWillTopic'));
        assert.equal(controls.find((control) => control.id === 'willPayload').default, 'offline');
        assert.equal(controls.find((control) => control.id === 'willRetain').default, true);
        assert.deepEqual(
            controls.find((control) => control.id === 'willQos').options.map((o) => o.value),
            [0, 1]
        );
    });

    it('configures the will before the runtime starts', () => {
        const result = globalThis.NodeInitGenerators.mqttWill(context({}));
        assert.equal(
            result.init.block,
            "_mqtt.configure_will(topic='', payload='offline', retain=True, qos=0)"
        );
        assert.equal(result.init.execute, '_mqtt.start()');
        assert.equal(result.init.priority, 10);
    });

    it('honours the configured will payload, retain flag and qos', () => {
        const result = globalThis.NodeInitGenerators.mqttWill(
            context({ willPayload: 'gone', willRetain: false, willQos: 1 })
        );
        assert.equal(
            result.init.block,
            "_mqtt.configure_will(topic='', payload='gone', retain=False, qos=1)"
        );
    });

    it('resolves the will topic sentinel', () => {
        const result = globalThis.NodeInitGenerators.mqttWill(
            context({ willTopic: '__new__', customWillTopic: 'home/dev/status' })
        );
        assert.ok(result.init.block.includes("topic='home/dev/status'"));
    });

    it('defines mqtt-announce with init and loop implementations', () => {
        const announce = loadDefinitions().nodeTypes['mqtt-announce'];
        assert.equal(announce.initImplementations.python.value, 'NodeInitGenerators.mqttAnnounce');
        assert.equal(announce.implementations.python.value, 'NodeCodeGenerators.mqttAnnounce');
        assert.equal(announce.initFunction, 'init_mqtt');
        assert.deepEqual(announce.outputs, []);
        assert.deepEqual(
            announce.controls.map((control) => control.id),
            [
                'announceTopic',
                'customAnnounceTopic',
                'payloadMode',
                'storeNamespace',
                'payload',
                'retain',
                'qos',
                'publishMode',
                'triggerTopic',
                'customTriggerTopic',
                'triggerValue',
            ]
        );
    });

    it('defaults the announce controls', () => {
        const controls = loadDefinitions().nodeTypes['mqtt-announce'].controls;
        const byId = (id) => controls.find((control) => control.id === id);
        assert.deepEqual(byId('announceTopic').dynamicOptions, {
            source: 'graphTopics',
            newTopicControls: ['customAnnounceTopic'],
        });
        assert.deepEqual(byId('triggerTopic').dynamicOptions, {
            source: 'graphTopics',
            newTopicControls: ['customTriggerTopic'],
        });
        assert.equal(byId('triggerValue').default, 'online');
        assert.equal(byId('payloadMode').default, 'value');
        assert.equal(byId('publishMode').default, 'on-change');
        assert.equal(byId('retain').default, true);
        assert.equal(byId('announceTopic').options, undefined);
    });

    it('registers the announcement and its trigger subscription', () => {
        const withoutTrigger = globalThis.NodeInitGenerators.mqttAnnounce(
            context({ announceTopic: 'home/a' })
        );
        assert.equal(withoutTrigger.init.block, "_mqtt.register_publish(topic='home/a', qos=0)");
        assert.equal(withoutTrigger.init.execute, '_mqtt.start()');

        const withTrigger = globalThis.NodeInitGenerators.mqttAnnounce(
            context({ announceTopic: 'home/a', triggerTopic: 'homeassistant/status' })
        );
        assert.equal(
            withTrigger.init.block,
            "_mqtt.register_publish(topic='home/a', qos=0)\n" +
                "_mqtt.register_subscription(topic='homeassistant/status', qos=0)"
        );
    });

    it('publishes the payload control when the input is unconnected', () => {
        const result = globalThis.NodeCodeGenerators.mqttAnnounce(context({ payload: 'online' }));

        assert.equal(
            result.statement,
            "if bool(True):\n    _mqtt.publish_deferred(topic='', payload=('online'), qos=0, " +
                "retain=True, key='_mqtt_announce_5', if_changed='_mqtt_announce_last_5')"
        );
        assert.deepEqual(result.outputs, []);
    });

    it('publishes the connected input instead of the control', () => {
        const result = globalThis.NodeCodeGenerators.mqttAnnounce(
            context(
                { payload: 'ignored', announceTopic: 'home/a' },
                {
                    inputs: ['', 'node_1_out0'],
                    inputsMeta: [{ connected: false }, { connected: true }],
                }
            )
        );

        assert.ok(result.statement.includes('payload=(node_1_out0)'));
        assert.ok(!result.statement.includes("'ignored'"));
    });

    it('publishes the store as one JSON payload', () => {
        const ctx = context({
            announceTopic: 'home/a',
            payloadMode: 'json-store',
            storeNamespace: 'sensors',
        });
        const result = globalThis.NodeCodeGenerators.mqttAnnounce(ctx);

        assert.ok(
            result.statement.includes("payload=(_mqtt.json_payload(_store.items('sensors')))")
        );
        assert.ok(ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('emits a comment for json-store without a namespace', () => {
        const ctx = context({ payloadMode: 'json-store' });
        const result = globalThis.NodeCodeGenerators.mqttAnnounce(ctx);

        assert.equal(
            result.statement,
            '# mqtt announce: payload mode json-store without a store namespace'
        );
        assert.ok(!ctx._imports.includes('import otter_vars.store as _store'));
    });

    it('publishes every loop without a change key', () => {
        const result = globalThis.NodeCodeGenerators.mqttAnnounce(
            context({ payload: 'online', publishMode: 'every-loop' })
        );
        assert.ok(result.statement.includes('if_changed=None'));
    });

    it('re-asserts on a matching trigger value', () => {
        const result = globalThis.NodeCodeGenerators.mqttAnnounce(
            context({
                payload: 'online',
                announceTopic: 'home/a',
                triggerTopic: 'homeassistant/status',
                triggerValue: 'online',
            })
        );
        const lines = result.statement.split('\n');

        assert.equal(lines[0], 'if bool(True):');
        assert.equal(
            lines[1],
            "    _mqtt_ann_trig_5 = _mqtt.take_updated(topic='homeassistant/status', " +
                "value_type='string', key='_mqtt_announce_trig_5')"
        );
        assert.equal(lines[2], '    if _mqtt_ann_trig_5:');
        assert.equal(
            lines[3],
            "        _mqtt_ann_trig_5 = _mqtt.latest_value(topic='homeassistant/status', " +
                "value_type='string') == 'online'"
        );
        assert.ok(
            lines[4].startsWith('    _mqtt.publish_deferred(') &&
                lines[4].includes(
                    "if_changed=(None if _mqtt_ann_trig_5 else '_mqtt_announce_last_5')"
                )
        );
    });

    it('gates the whole announce block on the enabled input', () => {
        const statementFor = (inputs) =>
            globalThis.NodeCodeGenerators.mqttAnnounce(
                context(
                    {
                        payload: 'online',
                        announceTopic: 'home/a',
                        triggerTopic: 'homeassistant/status',
                    },
                    { inputs, inputsMeta: [{ connected: false }, { connected: false }] }
                )
            ).statement;

        assert.ok(
            statementFor(['node_2_out0', 'input_val']).startsWith(
                'if bool(node_2_out0):\n    _mqtt_ann_trig_5 = _mqtt.take_updated('
            )
        );
        assert.ok(
            statementFor(['False', 'input_val']).startsWith(
                'if bool(False):\n    _mqtt_ann_trig_5 = _mqtt.take_updated('
            )
        );
        assert.ok(
            statementFor(['', 'input_val']).startsWith(
                'if bool(True):\n    _mqtt_ann_trig_5 = _mqtt.take_updated('
            )
        );
        assert.ok(
            statementFor([undefined, 'input_val']).startsWith(
                'if bool(True):\n    _mqtt_ann_trig_5 = _mqtt.take_updated('
            )
        );
    });

    it('re-asserts on any trigger message without a trigger value', () => {
        const result = globalThis.NodeCodeGenerators.mqttAnnounce(
            context({
                payload: 'online',
                announceTopic: 'home/a',
                triggerTopic: 'homeassistant/status',
                triggerValue: '',
            })
        );

        assert.ok(!result.statement.includes('_mqtt.latest_value('));
        assert.ok(
            result.statement.includes(
                "if_changed=(None if _mqtt_ann_trig_5 else '_mqtt_announce_last_5')"
            )
        );
    });

    it('resolves the announce and trigger topic sentinels', () => {
        const result = globalThis.NodeCodeGenerators.mqttAnnounce(
            context({
                announceTopic: '__new__',
                customAnnounceTopic: 'home/new',
                triggerTopic: '__new__',
                customTriggerTopic: 'home/trig',
                payload: 'online',
            })
        );

        assert.ok(result.statement.includes("topic='home/new'"));
        assert.ok(result.statement.includes("topic='home/trig'"));
    });
});
