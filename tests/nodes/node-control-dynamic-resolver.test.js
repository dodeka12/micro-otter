import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    getDynamicControlResolver,
    registerDynamicControlResolver,
    resolveDynamicControl,
} from '../../src/micro_otter/nodes/html/js/nodes/node-control-dynamic-resolver.js';
import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';

function stubTarget({ pins = {}, capabilities = {}, resources = {} } = {}) {
    return {
        getPinsForCapability(key) {
            return Object.prototype.hasOwnProperty.call(capabilities, key)
                ? capabilities[key]
                : null;
        },
        getPinCapability(pin) {
            return Object.prototype.hasOwnProperty.call(pins, pin) ? pins[pin] : null;
        },
        resources,
    };
}

function resolverArgs(control, nodeData, deviceTarget) {
    return { control, nodeData: { controlValues: nodeData }, deviceTarget };
}

describe('dynamic control resolver registry', () => {
    it('registers and dispatches a stub resolver', () => {
        registerDynamicControlResolver('stub', () => ({
            options: [{ value: 'x', label: 'X' }],
            disabled: false,
            value: 'x',
        }));

        assert.equal(typeof getDynamicControlResolver('stub'), 'function');

        const result = resolveDynamicControl(
            resolverArgs({ id: 'c', dynamicOptions: { source: 'stub' } }, {}, null)
        );
        assert.deepEqual(result, {
            options: [{ value: 'x', label: 'X' }],
            disabled: false,
            value: 'x',
        });
    });

    it('returns null for an unknown source', () => {
        const result = resolveDynamicControl(
            resolverArgs({ id: 'c', dynamicOptions: { source: 'does-not-exist' } }, {}, null)
        );
        assert.equal(result, null);
    });
});

describe('targetPinPull resolver', () => {
    it('lists undefined + supported pull directions', () => {
        const target = stubTarget({
            pins: { 1: { label: 'GPIO1', pull: ['up', 'down'] } },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                { id: 'pull', dynamicOptions: { source: 'targetPinPull', includeUndefined: true } },
                { pin: 1, pull: 'up' },
                target
            )
        );
        assert.deepEqual(
            result.options.map((option) => option.value),
            [null, 'up', 'down']
        );
        assert.equal(result.disabled, false);
        assert.equal(result.value, 'up');
    });

    it('disables to a single fixed option when fixedPull is set', () => {
        const target = stubTarget({
            pins: { 3: { label: 'GPIO3', pull: ['up'], fixedPull: 'up' } },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                { id: 'pull', dynamicOptions: { source: 'targetPinPull', includeUndefined: true } },
                { pin: 3, pull: 'down' },
                target
            )
        );
        assert.deepEqual(result.options, [{ value: 'up', label: 'Pull Up' }]);
        assert.equal(result.disabled, true);
        assert.equal(result.value, 'up');
    });

    it('returns empty options for an unknown pin without disabling', () => {
        const target = stubTarget({ pins: {} });
        const result = resolveDynamicControl(
            resolverArgs(
                { id: 'pull', dynamicOptions: { source: 'targetPinPull', includeUndefined: true } },
                { pin: 99 },
                target
            )
        );
        assert.deepEqual(result.options, []);
        assert.equal(result.disabled, false);
    });
});

describe('targetPinsForCapability resolver', () => {
    it('maps capability pins to labeled options', () => {
        const target = stubTarget({
            pins: { 4: { label: 'GPIO4' } },
            capabilities: { 'i2s.bclk': [4] },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'bclkPin',
                    dynamicOptions: { source: 'targetPinsForCapability', capabilityKey: 'i2s.bclk' },
                },
                { bclkPin: 99 },
                target
            )
        );
        assert.deepEqual(result.options, [{ value: 4, label: 'GPIO4' }]);
        assert.equal(result.disabled, false);
        assert.equal(result.value, 4);
    });

    it('prepends a None option when allowNone is set', () => {
        const target = stubTarget({
            pins: { 4: { label: 'GPIO4' } },
            capabilities: { 'digital.output': [4] },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'gainPin',
                    dynamicOptions: {
                        source: 'targetPinsForCapability',
                        capabilityKey: 'digital.output',
                        allowNone: true,
                    },
                },
                { gainPin: null },
                target
            )
        );
        assert.deepEqual(
            result.options.map((option) => option.value),
            [null, 4]
        );
        assert.equal(result.options[0].label, 'None');
        assert.equal(result.value, null);
    });

    it('clamps an invalid pin to None when allowNone is set', () => {
        const target = stubTarget({
            pins: { 4: { label: 'GPIO4' } },
            capabilities: { 'digital.output': [4] },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'gainPin',
                    dynamicOptions: {
                        source: 'targetPinsForCapability',
                        capabilityKey: 'digital.output',
                        allowNone: true,
                    },
                },
                { gainPin: 99 },
                target
            )
        );
        assert.equal(result.value, null);
    });

    it('disables an empty pin list for an unknown capability', () => {
        const target = stubTarget({ pins: {}, capabilities: {} });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'pin',
                    dynamicOptions: { source: 'targetPinsForCapability', capabilityKey: 'nope' },
                },
                {},
                target
            )
        );
        assert.deepEqual(result.options, []);
        assert.equal(result.disabled, true);
        assert.equal(result.value, null);
    });

    it('disables the picker when the target has no pins for a declared capability', () => {
        const target = stubTarget({
            pins: { 2: { label: 'GPIO2' } },
            capabilities: { 'digital.output': [2] },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'pin',
                    dynamicOptions: { source: 'targetPinsForCapability', capabilityKey: 'dac' },
                },
                { pin: 25 },
                target
            )
        );
        assert.deepEqual(result, { options: [], disabled: true, value: null });
    });

    it('keeps an optional empty list usable through None', () => {
        const target = stubTarget({
            pins: { 2: { label: 'GPIO2' } },
            capabilities: { 'digital.output': [2] },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'pin',
                    dynamicOptions: {
                        source: 'targetPinsForCapability',
                        capabilityKey: 'dac',
                        allowNone: true,
                    },
                },
                { pin: 25 },
                target
            )
        );
        assert.deepEqual(
            result.options.map((option) => option.value),
            [null]
        );
        assert.equal(result.disabled, false);
        assert.equal(result.value, null);
    });

    it('keeps a non-empty pin list enabled and preserves the current value', () => {
        const target = stubTarget({
            pins: { 25: { label: 'GPIO25' }, 26: { label: 'GPIO26' } },
            capabilities: { dac: [25, 26] },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'pin',
                    dynamicOptions: { source: 'targetPinsForCapability', capabilityKey: 'dac' },
                },
                { pin: 26 },
                target
            )
        );
        assert.deepEqual(
            result.options.map((option) => option.value),
            [25, 26]
        );
        assert.equal(result.disabled, false);
        assert.equal(result.value, 26);
    });

    it('annotates claimed pin labels without changing values or order', () => {
        const target = new DeviceTargetInfo({
            targetId: 'esp32-s3-mini',
            capabilityToPins: { 'digital.output': [43, 21] },
            pinCapabilities: {
                43: {
                    label: 'GPIO43',
                    digital: { output: true },
                    claims: [
                        {
                            role: 'console.tx',
                            conflicts: ['digital.output'],
                            severity: 'warn',
                            note: 'n',
                        },
                    ],
                },
                21: { label: 'GPIO21', digital: { output: true } },
            },
        });

        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'pin',
                    dynamicOptions: { source: 'targetPinsForCapability', capabilityKey: 'digital.output' },
                },
                {},
                target
            )
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            [43, 21]
        );
        assert.equal(result.options[0].label, 'GPIO43 — UART0 TX (console)');
        assert.equal(result.options[1].label, 'GPIO21');
    });
});

describe('targetResourceValues resolver', () => {
    it('derives 0..n-1 ids from a resource count', () => {
        const target = stubTarget({ resources: { i2s: { controllers: 2 } } });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'i2sId',
                    dynamicOptions: {
                        source: 'targetResourceValues',
                        resourceGroup: 'i2s',
                        resourceKey: 'controllers',
                    },
                },
                { i2sId: 1 },
                target
            )
        );
        assert.deepEqual(
            result.options.map((option) => option.value),
            [0, 1]
        );
        assert.equal(result.disabled, false);
        assert.equal(result.value, 1);
    });

    it('disables when the resource group is absent', () => {
        const target = stubTarget({ resources: {} });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'i2sId',
                    dynamicOptions: {
                        source: 'targetResourceValues',
                        resourceGroup: 'i2s',
                        resourceKey: 'controllers',
                    },
                },
                {},
                target
            )
        );
        assert.deepEqual(result.options, []);
        assert.equal(result.disabled, true);
        assert.equal(result.value, null);
    });
});

describe('resolvers against open pin set targets', () => {
    it('targetPinsForCapability lists the full open range', () => {
        const target = new DeviceTargetInfo({ targetId: 'generic', openPins: { min: 0, max: 5 } });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'pin',
                    dynamicOptions: { source: 'targetPinsForCapability', capabilityKey: 'digital.input' },
                },
                {},
                target
            )
        );
        assert.deepEqual(
            result.options.map((option) => option.value),
            [0, 1, 2, 3, 4, 5]
        );
        assert.equal(result.disabled, false);
    });

    it('targetResourceValues derives ids from resources on an open target', () => {
        const target = new DeviceTargetInfo({
            targetId: 'generic',
            openPins: { min: 0, max: 5 },
            resources: { i2s: { controllers: 2 } },
        });
        const result = resolveDynamicControl(
            resolverArgs(
                {
                    id: 'i2sId',
                    dynamicOptions: {
                        source: 'targetResourceValues',
                        resourceGroup: 'i2s',
                        resourceKey: 'controllers',
                    },
                },
                {},
                target
            )
        );
        assert.deepEqual(
            result.options.map((option) => option.value),
            [0, 1]
        );
        assert.equal(result.disabled, false);
    });
});

function graphWithTopics(...topics) {
    return {
        getNodes: () =>
            topics.map((topic, index) => ({
                id: `mqtt-${index}`,
                type: 'mqtt-write',
                controls: [{ id: 'topic', type: 'dropdown' }],
                controlValues: { topic },
            })),
    };
}

function graphTopicArgs(controlValues, graph = graphWithTopics('home/a', 'home/z')) {
    return {
        control: {
            id: 'topic',
            type: 'dropdown',
            default: '',
            dynamicOptions: { source: 'graphTopics', newTopicControls: ['customTopic'] },
        },
        nodeData: { controlValues },
        deviceTarget: null,
        graph,
    };
}

describe('graphTopics resolver', () => {
    it('lists the current value, the graph topics and the new-topic sentinel', () => {
        const result = resolveDynamicControl(graphTopicArgs({ topic: 'home/current' }));

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['home/current', 'home/a', 'home/z', '__new__']
        );
        assert.equal(result.disabled, false);
        assert.equal(result.value, 'home/current');
    });

    it('never lists the current value twice', () => {
        const result = resolveDynamicControl(
            graphTopicArgs({ topic: 'home/a' }, graphWithTopics('home/a', 'home/b'))
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['home/a', 'home/b', '__new__']
        );
    });

    it('selects the sentinel for an unset topic and labels the entry', () => {
        const result = resolveDynamicControl(graphTopicArgs({ topic: '' }));

        assert.equal(result.value, '__new__');
        assert.equal(result.options[0].label, '(not set)');
    });

    it('never overrides the sentinel display label for a real topic', () => {
        const result = resolveDynamicControl(
            graphTopicArgs({ topic: 'home/a', customTopic: 'home/typed' }, graphWithTopics('home/a'))
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.equal(sentinel.displayLabel, undefined);
    });

    it('keeps a stored sentinel as a single entry', () => {
        const result = resolveDynamicControl(
            graphTopicArgs({ topic: '__new__', customTopic: 'home/typed' }, graphWithTopics())
        );

        assert.equal(result.value, '__new__');
        assert.equal(
            result.options.filter((option) => option.value === '__new__').length,
            1
        );
        const sentinel = result.options.find((option) => option.value === '__new__');
        assert.equal(sentinel.displayLabel, 'home/typed');
    });

    it('falls back to current + sentinel without a graph', () => {
        const result = resolveDynamicControl(graphTopicArgs({ topic: '' }, null));

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['', '__new__']
        );
        assert.equal(result.disabled, false);
    });

    it('carries the declared new-topic controls on the sentinel option', () => {
        const result = resolveDynamicControl(graphTopicArgs({ topic: '' }));
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.deepEqual(sentinel.activeControls, ['customTopic']);
    });

    it('omits activeControls when the descriptor declares none', () => {
        const args = graphTopicArgs({ topic: '' });
        args.control.dynamicOptions = { source: 'graphTopics' };

        const result = resolveDynamicControl(args);
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.deepEqual(sentinel.activeControls, []);
    });
});
function varNode(id, type, { inputDefaults = {}, controlValues = {} } = {}) {
    return { id, type, inputDefaults, controlValues };
}

function collectionOf(...nodes) {
    return { getGraphArray: () => [{ getNodes: () => nodes }] };
}

function varStoreArgs(nodeData, { collection = null, graph = null, dynamicOptions } = {}) {
    return {
        control: {
            id: 'store',
            type: 'dropdown',
            default: 'default',
            dynamicOptions: dynamicOptions || {
                source: 'varStores',
                newStoreControls: ['customStore'],
            },
        },
        nodeData,
        deviceTarget: null,
        graph,
        collection,
    };
}

function varNameArgs(nodeData, { collection = null, graph = null, dynamicOptions } = {}) {
    return {
        control: {
            id: 'name',
            type: 'dropdown',
            default: '',
            dynamicOptions: dynamicOptions || {
                source: 'varNames',
                dependsOn: ['store'],
                newNameControls: ['customName'],
            },
        },
        nodeData,
        deviceTarget: null,
        graph,
        collection,
    };
}

describe('varStores resolver', () => {
    it('lists current, collected namespaces and the sentinel', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', { inputDefaults: { store: 'presets' } }),
            varNode('r2', 'vars.var-write', { inputDefaults: { store: 'logs' } })
        );
        const result = resolveDynamicControl(
            varStoreArgs({ inputDefaults: { store: 'current' }, controlValues: {} }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['current', 'default', 'logs', 'presets', '__new__']
        );
        assert.equal(result.disabled, false);
        assert.equal(result.value, 'current');
    });

    it('keeps a stored namespace that no node uses any more', () => {
        const result = resolveDynamicControl(
            varStoreArgs(
                { inputDefaults: { store: 'deleted-store' }, controlValues: {} },
                { collection: collectionOf() }
            )
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['deleted-store', 'default', '__new__']
        );
    });

    it('resolves the store value from inputDefaults, not controlValues', () => {
        const result = resolveDynamicControl(
            varStoreArgs({ inputDefaults: { store: 'presets' }, controlValues: {} })
        );

        assert.equal(result.value, 'presets');
        assert.equal(result.options[0].value, 'presets');
    });

    it('opens an unset store on the default namespace, not the sentinel', () => {
        const result = resolveDynamicControl(
            varStoreArgs({ inputDefaults: {}, controlValues: {} }, { collection: collectionOf() })
        );

        assert.equal(result.value, 'default');
        assert.deepEqual(
            result.options.map((option) => option.value),
            ['default', '__new__']
        );
        assert.equal(result.options[0].label, 'default');
    });

    it('reads a stored empty store as the default namespace', () => {
        const result = resolveDynamicControl(
            varStoreArgs(
                { inputDefaults: { store: '' }, controlValues: {} },
                { collection: collectionOf() }
            )
        );

        assert.equal(result.value, 'default');
        assert.deepEqual(
            result.options.map((option) => option.value),
            ['default', '__new__']
        );
    });

    it('lists the namespaces without a blank entry while the sentinel is selected', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', { inputDefaults: { store: 'presets' } })
        );
        const result = resolveDynamicControl(
            varStoreArgs(
                { inputDefaults: { store: '__new__' }, controlValues: {} },
                { collection }
            )
        );

        assert.equal(result.value, '__new__');
        assert.deepEqual(
            result.options.map((option) => option.value),
            ['default', 'presets', '__new__']
        );
    });

    it('echoes the typed namespace on the sentinel while it is selected', () => {
        const result = resolveDynamicControl(
            varStoreArgs(
                {
                    inputDefaults: { store: '__new__' },
                    controlValues: { customStore: '  presets  ' },
                },
                { collection: collectionOf() }
            )
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.equal(sentinel.displayLabel, 'presets');
        assert.equal(sentinel.label, 'New store\u2026');
    });

    it('leaves the sentinel display label empty until something is typed', () => {
        const result = resolveDynamicControl(
            varStoreArgs({ inputDefaults: { store: '__new__' }, controlValues: {} })
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.equal(sentinel.displayLabel, undefined);
    });

    it('never overrides the display label of a real namespace', () => {
        const result = resolveDynamicControl(
            varStoreArgs({
                inputDefaults: { store: 'presets' },
                controlValues: { customStore: 'typed' },
            })
        );
        const selected = result.options.find((option) => option.value === 'presets');

        assert.equal(selected.displayLabel, undefined);
    });

    it('never lists a reserved namespace and never rewrites a stored one', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', { inputDefaults: { store: '_webcontrol' } }),
            varNode('r2', 'vars.var-write', { inputDefaults: { store: 'presets' } })
        );
        const result = resolveDynamicControl(
            varStoreArgs(
                { inputDefaults: { store: '_webcontrol' }, controlValues: {} },
                { collection }
            )
        );

        assert.equal(result.value, '_webcontrol');
        assert.deepEqual(
            result.options.map((option) => option.value),
            ['_webcontrol', 'default', 'presets', '__new__']
        );
    });

    it('carries the declared new-store controls on the sentinel option', () => {
        const result = resolveDynamicControl(
            varStoreArgs({ inputDefaults: {}, controlValues: {} })
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.deepEqual(sentinel.activeControls, ['customStore']);
        assert.equal(sentinel.label, 'New store\u2026');
    });

    it('uses the descriptor label and tolerates a missing control list', () => {
        const result = resolveDynamicControl(
            varStoreArgs(
                { inputDefaults: {}, controlValues: {} },
                { dynamicOptions: { source: 'varStores', newLabel: 'Eigener Store\u2026' } }
            )
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.equal(sentinel.label, 'Eigener Store\u2026');
        assert.deepEqual(sentinel.activeControls, []);
    });

    it('passes an i18n label map through to the sentinel option', () => {
        const result = resolveDynamicControl(
            varStoreArgs(
                { inputDefaults: {}, controlValues: {} },
                {
                    dynamicOptions: {
                        source: 'varStores',
                        newLabel: { en: 'New store\u2026', de: 'Neuer Store\u2026' },
                    },
                }
            )
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.deepEqual(sentinel.label, { en: 'New store\u2026', de: 'Neuer Store\u2026' });
    });
});



describe('varNames resolver', () => {
    it('lists the declared variable names of the namespace named by dependsOn', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', {
                inputDefaults: { store: 'presets' },
                controlValues: { name: '__new__', customName: 'temp' },
            }),
            varNode('r2', 'vars.var-write', {
                inputDefaults: { store: 'presets' },
                controlValues: { name: '__new__', customName: 'humidity' },
            }),
            varNode('r3', 'vars.var-read', {
                inputDefaults: { store: 'logs' },
                controlValues: { name: '__new__', customName: 'line' },
            })
        );
        const result = resolveDynamicControl(
            varNameArgs(
                { id: 'r9', inputDefaults: { store: 'presets' }, controlValues: { name: '' } },
                { collection }
            )
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['', 'humidity', 'temp', '__new__']
        );
        assert.equal(result.value, '');
    });

    it('follows a sentinel namespace through its companion control', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', {
                inputDefaults: { store: 'presets' },
                controlValues: { name: '__new__', customName: 'temp' },
            })
        );
        const result = resolveDynamicControl(
            varNameArgs(
                {
                    id: 'r9',
                    inputDefaults: { store: '__new__' },
                    controlValues: { customStore: 'presets', name: '' },
                },
                { collection }
            )
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['', 'temp', '__new__']
        );
    });

    it('falls back to the default namespace when nothing names a store', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', {
                controlValues: { name: '__new__', customName: 'counter' },
            })
        );
        const result = resolveDynamicControl(
            varNameArgs({ id: 'r9', inputDefaults: {}, controlValues: { name: '' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['', 'counter', '__new__']
        );
    });

    it('yields only current and sentinel for an unknown namespace', () => {
        const result = resolveDynamicControl(
            varNameArgs({
                inputDefaults: { store: 'missing' },
                controlValues: { name: 'kept' },
            })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['kept', '__new__']
        );
        assert.equal(result.value, 'kept');
    });

    it('resolves the name from controlValues on a var-read node', () => {
        const result = resolveDynamicControl(
            varNameArgs({ inputDefaults: { store: 'presets' }, controlValues: { name: 'buf' } })
        );

        assert.equal(result.value, 'buf');
        assert.equal(result.options[0].label, 'buf');
    });

    it('carries the declared new-name controls on the sentinel option', () => {
        const result = resolveDynamicControl(
            varNameArgs({ inputDefaults: {}, controlValues: {} })
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.deepEqual(sentinel.activeControls, ['customName']);
        assert.equal(sentinel.label, 'Declare variable\u2026');
    });

    it('echoes the typed name on the sentinel while it is selected', () => {
        const result = resolveDynamicControl(
            varNameArgs({
                inputDefaults: { store: 'default' },
                controlValues: { name: '__new__', customName: ' pressure ' },
            })
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.equal(result.value, '__new__');
        assert.equal(sentinel.displayLabel, 'pressure');
    });

    it('leaves the name sentinel display label empty for a real selection', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', {
                inputDefaults: { store: 'presets' },
                controlValues: { name: 'temp' },
            })
        );
        const result = resolveDynamicControl(
            varNameArgs(
                { inputDefaults: { store: 'presets' }, controlValues: { name: 'temp' } },
                { collection }
            )
        );
        const sentinel = result.options.find((option) => option.value === '__new__');

        assert.equal(sentinel.displayLabel, undefined);
    });

    it('does not offer a name that only a reference node uses', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', {
                inputDefaults: { store: 'presets' },
                controlValues: { name: 'ghost' },
            })
        );
        const result = resolveDynamicControl(
            varNameArgs(
                { id: 'r9', inputDefaults: { store: 'presets' }, controlValues: { name: '' } },
                { collection }
            )
        );

        assert.deepEqual(result.options.map((option) => option.value), ['', '__new__']);
    });

    it('excludes the declaring node from its own option list', () => {
        const collection = collectionOf(
            varNode('r1', 'vars.var-read', {
                inputDefaults: { store: 'presets' },
                controlValues: { name: '__new__', customName: 'temp' },
            }),
            varNode('r2', 'vars.var-write', {
                inputDefaults: { store: 'presets' },
                controlValues: { name: '__new__', customName: 'humidity' },
            })
        );
        const result = resolveDynamicControl(
            varNameArgs(
                {
                    id: 'r1',
                    inputDefaults: { store: 'presets' },
                    controlValues: { name: '__new__', customName: 'temp' },
                },
                { collection }
            )
        );

        assert.deepEqual(result.options.map((option) => option.value), ['', 'humidity', '__new__']);
        assert.equal(result.value, '__new__');
    });
});

describe('cross-node dynamic sources', () => {
    it('treats the var pickers as collection-scoped sources', async () => {
        const { CROSS_NODE_DYNAMIC_SOURCES } = await import(
            '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js'
        );

        assert.ok(CROSS_NODE_DYNAMIC_SOURCES.includes('varStores'));
        assert.ok(CROSS_NODE_DYNAMIC_SOURCES.includes('varNames'));
    });

    it('treats the interrupt-name picker as a collection-scoped source', async () => {
        const { CROSS_NODE_DYNAMIC_SOURCES } = await import(
            '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js'
        );

        assert.ok(CROSS_NODE_DYNAMIC_SOURCES.includes('irqTriggerNames'));
    });

    it('treats the signal-name picker as a collection-scoped source', async () => {
        const { CROSS_NODE_DYNAMIC_SOURCES } = await import(
            '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js'
        );

        assert.ok(CROSS_NODE_DYNAMIC_SOURCES.includes('signalNames'));
    });
});

function irqNode(id, type, triggerName) {
    return { id, type, controlValues: triggerName === undefined ? {} : { triggerName } };
}

function irqNameArgs(nodeData, { collection = null, graph = null } = {}) {
    return {
        control: {
            id: 'triggerName',
            type: 'dropdown',
            default: '',
            dynamicOptions: { source: 'irqTriggerNames' },
        },
        nodeData,
        deviceTarget: null,
        graph,
        collection,
    };
}

describe('irqTriggerNames resolver', () => {
    it('lists every declared interrupt name of the collection, sorted', () => {
        const collection = collectionOf(
            irqNode('d1', 'irq.interrupt-input', 'sensor'),
            irqNode('d2', 'irq.interrupt-input', 'button')
        );
        const result = resolveDynamicControl(
            irqNameArgs({ id: 'r1', controlValues: { triggerName: '' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['button', 'sensor']
        );
        assert.deepEqual(
            result.options.map((option) => option.label),
            ['button', 'sensor']
        );
        assert.equal(result.disabled, false);
        assert.equal(result.value, '');
    });

    it('includes a declaration from another graph', () => {
        const collection = {
            getGraphArray: () => [
                { getId: () => 'g-init', getNodes: () => [irqNode('d1', 'irq.interrupt-input', 'button')] },
                { getId: () => 'g-irq', getNodes: () => [] },
            ],
        };
        const result = resolveDynamicControl(
            irqNameArgs({ id: 'r1', controlValues: { triggerName: '' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['button']
        );
    });

    it('skips the resolving node own declaration', () => {
        const collection = collectionOf(
            irqNode('d1', 'irq.interrupt-input', 'button'),
            irqNode('d2', 'irq.interrupt-input', 'sensor')
        );
        const result = resolveDynamicControl(
            irqNameArgs({ id: 'd1', controlValues: { triggerName: 'button' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['sensor'],
            'the own name is neither listed nor re-added as a stale value'
        );
        assert.equal(result.value, 'button');
    });

    it('ignores enable nodes and blank names', () => {
        const collection = collectionOf(
            irqNode('r1', 'irq.interrupt-enable', 'button'),
            irqNode('d1', 'irq.interrupt-input', '   ')
        );
        const result = resolveDynamicControl(
            irqNameArgs({ id: 'r9', controlValues: { triggerName: '' } }, { collection })
        );

        assert.deepEqual(result.options, []);
        assert.equal(result.disabled, true);
    });

    it('pins a stale current value first', () => {
        const collection = collectionOf(irqNode('d1', 'irq.interrupt-input', 'button'));
        const result = resolveDynamicControl(
            irqNameArgs({ id: 'r1', controlValues: { triggerName: 'ghost' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['ghost', 'button']
        );
        assert.equal(result.value, 'ghost');
        assert.equal(result.disabled, false);
    });

    it('trims the stored value and does not duplicate a declared current name', () => {
        const collection = collectionOf(irqNode('d1', 'irq.interrupt-input', 'button'));
        const result = resolveDynamicControl(
            irqNameArgs({ id: 'r1', controlValues: { triggerName: ' button ' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['button']
        );
        assert.equal(result.value, 'button');
    });

    it('falls back to the active graph when there is no collection', () => {
        const graph = { getNodes: () => [irqNode('d1', 'irq.interrupt-input', 'button')] };
        const result = resolveDynamicControl(
            irqNameArgs({ id: 'r1', controlValues: { triggerName: '' } }, { graph })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['button']
        );
    });
});


function signalNode(id, signal) {
    return { id, type: 'signal-post', controlValues: signal === undefined ? {} : { signal } };
}

function signalNameArgs(
    nodeData,
    { collection = null, graph = null, dynamicOptions = null } = {}
) {
    return {
        control: {
            id: 'signal',
            type: 'dropdown',
            default: '',
            dynamicOptions:
                dynamicOptions || {
                    source: 'signalNames',
                    newNameControls: ['customSignal'],
                    newLabel: { en: 'Define signal…', de: 'Signal definieren…' },
                },
        },
        nodeData,
        deviceTarget: null,
        graph,
        collection,
    };
}

describe('signalNames resolver', () => {
    it('lists (not set), the collected names, then the sentinel', () => {
        const collection = collectionOf(signalNode('n1', 'radar'), signalNode('n2', 'motion'));
        const result = resolveDynamicControl(
            signalNameArgs({ id: 'x', controlValues: { signal: '' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['', 'motion', 'radar', '__new__']
        );
        assert.equal(result.options[0].label, '(not set)');
        assert.deepEqual(result.options[result.options.length - 1].activeControls, [
            'customSignal',
        ]);
        assert.equal(result.value, '');
    });

    it('takes the sentinel label from newLabel', () => {
        const collection = collectionOf();
        const result = resolveDynamicControl(
            signalNameArgs({ id: 'x', controlValues: { signal: '' } }, { collection })
        );

        const sentinel = result.options[result.options.length - 1];
        assert.equal(sentinel.label.en, 'Define signal…');
        assert.equal(sentinel.label.de, 'Signal definieren…');
    });

    it('lists the sentinel once while a new name is being typed', () => {
        const collection = collectionOf();
        const result = resolveDynamicControl(
            signalNameArgs(
                { id: 'x', controlValues: { signal: '__new__', customSignal: 'fresh' } },
                { collection }
            )
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['', '__new__']
        );
        const sentinels = result.options.filter((option) => option.value === '__new__');
        assert.equal(sentinels.length, 1);
        assert.deepEqual(sentinels[0].activeControls, ['customSignal']);
        assert.equal(sentinels[0].displayLabel, 'fresh');
        assert.equal(result.value, '__new__');
    });

    it('preserves a stale stored value', () => {
        const collection = collectionOf(signalNode('n1', 'radar'));
        const result = resolveDynamicControl(
            signalNameArgs({ id: 'x', controlValues: { signal: 'ghost' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['ghost', 'radar', '__new__']
        );
        assert.equal(result.value, 'ghost');
    });

    it('offers (not set) and the sentinel for an empty collection', () => {
        const collection = collectionOf();
        const result = resolveDynamicControl(
            signalNameArgs({ id: 'x', controlValues: { signal: '' } }, { collection })
        );

        assert.deepEqual(
            result.options.map((option) => option.value),
            ['', '__new__']
        );
        assert.equal(result.disabled, false);
    });
});

