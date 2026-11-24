import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';
import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';

class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this._connected = false;
        this._capabilityToPins = {};
        this._generalCapabilities = {};
    }

    setConnected(value) {
        this._connected = value;
    }

    setCapabilityMap(capabilityToPins) {
        this._capabilityToPins = capabilityToPins;
    }

    setGeneralCapabilities(generalCapabilities) {
        this._generalCapabilities = generalCapabilities;
    }

    isConnected() {
        return this._connected;
    }

    getState() {
        return this._connected ? 'connected' : 'disconnected';
    }

    async executeCode(code) {
        if (code.includes('print(1+1)')) {
            return '2';
        }
        return '3.4.0; MicroPython v1.22.1';
    }

    async loadDeviceInfo() {
        return {
            runtimeInstalled: true,
            runtimeId: 'general',
            runtimeName: 'General Runtime',
            runtimeVersion: '1.0.0',
            runtimeDescription: 'General runtime',
            runtimeCustomView: null,
            collectionDeployed: false,
            collectionName: null,
            collectionVersion: null,
            deviceTargetInfo: new DeviceTargetInfo({
                id: 'esp32',
                displayName: 'ESP32',
                capabilityToPins: this._capabilityToPins,
                generalCapabilities: this._generalCapabilities,
            }),
        };
    }

    getDeviceInfoData() {
        return null;
    }
}

function createCollection(nodeTypeId = 'stdmo-servo', pin = 5) {
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
                    getNodes() {
                        return [{ id: 'node-1', type: nodeTypeId, controlValues: { pin } }];
                    },
                },
            ];
        },
        getTitle() {
            return 'Capability Validation Collection';
        },
        getVersionString() {
            return '1.0.0';
        },
        getId() {
            return 'collection-1';
        },
    };
}

function createRuntimeCollection(nodeType, nodeTypeId = 'stdmo-servo') {
    return {
        getRuntime(runtimeId) {
            if (runtimeId !== 'general') {
                return null;
            }

            return {
                id: 'general',
                getNodeType(candidateId) {
                    return candidateId === nodeTypeId ? nodeType : null;
                },
                getDeviceTarget(targetId) {
                    if (targetId !== 'esp32') {
                        return null;
                    }
                    return { id: 'esp32', displayName: 'ESP32' };
                },
            };
        },
    };
}

function createViewManager() {
    return {
        async showFormDialog() {
            return { confirmed: false, formData: null };
        },
        async showError() {},
    };
}

function createCollectionWithGraph(graph) {
    return {
        getTargetId() {
            return 'esp32';
        },
        getDeviceRuntimeId() {
            return 'general';
        },
        getGraphArray() {
            return [graph];
        },
        getTitle() {
            return 'Connection Validation Collection';
        },
        getVersionString() {
            return '1.0.0';
        },
        getId() {
            return 'collection-graph-validation';
        },
    };
}

describe('capability validation migration coverage (stdmo capabilities)', () => {
    it('DeviceDeployment validateCollectionCompatibility reports compatible when required pwm capability is present', async () => {
        const connection = new MockDeviceConnection();
        connection.setCapabilityMap({ 'pwm.output': [5, 6, 7] });

        const nodeType = {
            requiredCapabilities: ['pwm.output'],
        };

        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => nodeType },
            runtimeCollection: createRuntimeCollection(nodeType),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const result = await deployment.validateCollectionCompatibility(createCollection());
        assert.equal(result.compatible, true);
        assert.deepEqual(result.errors, []);
    });

    it('DeviceDeployment validateCollectionCompatibility reports compatible when required viper (general) capability is supported', async () => {
        const connection = new MockDeviceConnection();
        connection.setGeneralCapabilities({ viper: { supported: true } });

        const nodeType = {
            requiredCapabilities: ['viper'],
        };

        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => nodeType },
            runtimeCollection: createRuntimeCollection(nodeType),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const result = await deployment.validateCollectionCompatibility(createCollection());
        assert.equal(result.compatible, true);
        assert.deepEqual(result.errors, []);
    });

    it('DeviceDeployment validateCollectionCompatibility ignores function-graph-managed node types', async () => {
        const connection = new MockDeviceConnection();
        connection.setCapabilityMap({ 'pwm.output': [5, 6, 7] });

        const nodeType = {
            requiredCapabilities: ['pwm.output'],
        };

        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => nodeType },
            runtimeCollection: createRuntimeCollection(nodeType),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const collection = createCollectionWithGraph({
            getNodes() {
                return [
                    { id: 'call', type: 'function_graph.graph-6' },
                    { id: 'fn-input', type: 'graph.function.input' },
                    { id: 'fn-output', type: 'graph.function.output' },
                    { id: 'servo', type: 'stdmo-servo', controlValues: { pin: 5 } },
                ];
            },
        });

        const result = await deployment.validateCollectionCompatibility(collection);
        assert.equal(result.compatible, true);
        assert.deepEqual(result.errors, []);
    });

    it('DeviceDeployment validateCollectionCompatibility still reports an unknown node type', async () => {
        const connection = new MockDeviceConnection();
        const nodeType = {};

        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => nodeType },
            runtimeCollection: createRuntimeCollection(nodeType),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const collection = createCollectionWithGraph({
            getNodes() {
                return [{ id: 'ghost', type: 'ghost.node' }];
            },
        });

        const result = await deployment.validateCollectionCompatibility(collection);
        assert.equal(result.compatible, false);
        assert.deepEqual(result.errors, ['Node type not found: ghost.node']);
    });

    it('DeviceDeployment validateCollectionCompatibility reports missing when required viper capability is not supported', async () => {
        const connection = new MockDeviceConnection();

        const nodeType = {
            requiredCapabilities: ['viper'],
        };

        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => nodeType },
            runtimeCollection: createRuntimeCollection(nodeType),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const result = await deployment.validateCollectionCompatibility(createCollection());
        assert.equal(result.compatible, false);
        assert.deepEqual(result.errors, ['Missing required capability for stdmo-servo: viper']);
    });

    it('derives a pin requirement from resourceUsage in the pre-deploy gate', async () => {
        const connection = new MockDeviceConnection();
        const nodeType = {
            controls: [{ id: 'pin' }],
            resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'dac' }],
        };

        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => nodeType },
            runtimeCollection: createRuntimeCollection(nodeType, 'core-dac-output'),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const result = await deployment.validateCollectionCompatibility(
            createCollection('core-dac-output', 25)
        );

        assert.equal(result.compatible, false);
        assert.deepEqual(result.errors, [
            'Missing required capability for core-dac-output: dac',
        ]);
    });

    it('accepts a derived pin requirement when the target exposes the capability', async () => {
        const connection = new MockDeviceConnection();
        connection.setCapabilityMap({ dac: [25, 26] });
        const nodeType = {
            controls: [{ id: 'pin' }],
            resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'dac' }],
        };

        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => nodeType },
            runtimeCollection: createRuntimeCollection(nodeType, 'core-dac-output'),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const result = await deployment.validateCollectionCompatibility(
            createCollection('core-dac-output', 25)
        );

        assert.equal(result.compatible, true);
        assert.deepEqual(result.errors, []);
    });

    it('evaluates a conditional requirement per node and reports it once', async () => {
        const connection = new MockDeviceConnection();
        const nodeType = {
            controls: [{ id: 'pin' }, { id: 'mode' }],
            resourceUsage: [
                {
                    kind: 'pin',
                    controlId: 'pin',
                    capability: 'dac',
                    requiredWhen: { controlId: 'mode', equals: 'output' },
                },
            ],
        };

        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => nodeType },
            runtimeCollection: createRuntimeCollection(nodeType, 'core-dac-output'),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const collection = {
            getTargetId() {
                return 'esp32';
            },
            getDeviceRuntimeId() {
                return 'general';
            },
            getGraphArray() {
                return [
                    {
                        getNodes() {
                            return [
                                {
                                    id: 'node-out',
                                    type: 'core-dac-output',
                                    controlValues: { pin: 25, mode: 'output' },
                                },
                                {
                                    id: 'node-in',
                                    type: 'core-dac-output',
                                    controlValues: { pin: 26, mode: 'input' },
                                },
                            ];
                        },
                    },
                ];
            },
        };

        const result = await deployment.validateCollectionCompatibility(collection);

        assert.equal(result.compatible, false);
        assert.deepEqual(result.errors, [
            'Missing required capability for core-dac-output: dac',
        ]);
    });

    it('CollectionDeployment prepareDeployCollection surfaces capability-check issue when selected pin does not support pwm', async () => {
        const previousChecks = globalThis.NodeCapabilityChecks;
        globalThis.NodeCapabilityChecks = {
            servoNode({ node, capabilities }) {
                const pin = node?.controlValues?.pin;
                const pwmPins = capabilities?.capabilityToPins?.['pwm.output'];
                if (Array.isArray(pwmPins) && pwmPins.includes(pin)) {
                    return [];
                }
                return [{ message: `Pin ${pin} does not support PWM` }];
            },
        };

        try {
            const deployment = new CollectionDeployment({
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
                        capabilityToPins: { 'pwm.output': [5, 6, 7] },
                    },
                },
                updateDeviceState() {},
                collectionManager: {
                    getNodeType(nodeTypeId) {
                        if (nodeTypeId !== 'stdmo-servo') {
                            return null;
                        }
                        return { capabilityCheck: 'NodeCapabilityChecks.servoNode' };
                    },
                },
                runtimeCollection: createRuntimeCollection({
                    capabilityCheck: 'NodeCapabilityChecks.servoNode',
                }),
                transpiler: {},
            });

            await assert.rejects(
                async () => {
                    await deployment.prepareDeployCollection(createCollection('stdmo-servo', 3));
                },
                {
                    message: /does not support PWM/i,
                }
            );
        } finally {
            globalThis.NodeCapabilityChecks = previousChecks;
        }
    });

    it('CollectionDeployment preflight reuses graph.canConnect cardinality errors', async () => {
        const graph = NodeGraph.fromData({
            id: 'graph-cardinality-invalid',
            nodes: [
                {
                    id: 'sourceA',
                    type: 'source-node',
                    outputs: [{ id: 'out0', outputType: 'web.element' }],
                },
                {
                    id: 'sourceB',
                    type: 'source-node',
                    outputs: [{ id: 'out0', outputType: 'web.element' }],
                },
                {
                    id: 'target',
                    type: 'target-node',
                    inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
                },
            ],
            connections: [
                { fromNode: 'sourceA', fromIndex: 0, toNode: 'target', toIndex: 0 },
                { fromNode: 'sourceB', fromIndex: 0, toNode: 'target', toIndex: 0 },
            ],
        });

        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        input: { maxConnections: 1 },
                    },
                };
            }
            return null;
        });

        const editorValidation = graph.canConnect('sourceB', 0, 'target', 0, {
            allowExistingConnectionMatch: true,
        });
        assert.equal(editorValidation.valid, false);
        assert.ok(editorValidation.message);

        const deployment = new CollectionDeployment({
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
                    capabilityToPins: {},
                },
            },
            updateDeviceState() {},
            collectionManager: {
                getNodeType() {
                    return {};
                },
            },
            runtimeCollection: {
                getRuntime() {
                    return { id: 'general' };
                },
            },
            transpiler: {},
        });

        await assert.rejects(
            async () => {
                await deployment._validateCollectionCompatibility(createCollectionWithGraph(graph));
            },
            {
                message: new RegExp(editorValidation.message),
            }
        );
    });

    it('CollectionDeployment preflight rejects structure-kind connection to wildcard value input', async () => {
        const graph = NodeGraph.fromData({
            id: 'graph-structure-kind-invalid',
            nodes: [
                {
                    id: 'sourceElement',
                    type: 'source-node',
                    outputs: [{ id: 'out0', outputType: 'web.element' }],
                },
                {
                    id: 'targetAny',
                    type: 'target-node',
                    inputs: [{ id: 'in0', allowedTypes: ['any'] }],
                },
            ],
            connections: [
                { fromNode: 'sourceElement', fromIndex: 0, toNode: 'targetAny', toIndex: 0 },
            ],
        });

        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return { kind: 'structure' };
            }
            return { kind: 'value' };
        });

        const editorValidation = graph.canConnect('sourceElement', 0, 'targetAny', 0, {
            allowExistingConnectionMatch: true,
        });
        assert.equal(editorValidation.valid, false);
        assert.match(editorValidation.message, /Type mismatch/);

        const deployment = new CollectionDeployment({
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
                    capabilityToPins: {},
                },
            },
            updateDeviceState() {},
            collectionManager: {
                getNodeType() {
                    return {};
                },
            },
            runtimeCollection: {
                getRuntime() {
                    return { id: 'general' };
                },
            },
            transpiler: {},
        });

        await assert.rejects(
            async () => {
                await deployment._validateCollectionCompatibility(createCollectionWithGraph(graph));
            },
            (error) => {
                assert.match(
                    error.message,
                    /Type mismatch: Cannot connect 'web\.element' to input accepting \[any\]/
                );
                return true;
            }
        );
    });

    it('CollectionDeployment prepareDeployCollection surfaces capability-check issue when capability map is missing', async () => {
        const previousChecks = globalThis.NodeCapabilityChecks;
        globalThis.NodeCapabilityChecks = {
            servoNode({ capabilities }) {
                const pwmPins = capabilities?.capabilityToPins?.['pwm.output'];
                if (Array.isArray(pwmPins)) {
                    return [];
                }
                return [{ message: 'Device target does not advertise PWM capability map' }];
            },
        };

        try {
            const deployment = new CollectionDeployment({
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
                    },
                },
                updateDeviceState() {},
                collectionManager: {
                    getNodeType(nodeTypeId) {
                        if (nodeTypeId !== 'stdmo-servo') {
                            return null;
                        }
                        return { capabilityCheck: 'NodeCapabilityChecks.servoNode' };
                    },
                },
                runtimeCollection: createRuntimeCollection({
                    capabilityCheck: 'NodeCapabilityChecks.servoNode',
                }),
                transpiler: {},
            });

            await assert.rejects(
                async () => {
                    await deployment.prepareDeployCollection(createCollection('stdmo-servo', 5));
                },
                {
                    message: /does not advertise PWM capability map/i,
                }
            );
        } finally {
            globalThis.NodeCapabilityChecks = previousChecks;
        }
    });

    it('CollectionDeployment validation no longer bypasses for the removed custom target id', async () => {
        const deployment = new CollectionDeployment({
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
                    id: 'custom',
                    capabilityToPins: {},
                    metadata: {},
                },
            },
            updateDeviceState() {},
            collectionManager: {
                getNodeType(nodeTypeId) {
                    if (nodeTypeId !== 'stdmo-servo') {
                        return null;
                    }
                    return { requiredCapabilities: ['pwm.output'] };
                },
            },
            runtimeCollection: createRuntimeCollection({ requiredCapabilities: ['pwm.output'] }),
            transpiler: {},
        });

        await assert.rejects(async () => {
            await deployment._validateCollectionCompatibility(createCollection('stdmo-servo', 3));
        });
    });

    it('CollectionDeployment validation bypasses required capabilities when target metadata marks custom', async () => {
        const deployment = new CollectionDeployment({
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
                    capabilityToPins: {},
                    metadata: { isCustomTarget: true },
                },
            },
            updateDeviceState() {},
            collectionManager: {
                getNodeType(nodeTypeId) {
                    if (nodeTypeId !== 'stdmo-servo') {
                        return null;
                    }
                    return { requiredCapabilities: ['pwm.output'] };
                },
            },
            runtimeCollection: createRuntimeCollection({ requiredCapabilities: ['pwm.output'] }),
            transpiler: {},
        });

        await assert.doesNotReject(async () => {
            await deployment._validateCollectionCompatibility(createCollection('stdmo-servo', 3));
        });
    });

    it('CollectionDeployment validation reports the declaration beside a silent capabilityCheck', async () => {
        const previousChecks = globalThis.NodeCapabilityChecks;
        globalThis.NodeCapabilityChecks = {
            servoNode() {
                return [];
            },
        };

        try {
            const deployment = new CollectionDeployment({
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
                        capabilityToPins: {},
                        metadata: {},
                    },
                },
                updateDeviceState() {},
                collectionManager: {
                    getNodeType(nodeTypeId) {
                        if (nodeTypeId !== 'stdmo-servo') {
                            return null;
                        }
                        return {
                            requiredCapabilities: ['pwm.output'],
                            capabilityCheck: 'NodeCapabilityChecks.servoNode',
                        };
                    },
                },
                runtimeCollection: createRuntimeCollection({
                    requiredCapabilities: ['pwm.output'],
                    capabilityCheck: 'NodeCapabilityChecks.servoNode',
                }),
                transpiler: {},
            });

            await assert.rejects(
                async () => {
                    await deployment._validateCollectionCompatibility(
                        createCollection('stdmo-servo', 3)
                    );
                },
                {
                    message: /Missing required capability: pwm\.output/,
                }
            );
        } finally {
            globalThis.NodeCapabilityChecks = previousChecks;
        }
    });
});

describe('webview package capability inheritance', () => {
    function createDeployment() {
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
                deviceTargetInfo: { id: 'esp32' },
            },
            updateDeviceState() {},
            collectionManager: {
                getNodeType(nodeTypeId) {
                    return { type: nodeTypeId };
                },
            },
            runtimeCollection: {
                getRuntime() {
                    return null;
                },
            },
            transpiler: {},
        });
    }

    function makeCollection(nodeTypeIds) {
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
                            return 'graph-capabilities';
                        },
                        getNodes() {
                            return nodeTypeIds.map((type, index) => ({
                                id: `n${index}`,
                                type,
                            }));
                        },
                        getConnections() {
                            return [];
                        },
                    },
                ];
            },
        };
    }

    it('keeps the package-level wifi/ethernet requirement for the store nodes', async () => {
        const deployment = createDeployment();
        const runtime = {
            nodePackages: [{ id: 'webview', requiredCapabilities: [['wifi', 'ethernet']] }],
        };
        const targetInfo = {
            id: 'esp32',
            capabilityToPins: {},
            generalCapabilities: {},
            metadata: {},
        };

        const errors = await deployment._validateNodePackages(
            makeCollection([
                'webview.web-store-read',
                'webview.web-store-write',
                'webview.web-store-save',
                'webview.web-store-load',
            ]),
            runtime,
            targetInfo
        );

        assert.ok(
            errors.some(
                (error) =>
                    error.message.includes("'webview'") &&
                    error.message.includes('wifi or ethernet')
            ),
            'Expected the package-level capability requirement to be reported'
        );
        assert.ok(
            !errors.some((error) => String(error.message).includes('web-store')),
            'The store nodes must not add node-level capability rules'
        );
    });

    it('accepts the store nodes when the target advertises ethernet', async () => {
        const deployment = createDeployment();
        const runtime = {
            nodePackages: [{ id: 'webview', requiredCapabilities: [['wifi', 'ethernet']] }],
        };
        const targetInfo = {
            id: 'esp32',
            capabilityToPins: {},
            generalCapabilities: { ethernet: { supported: true } },
            metadata: {},
        };

        const errors = await deployment._validateNodePackages(
            makeCollection(['webview.web-store-read']),
            runtime,
            targetInfo
        );

        assert.equal(
            errors.filter((error) => error.message.includes("'webview'")).length,
            0
        );
    });
});

