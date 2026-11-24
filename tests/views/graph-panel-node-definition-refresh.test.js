// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppEventEmitter } from '../../src/micro_otter/nodes/html/js/core/app-event-emitter.js';
import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

class GraphStub extends AppEventEmitter {
    constructor(node) {
        super();
        this.id = 'graph-1';
        this.node = node;
        this.updateCalls = [];
    }

    getName() {
        return 'Graph 1';
    }

    getNodeIds() {
        return [this.node.getId()];
    }

    getNodes() {
        return [this.node];
    }

    getNode(nodeId) {
        return nodeId === this.node.getId() ? this.node : null;
    }

    getConnections() {
        return [];
    }

    updateNode(nodeId, patch) {
        if (nodeId !== this.node.getId()) {
            return null;
        }

        this.updateCalls.push({ nodeId, patch });
        Object.assign(this.node, patch);
        return this.node;
    }
}

describe('GraphPanelView node definition refresh', () => {
    it('does not emit startup model writes during GraphPanelView construction', () => {
        const node = new NodeData({
            id: 'node-startup',
            type: 'core.math',
            typeName: { en: 'Legacy Name' },
            controls: [],
            controlValues: {},
            inputs: [],
            outputs: [],
            inputDefaults: {},
        });

        const graph = new GraphStub(node);

        const runtime = {
            getNodeType(typeId) {
                if (typeId !== 'core.math') {
                    return null;
                }
                return {
                    title: { en: 'Math' },
                    icon: 'icons/calculate_24dp.svg',
                    color: '#6b8b9e',
                    inputs: [{ id: 'in0', name: { en: 'In 1' } }],
                    outputs: [{ id: 'out0', name: { en: 'Out' }, outputType: 'number' }],
                    controls: [
                        {
                            id: 'operation',
                            type: 'dropdown',
                            label: { en: 'Operation' },
                            defaultValue: 'add',
                            options: [{ value: 'add', label: { en: 'Add' } }],
                        },
                    ],
                };
            },
            getDeviceTarget() {
                return {
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                };
            },
        };

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        assert.equal(
            graph.updateCalls.length,
            0,
            'Expected no startup graph.updateNode writes during constructor path'
        );

        view.dispose();
    });

    it('refreshes existing node controls from runtime definition and preserves user values', () => {
        const node = new NodeData({
            id: 'node-1',
            type: 'core.math',
            typeName: { en: 'Math' },
            controls: [
                {
                    id: 'operation',
                    type: 'dropdown',
                    label: 'Operation',
                    options: [
                        { value: 'add', label: 'Add', activeInputs: ['in0', 'in1'] },
                        { value: 'subtract', label: 'Subtract', activeInputs: ['in0', 'in1'] },
                    ],
                },
            ],
            controlValues: {
                operation: 'subtract',
            },
            inputs: [
                { id: 'in0', name: 'In 1' },
                { id: 'in1', name: 'In 2' },
            ],
            outputs: [{ id: 'out0', name: 'Out' }],
            inputDefaults: {
                in0: 0,
                staleInput: 123,
            },
        });

        const graph = new GraphStub(node);

        const runtime = {
            getNodeType(typeId) {
                if (typeId !== 'core.math') {
                    return null;
                }
                return {
                    title: { en: 'Math' },
                    icon: 'icons/calculate_24dp.svg',
                    color: '#6b8b9e',
                    inputs: [
                        { id: 'in0', name: { en: 'In 1' } },
                        { id: 'in1', name: { en: 'In 2' } },
                    ],
                    outputs: [{ id: 'out0', name: { en: 'Out' } }],
                    controls: [
                        {
                            id: 'operation',
                            type: 'dropdown',
                            label: { en: 'Operation' },
                            defaultValue: 'add',
                            options: [
                                {
                                    value: 'add',
                                    label: { en: 'Add' },
                                    activeInputs: ['in0', 'in1'],
                                },
                                {
                                    value: 'modulus',
                                    label: { en: 'Modulus' },
                                    activeInputs: ['in0', 'in1'],
                                },
                                {
                                    value: 'fraction',
                                    label: { en: 'Fraction' },
                                    activeInputs: ['in0'],
                                    activeControls: [],
                                },
                            ],
                            affectsInputs: true,
                            affectsControls: true,
                        },
                        {
                            id: 'angleUnit',
                            type: 'dropdown',
                            label: { en: 'Angle Unit' },
                            defaultValue: 'degrees',
                            options: [
                                { value: 'degrees', label: { en: 'Degrees' } },
                                { value: 'radians', label: { en: 'Radians' } },
                            ],
                        },
                    ],
                };
            },
            getDeviceTarget() {
                return {
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                };
            },
        };

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.renderPanel = () => {};
        view._refreshExistingNodesFromRuntimeDefinitions();

        assert.equal(graph.updateCalls.length, 1);

        const operationControl = node.controls.find((control) => control.id === 'operation');
        assert.ok(operationControl, 'Expected operation control to exist after refresh');
        const optionValues = operationControl.options.map((option) => option.value);
        assert.ok(optionValues.includes('modulus'));
        assert.ok(optionValues.includes('fraction'));

        assert.equal(node.controlValues.operation, 'subtract');
        assert.equal(node.controlValues.angleUnit, 'degrees');

        assert.deepEqual(node.inputDefaults, { in0: 0 });

        view.dispose();
    });

    it('preserves localized connector and control labels during runtime refresh', () => {
        const node = new NodeData({
            id: 'node-locale',
            type: 'core.localized',
            typeName: { en: 'Localized', de: 'Lokalisiert' },
            controls: [
                {
                    id: 'mode',
                    type: 'dropdown',
                    label: 'Mode',
                    options: [{ value: 'a', label: 'A' }],
                },
            ],
            controlValues: { mode: 'a' },
            inputs: [{ id: 'in0', name: 'Input' }],
            outputs: [{ id: 'out0', name: 'Output' }],
            inputDefaults: {},
        });

        const graph = new GraphStub(node);

        const runtime = {
            getNodeType(typeId) {
                if (typeId !== 'core.localized') {
                    return null;
                }

                return {
                    title: { en: 'Localized', de: 'Lokalisiert' },
                    icon: 'icons/localized.svg',
                    color: '#123456',
                    inputs: [{ id: 'in0', name: { en: 'Input', de: 'Eingang' } }],
                    outputs: [{ id: 'out0', name: { en: 'Output', de: 'Ausgang' } }],
                    controls: [
                        {
                            id: 'mode',
                            type: 'dropdown',
                            label: { en: 'Mode', de: 'Modus' },
                            defaultValue: 'a',
                            options: [{ value: 'a', label: { en: 'A', de: 'A' } }],
                        },
                    ],
                };
            },
            getDeviceTarget() {
                return {
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                };
            },
        };

        const i18nService = {
            currentLocale: 'de',
            addEventListener: () => {},
            removeEventListener: () => {},
            t: (key) => key,
        };

        const view = new GraphPanelView({
            graph,
            i18nService,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });
        view._refreshExistingNodesFromRuntimeDefinitions();

        assert.equal(typeof node.inputs[0].name, 'object');
        assert.deepEqual(node.inputs[0].name, { en: 'Input', de: 'Eingang' });
        assert.equal(typeof node.outputs[0].name, 'object');
        assert.deepEqual(node.outputs[0].name, { en: 'Output', de: 'Ausgang' });
        assert.equal(typeof node.controls[0].label, 'object');
        assert.deepEqual(node.controls[0].label, { en: 'Mode', de: 'Modus' });

        view.dispose();
    });

    it('preserves control layout metadata during runtime refresh', () => {
        const node = new NodeData({
            id: 'node-layout',
            type: 'webview.web-root',
            typeName: { en: 'Web Root' },
            controls: [
                {
                    id: 'title',
                    type: 'text',
                    label: 'Page Title',
                },
            ],
            controlValues: { title: 'Home' },
            inputs: [],
            outputs: [{ id: 'root', name: 'Root' }],
            inputDefaults: {},
        });

        const graph = new GraphStub(node);

        const runtime = {
            getNodeType(typeId) {
                if (typeId !== 'webview.web-root') {
                    return null;
                }

                return {
                    title: { en: 'Web Root' },
                    icon: 'icons/web_root_24dp.svg',
                    color: '#8f5f86',
                    inputs: [],
                    outputs: [{ id: 'root', name: { en: 'Root' } }],
                    controls: [
                        {
                            id: 'title',
                            type: 'text',
                            label: { en: 'Page Title' },
                            layout: 'stacked',
                            defaultValue: 'Micro Otter',
                        },
                    ],
                };
            },
            getDeviceTarget() {
                return {
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                };
            },
        };

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });
        view._refreshExistingNodesFromRuntimeDefinitions();

        const titleControl = node.controls.find((control) => control.id === 'title');
        assert.ok(titleControl, 'Expected title control to exist after refresh');
        assert.equal(titleControl.layout, 'stacked');

        view.dispose();
    });

    it('normalizes existing node width from runtime width metadata during refresh', () => {
        const node = new NodeData({
            id: 'node-width',
            type: 'core.width-aware',
            typeName: { en: 'Width Aware' },
            width: 480,
            controls: [],
            controlValues: {},
            inputs: [],
            outputs: [],
            inputDefaults: {},
        });

        const graph = new GraphStub(node);

        const runtime = {
            getNodeType(typeId) {
                if (typeId !== 'core.width-aware') {
                    return null;
                }

                return {
                    title: { en: 'Width Aware' },
                    icon: 'icons/width_24dp.svg',
                    color: '#8f5f86',
                    controls: [],
                    inputs: [],
                    outputs: [],
                    defaultWidth: 200,
                    minWidth: 120,
                    maxWidth: 240,
                };
            },
            getDeviceTarget() {
                return {
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                };
            },
        };

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });
        view._refreshExistingNodesFromRuntimeDefinitions();

        assert.equal(node.width, 240);
        assert.equal(graph.updateCalls.length, 1);
        assert.equal(graph.updateCalls[0].patch.width, 240);

        view.dispose();
    });

    it('uses runtime width metadata when creating dropped nodes', () => {
        class DropGraphStub extends AppEventEmitter {
            constructor() {
                super();
                this.id = 'graph-drop';
                this.addedNodes = [];
            }

            getName() {
                return 'Graph Drop';
            }

            getNodeIds() {
                return [];
            }

            getNodes() {
                return [];
            }

            getConnections() {
                return [];
            }

            getNode() {
                return null;
            }

            addNode(node) {
                this.addedNodes.push(node);
                return node;
            }
        }

        const graph = new DropGraphStub();

        const runtime = {
            getNodeType(typeId) {
                if (typeId !== 'core.resizable') {
                    return null;
                }

                return {
                    title: { en: 'Resizable' },
                    icon: 'icons/resize_24dp.svg',
                    color: '#667788',
                    controls: [],
                    inputs: [],
                    outputs: [],
                    defaultWidth: 60,
                    minWidth: 90,
                    maxWidth: 180,
                };
            },
            getDeviceTarget() {
                return {
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                };
            },
        };

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.getCanvasPosScreenFromEvent = () => ({ x: 10, y: 20 });
        view.screenToWorld = () => ({ x: 100, y: 200 });
        view.clampToGrid = (x, y) => ({ x, y });
        view.syncNodeUisFromGraph = () => {};
        view.renderPanel = () => {};

        view.handleDrop({
            preventDefault: () => {},
            dataTransfer: {
                getData: () => JSON.stringify({ nodeTypeId: 'core.resizable' }),
            },
        });

        assert.equal(graph.addedNodes.length, 1);
        assert.equal(graph.addedNodes[0].width, 90);

        view.dispose();
    });

    it('applies keyboard-style width resize through shared clamped update path', () => {
        const node = new NodeData({
            id: 'node-keywidth',
            type: 'core.keywidth',
            typeName: { en: 'Keyboard Width' },
            width: 150,
            controls: [],
            controlValues: {},
            inputs: [],
            outputs: [],
            inputDefaults: {},
        });

        const graph = new GraphStub(node);

        const runtime = {
            getNodeType(typeId) {
                if (typeId !== 'core.keywidth') {
                    return null;
                }

                return {
                    title: { en: 'Keyboard Width' },
                    icon: 'icons/keywidth.svg',
                    color: '#557799',
                    controls: [],
                    inputs: [],
                    outputs: [],
                    defaultWidth: 150,
                    minWidth: 120,
                    maxWidth: 180,
                };
            },
            getDeviceTarget() {
                return {
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                };
            },
        };

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.renderPanel = () => {};
        graph.updateCalls.length = 0;
        view.selection.addToSelection('node-keywidth');

        view._resizeSelectedNodeWidths(50);

        assert.equal(node.width, 180);
        assert.ok(graph.updateCalls.length >= 1);
        assert.equal(graph.updateCalls[0].patch.width, 180);

        view.dispose();
    });
});
