import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import NodePackage from '../../src/micro_otter/nodes/html/js/data/node-package.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';
import { registerRuntimeDataTypesForCollection } from '../../src/micro_otter/nodes/html/js/data/runtime-data-type-registration.js';

function createCollection() {
    return new Collection({
        id: generateUuidV4(),
        graphs: [new NodeGraph({ id: 'graph-1' })],
        activeGraphIdx: 0,
    });
}

function createJsonResponse(payload) {
    return {
        ok: true,
        json: async () => payload,
    };
}

function createFetchFromMap(payloadByUrl) {
    return async (input) => {
        const url = String(input);
        if (!payloadByUrl.has(url)) {
            return { ok: false, json: async () => ({}) };
        }
        return createJsonResponse(payloadByUrl.get(url));
    };
}

describe('registerRuntimeDataTypesForCollection', () => {
    it('registers package-defined data types into collection registry', () => {
        const collection = createCollection();
        const runtime = {
            nodePackages: [
                {
                    getDataTypes: () => ({
                        'web.element': {
                            name: { en: 'Web Element' },
                            description: { en: 'Web element reference' },
                            color: '#ff00ff',
                        },
                    }),
                },
            ],
        };

        const count = registerRuntimeDataTypesForCollection(collection, runtime);

        assert.equal(count, 1);
        assert.equal(collection.getDataType('web.element')?.color, '#ff00ff');
        assert.equal(collection.getDataType('web.element')?.kind, 'value');
    });

    it('applies default connection policy for package types without explicit policy', () => {
        const collection = createCollection();
        const runtime = {
            nodePackages: [
                {
                    getDataTypes: () => ({
                        'web.element': {
                            name: { en: 'Web Element' },
                            color: '#ff00ff',
                        },
                    }),
                },
            ],
        };

        registerRuntimeDataTypesForCollection(collection, runtime);

        assert.deepEqual(collection.getDataType('web.element')?.connectionPolicy, {
            input: { maxConnections: 1 },
            output: { maxConnections: 0 },
        });
    });

    it('preserves legacy behavior for package types without policy: output remains multi-connect', () => {
        const collection = createCollection();
        const graph = collection.getGraphArray()[0];

        registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [
                {
                    getDataTypes: () => ({
                        'legacy.element': {
                            name: { en: 'Legacy Element' },
                            color: '#ff00ff',
                        },
                    }),
                },
            ],
        });

        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'legacy.element' }],
        });
        const targetA = graph.addNode({
            id: 'targetA',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['legacy.element'] }],
        });
        const targetB = graph.addNode({
            id: 'targetB',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['legacy.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: targetA.id, toIndex: 0 });

        const secondValidation = graph.canConnect(source.id, 0, targetB.id, 0);
        assert.equal(secondValidation.valid, true);
    });

    it('preserves legacy behavior for package types without policy: input remains single-connect', () => {
        const collection = createCollection();
        const graph = collection.getGraphArray()[0];

        registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [
                {
                    getDataTypes: () => ({
                        'legacy.element': {
                            name: { en: 'Legacy Element' },
                            color: '#ff00ff',
                        },
                    }),
                },
            ],
        });

        const sourceA = graph.addNode({
            id: 'sourceA',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'legacy.element' }],
        });
        const sourceB = graph.addNode({
            id: 'sourceB',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'legacy.element' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['legacy.element'] }],
        });

        graph.addConnection({ fromNode: sourceA.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const secondValidation = graph.canConnect(sourceB.id, 0, target.id, 0);
        assert.equal(secondValidation.valid, false);
        assert.equal(
            secondValidation.message,
            "Input connection limit exceeded for type 'legacy.element': maxConnections=1, currentConnections=1"
        );
    });

    it('clears previously registered custom types before applying current runtime set', () => {
        const collection = createCollection();

        registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [
                {
                    getDataTypes: () => ({
                        'web.element': {
                            name: { en: 'Web Element' },
                            color: '#ff00ff',
                        },
                    }),
                },
            ],
        });

        assert.ok(collection.getDataType('web.element'));

        const count = registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [],
        });

        assert.equal(count, 0);
        assert.equal(collection.getDataType('web.element'), null);
        assert.ok(collection.getDataType('int'));
    });

    it('loads data_types.json policies through NodePackage into collection registry lookup', async () => {
        const webviewDataTypes = JSON.parse(
            readFileSync(
                path.resolve('src/micro_otter/nodes/device/node_pkgs/webview/data_types.json'),
                'utf8'
            )
        );
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/webview/manifest.json',
                    {
                        id: 'webview',
                        nodeDefs: 'node_definitions.json',
                        dataTypes: 'data_types.json',
                    },
                ],
                ['/device/node_pkgs/webview/node_definitions.json', { nodeTypes: {} }],
                ['/device/node_pkgs/webview/data_types.json', webviewDataTypes],
            ])
        );

        const nodePackage = new NodePackage('/device/node_pkgs/webview/');
        await nodePackage.load(fetchImpl);

        const collection = createCollection();
        const count = registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [nodePackage],
        });

        assert.equal(count, 2);
        assert.deepEqual(collection.getDataType('web.element')?.connectionPolicy, {
            input: { maxConnections: 1 },
            output: { maxConnections: 1 },
        });
        assert.equal(collection.getDataType('web.element')?.kind, 'structure');
    });

    it('blocks second outgoing web.element connection when package policy sets output maxConnections to 1', () => {
        const collection = createCollection();
        const graph = collection.getGraphArray()[0];

        registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [
                {
                    getDataTypes: () => ({
                        'web.element': {
                            name: { en: 'Web Element' },
                            color: '#ff00ff',
                            connectionPolicy: {
                                input: { maxConnections: 1 },
                                output: { maxConnections: 1 },
                            },
                        },
                    }),
                },
            ],
        });

        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const targetA = graph.addNode({
            id: 'targetA',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });
        const targetB = graph.addNode({
            id: 'targetB',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: targetA.id, toIndex: 0 });

        const secondValidation = graph.canConnect(source.id, 0, targetB.id, 0);
        assert.equal(secondValidation.valid, false);
        assert.equal(
            secondValidation.message,
            "Output connection limit exceeded for type 'web.element': maxConnections=1, currentConnections=1"
        );
    });
});
