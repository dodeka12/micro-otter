import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import NodePackage from '../../src/micro_otter/nodes/html/js/data/node-package.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';
import { registerRuntimeDataTypesForCollection } from '../../src/micro_otter/nodes/html/js/data/runtime-data-type-registration.js';
import { resolveTypeCompatibility } from '../../src/micro_otter/nodes/html/js/data/type-conversions.js';

const manifestPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/core/manifest.json');
const dataTypesPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/data_types.json'
);

/**
 * Create a JSON fetch response double.
 * @param {unknown} payload - Parsed JSON payload returned by the response.
 * @returns {object} Fetch-like response with `ok` and `json`.
 */
function createJsonResponse(payload) {
    return {
        ok: true,
        json: async () => payload,
    };
}

/**
 * Create a fetch double backed by a URL-to-payload map.
 * @param {Map<string, unknown>} payloadByUrl - Payload keyed by request URL.
 * @returns {(input: unknown) => Promise<object>} Fetch-like function returning mapped payloads.
 */
function createFetchFromMap(payloadByUrl) {
    return async (input) => {
        const url = String(input);
        if (!payloadByUrl.has(url)) {
            return { ok: false, json: async () => ({}) };
        }
        return createJsonResponse(payloadByUrl.get(url));
    };
}

/**
 * Build a collection with one empty graph.
 * @returns {Collection} Collection instance.
 */
function createCollection() {
    return new Collection({
        id: generateUuidV4(),
        graphs: [new NodeGraph({ id: 'graph-1' })],
        activeGraphIdx: 0,
    });
}

/**
 * Read the declared core tuple data type from the package JSON file.
 * @returns {object|null} The `core.tuple` declaration or null when missing.
 */
function readCoreTupleType() {
    const dataTypes = JSON.parse(readFileSync(dataTypesPath, 'utf8'));
    return dataTypes.types?.['core.tuple'];
}

describe('core package data types', () => {
    it('declares a data types file in the manifest', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.equal(manifest.dataTypes, 'data_types.json');
    });

    it('bumps the package version past the pre-tuple release', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
        const parsed = manifest.version.split('.').map((part) => Number(part));
        const previous = [1, 13, 0];
        const isGreater =
            parsed[0] > previous[0] ||
            (parsed[0] === previous[0] &&
                (parsed[1] > previous[1] ||
                    (parsed[1] === previous[1] && parsed[2] > previous[2])));
        assert.equal(isGreater, true);
    });

    it('registers core.tuple as a value kind with bilingual metadata', () => {
        const tupleType = readCoreTupleType();
        assert.ok(tupleType);
        assert.equal(tupleType.kind, 'value');
        assert.equal(tupleType.color, '#9b7ad6');
        assert.equal(tupleType.name.en, 'Tuple');
        assert.equal(tupleType.name.de, 'Tupel');
        assert.equal(tupleType.description.en.length > 0, true);
        assert.equal(tupleType.description.de.length > 0, true);
        assert.deepEqual(tupleType.connectionPolicy, {
            input: { maxConnections: 1 },
            output: { maxConnections: 0 },
        });
    });

    it('loads core.tuple through NodePackage', async () => {
        const coreDataTypes = JSON.parse(readFileSync(dataTypesPath, 'utf8'));
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/core/manifest.json',
                    {
                        id: 'core',
                        nodeDefs: 'node_definitions.json',
                        dataTypes: 'data_types.json',
                    },
                ],
                ['/device/node_pkgs/core/node_definitions.json', { nodeTypes: {} }],
                ['/device/node_pkgs/core/data_types.json', coreDataTypes],
            ])
        );

        const pkg = new NodePackage('/device/node_pkgs/core/');
        await pkg.load(fetchImpl);

        const dataTypes = pkg.getDataTypes();
        assert.equal(dataTypes['core.tuple']?.kind, 'value');
        assert.equal(dataTypes['core.tuple']?.color, '#9b7ad6');
        assert.equal(dataTypes['core.tuple']?.name?.de, 'Tupel');
        assert.deepEqual(dataTypes['core.tuple']?.connectionPolicy, {
            input: { maxConnections: 1 },
            output: { maxConnections: 0 },
        });
    });

    it('needs no conversion for exact tuple matches', () => {
        const compatibility = resolveTypeCompatibility('core.tuple', ['core.tuple']);
        assert.equal(compatibility.compatible, true);
        assert.equal(compatibility.targetType, 'core.tuple');
        assert.equal(compatibility.requiresImplicitConversion, false);
    });

    it('accepts any targets because core.tuple is a value kind', () => {
        const compatibility = resolveTypeCompatibility('core.tuple', ['any']);
        assert.equal(compatibility.compatible, true);
        assert.equal(compatibility.targetType, 'any');
        assert.equal(compatibility.requiresImplicitConversion, false);
    });

    it('rejects tuple to scalar and scalar to tuple comparisons', () => {
        assert.equal(resolveTypeCompatibility('core.tuple', ['float']).compatible, false);
        assert.equal(resolveTypeCompatibility('float', ['core.tuple']).compatible, false);
    });
});


describe('core.tuple registration and connection policy', () => {
    it('reaches the collection registry with its explicit policy', () => {
        const collection = createCollection();
        const coreTypes = JSON.parse(readFileSync(dataTypesPath, 'utf8')).types;

        const count = registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [{ getDataTypes: () => coreTypes }],
        });

        assert.equal(count, 1);
        assert.equal(collection.getDataType('core.tuple')?.kind, 'value');
        assert.deepEqual(collection.getDataType('core.tuple')?.connectionPolicy, {
            input: { maxConnections: 1 },
            output: { maxConnections: 0 },
        });
    });

    it('blocks a second tuple source on one tuple input', () => {
        const collection = createCollection();
        const graph = collection.getGraphArray()[0];
        const coreTypes = JSON.parse(readFileSync(dataTypesPath, 'utf8')).types;

        registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [{ getDataTypes: () => coreTypes }],
        });

        const sourceA = graph.addNode({
            id: 'sourceA',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'core.tuple' }],
        });
        const sourceB = graph.addNode({
            id: 'sourceB',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'core.tuple' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['core.tuple'] }],
        });

        graph.addConnection({
            fromNode: sourceA.id,
            fromIndex: 0,
            toNode: target.id,
            toIndex: 0,
        });

        const secondValidation = graph.canConnect(sourceB.id, 0, target.id, 0);
        assert.equal(secondValidation.valid, false);
        assert.equal(
            secondValidation.message,
            "Input connection limit exceeded for type 'core.tuple': maxConnections=1, currentConnections=1"
        );
    });

    it('allows one tuple output to fan out to two tuple inputs', () => {
        const collection = createCollection();
        const graph = collection.getGraphArray()[0];
        const coreTypes = JSON.parse(readFileSync(dataTypesPath, 'utf8')).types;

        registerRuntimeDataTypesForCollection(collection, {
            nodePackages: [{ getDataTypes: () => coreTypes }],
        });

        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'core.tuple' }],
        });
        const targetA = graph.addNode({
            id: 'targetA',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['core.tuple'] }],
        });
        const targetB = graph.addNode({
            id: 'targetB',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['core.tuple'] }],
        });

        graph.addConnection({
            fromNode: source.id,
            fromIndex: 0,
            toNode: targetA.id,
            toIndex: 0,
        });

        const secondValidation = graph.canConnect(source.id, 0, targetB.id, 0);
        assert.equal(secondValidation.valid, true);
    });
});

