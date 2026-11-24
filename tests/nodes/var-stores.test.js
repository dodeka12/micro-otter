// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: variable-store collector
 *
 * The collector is the single definition of "which namespaces exist in this collection" and
 * "which variable names exist in namespace X". The `varStores` / `varNames` dropdowns and the
 * `vars` generators all consume it, so these tests pin the edge cases that would otherwise
 * surface as an empty or wrong dropdown list.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    collectVarNames,
    collectVarStores,
    customVarControlId,
    declaredVarEntry,
    DEFAULT_VAR_STORE,
    effectiveVarName,
    effectiveVarStoreName,
    isReservedStoreName,
    isVarNameDeclaration,
    isVarNameNode,
    VAR_NAME_SOURCE,
    VAR_NEW_SENTINEL,
    VAR_STORE_INPUTS,
    VAR_STORE_SOURCE,
} from '../../src/micro_otter/nodes/html/js/nodes/var-stores.js';

function readNode(id, { store, name, customStore, customName } = {}) {
    const inputDefaults = {};
    const controlValues = {};
    if (store !== undefined) {
        inputDefaults.store = store;
    }
    if (name !== undefined) {
        controlValues.name = name;
    }
    if (customStore !== undefined) {
        controlValues.customStore = customStore;
    }
    if (customName !== undefined) {
        controlValues.customName = customName;
    }
    return { id, type: 'vars.var-read', inputs: [{ id: 'store' }], controlValues, inputDefaults };
}

function writeNode(id, { store, name, customStore, customName } = {}) {
    const node = readNode(id, { store, name, customStore, customName });
    node.type = 'vars.var-write';
    return node;
}

function storeNode(id, type, store) {
    return { id, type, inputs: [{ id: 'name' }], controlValues: {}, inputDefaults: { name: store } };
}

function mqttStoreNode(id, storeNamespace) {
    return {
        id,
        type: 'mqtt.mqtt-read',
        controls: [{ id: 'storeNamespace', type: 'text' }],
        controlValues: { storeNamespace },
        inputDefaults: {},
    };
}

function graphOf(...nodes) {
    return { getNodes: () => nodes };
}

function collectionOf(...graphs) {
    return { getGraphArray: () => graphs };
}

describe('variable-store collector constants', () => {
    it('exposes the source names the node definitions declare', () => {
        assert.equal(VAR_STORE_SOURCE, 'varStores');
        assert.equal(VAR_NAME_SOURCE, 'varNames');
        assert.equal(VAR_NEW_SENTINEL, '__new__');
        assert.equal(DEFAULT_VAR_STORE, 'default');
    });

    it('derives the companion control id like the topic picker', () => {
        assert.equal(customVarControlId('name'), 'customName');
        assert.equal(customVarControlId('store'), 'customStore');
        assert.equal(customVarControlId(''), 'custom');
    });

    it('reserves underscore-prefixed namespaces only', () => {
        assert.equal(isReservedStoreName('_webcontrol'), true);
        assert.equal(isReservedStoreName('  _internal'), true);
        assert.equal(isReservedStoreName('presets'), false);
        assert.equal(isReservedStoreName(''), false);
        assert.equal(isReservedStoreName(null), false);
    });

    it('maps the namespace input of every node type that names one', () => {
        assert.equal(VAR_STORE_INPUTS['var-read'], 'store');
        assert.equal(VAR_STORE_INPUTS['var-write'], 'store');
        assert.equal(VAR_STORE_INPUTS['var-store-save'], 'name');
        assert.equal(VAR_STORE_INPUTS['var-store-load'], 'name');
        assert.equal(isVarNameNode('vars.var-read'), true);
        assert.equal(isVarNameNode('vars.var-write'), true);
        assert.equal(isVarNameNode('vars.var-store-save'), false);
        assert.equal(isVarNameNode('mqtt.mqtt-read'), false);
        assert.equal(isVarNameNode(undefined), false);
    });
});

describe('variable-store effective values', () => {
    it('reads the namespace from the input default', () => {
        assert.equal(effectiveVarStoreName(readNode('a', { store: ' presets ' })), 'presets');
    });

    it('resolves the sentinel namespace through its companion control', () => {
        const node = readNode('a', { store: VAR_NEW_SENTINEL, customStore: ' presets ' });
        assert.equal(effectiveVarStoreName(node), 'presets');
    });

    it('returns an empty namespace for a sentinel without companion text', () => {
        assert.equal(effectiveVarStoreName(readNode('a', { store: VAR_NEW_SENTINEL })), '');
        assert.equal(
            effectiveVarStoreName(readNode('a', { store: VAR_NEW_SENTINEL, customStore: '   ' })),
            ''
        );
    });

    it('ignores node types that do not name a namespace', () => {
        assert.equal(effectiveVarStoreName(mqttStoreNode('a', 'presets')), '');
        assert.equal(effectiveVarStoreName(null), '');
        assert.equal(effectiveVarStoreName(undefined), '');
    });

    it('resolves the variable name sentinel through its companion control', () => {
        assert.equal(effectiveVarName(readNode('a', { name: 'buf' })), 'buf');
        assert.equal(
            effectiveVarName(readNode('a', { name: VAR_NEW_SENTINEL, customName: ' temp ' })),
            'temp'
        );
        assert.equal(effectiveVarName(readNode('a', { name: VAR_NEW_SENTINEL })), '');
        assert.equal(effectiveVarName({}), '');
    });
});

describe('collectVarStores', () => {
    it('collects namespaces of every node type that names one, default first', () => {
        const nodes = [
            readNode('r1', { store: 'presets', name: 'temp' }),
            writeNode('w1', { store: 'presets', name: 'humidity' }),
            storeNode('s1', 'vars.var-store-save', 'logs'),
            storeNode('s2', 'vars.var-store-load', 'logs'),
            mqttStoreNode('m1', 'presets'),
        ];
        const stores = collectVarStores(collectionOf(graphOf(...nodes)));

        assert.deepEqual(stores, ['default', 'logs', 'presets']);
    });

    it('lists namespaces from every graph of the collection', () => {
        const collection = collectionOf(
            graphOf(readNode('r1', { store: 'alpha' })),
            graphOf(writeNode('w1', { store: 'beta' }))
        );

        assert.deepEqual(collectVarStores(collection), ['default', 'alpha', 'beta']);
    });

    it('falls back to the graph nodes when no collection is available', () => {
        const graph = graphOf(readNode('r1', { store: 'presets' }));

        assert.deepEqual(collectVarStores(null, graph), ['default', 'presets']);
    });

    it('filters reserved namespaces but keeps stored values readable', () => {
        const nodes = [readNode('r1', { store: '_webcontrol', name: 'hidden' })];
        const collection = collectionOf(graphOf(...nodes));

        assert.deepEqual(collectVarStores(collection), ['default']);
        // The name stays the node's stored value, but a plain name is not a declaration.
        assert.equal(effectiveVarName(nodes[0]), 'hidden');
        assert.deepEqual(collectVarNames(collection, null, '_webcontrol'), []);
    });

    it('resolves a sentinel namespace and ignores empty namespace controls', () => {
        const nodes = [
            readNode('r1', { store: VAR_NEW_SENTINEL, customStore: 'presets' }),
            mqttStoreNode('m1', ''),
            mqttStoreNode('m2', '   '),
            writeNode('w1', {}),
        ];

        assert.deepEqual(collectVarStores(collectionOf(graphOf(...nodes))), ['default', 'presets']);
    });

    it('de-duplicates namespaces and sorts them', () => {
        const nodes = [
            readNode('r1', { store: 'zeta' }),
            readNode('r2', { store: 'alpha' }),
            writeNode('w1', { store: 'zeta' }),
            writeNode('w2', { store: 'alpha' }),
        ];

        assert.deepEqual(collectVarStores(collectionOf(graphOf(...nodes))), [
            'default',
            'alpha',
            'zeta',
        ]);
    });

    it('returns only the default namespace for an empty or missing collection', () => {
        assert.deepEqual(collectVarStores(null), ['default']);
        assert.deepEqual(collectVarStores(undefined, null), ['default']);
        assert.deepEqual(collectVarStores(collectionOf(graphOf())), ['default']);
    });
});

describe('collectVarNames', () => {
    it('lists only declared variable names, sorted and de-duplicated', () => {
        const nodes = [
            readNode('r1', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'temp' }),
            writeNode('w1', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'humidity' }),
            readNode('r2', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'temp' }),
            readNode('r3', { store: 'other', name: VAR_NEW_SENTINEL, customName: 'pressure' }),
            readNode('r4', { store: 'presets', name: 'ghost' }),
        ];
        const collection = collectionOf(graphOf(...nodes));

        assert.deepEqual(collectVarNames(collection, null, 'presets'), ['humidity', 'temp']);
        assert.deepEqual(collectVarNames(collection, null, 'other'), ['pressure']);
    });

    it('never offers a name that only a reference node uses', () => {
        const nodes = [
            readNode('r1', { store: 'presets', name: 'temp' }),
            writeNode('w1', { store: 'presets', name: 'humidity' }),
        ];

        assert.deepEqual(collectVarNames(collectionOf(graphOf(...nodes)), null, 'presets'), []);
    });

    it('treats an unset namespace as the default namespace', () => {
        const nodes = [
            readNode('r1', { name: VAR_NEW_SENTINEL, customName: 'counter' }),
            writeNode('w1', { store: 'default', name: VAR_NEW_SENTINEL, customName: 'flag' }),
            readNode('r2', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'temp' }),
        ];
        const collection = collectionOf(graphOf(...nodes));

        assert.deepEqual(collectVarNames(collection, null, ''), ['counter', 'flag']);
        assert.deepEqual(collectVarNames(collection, null, DEFAULT_VAR_STORE), ['counter', 'flag']);
    });

    it('ignores a declare-mode node whose customName is empty', () => {
        const nodes = [
            readNode('r1', { store: 'presets', name: VAR_NEW_SENTINEL, customName: '   ' }),
            readNode('r2', { store: 'presets', name: VAR_NEW_SENTINEL }),
        ];

        assert.deepEqual(collectVarNames(collectionOf(graphOf(...nodes)), null, 'presets'), []);
    });

    it('resolves both sentinels before comparing namespaces', () => {
        const nodes = [
            readNode('r1', {
                store: VAR_NEW_SENTINEL,
                customStore: 'presets',
                name: VAR_NEW_SENTINEL,
                customName: 'typed',
            }),
        ];
        const collection = collectionOf(graphOf(...nodes));

        assert.deepEqual(collectVarNames(collection, null, 'presets'), ['typed']);
    });

    it('excludes the resolving node so a declaration never lists itself', () => {
        const nodes = [
            readNode('r1', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'temp' }),
            readNode('r2', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'humidity' }),
        ];
        const collection = collectionOf(graphOf(...nodes));

        assert.deepEqual(collectVarNames(collection, null, 'presets', 'r1'), ['humidity']);
        assert.deepEqual(collectVarNames(collection, null, 'presets'), ['humidity', 'temp']);
    });

    it('never offers the name input of var-store-save / var-store-load', () => {
        const nodes = [
            storeNode('s1', 'vars.var-store-save', 'presets'),
            storeNode('s2', 'vars.var-store-load', 'presets'),
            mqttStoreNode('m1', 'presets'),
        ];

        assert.deepEqual(collectVarNames(collectionOf(graphOf(...nodes)), null, 'presets'), []);
    });

    it('returns an empty list for an unknown namespace', () => {
        const collection = collectionOf(
            graphOf(readNode('r1', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'temp' }))
        );

        assert.deepEqual(collectVarNames(collection, null, 'missing'), []);
    });

    it('falls back to the graph nodes and tolerates missing arguments', () => {
        const graph = graphOf(
            readNode('r1', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'temp' })
        );

        assert.deepEqual(collectVarNames(null, graph, 'presets'), ['temp']);
        assert.deepEqual(collectVarNames(undefined, undefined, 'presets'), []);
        assert.deepEqual(collectVarNames(null, null, ''), []);
    });
});

describe('variable declaration detection', () => {
    it('detects a declaration site only with a sentinel name and a non-empty customName', () => {
        assert.equal(
            isVarNameDeclaration(readNode('r1', { name: VAR_NEW_SENTINEL, customName: 'x' })),
            true
        );
        assert.equal(
            isVarNameDeclaration(readNode('r1', { name: VAR_NEW_SENTINEL, customName: '' })),
            false
        );
        assert.equal(isVarNameDeclaration(readNode('r1', { name: 'x' })), false);
        assert.equal(
            isVarNameDeclaration(storeNode('s1', 'vars.var-store-save', 'presets')),
            false
        );
    });

    it('returns the declared store and name, or null when not declaring', () => {
        assert.deepEqual(
            declaredVarEntry(
                readNode('r1', { store: 'presets', name: VAR_NEW_SENTINEL, customName: 'temp' })
            ),
            { store: 'presets', name: 'temp' }
        );
        assert.equal(declaredVarEntry(readNode('r1', { name: 'temp' })), null);
    });
});

