import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

function makeDeployment(nodeTypes) {
    return new CollectionDeployment({
        deviceConnection: {
            async readTextFile() {
                return '';
            },
            async writeTextFile() {},
            async sendFile() {},
            async calculateHash() {
                return 'hash';
            },
            async softReset() {},
            async exitRawRepl() {},
            async deleteFile() {},
            async deleteFolderRecursive() {},
        },
        deviceState: {
            connected: true,
            runtimeInstalled: true,
            runtimeId: 'general',
            deviceTargetInfo: {
                id: 'esp32',
                capabilityToPins: { 'pwm.output': [5], 'adc.unit1': [5] },
                generalCapabilities: {},
                metadata: {},
            },
        },
        updateDeviceState() {},
        collectionManager: {
            getNodeType(typeId) {
                return nodeTypes[typeId] || null;
            },
        },
        runtimeCollection: {
            getRuntime() {
                return { id: 'general', getNodeType: () => null };
            },
        },
        transpiler: {},
    });
}

function makeCollection(nodes) {
    return {
        getTargetId() {
            return 'esp32';
        },
        getDeviceRuntimeId() {
            return 'general';
        },
        getGraphArray() {
            return [
                {
                    getId() {
                        return 'g1';
                    },
                    getNodes() {
                        return nodes;
                    },
                    getConnections() {
                        return [];
                    },
                },
            ];
        },
        getTitle() {
            return 'Graph Validation Collection';
        },
        getVersionString() {
            return '1.0.0';
        },
        getId() {
            return 'collection-graph-validation';
        },
    };
}

describe('CollectionDeployment graph resource validation', () => {
    it('surfaces a pin-function conflict across nodes', async () => {
        const deployment = makeDeployment({
            'type-a': {
                type: 'type-a',
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }],
            },
            'type-b': {
                type: 'type-b',
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'adc.unit1' }],
            },
        });

        const collection = makeCollection([
            { id: 'a', type: 'type-a', controlValues: { pin: 5 } },
            { id: 'b', type: 'type-b', controlValues: { pin: 5 } },
        ]);

        const errors = await deployment._validateNodePackages(
            collection,
            {},
            {
                id: 'esp32',
                capabilityToPins: { 'pwm.output': [5], 'adc.unit1': [5] },
                generalCapabilities: {},
                metadata: {},
            }
        );

        assert.ok(errors.some((error) => /multiple capabilities/.test(error.message)));
    });

    it('does not surface a conflict for same-capability reuse', async () => {
        const deployment = makeDeployment({
            'type-a': {
                type: 'type-a',
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }],
            },
            'type-b': {
                type: 'type-b',
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }],
            },
        });

        const collection = makeCollection([
            { id: 'a', type: 'type-a', controlValues: { pin: 5 } },
            { id: 'b', type: 'type-b', controlValues: { pin: 5 } },
        ]);

        const errors = await deployment._validateNodePackages(
            collection,
            {},
            {
                id: 'esp32',
                capabilityToPins: { 'pwm.output': [5] },
                generalCapabilities: {},
                metadata: {},
            }
        );

        assert.equal(errors.some((error) => /multiple capabilities/.test(error.message)), false);
    });

    it('flags a node package whose required general capability is unsupported', async () => {
        const deployment = makeDeployment({});
        const collection = makeCollection([]);

        const errors = await deployment._validateNodePackages(
            collection,
            { nodePackages: [{ id: 'audio', requiredCapabilities: ['viper'] }] },
            {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: {},
                metadata: {},
            }
        );

        assert.ok(errors.some((error) => /requires unsupported capability: viper/.test(error.message)));
    });

    it('does not flag a node package when its required capability is supported', async () => {
        const deployment = makeDeployment({});
        const collection = makeCollection([]);

        const errors = await deployment._validateNodePackages(
            collection,
            { nodePackages: [{ id: 'audio', requiredCapabilities: ['viper'] }] },
            {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: { viper: { supported: true } },
                metadata: {},
            }
        );

        assert.equal(
            errors.some((error) => /requires unsupported capability/.test(error.message)),
            false
        );
    });

    it('flags a node package whose required pin capability is unavailable', async () => {
        const deployment = makeDeployment({});
        const collection = makeCollection([]);

        const errors = await deployment._validateNodePackages(
            collection,
            { nodePackages: [{ id: 'audio', requiredCapabilities: ['i2s'] }] },
            {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: {},
                resources: {},
                metadata: {},
            }
        );

        assert.ok(
            errors.some((error) =>
                /requires unsupported capability: i2s/.test(error.message)
            )
        );
    });

    it('does not flag a node package whose required pin capability is available', async () => {
        const deployment = makeDeployment({});
        const collection = makeCollection([]);

        const errors = await deployment._validateNodePackages(
            collection,
            { nodePackages: [{ id: 'audio', requiredCapabilities: ['i2s'] }] },
            {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: {},
                resources: { i2s: { controllers: 2 } },
                metadata: {},
            }
        );

        assert.equal(
            errors.some((error) => /requires unsupported capability/.test(error.message)),
            false
        );
    });

    it('satisfies a node package OR-group when either capability is present', async () => {
        const deployment = makeDeployment({});
        const collection = makeCollection([]);

        const errors = await deployment._validateNodePackages(
            collection,
            { nodePackages: [{ id: 'webview', requiredCapabilities: [['wifi', 'ethernet']] }] },
            {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: { wifi: { supported: true } },
                metadata: {},
            }
        );

        assert.equal(
            errors.some((error) => /requires unsupported capability/.test(error.message)),
            false
        );
    });

    it('flags a node package OR-group when all capabilities are missing', async () => {
        const deployment = makeDeployment({});
        const collection = makeCollection([]);

        const errors = await deployment._validateNodePackages(
            collection,
            { nodePackages: [{ id: 'webview', requiredCapabilities: [['wifi', 'ethernet']] }] },
            {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: {},
                metadata: {},
            }
        );

        assert.ok(
            errors.some((error) =>
                /requires unsupported capability: wifi or ethernet/.test(error.message)
            )
        );
    });

    it('accepts function-graph-managed node types without a runtime definition', async () => {
        const deployment = makeDeployment({});
        const collection = makeCollection([
            { id: 'call', type: 'function_graph.graph-6' },
            { id: 'fn-input', type: 'graph.function.input' },
            { id: 'fn-output', type: 'graph.function.output' },
        ]);

        const errors = await deployment._validateNodePackages(
            collection,
            { nodePackages: [] },
            {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: {},
                metadata: {},
            }
        );

        assert.deepEqual(errors, []);
    });

    it('still reports a node type that no package provides', async () => {
        const deployment = makeDeployment({});
        const collection = makeCollection([
            { id: 'call', type: 'function_graph.graph-6' },
            { id: 'mystery', type: 'mystery.mystery-node' },
        ]);

        const errors = await deployment._validateNodePackages(
            collection,
            { nodePackages: [] },
            {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: {},
                metadata: {},
            }
        );

        assert.deepEqual(
            errors.map((error) => error.message),
            ['Node type not found: mystery.mystery-node']
        );
    });
});
