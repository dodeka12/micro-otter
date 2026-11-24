import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/hass');
const definitionsPath = path.join(packageRoot, 'node_definitions.json');
const generatorsPath = path.join(packageRoot, 'node_generators.js');

function loadNodeTypes() {
    return JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;
}

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
        return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }
    return String(value);
}

const ENTITY_NODES = [
    'hass-sensor',
    'hass-binary-sensor',
    'hass-number',
    'hass-switch',
    'hass-select',
    'hass-text',
    'hass-button',
];

// Entities with a command topic: they own a value that Home Assistant can set.
const WRITABLE_NODES = ['hass-number', 'hass-switch', 'hass-select', 'hass-text'];

describe('hass node definitions', () => {
    it('defines the bridge, the availability flag and the seven entity nodes', () => {
        assert.deepEqual(Object.keys(loadNodeTypes()).sort(), [
            'hass-availability',
            'hass-binary-sensor',
            'hass-bridge',
            'hass-button',
            'hass-number',
            'hass-select',
            'hass-sensor',
            'hass-switch',
            'hass-text',
        ]);
    });

    it('runs every node through init_mqtt', () => {
        const nodeTypes = loadNodeTypes();
        Object.keys(nodeTypes).forEach((typeId) => {
            const node = nodeTypes[typeId];
            assert.equal(node.initFunction, 'init_mqtt', `${typeId} init function`);
            assert.equal(node.implementations.python.type, 'code-generator');
            assert.equal(node.initImplementations.python.type, 'code-generator');
        });
    });

    it('gives the bridge the documented controls and no connectors', () => {
        const bridge = loadNodeTypes()['hass-bridge'];
        assert.deepEqual(bridge.inputs, []);
        assert.deepEqual(bridge.outputs, []);
        assert.deepEqual(
            bridge.controls.map((control) => control.id),
            [
                'deviceId',
                'deviceName',
                'discoveryPrefix',
                'topicPrefix',
                'availability',
                'will',
                'manufacturer',
                'model',
                'swVersion',
            ]
        );
        const byId = (id) => bridge.controls.find((control) => control.id === id);
        assert.equal(byId('deviceId').required, true);
        assert.equal(byId('discoveryPrefix').default, 'homeassistant');
        assert.equal(byId('topicPrefix').default, 'otter');
        assert.equal(byId('availability').default, true);
        assert.equal(byId('will').default, true);
        assert.equal(byId('manufacturer').default, 'Micro-Otter');
    });

    it('gives the availability flag one text control and one bool input', () => {
        const flag = loadNodeTypes()['hass-availability'];

        assert.deepEqual(
            flag.inputs.map((input) => input.id),
            ['enabled', 'value']
        );
        assert.deepEqual(flag.inputs[1].allowedTypes, ['bool']);
        assert.equal(flag.inputs[1].defaultControl.type, 'checkbox');
        assert.equal(flag.inputs[1].defaultControl.default, false);
        assert.deepEqual(flag.outputs, []);
        assert.deepEqual(
            flag.controls.map((control) => control.id),
            ['id']
        );
        assert.equal(flag.controls[0].type, 'text');
        assert.equal(flag.controls[0].required, true);
        assert.equal(flag.controls[0].default, '');
    });

    it('gives the availability flag no will and no entity component', () => {
        const controlIds = loadNodeTypes()['hass-availability'].controls.map(
            (control) => control.id
        );

        assert.ok(!controlIds.includes('will'), 'a flag must not configure a will');
        assert.ok(!controlIds.includes('objectId'), 'a flag is a topic provider, not an entity');
    });
});

describe('hass entity definitions', () => {
    it('gives every entity a required object id and no separate availability control', () => {
        const nodeTypes = loadNodeTypes();
        ENTITY_NODES.forEach((typeId) => {
            const node = nodeTypes[typeId];
            const objectId = node.controls.find((control) => control.id === 'objectId');
            const availability = node.controls.find((control) => control.id === 'availability');
            assert.ok(objectId, `${typeId} has no objectId`);
            assert.equal(objectId.required, true);
            assert.equal(availability, undefined, `${typeId} still has an availability checkbox`);
        });
    });

    it('gives every entity the availability mode and flag controls', () => {
        const nodeTypes = loadNodeTypes();
        ENTITY_NODES.forEach((typeId) => {
            const controls = nodeTypes[typeId].controls;
            const mode = controls.find((control) => control.id === 'availabilityMode');
            const flags = controls.find((control) => control.id === 'availabilityFlags');

            assert.ok(mode, `${typeId} has no availabilityMode`);
            assert.equal(mode.type, 'dropdown');
            assert.equal(mode.default, 'all');
            assert.deepEqual(
                mode.options.map((option) => option.value),
                ['all', 'any', 'latest']
            );

            assert.ok(flags, `${typeId} has no availabilityFlags`);
            assert.equal(flags.type, 'multi-dropdown');
            assert.deepEqual(flags.default, ['__device__']);
            assert.deepEqual(flags.valueMigration, {
                fromControl: 'availability',
                entry: '__device__',
            });
            assert.equal(flags.dynamicOptions.source, 'availabilityRefs');
        });
    });

    it('uses the icon control for every entity icon field', () => {
        const nodeTypes = loadNodeTypes();

        ENTITY_NODES.forEach((typeId) => {
            const icon = nodeTypes[typeId].controls.find((control) => control.id === 'icon');
            assert.ok(icon, `${typeId} has no icon control`);
            assert.equal(icon.type, 'icon', `${typeId} icon control type`);
            assert.equal(icon.default, '', `${typeId} icon default must stay empty`);
            assert.equal(typeof icon.label.en, 'string', `${typeId} misses label.en`);
            assert.equal(typeof icon.label.de, 'string', `${typeId} misses label.de`);
            assert.equal(typeof icon.description.en, 'string', `${typeId} misses description.en`);
            assert.equal(typeof icon.description.de, 'string', `${typeId} misses description.de`);
        });

        Object.keys(nodeTypes).forEach((typeId) => {
            const iconControls = nodeTypes[typeId].controls.filter(
                (control) => control.type === 'icon'
            );
            const expected = ENTITY_NODES.includes(typeId) ? 1 : 0;
            assert.equal(iconControls.length, expected, `${typeId} icon control count`);
        });
    });

    it('declares the component-specific controls', () => {
        const nodeTypes = loadNodeTypes();
        const ids = (typeId) => nodeTypes[typeId].controls.map((control) => control.id);

        ['deviceClass', 'unit', 'stateClass', 'expireAfter'].forEach((id) =>
            assert.ok(ids('hass-sensor').includes(id), `hass-sensor misses ${id}`)
        );
        ['deviceClass', 'expireAfter'].forEach((id) =>
            assert.ok(ids('hass-binary-sensor').includes(id), `hass-binary-sensor misses ${id}`)
        );
        ['min', 'max', 'step', 'mode', 'unit'].forEach((id) =>
            assert.ok(ids('hass-number').includes(id), `hass-number misses ${id}`)
        );
        ['payloadOn', 'payloadOff'].forEach((id) =>
            assert.ok(ids('hass-switch').includes(id), `hass-switch misses ${id}`)
        );
        assert.ok(ids('hass-select').includes('options'));
        ['min', 'max', 'pattern', 'mode'].forEach((id) =>
            assert.ok(ids('hass-text').includes(id), `hass-text misses ${id}`)
        );
    });

    it('declares the press button as a receive-only entity', () => {
        const node = loadNodeTypes()['hass-button'];
        const controls = Object.fromEntries(node.controls.map((control) => [control.id, control]));

        assert.deepEqual(node.inputs, []);
        assert.deepEqual(
            node.outputs.map((output) => output.id),
            ['pressed']
        );
        assert.equal(node.outputs[0].outputType, 'bool');
        assert.deepEqual(node.outputs[0].initialTypes, ['bool']);

        // A press has no value, so neither authority nor report state applies.
        assert.equal(controls.authority, undefined);
        assert.equal(controls.reportState, undefined);
        assert.equal(controls.expireAfter, undefined);
        assert.equal(controls.deviceClass, undefined);

        assert.equal(controls.payloadPress.type, 'text');
        assert.equal(controls.payloadPress.default, 'PRESS');
        assert.ok(controls.availabilityMode, 'hass-button misses availabilityMode');
        assert.ok(controls.availabilityFlags, 'hass-button misses availabilityFlags');
    });

    it('declares the text body with the documented contract', () => {
        const node = loadNodeTypes()['hass-text'];
        const controls = Object.fromEntries(node.controls.map((control) => [control.id, control]));

        assert.deepEqual(
            node.inputs.map((input) => input.id),
            ['enabled', 'value']
        );
        assert.deepEqual(node.inputs[1].allowedTypes, ['string']);
        assert.deepEqual(
            node.outputs.map((output) => output.id),
            ['value', 'command', 'updated']
        );

        assert.equal(controls.min.type, 'number');
        assert.equal(controls.min.default, 0);
        assert.equal(controls.max.type, 'number');
        assert.equal(controls.max.default, 255);
        assert.equal(controls.pattern.type, 'text');
        assert.equal(controls.pattern.default, '');
        assert.equal(controls.mode.type, 'dropdown');
        assert.equal(controls.mode.default, 'text');
        assert.deepEqual(
            controls.mode.options.map((option) => option.value),
            ['text', 'password']
        );
    });

    it('leads every state publisher with the enabled gate', () => {
        const nodeTypes = loadNodeTypes();
        const publishers = [
            'hass-sensor',
            'hass-binary-sensor',
            'hass-availability',
            ...WRITABLE_NODES,
        ];

        publishers.forEach((typeId) => {
            const inputs = nodeTypes[typeId].inputs;
            const enabled = inputs[0];
            assert.equal(enabled.id, 'enabled', `${typeId} enabled id`);
            assert.deepEqual(enabled.allowedTypes, ['bool'], `${typeId} enabled allowedTypes`);
            assert.deepEqual(enabled.initialTypes, ['bool'], `${typeId} enabled initialTypes`);
            assert.equal(enabled.defaultControl.type, 'checkbox', `${typeId} enabled control`);
            assert.equal(enabled.defaultControl.default, true, `${typeId} enabled default`);
            assert.equal(typeof enabled.description.en, 'string', `${typeId} misses en`);
            assert.equal(typeof enabled.description.de, 'string', `${typeId} misses de`);
            assert.ok(enabled.description.en.length > 0, `${typeId} empty en`);
            assert.ok(enabled.description.de.length > 0, `${typeId} empty de`);
        });

        assert.deepEqual(nodeTypes['hass-button'].inputs, []);
        assert.deepEqual(nodeTypes['hass-bridge'].inputs, []);
    });

    it('declares the writable outputs', () => {
        const nodeTypes = loadNodeTypes();
        WRITABLE_NODES.forEach((typeId) => {
            assert.deepEqual(
                nodeTypes[typeId].outputs.map((output) => output.id),
                ['value', 'command', 'updated'],
                `${typeId} outputs`
            );
        });
        ['hass-sensor', 'hass-binary-sensor'].forEach((typeId) => {
            assert.deepEqual(nodeTypes[typeId].outputs, [], `${typeId} outputs`);
        });
    });

    it('gives every writable entity the authority dropdown', () => {
        const nodeTypes = loadNodeTypes();

        WRITABLE_NODES.forEach((typeId) => {
            const authority = nodeTypes[typeId].controls.find(
                (control) => control.id === 'authority'
            );

            assert.ok(authority, `${typeId} has no authority control`);
            assert.equal(authority.type, 'dropdown', `${typeId} authority type`);
            assert.equal(authority.default, 'device', `${typeId} authority default`);
            assert.equal(
                authority.legacyDefault,
                'homeassistant',
                `${typeId} authority legacyDefault`
            );
            assert.deepEqual(
                authority.options.map((option) => option.value),
                ['device', 'homeassistant'],
                `${typeId} authority options`
            );
            assert.equal(typeof authority.description.en, 'string', `${typeId} misses en`);
            assert.equal(typeof authority.description.de, 'string', `${typeId} misses de`);
        });
    });

    it('places the authority controls after the availability controls', () => {
        const nodeTypes = loadNodeTypes();

        WRITABLE_NODES.forEach((typeId) => {
            const ids = nodeTypes[typeId].controls.map((control) => control.id);
            assert.equal(
                ids.indexOf('authority'),
                ids.indexOf('availabilityFlags') + 1,
                `${typeId} must keep the inspector order stable`
            );
            assert.equal(
                ids.indexOf('reportState'),
                ids.indexOf('authority') + 1,
                `${typeId} reportState must follow the authority`
            );
        });
    });

    it('gives every writable entity the report state checkbox', () => {
        const nodeTypes = loadNodeTypes();

        WRITABLE_NODES.forEach((typeId) => {
            const reportState = nodeTypes[typeId].controls.find(
                (control) => control.id === 'reportState'
            );

            assert.ok(reportState, `${typeId} has no reportState control`);
            assert.equal(reportState.type, 'checkbox', `${typeId} reportState type`);
            assert.equal(reportState.default, true, `${typeId} reportState default`);
            // Reporting the state is the historical behaviour, so nothing to migrate.
            assert.equal(reportState.legacyDefault, undefined, `${typeId} reportState legacy`);
        });

        ['hass-sensor', 'hass-binary-sensor'].forEach((typeId) => {
            const ids = nodeTypes[typeId].controls.map((control) => control.id);
            assert.ok(!ids.includes('authority'), `${typeId} must not own a value`);
            assert.ok(!ids.includes('reportState'), `${typeId} always reports its state`);
        });
    });

    it('types the command output like the value output and updated as bool', () => {
        const nodeTypes = loadNodeTypes();

        WRITABLE_NODES.forEach((typeId) => {
            const outputs = nodeTypes[typeId].outputs;
            const byId = (id) => outputs.find((output) => output.id === id);

            assert.equal(byId('command').outputType, byId('value').outputType);
            assert.deepEqual(byId('command').initialTypes, byId('value').initialTypes);
            assert.equal(byId('updated').outputType, 'bool');
            assert.deepEqual(byId('updated').initialTypes, ['bool']);
            assert.equal(new Set(outputs.map((output) => output.id)).size, outputs.length);
        });
    });

    it('names both authorities in the info text of every writable entity', () => {
        const nodeTypes = loadNodeTypes();

        WRITABLE_NODES.forEach((typeId) => {
            const info = nodeTypes[typeId].info;
            assert.ok(info.en.includes('Device'), `${typeId} info.en names the device side`);
            assert.ok(info.en.includes('Home Assistant'), `${typeId} info.en names Home Assistant`);
            assert.ok(info.de.includes('Geraet'), `${typeId} info.de names the device side`);
            assert.ok(info.de.includes('Home Assistant'), `${typeId} info.de names Home Assistant`);
        });
    });

    it('ships every icon referenced by the node definitions', () => {
        const nodeTypes = loadNodeTypes();
        Object.keys(nodeTypes).forEach((typeId) => {
            const icon = nodeTypes[typeId].icon;
            assert.ok(icon, `${typeId} declares no icon`);
            assert.ok(existsSync(path.join(packageRoot, icon)), `${typeId} icon ${icon} missing`);
        });
    });

    it('keeps en/de parity on every localized string', () => {
        const nodeTypes = loadNodeTypes();
        Object.keys(nodeTypes).forEach((id) => assertLocalized(nodeTypes[id], id));
    });

    it('walks every entity node type through the shared assertions', () => {
        const nodeTypes = loadNodeTypes();
        const declared = Object.keys(nodeTypes)
            .filter((typeId) => typeId !== 'hass-bridge' && typeId !== 'hass-availability')
            .sort();

        // A node type the shared lists do not know would silently escape every assertion above.
        assert.deepEqual(declared, [...ENTITY_NODES].sort());
        assert.equal(ENTITY_NODES.length, 7);

        const withCommandOutput = declared.filter((typeId) =>
            (nodeTypes[typeId].outputs || []).some((output) => output.id === 'command')
        );
        assert.deepEqual(withCommandOutput, [...WRITABLE_NODES].sort());
    });
});

describe('hass node generators', () => {
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
        await import(`${url.href}?test=hass-generators`);
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

    function context(controlValues, overrides = {}) {
        const imports = [];
        return {
            node: { id: '5', controlValues },
            inputs: ['0'],
            inputsMeta: [{ connected: false }],
            outputs: ['node_5_out0'],
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

    it('emits the documented bridge configure call', () => {
        const ctx = context({});
        const result = globalThis.NodeInitGenerators.hassBridge(ctx);

        assert.equal(
            result.init.block,
            "_hass.configure(device_id='', device_name='', discovery_prefix='homeassistant', " +
                "topic_prefix='otter', availability=True, manufacturer='Micro-Otter', model='', " +
                "sw_version='', will=True)"
        );
        assert.equal(result.init.priority, 1);
        assert.equal(result.init.execute, '_mqtt.start()');
        assert.ok(result.init.block.startsWith('_hass.configure('));
        assert.ok(ctx._imports.includes('from otter_hass import runtime as _hass'));
        assert.ok(ctx._imports.includes('from otter_mqtt import runtime as _mqtt'));
    });

    it('keeps every entity generator at priority 5', () => {
        const entityGenerators = [
            'hassSensor',
            'hassBinarySensor',
            'hassNumber',
            'hassSwitch',
            'hassSelect',
        ];
        for (const name of entityGenerators) {
            const result = globalThis.NodeInitGenerators[name](context({ objectId: 'x' }));
            assert.equal(result.init.priority, 5, `${name} must stay at priority 5`);
        }
    });

    it('passes the bridge controls through, including disabled availability', () => {
        const result = globalThis.NodeInitGenerators.hassBridge(
            context({
                deviceId: 'otter-kitchen',
                deviceName: 'Kitchen',
                discoveryPrefix: 'ha',
                topicPrefix: 'home',
                availability: false,
                will: false,
                manufacturer: 'ACME',
                model: 'X1',
                swVersion: '1.0',
            })
        );

        assert.ok(result.init.block.includes("device_id='otter-kitchen'"));
        assert.ok(result.init.block.includes("device_name='Kitchen'"));
        assert.ok(result.init.block.includes("discovery_prefix='ha'"));
        assert.ok(result.init.block.includes("topic_prefix='home'"));
        assert.ok(result.init.block.includes('availability=False'));
        assert.ok(result.init.block.includes('will=False'));
        assert.ok(result.init.block.includes("manufacturer='ACME'"));
        assert.ok(result.init.block.includes("model='X1'"));
        assert.ok(result.init.block.includes("sw_version='1.0'"));
    });

    it('emits a comment instead of a loop for the bridge', () => {
        const result = globalThis.NodeCodeGenerators.hassBridge(context({}));
        assert.equal(result.statement, '# hass bridge: configured in init_mqtt');
        assert.ok(!result.statement.includes('_hass.poll_birth'));
        assert.deepEqual(result.outputs, []);
    });
});

describe('hass availability generators', () => {
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
        await import(`${url.href}?test=hass-availability-generators`);
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
            node: { id: '7', controlValues },
            inputs: ['', 'False'],
            inputsMeta: [{ connected: false }, { connected: false }],
            outputs: [],
            outputsMeta: [],
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

    it('registers the retained flag topic in init_mqtt', () => {
        const ctx = context({ id: 'heating' });
        const result = globalThis.NodeInitGenerators.hassAvailability(ctx);

        assert.equal(
            result.init.block,
            "_mqtt.register_publish(topic=_hass.availability_topic('heating'), qos=0)"
        );
        assert.equal(result.init.priority, 5);
        assert.equal(result.init.execute, '_mqtt.start()');
        assert.ok(ctx._imports.includes('from otter_hass import runtime as _hass'));
        assert.ok(ctx._imports.includes('from otter_mqtt import runtime as _mqtt'));
    });

    it('publishes the flag once and on change, retained', () => {
        const result = globalThis.NodeCodeGenerators.hassAvailability(context({ id: 'heating' }));

        assert.equal(
            result.statement,
            "if bool(True):\n    _mqtt.publish_deferred(topic=_hass.availability_topic('heating'), " +
                "payload=('online' if (False) else 'offline'), qos=0, retain=True, " +
                "key='_hass_avail_7', if_changed='_hass_avail_last_7')"
        );
        assert.deepEqual(result.outputs, []);
    });

    it('maps the bool input to the Home Assistant payloads', () => {
        const online = globalThis.NodeCodeGenerators.hassAvailability(
            context(
                { id: 'heating' },
                {
                    inputs: ['', 'node_3_out0'],
                    inputsMeta: [{ connected: false }, { connected: true }],
                }
            )
        );
        assert.ok(online.statement.includes("payload=('online' if (node_3_out0) else 'offline')"));

        const literalTrue = globalThis.NodeCodeGenerators.hassAvailability(
            context({ id: 'heating' }, { inputs: ['', 'True'] })
        );
        assert.ok(literalTrue.statement.includes("payload=('online' if (True) else 'offline')"));
    });

    it('gates the availability publication on the enabled input', () => {
        const statementFor = (inputs, inputsMeta = []) =>
            globalThis.NodeCodeGenerators.hassAvailability(
                context({ id: 'heating' }, { inputs, inputsMeta })
            ).statement;

        assert.ok(
            statementFor(
                ['node_2_out0', 'False'],
                [{ connected: true }, { connected: false }]
            ).startsWith('if bool(node_2_out0):\n    _mqtt.publish_deferred(')
        );
        assert.ok(
            statementFor(['False', 'False']).startsWith(
                'if bool(False):\n    _mqtt.publish_deferred('
            )
        );
        assert.ok(
            statementFor(['', 'False']).startsWith('if bool(True):\n    _mqtt.publish_deferred(')
        );
        assert.ok(
            statementFor([undefined, 'False']).startsWith(
                'if bool(True):\n    _mqtt.publish_deferred('
            )
        );
    });

    it('leaves id sanitisation to the runtime', () => {
        const result = globalThis.NodeCodeGenerators.hassAvailability(
            context({ id: 'Heating Pwr!' })
        );

        assert.ok(result.statement.includes("_hass.availability_topic('Heating Pwr!')"));
        assert.ok(!result.statement.includes("_hass.availability_topic('Heating_Pwr_')"));
    });

    it('degrades to a comment without an id', () => {
        const loop = globalThis.NodeCodeGenerators.hassAvailability(context({ id: '  ' }));
        assert.equal(loop.statement, '# hass availability: id is empty');
        assert.deepEqual(loop.outputs, []);

        const init = globalThis.NodeInitGenerators.hassAvailability(context({ id: '' }));
        assert.equal(init.init.block, '# hass availability: id is empty');
        assert.equal(init.init.priority, 5);
    });
});

describe('hass entity generators', () => {
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
        await import(`${url.href}?test=hass-entity-generators`);
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
            node: { id: '7', controlValues },
            inputs: ['', '0'],
            inputsMeta: [{ connected: false }, { connected: false }],
            outputs: ['node_7_out0'],
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

    it('registers a sensor with the configured metadata', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({
                objectId: 'temperature',
                name: 'Temperature',
                deviceClass: 'temperature',
                unit: 'C',
                stateClass: 'measurement',
                expireAfter: 300,
            })
        );

        assert.equal(
            result.init.block,
            "_hass.register_entity('sensor', 'temperature', config={'device_class': 'temperature', " +
                "'unit_of_measurement': 'C', 'state_class': 'measurement'}, name='Temperature', " +
                'expire_after=300)'
        );
        assert.equal(result.init.priority, 5);
        assert.equal(result.init.execute, '_mqtt.start()');
    });

    it('omits unset sensor metadata', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({ objectId: 'temperature' })
        );
        assert.equal(
            result.init.block,
            "_hass.register_entity('sensor', 'temperature', config={})"
        );
    });

    it('publishes the sensor state', () => {
        const result = globalThis.NodeCodeGenerators.hassSensor(
            context({ objectId: 'temperature' })
        );
        assert.equal(
            result.statement,
            "if bool(True):\n    _hass.publish_state('sensor', 'temperature', (0), retain=True)"
        );
    });

    it('gates the sensor publication on the enabled input', () => {
        const connected = globalThis.NodeCodeGenerators.hassSensor(
            context(
                { objectId: 'temperature' },
                {
                    inputs: ['node_2_out0', '0'],
                    inputsMeta: [{ connected: true }, { connected: false }],
                }
            )
        );
        assert.ok(
            connected.statement.startsWith(
                "if bool(node_2_out0):\n    _hass.publish_state('sensor', 'temperature'"
            )
        );

        const disabled = globalThis.NodeCodeGenerators.hassSensor(
            context({ objectId: 'temperature' }, { inputs: ['False', '0'] })
        );
        assert.ok(
            disabled.statement.startsWith(
                "if bool(False):\n    _hass.publish_state('sensor', 'temperature'"
            )
        );

        const missing = globalThis.NodeCodeGenerators.hassSensor(
            context({ objectId: 'temperature' }, { inputs: ['', '0'] })
        );
        assert.ok(
            missing.statement.startsWith(
                "if bool(True):\n    _hass.publish_state('sensor', 'temperature'"
            )
        );
    });

    it('gates the binary sensor publication on the enabled input', () => {
        const connected = globalThis.NodeCodeGenerators.hassBinarySensor(
            context(
                { objectId: 'motion' },
                {
                    inputs: ['node_2_out0', 'False'],
                    inputsMeta: [{ connected: true }, { connected: false }],
                }
            )
        );
        assert.ok(
            connected.statement.startsWith(
                "if bool(node_2_out0):\n    _hass.publish_state('binary_sensor', 'motion'"
            )
        );

        const disabled = globalThis.NodeCodeGenerators.hassBinarySensor(
            context({ objectId: 'motion' }, { inputs: ['False', 'False'] })
        );
        assert.ok(
            disabled.statement.startsWith(
                "if bool(False):\n    _hass.publish_state('binary_sensor', 'motion'"
            )
        );
    });

    it('pins the binary sensor payloads to true and false', () => {
        const result = globalThis.NodeInitGenerators.hassBinarySensor(
            context({ objectId: 'motion', deviceClass: 'motion' })
        );
        assert.ok(result.init.block.startsWith("_hass.register_entity('binary_sensor', 'motion'"));
        assert.ok(result.init.block.includes("'payload_on': 'true'"));
        assert.ok(result.init.block.includes("'payload_off': 'false'"));
    });

    it('marks an empty object id instead of calling the runtime', () => {
        const init = globalThis.NodeInitGenerators.hassSensor(context({ objectId: '  ' }));
        const loop = globalThis.NodeCodeGenerators.hassSensor(context({ objectId: '  ' }));

        assert.equal(init.init.block, '# hass sensor: objectId is empty');
        assert.equal(init.init.execute, '_mqtt.start()');
        assert.equal(loop.statement, '# hass sensor: objectId is empty');
        assert.deepEqual(loop.outputs, []);
    });
});

describe('hass writable entity generators', () => {
    before(async () => {
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=hass-writable-generators`);
    });

    function context(controlValues, overrides = {}) {
        const imports = [];
        return {
            node: { id: '9', controlValues },
            inputs: ['', '0'],
            inputsMeta: [{ connected: false }, { connected: false }],
            outputs: ['node_9_out0'],
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

    /**
     * Build a context whose node has the three writable outputs.
     * @param {object} controlValues - Values of the node's controls.
     * @param {boolean[]} connected - Which of the three outputs is wired.
     * @param {object} overrides - Further context overrides.
     * @returns {object} Generator context with `value`, `command` and `updated` outputs.
     */
    function context3(controlValues, connected = [true, false, false], overrides = {}) {
        return context(controlValues, {
            outputs: ['node_9_out0', 'node_9_out1', 'node_9_out2'],
            outputsMeta: connected.map((flag) => ({ connected: flag })),
            ...overrides,
        });
    }

    it('registers a number with its range controls', () => {
        const result = globalThis.NodeInitGenerators.hassNumber(
            context({ objectId: 'level', min: 0, max: 10, step: 0.5, mode: 'slider', unit: '%' })
        );

        assert.equal(
            result.init.block,
            "_hass.register_entity('number', 'level', config={'min': 0, 'max': 10, 'step': 0.5, " +
                "'mode': 'slider', 'unit_of_measurement': '%'})"
        );
    });

    it('emits the optimistic number echo when the input is unwired', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(context({ objectId: 'level' }));

        assert.equal(
            result.statement,
            "node_9_out0 = _hass.latest_command('number', 'level', value_type='float', default=(0))\n" +
                'if bool(True):\n' +
                "    _hass.publish_state('number', 'level', (node_9_out0), retain=True)"
        );
        assert.deepEqual(result.outputs, ['node_9_out0']);
    });

    it('gates only the publish line of a writable entity', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level' }, [true, true, true], {
                inputs: ['node_2_out0', 'node_1_out0'],
                inputsMeta: [{ connected: true }, { connected: true }],
            })
        );
        const lines = result.statement.split('\n');

        assert.equal(
            lines[0],
            "node_9_out0 = _hass.latest_command('number', 'level', value_type='float', default=(node_1_out0))"
        );
        assert.equal(lines[1], 'node_9_out1 = node_9_out0');
        assert.ok(lines[2].startsWith('node_9_out2 = _hass.take_command('));
        assert.equal(lines[3], 'if bool(node_2_out0):');
        assert.ok(lines[4].startsWith("    _hass.publish_state('number', 'level', (node_1_out0)"));
        assert.ok(
            !lines.slice(0, 3).some((line) => line.startsWith('if bool(')),
            'command processing must stay unconditional'
        );
    });

    it('emits no guard when report state is off', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level', reportState: false }, [true, false, false], {
                inputs: ['', 'node_1_out0'],
                inputsMeta: [{ connected: false }, { connected: true }],
            })
        );

        assert.ok(!result.statement.includes('if bool('));
        assert.ok(!result.statement.includes('publish_state'));
    });

    it('publishes the wired input for a number', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context(
                { objectId: 'level' },
                {
                    inputs: ['', 'node_1_out0'],
                    inputsMeta: [{ connected: false }, { connected: true }],
                }
            )
        );

        assert.ok(result.statement.includes("publish_state('number', 'level', (node_1_out0)"));
    });

    it('registers a switch with true/false payloads', () => {
        const result = globalThis.NodeInitGenerators.hassSwitch(context({ objectId: 'relay' }));
        assert.equal(
            result.init.block,
            "_hass.register_entity('switch', 'relay', config={'payload_on': 'true', " +
                "'payload_off': 'false'})"
        );
    });

    it('coerces switch commands as bool', () => {
        const result = globalThis.NodeCodeGenerators.hassSwitch(context({ objectId: 'relay' }));
        assert.ok(result.statement.includes("value_type='bool'"));
    });

    it('registers a select with the parsed option list', () => {
        const result = globalThis.NodeInitGenerators.hassSelect(
            context({ objectId: 'mode', options: 'low, medium ,high' })
        );
        assert.equal(
            result.init.block,
            "_hass.register_entity('select', 'mode', config={'options': ['low', 'medium', 'high']})"
        );
    });

    it('coerces select commands as strings', () => {
        const result = globalThis.NodeCodeGenerators.hassSelect(context({ objectId: 'mode' }));
        assert.ok(result.statement.includes("value_type='string'"));
    });

    it('keeps the Home Assistant authority when the control is missing or unknown', () => {
        const legacy = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level' }, [true, true, false])
        );
        const unknown = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level', authority: 'nonsense' }, [true, true, false])
        );

        assert.equal(
            legacy.statement.split('\n')[0],
            "node_9_out0 = _hass.latest_command('number', 'level', value_type='float', default=(0))"
        );
        assert.equal(unknown.statement, legacy.statement);
    });

    it('emits the plain input for the value output with device authority', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level', authority: 'device' }, [true, false, false], {
                inputs: ['', 'node_1_out0'],
                inputsMeta: [{ connected: false }, { connected: true }],
            })
        );

        assert.equal(
            result.statement,
            'node_9_out0 = node_1_out0\n' +
                'if bool(True):\n' +
                "    _hass.publish_state('number', 'level', (node_1_out0), retain=True)"
        );
        assert.ok(!result.statement.includes('latest_command'));
        assert.deepEqual(result.outputs, ['node_9_out0']);
    });

    it('emits command and updated behind the value output of a device node', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level', authority: 'device' }, [true, true, true], {
                inputs: ['', 'node_1_out0'],
                inputsMeta: [{ connected: false }, { connected: true }],
            })
        );

        assert.equal(
            result.statement,
            'node_9_out0 = node_1_out0\n' +
                "node_9_out1 = _hass.latest_command('number', 'level', value_type='float', " +
                'default=(node_1_out0))\n' +
                "node_9_out2 = _hass.take_command('number', 'level', value_type='float', " +
                "key='hass_cmd_9')\n" +
                'if bool(True):\n' +
                "    _hass.publish_state('number', 'level', (node_1_out0), retain=True)"
        );
        assert.deepEqual(result.outputs, ['node_9_out0', 'node_9_out1', 'node_9_out2']);
    });

    it('reuses the value variable for the command output while HA owns the value', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level' }, [true, true, false])
        );

        assert.equal(
            result.statement,
            "node_9_out0 = _hass.latest_command('number', 'level', value_type='float', default=(0))\n" +
                'node_9_out1 = node_9_out0\n' +
                'if bool(True):\n' +
                "    _hass.publish_state('number', 'level', (node_9_out0), retain=True)"
        );
        assert.equal(result.statement.split('latest_command').length - 1, 1);
    });

    it('emits only the wired outputs', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level' }, [false, false, true])
        );

        assert.equal(
            result.statement,
            "node_9_out2 = _hass.take_command('number', 'level', value_type='float', " +
                "key='hass_cmd_9')\n" +
                'if bool(True):\n' +
                "    _hass.publish_state('number', 'level', (0.0), retain=True)"
        );
        assert.deepEqual(result.outputs, ['node_9_out2']);
    });

    it('gives two nodes of one entity two consume keys', () => {
        const first = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level' }, [false, false, true])
        );
        const second = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level' }, [false, false, true], {
                node: { id: '12', controlValues: { objectId: 'level' } },
                outputs: ['node_12_out0', 'node_12_out1', 'node_12_out2'],
            })
        );

        assert.ok(first.statement.includes("key='hass_cmd_9'"));
        assert.ok(second.statement.includes("key='hass_cmd_12'"));
    });

    it('consumes the updated edge with the value type of the node', () => {
        const result = globalThis.NodeCodeGenerators.hassSwitch(
            context3({ objectId: 'relay' }, [false, false, true])
        );

        assert.ok(
            result.statement.startsWith(
                "node_9_out2 = _hass.take_command('switch', 'relay', value_type='bool', " +
                    "key='hass_cmd_9')"
            )
        );
        assert.deepEqual(result.outputs, ['node_9_out2']);
    });

    it('drops the publish line and announces report_state=False', () => {
        const init = globalThis.NodeInitGenerators.hassNumber(
            context3({ objectId: 'level', reportState: false })
        );
        const loop = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'level', reportState: false })
        );

        assert.equal(
            init.init.block,
            "_hass.register_entity('number', 'level', config={'min': 0, 'max': 100, " +
                "'step': 1, 'mode': 'auto'}, report_state=False)"
        );
        assert.equal(
            loop.statement,
            "node_9_out0 = _hass.latest_command('number', 'level', value_type='float', default=(0))"
        );
    });

    it('keeps the register call unchanged while report state is on', () => {
        const on = globalThis.NodeInitGenerators.hassNumber(
            context3({ objectId: 'level', reportState: true })
        );
        const absent = globalThis.NodeInitGenerators.hassNumber(context3({ objectId: 'level' }));

        assert.equal(on.init.block, absent.init.block);
        assert.ok(!on.init.block.includes('report_state'));
    });

    it('still emits the command outputs with report state off', () => {
        const result = globalThis.NodeCodeGenerators.hassSelect(
            context3({ objectId: 'mode', reportState: false }, [false, true, true])
        );

        assert.equal(
            result.statement,
            "node_9_out1 = _hass.latest_command('select', 'mode', value_type='string', " +
                'default=(0))\n' +
                "node_9_out2 = _hass.take_command('select', 'mode', value_type='string', " +
                "key='hass_cmd_9')"
        );
    });

    it('needs no input for a write-only device control', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'brightness', authority: 'device', reportState: false }, [
                true,
                false,
                false,
            ])
        );

        assert.equal(result.statement, 'node_9_out0 = 0');
    });

    it('emits a comment for a write-only control with nothing wired', () => {
        const result = globalThis.NodeCodeGenerators.hassNumber(
            context3({ objectId: 'brightness', authority: 'device', reportState: false }, [
                false,
                false,
                false,
            ])
        );

        // The transpiler requires a body for every node, so an empty loop becomes a comment.
        assert.equal(result.statement, '# hass number: report state off and no outputs connected');
        assert.deepEqual(result.outputs, []);
    });

    it('registers a text field with its length contract', () => {
        const result = globalThis.NodeInitGenerators.hassText(
            context({ objectId: 'label', min: 0, max: 32, mode: 'text' })
        );

        assert.equal(
            result.init.block,
            "_hass.register_entity('text', 'label', config={'min': 0, 'max': 32, " +
                "'mode': 'text'})"
        );
        assert.equal(result.init.priority, 5);
        assert.equal(result.init.execute, '_mqtt.start()');
    });

    it('omits an empty text pattern and keeps the password mode', () => {
        const empty = globalThis.NodeInitGenerators.hassText(
            context({ objectId: 'label', pattern: '   ' })
        );
        const password = globalThis.NodeInitGenerators.hassText(
            context({ objectId: 'secret', pattern: '[a-z]+', mode: 'password' })
        );

        assert.ok(!empty.init.block.includes("'pattern'"));
        assert.ok(password.init.block.includes("'pattern': '[a-z]+'"));
        assert.ok(password.init.block.includes("'mode': 'password'"));
    });

    it('treats a text field like the other writable entities', () => {
        const loop = globalThis.NodeCodeGenerators.hassText(context({ objectId: 'label' }));
        const init = globalThis.NodeInitGenerators.hassText(
            context({ objectId: 'label', reportState: false })
        );

        assert.equal(
            loop.statement,
            "node_9_out0 = _hass.latest_command('text', 'label', value_type='string', " +
                'default=(0))\n' +
                'if bool(True):\n' +
                "    _hass.publish_state('text', 'label', (node_9_out0), retain=True)"
        );
        assert.ok(init.init.block.endsWith(', report_state=False)'));
    });

    it('marks an empty object id instead of calling the runtime for a text field', () => {
        const init = globalThis.NodeInitGenerators.hassText(context3({ objectId: ' ' }));
        const loop = globalThis.NodeCodeGenerators.hassText(context3({ objectId: ' ' }));

        assert.equal(init.init.block, '# hass text: objectId is empty');
        assert.equal(loop.statement, '# hass text: objectId is empty');
        assert.deepEqual(loop.outputs, []);
    });

    it('announces a button without a state topic', () => {
        const result = globalThis.NodeInitGenerators.hassButton(
            context({ objectId: 'restart', payloadPress: 'PRESS' })
        );

        assert.equal(
            result.init.block,
            "_hass.register_entity('button', 'restart', config={'payload_press': 'PRESS'}, " +
                'report_state=False)'
        );
        assert.equal(result.init.priority, 5);
        assert.equal(result.init.execute, '_mqtt.start()');
    });

    it('consumes a button press once per node', () => {
        const result = globalThis.NodeCodeGenerators.hassButton(context({ objectId: 'restart' }));
        const other = globalThis.NodeCodeGenerators.hassButton(
            context(
                { objectId: 'restart' },
                {
                    node: { id: '11', controlValues: { objectId: 'restart' } },
                    outputs: ['node_11_out0'],
                }
            )
        );

        assert.equal(
            result.statement,
            "node_9_out0 = _hass.take_command('button', 'restart', value_type='string', " +
                "key='hass_cmd_9')"
        );
        assert.deepEqual(result.outputs, ['node_9_out0']);
        assert.ok(other.statement.includes("key='hass_cmd_11'"));
    });

    it('emits no runtime call for an unconnected button output', () => {
        const result = globalThis.NodeCodeGenerators.hassButton(
            context(
                { objectId: 'restart' },
                {
                    outputs: ['node_9_out0'],
                    outputsMeta: [{ connected: false }],
                }
            )
        );

        assert.equal(result.statement, '# hass button: pressed output is not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('marks an empty object id for a button in both blocks', () => {
        const init = globalThis.NodeInitGenerators.hassButton(context({ objectId: '' }));
        const loop = globalThis.NodeCodeGenerators.hassButton(context({ objectId: '' }));

        assert.equal(init.init.block, '# hass button: objectId is empty');
        assert.equal(loop.statement, '# hass button: objectId is empty');
    });

    it('keeps the legacy availability control honoured without flags', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({ objectId: 'temperature', availability: false })
        );
        assert.ok(result.init.block.endsWith(', availability=False)'));
    });

    it('emits only the scalar form for the device entry alone', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({ objectId: 'temperature', availabilityFlags: ['__device__'] })
        );
        assert.equal(
            result.init.block,
            "_hass.register_entity('sensor', 'temperature', config={})"
        );
    });

    it('turns an empty flag list into unavailable', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({ objectId: 'temperature', availabilityFlags: [], availabilityMode: 'any' })
        );
        assert.equal(
            result.init.block,
            "_hass.register_entity('sensor', 'temperature', config={}, availability=False)"
        );
    });

    it('treats a named flag alone as device availability off', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({
                objectId: 'temperature',
                availabilityFlags: ['heating'],
                availabilityMode: 'all',
            })
        );
        assert.equal(
            result.init.block,
            "_hass.register_entity('sensor', 'temperature', config={}, availability=False, " +
                "availability_flags=['heating'], availability_mode='all')"
        );
    });

    it('passes the selected availability flags and the mode to the runtime', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({
                objectId: 'temperature',
                availabilityFlags: ['__device__', 'heating'],
                availabilityMode: 'all',
            })
        );
        assert.equal(
            result.init.block,
            "_hass.register_entity('sensor', 'temperature', config={}, availability=True, " +
                "availability_flags=['heating'], availability_mode='all')"
        );
    });

    it('keeps the legacy device decision while the flags still apply', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({
                objectId: 'temperature',
                availability: false,
                availabilityFlags: ['heating', 'pump'],
                availabilityMode: 'any',
            })
        );
        assert.equal(
            result.init.block,
            "_hass.register_entity('sensor', 'temperature', config={}, availability=False, " +
                "availability_flags=['heating', 'pump'], availability_mode='any')"
        );
    });

    it('strips the device entry and drops empty and repeated flags', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({
                objectId: 'temperature',
                availabilityFlags: [
                    '__device__',
                    '',
                    ' heating ',
                    'heating',
                    null,
                    '__device__',
                    'pump',
                ],
                availabilityMode: 'sometimes',
            })
        );
        assert.ok(result.init.block.includes('availability=True'));
        assert.ok(result.init.block.includes("availability_flags=['heating', 'pump']"));
        assert.ok(result.init.block.endsWith("availability_mode='all')"));
    });

    it('stays scalar when the flag control is absent', () => {
        const result = globalThis.NodeInitGenerators.hassSensor(
            context({ objectId: 'temperature', availabilityMode: 'any' })
        );
        assert.equal(
            result.init.block,
            "_hass.register_entity('sensor', 'temperature', config={})"
        );
    });

    it('wires the flags through every publishing entity type', () => {
        const generators = [
            'hassSensor',
            'hassBinarySensor',
            'hassNumber',
            'hassSwitch',
            'hassSelect',
            'hassText',
        ];
        for (const name of generators) {
            const result = globalThis.NodeInitGenerators[name](
                context({ objectId: 'x', options: 'a,b', availabilityFlags: ['heating'] })
            );
            assert.ok(
                result.init.block.includes("availability_flags=['heating']"),
                `${name} must forward the flags`
            );
            assert.ok(
                result.init.block.includes("availability_mode='all'"),
                `${name} must forward the mode`
            );
        }
    });

    const ENTITY_INIT_GENERATORS = [
        'hassSensor',
        'hassBinarySensor',
        'hassNumber',
        'hassSwitch',
        'hassSelect',
        'hassText',
    ];

    it('emits the picked icon in the discovery config of every entity type', () => {
        for (const name of ENTITY_INIT_GENERATORS) {
            const result = globalThis.NodeInitGenerators[name](
                context({ objectId: 'x', icon: 'mdi:thermometer' })
            );
            assert.ok(
                result.init.block.includes("'icon': 'mdi:thermometer'"),
                `${name} must forward the icon: ${result.init.block}`
            );
        }
    });

    it('keeps the icon the first key of the config literal', () => {
        for (const name of ENTITY_INIT_GENERATORS) {
            const block = globalThis.NodeInitGenerators[name](
                context({ objectId: 'x', icon: 'mdi:thermometer' })
            ).init.block;
            const config = block.slice(block.indexOf('config={') + 'config={'.length);
            assert.ok(
                config.startsWith("'icon': "),
                `${name} config must start with the icon: ${block}`
            );
        }
    });

    it('omits the icon key for an empty or absent control', () => {
        for (const name of ENTITY_INIT_GENERATORS) {
            [
                { objectId: 'x', icon: '' },
                { objectId: 'x', icon: '   ' },
                { objectId: 'x' },
            ].forEach((values) => {
                const block = globalThis.NodeInitGenerators[name](context(values)).init.block;
                assert.ok(
                    !block.includes("'icon'"),
                    `${name} must not emit an empty icon: ${block}`
                );
            });
        }
    });

    it('emits a foreign icon set verbatim', () => {
        for (const name of ENTITY_INIT_GENERATORS) {
            const block = globalThis.NodeInitGenerators[name](
                context({ objectId: 'x', icon: 'ph:thermometer' })
            ).init.block;
            assert.ok(
                block.includes("'icon': 'ph:thermometer'"),
                `${name} must pass a foreign set through: ${block}`
            );
        }
    });

    it('keeps the generated Python unchanged when no icon is set', () => {
        const expected = {
            hassSensor: "_hass.register_entity('sensor', 'x', config={})",
            hassBinarySensor:
                "_hass.register_entity('binary_sensor', 'x', config={'payload_on': 'true', " +
                "'payload_off': 'false'})",
            hassNumber:
                "_hass.register_entity('number', 'x', config={'min': 0, 'max': 100, " +
                "'step': 1, 'mode': 'auto'})",
            hassSwitch:
                "_hass.register_entity('switch', 'x', config={'payload_on': 'true', " +
                "'payload_off': 'false'})",
            hassSelect: "_hass.register_entity('select', 'x', config={})",
            hassText:
                "_hass.register_entity('text', 'x', config={'min': 0, 'max': 255, " +
                "'mode': 'text'})",
            hassButton:
                "_hass.register_entity('button', 'x', config={'payload_press': 'PRESS'}, " +
                'report_state=False)',
        };

        Object.keys(expected).forEach((name) => {
            assert.equal(
                globalThis.NodeInitGenerators[name](context({ objectId: 'x' })).init.block,
                expected[name],
                `${name} must not change without an icon`
            );
        });
    });
});

describe('hass graph rules', () => {
    let getGraphRules;
    let validateGraphRules;

    before(async () => {
        const registry =
            await import('../../src/micro_otter/nodes/html/js/core/graph-rule-registry.js');
        getGraphRules = registry.getGraphRules;
        validateGraphRules = registry.validateGraphRules;

        // Side effect: registers the built-in MQTT rules and sets globalThis.GraphRules.
        await import('../../src/micro_otter/nodes/html/js/core/graph-topic-validator.js');
        const capabilitiesUrl = pathToFileURL(path.join(packageRoot, 'node_capabilities.js'));
        await import(`${capabilitiesUrl.href}?test=hass-capabilities`);
    });

    function entityNodes() {
        return [
            { id: 's1', type: 'hass-sensor', controlValues: { objectId: 'temperature' } },
            { id: 'n1', type: 'hass-number', controlValues: { objectId: 'target' } },
        ];
    }

    function bridge(values = {}) {
        return { id: 'b1', type: 'hass-bridge', controlValues: values };
    }

    function will(values = {}) {
        return { id: 'w1', type: 'mqtt-will', controlValues: values };
    }

    const bridgeIssues = (issues) =>
        issues.filter(
            (issue) =>
                issue.message.includes('need a hass-bridge') ||
                issue.message.includes('More than one hass-bridge')
        );
    const willIssues = (issues) =>
        issues.filter((issue) => issue.message.includes('Only one will fits'));

    it('registers both rules through the shared registry', () => {
        const ids = getGraphRules().map((rule) => rule.id);
        assert.ok(ids.includes('hass-requires-bridge'));
        assert.ok(ids.includes('hass-bridge-will-conflict'));
    });

    it('flags entity nodes without a bridge', () => {
        const issues = validateGraphRules({
            graphId: 'g',
            nodes: entityNodes(),
            nodeTypesByNodeId: {},
        });
        assert.equal(bridgeIssues(issues).length, 2);
        assert.ok(bridgeIssues(issues).every((issue) => issue.source === 'graphRule'));
        assert.ok(
            bridgeIssues(issues).every((issue) => issue.message.includes('in the collection'))
        );
    });

    it('flags a lone hass-text or hass-button without a bridge', () => {
        for (const node of [
            { id: 't1', type: 'hass-text', controlValues: { objectId: 'label' } },
            { id: 'p1', type: 'hass-button', controlValues: { objectId: 'reset' } },
        ]) {
            const issues = validateGraphRules({
                graphId: 'g',
                nodes: [node],
                nodeTypesByNodeId: {},
            });
            assert.equal(bridgeIssues(issues).length, 1, `${node.type} was not badged`);
            assert.equal(bridgeIssues(issues)[0].nodeId, node.id);
        }
    });

    it('accepts a bridge next to the text and press button nodes', () => {
        const nodes = [
            bridge({ deviceId: 'otter-demo' }),
            { id: 't1', type: 'hass-text', controlValues: { objectId: 'label' } },
            { id: 'p1', type: 'hass-button', controlValues: { objectId: 'reset' } },
        ];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        assert.equal(bridgeIssues(issues).length, 0);
    });

    it('clears the badge when the bridge lives in another graph', () => {
        const nodes = entityNodes();
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: [...nodes, bridge()],
        });
        assert.equal(bridgeIssues(issues).length, 0);
    });

    it('clears the badge when the bridge is in the same graph', () => {
        const nodes = [...entityNodes(), bridge()];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });
        assert.equal(bridgeIssues(issues).length, 0);
    });

    it('warns only on the bridge of the current graph when two bridges exist', () => {
        const inGraph = bridge({ deviceId: 'a' });
        const otherGraph = bridge({ deviceId: 'b' });
        const nodes = [...entityNodes(), inGraph];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: [...nodes, otherGraph],
        });
        const duplicates = issues.filter((issue) =>
            issue.message.includes('More than one hass-bridge')
        );
        assert.equal(duplicates.length, 1);
        assert.equal(duplicates[0].nodeId, 'b1');
    });

    it('does not warn on a graph that owns no bridge when two bridges live elsewhere', () => {
        const nodes = entityNodes();
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: [...nodes, bridge({ deviceId: 'a' }), bridge({ deviceId: 'b' })],
        });
        assert.equal(bridgeIssues(issues).length, 0);
    });

    it('falls back to the graph nodes when collectionNodes is empty', () => {
        const nodes = [...entityNodes(), bridge()];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: [],
        });
        assert.equal(bridgeIssues(issues).length, 0);
    });

    it('flags a will node next to a bridge on the same topic', () => {
        const b = bridge({ deviceId: 'otter-demo' });
        const w = will({ willTopic: 'otter/otter-demo/availability' });
        const nodes = [b, w];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        const conflicts = willIssues(issues);
        assert.equal(conflicts.length, 2);
        assert.ok(conflicts.every((issue) => issue.source === 'graphRule'));
        const willIssue = conflicts.find((issue) => issue.nodeId === 'w1');
        const bridgeIssue = conflicts.find((issue) => issue.nodeId === 'b1');
        assert.ok(willIssue.message.includes("already sets 'otter/otter-demo/availability'"));
        assert.ok(bridgeIssue.message.includes("set 'otter/otter-demo/availability'"));
    });

    it('flags only the will node when the bridge is in another graph', () => {
        const b = bridge({ deviceId: 'otter-demo' });
        const w = will({ willTopic: 'other/topic' });
        const issues = validateGraphRules({
            graphId: 'g',
            nodes: [w],
            nodeTypesByNodeId: {},
            collectionNodes: [b, w],
        });

        const conflicts = willIssues(issues);
        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].nodeId, 'w1');
    });

    it('stays silent when the bridge owns no will', () => {
        const w = will({ willTopic: 'otter/otter-demo/availability' });
        for (const values of [
            { deviceId: 'otter-demo', will: false },
            { deviceId: 'otter-demo', availability: false },
        ]) {
            const nodes = [bridge(values), w];
            const issues = validateGraphRules({
                graphId: 'g',
                nodes,
                nodeTypesByNodeId: {},
                collectionNodes: nodes,
            });
            assert.equal(willIssues(issues).length, 0);
        }
    });

    it('stays silent without a bridge', () => {
        const w1 = { id: 'w1', type: 'mqtt-will', controlValues: { willTopic: 'same/topic' } };
        const w2 = { id: 'w2', type: 'mqtt-will', controlValues: { willTopic: 'same/topic' } };
        const nodes = [w1, w2];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });
        assert.equal(willIssues(issues).length, 0);
    });

    it('falls back to the graph nodes when collectionNodes is absent', () => {
        const b = bridge({ deviceId: 'otter-demo' });
        const w = will({ willTopic: 'otter/otter-demo/availability' });
        const issues = validateGraphRules({
            graphId: 'g',
            nodes: [b, w],
            nodeTypesByNodeId: {},
        });
        assert.equal(willIssues(issues).length, 2);
    });
});

describe('hass availability graph rules', () => {
    let getGraphRules;
    let validateGraphRules;

    before(async () => {
        const registry =
            await import('../../src/micro_otter/nodes/html/js/core/graph-rule-registry.js');
        getGraphRules = registry.getGraphRules;
        validateGraphRules = registry.validateGraphRules;

        await import('../../src/micro_otter/nodes/html/js/core/graph-topic-validator.js');
        const capabilitiesUrl = pathToFileURL(path.join(packageRoot, 'node_capabilities.js'));
        await import(`${capabilitiesUrl.href}?test=hass-availability-capabilities`);
    });

    function flag(id, flagId) {
        return { id, type: 'hass-availability', controlValues: { id: flagId } };
    }

    function sensor(id, flags) {
        return {
            id,
            type: 'hass-sensor',
            controlValues: { objectId: id, availabilityFlags: flags },
        };
    }

    function bridge() {
        return { id: 'b1', type: 'hass-bridge', controlValues: { deviceId: 'otter-demo' } };
    }

    const duplicateIssues = (issues) =>
        issues.filter((issue) => issue.message.includes('Two hass-availability nodes publish'));
    const invalidIssues = (issues) =>
        issues.filter((issue) => issue.message.includes('no usable Availability ID'));
    const missingIssues = (issues) =>
        issues.filter((issue) => issue.message.includes('is not defined by any'));

    it('registers the three flag rules', () => {
        const ids = getGraphRules().map((rule) => rule.id);
        assert.ok(ids.includes('hass-availability-duplicate-id'));
        assert.ok(ids.includes('hass-availability-invalid-id'));
        assert.ok(ids.includes('hass-availability-missing-flag'));
    });

    it('flags both nodes of a duplicated flag id', () => {
        const nodes = [bridge(), flag('f1', 'heating'), flag('f2', 'heating')];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        const duplicates = duplicateIssues(issues);
        assert.equal(duplicates.length, 2);
        assert.deepEqual(duplicates.map((issue) => issue.nodeId).sort(), ['f1', 'f2']);
        assert.ok(duplicates[0].message.includes("'heating'"));
        assert.ok(duplicates.every((issue) => issue.source === 'graphRule'));
    });

    it('compares the topic segment, not the raw id', () => {
        const nodes = [bridge(), flag('f1', 'Heating Pwr!'), flag('f2', 'Heating_Pwr')];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        assert.equal(duplicateIssues(issues).length, 2);
        assert.ok(duplicateIssues(issues)[0].message.includes("'Heating_Pwr'"));
    });

    it('badges only the duplicate on screen when the other lives in another graph', () => {
        const inGraph = [bridge(), flag('f1', 'heating')];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes: inGraph,
            nodeTypesByNodeId: {},
            collectionNodes: [...inGraph, flag('f2', 'heating')],
        });

        const duplicates = duplicateIssues(issues);
        assert.equal(duplicates.length, 1);
        assert.equal(duplicates[0].nodeId, 'f1');
    });

    it('keeps a unique flag clean', () => {
        const nodes = [bridge(), flag('f1', 'heating'), sensor('s1', ['heating'])];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        assert.equal(duplicateIssues(issues).length, 0);
        assert.equal(invalidIssues(issues).length, 0);
        assert.equal(missingIssues(issues).length, 0);
    });

    it('flags an empty or unusable flag id', () => {
        for (const flagId of [undefined, '', '   ', '!!!']) {
            const nodes = [bridge(), flag('f1', flagId)];
            const issues = validateGraphRules({
                graphId: 'g',
                nodes,
                nodeTypesByNodeId: {},
                collectionNodes: nodes,
            });

            assert.equal(invalidIssues(issues).length, 1, `id ${JSON.stringify(flagId)}`);
            assert.equal(invalidIssues(issues)[0].nodeId, 'f1');
        }
    });

    it('does not report an unusable id as a duplicate', () => {
        const nodes = [bridge(), flag('f1', ''), flag('f2', '   ')];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        assert.equal(duplicateIssues(issues).length, 0);
        assert.equal(invalidIssues(issues).length, 2);
    });

    it('warns about a reference no flag node defines', () => {
        const nodes = [bridge(), flag('f1', 'heating'), sensor('s1', ['heating', 'ghost'])];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        const missing = missingIssues(issues);
        assert.equal(missing.length, 1);
        assert.equal(missing[0].nodeId, 's1');
        assert.ok(missing[0].message.includes("'ghost'"));
    });

    it('warns about an undefined flag on the text and press button nodes too', () => {
        const text = {
            id: 't1',
            type: 'hass-text',
            controlValues: { objectId: 'label', availabilityFlags: ['ghost'] },
        };
        const button = {
            id: 'b1',
            type: 'hass-button',
            controlValues: { objectId: 'reset', availabilityFlags: ['ghost'] },
        };
        const nodes = [bridge(), flag('f1', 'heating'), text, button];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        assert.deepEqual(
            missingIssues(issues).map((issue) => issue.nodeId),
            ['t1', 'b1']
        );
    });

    it('ignores the reserved device entry in the missing-flag rule', () => {
        const nodes = [bridge(), sensor('s1', ['__device__', 'ghost'])];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        const missing = missingIssues(issues);
        assert.equal(missing.length, 1);
        assert.ok(missing[0].message.includes("'ghost'"));
        assert.ok(!missing[0].message.includes('__device__'));

        const deviceOnly = validateGraphRules({
            graphId: 'g',
            nodes: [bridge(), sensor('s2', ['__device__'])],
            nodeTypesByNodeId: {},
            collectionNodes: [bridge(), sensor('s2', ['__device__'])],
        });
        assert.equal(missingIssues(deviceOnly).length, 0);
    });

    it('accepts a flag defined in another graph of the collection', () => {
        const inGraph = [bridge(), sensor('s1', ['heating'])];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes: inGraph,
            nodeTypesByNodeId: {},
            collectionNodes: [...inGraph, flag('f2', 'heating')],
        });

        assert.equal(missingIssues(issues).length, 0);
    });

    it('stays silent for an entity without flags', () => {
        const nodes = [bridge(), sensor('s1', []), sensor('s2', undefined)];
        const issues = validateGraphRules({
            graphId: 'g',
            nodes,
            nodeTypesByNodeId: {},
            collectionNodes: nodes,
        });

        assert.equal(missingIssues(issues).length, 0);
    });
});
