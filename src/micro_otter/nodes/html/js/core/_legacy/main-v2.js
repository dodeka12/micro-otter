// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Minimal bootstrap for the v2 refactor: renders a single graph from the new
 * Workspace/Collection/NodeGraph data layer without touching legacy globals.
 */
import { EnvironmentV2 } from './environment-v2.js';
import { Workspace } from '../data/workspace.js';
import { CollectionStore } from '../data/collection-store.js';
import { debugLog } from '../core/debug.js';
import { PaletteV2 } from './palette-v2.js';
import { GraphPanelUiV2 } from './graph-panel-ui-v2.js';

const RUNTIME_COLLECTION_ROOT = '/device/runtime';

class MicroOtterApp {
    constructor() {
        this.state = {
            env: null,
            workspace: null,
            selectedNodeId: null,
            overlay: null,
        };
        this.started = false;
        this.palette = null;
        this.graphPanelUi = null;
        this.canvas = null;
        this.readabilityCanvas = null;
        this._resizeHandler = null;
    }

    async initialize() {
        if (this.started) {
            return;
        }
        this.started = true;
        // this.state.env = new EnvironmentV2({ enableReadabilityCanvas: false });

        this.palette = new PaletteV2({
            onCreate: (typeId, position) => this.createNode(typeId, position),
        });
        this.palette.attach();

        this.state.workspace = new Workspace();
        await this.state.workspace.load().catch((error) => {
            console.warn('[main-v2] Failed to load workspace from store', error);
        });
        const graph = this.state.workspace.getActiveGraph();
        debugLog('main_v2', 'Loaded workspace with graph ID:', graph?.getId());

        if (graph && (!graph.getNodes || graph.getNodes().length === 0)) {
            graph.addNode({
                type: 'const',
                title: 'Const 1',
                x: 0,
                y: 0,
                width: 150,
                height: 100,
            });
            // graph.addNode({
            //     type: 'math',
            //     title: 'Math 2',
            //     x: 360,
            //     y: 160,
            //     width: 140,
            //     height: 90,
            // });
            // graph.addConnection({ fromNode: 1, fromIndex: 0, toNode: 2, toIndex: 0 });
        }

        this.graphPanelUi = new GraphPanelUiV2({
            graph: graph,
            container: typeof document !== 'undefined' ? document.body : null,
            enableReadabilityCanvas: false,
            onSelect: (nodeId) => {
                this.state.selectedNodeId = nodeId;
            },
        });
        // this.graphPanelUi.attach();

        const handleGraphChange = () => {
            this.graphPanelUi?.renderPanel();
        };

        const activeCollection = this.state.workspace.getActiveCollection();
        if (activeCollection) {
            activeCollection.onGraphChange(handleGraphChange);
        }
        this.state.workspace.onChange((event) => {
            if (event?.type === 'collectionChanged') {
                handleGraphChange();
            }
        }, 'MicroOtterAppWorkspaceListener');

        this.graphPanelUi.renderPanel();
        this.registerAdminHelpers();
    }

    createNode(typeId, position = null) {
        const graph = this.state.workspace?.getActiveGraph?.();
        if (!graph) {
            return null;
        }
        const nodeTitle = (typeId || 'Node').charAt(0).toUpperCase() + (typeId || 'Node').slice(1);
        const pos = position || { x: 120, y: 120 };
        const node = graph.addNode({
            type: typeId || 'default',
            title: nodeTitle,
            x: pos.x,
            y: pos.y,
            width: 150,
            height: 100,
        });
        this.state.selectedNodeId = node?.id ?? null;
        this.graphPanelUi?.renderPanel?.();
        return node;
    }

    render() {
        this.graphPanelUi?.renderPanel?.();
    }

    registerAdminHelpers() {
        const store = new CollectionStore();
        const admin = {
            /**
             * Clears all stored collections from IndexedDB. Use with care.
             */
            clearCollections: async () => {
                await store.clearCollections();
                // eslint-disable-next-line no-console
            },
        };

        globalThis.microOtterAdmin = admin;
    }
}

export const microOtterApp = new MicroOtterApp();

function bootstrap() {
    microOtterApp.initialize();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
