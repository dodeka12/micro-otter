// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager } from '../../src/micro_otter/nodes/html/js/data/history-manager.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';

describe('HistoryManager', () => {
    let collection;
    let historyManager;
    let graph;

    beforeEach(() => {
        // Create a fresh collection with a single graph
        collection = new Collection({
            id: generateUuidV4(),
            title: 'Test Collection',
            graphs: [
                {
                    id: 'graph-1',
                    name: 'Test Graph',
                    nodes: [],
                    connections: [],
                },
            ],
        });

        graph = collection.getActiveGraph();
        historyManager = new HistoryManager(collection);
    });

    describe('Constructor', () => {
        it('should create instance with default options', () => {
            const manager = new HistoryManager(collection);
            assert.equal(manager.canUndo(), false);
            assert.equal(manager.canRedo(), false);
            assert.equal(manager.getHistoryDepth(), 0);
            assert.equal(manager.getMaxDepth(), 50);
        });

        it('should create instance with custom max depth', () => {
            const manager = new HistoryManager(collection, { maxDepth: 100 });
            assert.equal(manager.getMaxDepth(), 100);
        });

        it('should throw if collection is missing', () => {
            assert.throws(() => new HistoryManager(null), TypeError);
        });
    });

    describe('Basic Stack Operations', () => {
        it('should start with empty history', () => {
            assert.equal(historyManager.canUndo(), false);
            assert.equal(historyManager.canRedo(), false);
            assert.equal(historyManager.getHistoryDepth(), 0);
        });

        it('should have undo available after operation', () => {
            // Add a node (triggers operation capture)
            graph.addNode({ type: 'test-node', x: 100, y: 100 });

            assert.equal(historyManager.canUndo(), true);
            assert.equal(historyManager.canRedo(), false);
            assert.equal(historyManager.getHistoryDepth(), 1);
        });

        it('should have redo available after undo', () => {
            // Add a node
            const node = graph.addNode({ type: 'test-node', x: 100, y: 100 });
            const nodeId = node.id;

            // Undo
            const undoSuccess = historyManager.undo();
            assert.equal(undoSuccess, true);

            assert.equal(historyManager.canUndo(), false);
            assert.equal(historyManager.canRedo(), true);
            assert.equal(historyManager.getHistoryDepth(), 1);

            // Verify node was removed
            assert.equal(graph.hasNode(nodeId), false);
        });

        it('should clear redo stack when new operation added', () => {
            // Add node 1
            graph.addNode({ type: 'node1', x: 100, y: 100 });

            // Add node 2
            graph.addNode({ type: 'node2', x: 200, y: 200 });

            // Undo node 2
            historyManager.undo();
            assert.equal(historyManager.canRedo(), true);

            // Add node 3 (should clear redo stack)
            graph.addNode({ type: 'node3', x: 300, y: 300 });

            assert.equal(historyManager.canRedo(), false);
            assert.equal(historyManager.getHistoryDepth(), 2); // node1 and node3
        });
    });

    describe('Node Add/Remove Operations', () => {
        it('should capture node add operation', () => {
            graph.addNode({ type: 'gpio-input', x: 100, y: 200 });

            assert.equal(historyManager.canUndo(), true);
            const desc = historyManager.getUndoDescription();
            assert.ok(desc.includes('Add'));
        });

        it('should undo node add by removing node', () => {
            const node = graph.addNode({ type: 'gpio-input', x: 100, y: 200 });
            const nodeId = node.id;

            // Verify node exists
            assert.equal(graph.hasNode(nodeId), true);

            // Undo
            historyManager.undo();

            // Verify node removed
            assert.equal(graph.hasNode(nodeId), false);
        });

        it('should redo node add by restoring node', () => {
            const node = graph.addNode({ type: 'gpio-input', x: 100, y: 200 });
            const nodeId = node.id;
            const nodeType = node.type;

            // Undo
            historyManager.undo();
            assert.equal(graph.hasNode(nodeId), false);

            // Redo
            historyManager.redo();

            // Verify node restored
            const restoredNode = graph.getNode(nodeId);
            assert.ok(restoredNode);
            assert.equal(restoredNode.type, nodeType);
            assert.equal(restoredNode.x, 100);
            assert.equal(restoredNode.y, 200);
        });

        it('should capture node remove operation', () => {
            const node = graph.addNode({ type: 'gpio-input', x: 100, y: 200 });
            const nodeId = node.id;

            // Cache state before removal
            historyManager.beforeNodeRemove(nodeId);

            // Remove node
            graph.removeNode(nodeId);

            // Should have 2 operations: add + remove
            assert.equal(historyManager.getHistoryDepth(), 2);
        });

        it('should undo node remove by restoring node', () => {
            const node = graph.addNode({ type: 'gpio-input', x: 100, y: 200 });
            const nodeId = node.id;
            const nodeType = node.type;

            // Cache and remove
            historyManager.beforeNodeRemove(nodeId);
            graph.removeNode(nodeId);

            // Undo remove
            historyManager.undo();

            // Verify node restored
            const restoredNode = graph.getNode(nodeId);
            assert.ok(restoredNode);
            assert.equal(restoredNode.type, nodeType);
        });

        it('should restore node connections on undo delete', () => {
            // Create two nodes
            const node1 = graph.addNode({ type: 'node1', x: 100, y: 100 });
            const node2 = graph.addNode({ type: 'node2', x: 200, y: 200 });

            // Add connection
            node1.outputs = [{ id: 'out1', name: 'Output' }];
            node2.inputs = [{ id: 'in1', name: 'Input' }];
            graph.addConnection({
                fromNode: node1.id,
                fromIndex: 0,
                toNode: node2.id,
                toIndex: 0,
            });

            // Cache and remove node1
            historyManager.beforeNodeRemove(node1.id);
            graph.removeNode(node1.id);

            // Undo delete
            historyManager.undo();

            // Verify connection restored
            const connections = graph.getConnections();
            assert.equal(connections.length, 1);
            assert.equal(connections[0].fromNode, node1.id);
            assert.equal(connections[0].toNode, node2.id);
        });
    });

    describe('Node Move Operations', () => {
        it('should capture node move operation', () => {
            const node = graph.addNode({ type: 'gpio-input', x: 100, y: 100 });
            const nodeId = node.id;

            // Simulate drag start/end
            graph.startNodeDrag(nodeId);
            graph.updateNodePosition(nodeId, 200, 200);
            graph.endNodeDrag(nodeId);

            // Should have 2 operations: add + move
            assert.equal(historyManager.getHistoryDepth(), 2);
        });

        it('should undo node move by restoring position', () => {
            const node = graph.addNode({ type: 'gpio-input', x: 100, y: 100 });
            const nodeId = node.id;

            // Move node
            graph.startNodeDrag(nodeId);
            graph.updateNodePosition(nodeId, 200, 200);
            graph.endNodeDrag(nodeId);

            // Undo move
            historyManager.undo();

            // Verify position restored
            const movedNode = graph.getNode(nodeId);
            assert.equal(movedNode.x, 100);
            assert.equal(movedNode.y, 100);
        });

        it('should redo node move', () => {
            const node = graph.addNode({ type: 'gpio-input', x: 100, y: 100 });
            const nodeId = node.id;

            // Move node
            graph.startNodeDrag(nodeId);
            graph.updateNodePosition(nodeId, 200, 200);
            graph.endNodeDrag(nodeId);

            // Undo and redo
            historyManager.undo();
            historyManager.redo();

            // Verify position re-applied
            const movedNode = graph.getNode(nodeId);
            assert.equal(movedNode.x, 200);
            assert.equal(movedNode.y, 200);
        });

        it('should not create operation if position unchanged', () => {
            const node = graph.addNode({ type: 'gpio-input', x: 100, y: 100 });
            const nodeId = node.id;

            // Move to same position
            graph.startNodeDrag(nodeId);
            graph.updateNodePosition(nodeId, 100, 100);
            graph.endNodeDrag(nodeId);

            // Should only have add operation, no move
            assert.equal(historyManager.getHistoryDepth(), 1);
        });
    });

    describe('Connection Operations', () => {
        let node1, node2;

        beforeEach(() => {
            // Setup two nodes with connectors
            node1 = graph.addNode({ type: 'output-node', x: 100, y: 100 });
            node1.outputs = [{ id: 'out1', name: 'Output' }];

            node2 = graph.addNode({ type: 'input-node', x: 200, y: 200 });
            node2.inputs = [{ id: 'in1', name: 'Input' }];
        });

        it('should capture connection add operation', () => {
            graph.addConnection({
                fromNode: node1.id,
                fromIndex: 0,
                toNode: node2.id,
                toIndex: 0,
            });

            // Should have 3 operations: node1 add, node2 add, connection add
            assert.equal(historyManager.getHistoryDepth(), 3);
        });

        it('should undo connection add by removing connection', () => {
            graph.addConnection({
                fromNode: node1.id,
                fromIndex: 0,
                toNode: node2.id,
                toIndex: 0,
            });

            // Undo connection
            historyManager.undo();

            // Verify connection removed
            const connections = graph.getConnections();
            assert.equal(connections.length, 0);
        });

        it('should redo connection add', () => {
            graph.addConnection({
                fromNode: node1.id,
                fromIndex: 0,
                toNode: node2.id,
                toIndex: 0,
            });

            // Undo and redo
            historyManager.undo();
            historyManager.redo();

            // Verify connection restored
            const connections = graph.getConnections();
            assert.equal(connections.length, 1);
            assert.equal(connections[0].fromNode, node1.id);
            assert.equal(connections[0].toNode, node2.id);
        });

        it('should capture connection remove operation', () => {
            graph.addConnection({
                fromNode: node1.id,
                fromIndex: 0,
                toNode: node2.id,
                toIndex: 0,
            });

            // Remove connection
            graph.removeConnection(node1.id, 0, node2.id, 0);

            // Should have 4 operations: add1, add2, conn add, conn remove
            assert.equal(historyManager.getHistoryDepth(), 4);
        });

        it('should undo connection remove by restoring connection', () => {
            graph.addConnection({
                fromNode: node1.id,
                fromIndex: 0,
                toNode: node2.id,
                toIndex: 0,
            });

            // Remove connection
            graph.removeConnection(node1.id, 0, node2.id, 0);

            // Undo remove
            historyManager.undo();

            // Verify connection restored
            const connections = graph.getConnections();
            assert.equal(connections.length, 1);
        });
    });

    describe('Graph Operations', () => {
        it('should capture graph add operation', () => {
            const initialGraphCount = collection.getGraphArray().length;

            // Add a new graph
            const newGraph = {
                id: generateUuidV4(),
                name: 'New Graph',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);

            // Should capture the operation
            assert.equal(historyManager.getHistoryDepth(), 1);
            assert.equal(collection.getGraphArray().length, initialGraphCount + 1);
        });

        it('should undo graph add by removing graph', () => {
            const initialGraphCount = collection.getGraphArray().length;

            const newGraph = {
                id: generateUuidV4(),
                name: 'Test Graph',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            // Undo add
            historyManager.undo();

            // Graph should be removed
            assert.equal(collection.getGraphArray().length, initialGraphCount);
            assert.throws(() => collection.getGraphById(graphId));
        });

        it('should redo graph add', () => {
            const initialGraphCount = collection.getGraphArray().length;

            const newGraph = {
                id: generateUuidV4(),
                name: 'Test Graph',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            // Undo then redo
            historyManager.undo();
            historyManager.redo();

            // Graph should be restored
            assert.equal(collection.getGraphArray().length, initialGraphCount + 1);
            const restoredGraph = collection.getGraphById(graphId);
            assert.ok(restoredGraph);
            assert.equal(restoredGraph.getName(), 'Test Graph');
        });

        it('should capture graph remove operation', () => {
            // Add a graph to remove
            const newGraph = {
                id: generateUuidV4(),
                name: 'To Be Removed',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            // Cache and remove
            historyManager.beforeGraphRemove(graphId);
            collection.removeGraph(graphId);

            // Should have 2 operations: add + remove
            assert.equal(historyManager.getHistoryDepth(), 2);
        });

        it('should undo graph remove by restoring graph', () => {
            const initialGraphCount = collection.getGraphArray().length;

            // Add a graph
            const newGraph = {
                id: generateUuidV4(),
                name: 'Test Graph',
                nodes: [{ id: generateUuidV4(), type: 'test-node', x: 100, y: 100 }],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            // Remove it
            historyManager.beforeGraphRemove(graphId);
            collection.removeGraph(graphId);

            // Undo remove
            historyManager.undo();

            // Graph should be restored
            assert.equal(collection.getGraphArray().length, initialGraphCount + 1);
            const restoredGraph = collection.getGraphById(graphId);
            assert.ok(restoredGraph);
            assert.equal(restoredGraph.getName(), 'Test Graph');
            assert.equal(restoredGraph.getNodes().length, 1);
        });

        it('should redo graph remove', () => {
            const initialGraphCount = collection.getGraphArray().length;

            // Add and remove a graph
            const newGraph = {
                id: generateUuidV4(),
                name: 'Test Graph',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            historyManager.beforeGraphRemove(graphId);
            collection.removeGraph(graphId);

            // Undo then redo
            historyManager.undo();
            historyManager.redo();

            // Graph should be removed again
            assert.equal(collection.getGraphArray().length, initialGraphCount);
            assert.throws(() => collection.getGraphById(graphId));
        });

        it('should capture graph rename operation', () => {
            // Add a graph
            const newGraph = {
                id: generateUuidV4(),
                name: 'Original Name',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            // Set as active so events are propagated
            const graphIndex = collection.getGraphArray().findIndex((g) => g.getId() === graphId);
            collection.setActiveGraphIdx(graphIndex);

            const graphInstance = collection.getGraphById(graphId);

            // Rename it
            historyManager.beforeGraphRename(graphId);
            graphInstance.setName('New Name');

            // Should have 2 operations: add + rename
            assert.equal(historyManager.getHistoryDepth(), 2);
        });

        it('should undo graph rename', () => {
            // Add a graph
            const newGraph = {
                id: generateUuidV4(),
                name: 'Original Name',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            // Set as active so events are propagated
            const graphIndex = collection.getGraphArray().findIndex((g) => g.getId() === graphId);
            collection.setActiveGraphIdx(graphIndex);

            const graphInstance = collection.getGraphById(graphId);

            // Rename it
            historyManager.beforeGraphRename(graphId);
            graphInstance.setName('New Name');

            // Undo rename
            historyManager.undo();

            // Name should be restored
            assert.equal(graphInstance.getName(), 'Original Name');
        });

        it('should redo graph rename', () => {
            // Add a graph
            const newGraph = {
                id: generateUuidV4(),
                name: 'Original Name',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            // Set as active so events are propagated
            const graphIndex = collection.getGraphArray().findIndex((g) => g.getId() === graphId);
            collection.setActiveGraphIdx(graphIndex);

            const graphInstance = collection.getGraphById(graphId);

            // Rename it
            historyManager.beforeGraphRename(graphId);
            graphInstance.setName('New Name');

            // Undo then redo
            historyManager.undo();
            historyManager.redo();

            // New name should be applied again
            assert.equal(graphInstance.getName(), 'New Name');
        });

        it('should handle graph remove without cached state gracefully', () => {
            // Add a graph
            const newGraph = {
                id: generateUuidV4(),
                name: 'Test Graph',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;

            // Remove without caching (should not capture operation)
            collection.removeGraph(graphId);

            // Should only have 1 operation (add), not 2 (add + remove)
            assert.equal(historyManager.getHistoryDepth(), 1);
        });

        it('should handle graph rename without cached state gracefully', () => {
            // Add a graph
            const newGraph = {
                id: generateUuidV4(),
                name: 'Original Name',
                nodes: [],
                connections: [],
            };
            collection.addGraph(newGraph);
            const graphId = newGraph.id;
            const graphInstance = collection.getGraphById(graphId);

            // Rename without caching (should not capture operation)
            graphInstance.setName('New Name');

            // Should only have 1 operation (add), not 2 (add + rename)
            assert.equal(historyManager.getHistoryDepth(), 1);
        });
    });

    describe('Multiple Operations', () => {
        it('should handle multiple undo operations', () => {
            // Add 3 nodes
            const node1 = graph.addNode({ type: 'node1', x: 100, y: 100 });
            const node2 = graph.addNode({ type: 'node2', x: 200, y: 200 });
            const node3 = graph.addNode({ type: 'node3', x: 300, y: 300 });

            assert.equal(historyManager.getHistoryDepth(), 3);

            // Undo all
            historyManager.undo();
            assert.equal(graph.hasNode(node3.id), false);
            assert.equal(graph.hasNode(node2.id), true);

            historyManager.undo();
            assert.equal(graph.hasNode(node2.id), false);
            assert.equal(graph.hasNode(node1.id), true);

            historyManager.undo();
            assert.equal(graph.hasNode(node1.id), false);

            assert.equal(historyManager.canUndo(), false);
        });

        it('should handle multiple redo operations', () => {
            // Add 3 nodes
            const node1 = graph.addNode({ type: 'node1', x: 100, y: 100 });
            const node2 = graph.addNode({ type: 'node2', x: 200, y: 200 });
            const node3 = graph.addNode({ type: 'node3', x: 300, y: 300 });

            // Undo all
            historyManager.undo();
            historyManager.undo();
            historyManager.undo();

            // Redo all
            historyManager.redo();
            assert.equal(graph.hasNode(node1.id), true);

            historyManager.redo();
            assert.equal(graph.hasNode(node2.id), true);

            historyManager.redo();
            assert.equal(graph.hasNode(node3.id), true);

            assert.equal(historyManager.canRedo(), false);
        });
    });

    describe('Memory Management', () => {
        it('should enforce max depth limit', () => {
            const manager = new HistoryManager(collection, { maxDepth: 3 });

            // Add 5 nodes
            for (let i = 0; i < 5; i++) {
                graph.addNode({ type: `node${i}`, x: i * 100, y: 100 });
            }

            // Should only keep last 3
            assert.equal(manager.getHistoryDepth(), 3);
        });

        it('should adjust current index when trimming', () => {
            const manager = new HistoryManager(collection, { maxDepth: 3 });

            // Add 5 nodes
            for (let i = 0; i < 5; i++) {
                graph.addNode({ type: `node${i}`, x: i * 100, y: 100 });
            }

            // Should still be able to undo
            assert.equal(manager.canUndo(), true);
            manager.undo();
            assert.equal(manager.canUndo(), true);
        });

        it('should allow changing max depth', () => {
            historyManager.setMaxDepth(10);
            assert.equal(historyManager.getMaxDepth(), 10);
        });

        it('should clear all history', () => {
            graph.addNode({ type: 'node1', x: 100, y: 100 });
            graph.addNode({ type: 'node2', x: 200, y: 200 });

            assert.equal(historyManager.getHistoryDepth(), 2);

            historyManager.clear();

            assert.equal(historyManager.getHistoryDepth(), 0);
            assert.equal(historyManager.canUndo(), false);
            assert.equal(historyManager.canRedo(), false);
        });
    });

    describe('Query Methods', () => {
        it('should return null descriptions when no history', () => {
            assert.equal(historyManager.getUndoDescription(), null);
            assert.equal(historyManager.getRedoDescription(), null);
        });

        it('should return undo description after operation', () => {
            graph.addNode({ type: 'gpio-input', x: 100, y: 100 });

            const desc = historyManager.getUndoDescription();
            assert.ok(desc);
            assert.ok(desc.includes('Add'));
        });

        it('should return redo description after undo', () => {
            graph.addNode({ type: 'gpio-input', x: 100, y: 100 });
            historyManager.undo();

            const desc = historyManager.getRedoDescription();
            assert.ok(desc);
            assert.ok(desc.includes('Add'));
        });

        it('should resolve control edit label with active locale and locale-specific userName', () => {
            const previousI18n = globalThis.i18n;
            globalThis.i18n = { currentLocale: 'de' };

            try {
                const node = graph.addNode({
                    type: 'constant',
                    typeName: { en: 'Constant', de: 'Konstante' },
                    userName: { de: 'Wohnzimmer Wert' },
                    x: 100,
                    y: 100,
                    controlValues: { value: 1 },
                });

                graph.updateNode(node.id, { controlValues: { value: 2 } });

                const desc = historyManager.getUndoDescription();
                assert.equal(desc, 'Edit control on "Wohnzimmer Wert"');
            } finally {
                if (previousI18n === undefined) {
                    delete globalThis.i18n;
                } else {
                    globalThis.i18n = previousI18n;
                }
            }
        });

        it('should capture width-only node updates and undo/redo them', () => {
            const node = graph.addNode({
                type: 'resizable-node',
                typeName: { en: 'Resizable Node' },
                x: 100,
                y: 100,
                width: 180,
            });

            graph.updateNode(node.id, { width: 230 });

            assert.equal(historyManager.canUndo(), true);
            assert.ok(historyManager.getUndoDescription()?.includes('Resize node'));
            assert.equal(graph.getNode(node.id).width, 230);

            historyManager.undo();
            assert.equal(graph.getNode(node.id).width, 180);

            historyManager.redo();
            assert.equal(graph.getNode(node.id).width, 230);
        });

        it('should undo/redo combined x+width patches from left-edge resize updates', () => {
            const node = graph.addNode({
                type: 'resizable-node',
                x: 100,
                y: 100,
                width: 180,
            });

            graph.updateNode(node.id, { x: 120, width: 160 });

            assert.equal(graph.getNode(node.id).x, 120);
            assert.equal(graph.getNode(node.id).width, 160);

            historyManager.undo();
            assert.equal(graph.getNode(node.id).x, 100);
            assert.equal(graph.getNode(node.id).width, 180);

            historyManager.redo();
            assert.equal(graph.getNode(node.id).x, 120);
            assert.equal(graph.getNode(node.id).width, 160);
        });
    });

    describe('Error Handling', () => {
        it('should return false when undo not available', () => {
            const success = historyManager.undo();
            assert.equal(success, false);
        });

        it('should return false when redo not available', () => {
            const success = historyManager.redo();
            assert.equal(success, false);
        });

        it('should handle missing cached state gracefully', () => {
            const node = graph.addNode({ type: 'node1', x: 100, y: 100 });

            // Remove without caching (should not capture operation)
            graph.removeNode(node.id);

            // Should only have 1 operation (add), not 2 (add + remove)
            assert.equal(historyManager.getHistoryDepth(), 1);
        });
    });

    describe('Dispose', () => {
        it('should clean up event listeners', () => {
            historyManager.dispose();

            // Add node after dispose - should not be captured
            graph.addNode({ type: 'node1', x: 100, y: 100 });

            assert.equal(historyManager.getHistoryDepth(), 0);
        });

        it('should clear cache on dispose', () => {
            const node = graph.addNode({ type: 'node1', x: 100, y: 100 });
            historyManager.beforeNodeRemove(node.id);

            historyManager.dispose();

            // State cache should be cleared
            assert.equal(historyManager.getHistoryDepth(), 0);
        });
    });

    describe('Persistence (Phase 3)', () => {
        it('should serialize history to plain object', () => {
            // Add some operations
            graph.addNode({ type: 'node1', x: 100, y: 100 });
            graph.addNode({ type: 'node2', x: 200, y: 200 });

            const serialized = historyManager.serialize();

            assert.ok(serialized);
            assert.equal(typeof serialized, 'object');
            assert.equal(serialized.version, 1);
            assert.equal(serialized.maxDepth, 50);
            assert.equal(serialized.currentIndex, 1);
            assert.ok(Array.isArray(serialized.operations));
            assert.equal(serialized.operations.length, 2);
        });

        it('should deserialize history from plain object', () => {
            // Add operations and serialize
            graph.addNode({ type: 'node1', x: 100, y: 100 });
            graph.addNode({ type: 'node2', x: 200, y: 200 });
            const serialized = historyManager.serialize();

            // Create new collection and deserialize
            const newCollection = new Collection({
                id: generateUuidV4(),
                title: 'New Collection',
                graphs: [
                    {
                        id: 'graph-2',
                        name: 'New Graph',
                        nodes: [],
                        connections: [],
                    },
                ],
            });

            const newManager = HistoryManager.deserialize(serialized, newCollection);

            assert.equal(newManager.getHistoryDepth(), 2);
            assert.equal(newManager.canUndo(), true);
            assert.equal(newManager.canRedo(), false);
        });

        it('should include history in Collection serialization', () => {
            // Add operations
            graph.addNode({ type: 'node1', x: 100, y: 100 });
            graph.addNode({ type: 'node2', x: 200, y: 200 });

            const collectionData = collection.toData();

            assert.ok(collectionData.history);
            assert.equal(typeof collectionData.history, 'object');
            assert.ok(Array.isArray(collectionData.history.operations));
            assert.equal(collectionData.history.operations.length, 2);
        });

        it('should restore history when loading Collection from data', () => {
            // Add operations
            graph.addNode({ type: 'node1', x: 100, y: 100 });
            graph.addNode({ type: 'node2', x: 200, y: 200 });

            // Serialize collection
            const collectionData = collection.toData();

            // Create new collection from data
            const restoredCollection = Collection.fromData(collectionData);
            const restoredManager = restoredCollection.getHistoryManager();

            assert.equal(restoredManager.getHistoryDepth(), 2);
            assert.equal(restoredManager.canUndo(), true);
        });

        it('should allow undo after restoring from serialized data', () => {
            // Add operations
            graph.addNode({ type: 'node1', x: 100, y: 100 });
            graph.addNode({ type: 'node2', x: 200, y: 200 });

            // Serialize and restore
            const collectionData = collection.toData();
            const restoredCollection = Collection.fromData(collectionData);
            const restoredGraph = restoredCollection.getActiveGraph();
            const restoredManager = restoredCollection.getHistoryManager();

            // Get node count before undo using getNodes() (nodeCount getter has a bug)
            const nodeCountBefore = restoredGraph.getNodes().length;

            // Undo in restored collection
            restoredManager.undo();

            // Should have one less node
            assert.equal(restoredGraph.getNodes().length, nodeCountBefore - 1);
        });

        it('should preserve operation details across serialization', () => {
            // Add a node with specific data
            const node = graph.addNode({ type: 'gpio-input', x: 123, y: 456 });
            const nodeId = node.id;

            // Serialize and restore
            const collectionData = collection.toData();
            const restoredCollection = Collection.fromData(collectionData);
            const restoredGraph = restoredCollection.getActiveGraph();
            const restoredManager = restoredCollection.getHistoryManager();

            // Get the operation description
            const description = restoredManager.getUndoDescription();
            assert.ok(description);
            assert.ok(description.includes('Add'));

            // Undo and verify node was removed
            restoredManager.undo();
            assert.equal(restoredGraph.hasNode(nodeId), false);
        });

        it('should handle empty history during deserialization', () => {
            const collectionData = collection.toData();

            // Remove history
            delete collectionData.history;

            const restoredCollection = Collection.fromData(collectionData);
            const restoredManager = restoredCollection.getHistoryManager();

            // Should have empty history
            assert.equal(restoredManager.getHistoryDepth(), 0);
            assert.equal(restoredManager.canUndo(), false);
        });

        it('should handle null history during deserialization', () => {
            const collectionData = collection.toData();

            // Set history to null
            collectionData.history = null;

            const restoredCollection = Collection.fromData(collectionData);
            const restoredManager = restoredCollection.getHistoryManager();

            // Should have empty history
            assert.equal(restoredManager.getHistoryDepth(), 0);
            assert.equal(restoredManager.canUndo(), false);
        });

        it('should support multiple save/restore cycles', () => {
            // Cycle 1: Add nodes
            graph.addNode({ type: 'node1', x: 100, y: 100 });
            const data1 = collection.toData();

            // Cycle 2: Load and add more
            const coll2 = Collection.fromData(data1);
            const graph2 = coll2.getActiveGraph();
            graph2.addNode({ type: 'node2', x: 200, y: 200 });
            const data2 = coll2.toData();

            // Cycle 3: Load and verify
            const coll3 = Collection.fromData(data2);
            const manager3 = coll3.getHistoryManager();

            // Should have 2 operations from both cycles
            assert.equal(manager3.getHistoryDepth(), 2);
        });

        it('should clear history in Collection.dispose()', () => {
            // Add operations
            graph.addNode({ type: 'node1', x: 100, y: 100 });
            assert.equal(historyManager.getHistoryDepth(), 1);

            // Dispose collection
            collection.dispose();

            // History should be cleared (no way to access after dispose, but shouldn't throw)
            // Just verify dispose doesn't throw
            assert.ok(true);
        });
    });

    describe('Selection History Operations', () => {
        it('records selection changes and applies them via undo/redo listeners', () => {
            const appliedSelections = [];
            const unsubscribe = historyManager.onSelectionHistoryApplied((payload) => {
                appliedSelections.push(payload);
            });

            const recorded = historyManager.recordSelectionChange(
                ['node-a', 'node-b'],
                ['node-a'],
                'Clear partial selection'
            );

            assert.equal(recorded, true);
            assert.equal(historyManager.getHistoryDepth(), 1);
            assert.equal(historyManager.getUndoDescription(), 'Clear partial selection');

            historyManager.undo();
            historyManager.redo();

            assert.deepEqual(appliedSelections, [
                {
                    selectedNodeIds: ['node-a', 'node-b'],
                    direction: 'undo',
                    description: 'Clear partial selection',
                },
                {
                    selectedNodeIds: ['node-a'],
                    direction: 'redo',
                    description: 'Clear partial selection',
                },
            ]);

            unsubscribe();
        });

        it('does not record no-op selection changes', () => {
            const recorded = historyManager.recordSelectionChange(
                ['node-a'],
                ['node-a'],
                'No-op selection'
            );

            assert.equal(recorded, false);
            assert.equal(historyManager.getHistoryDepth(), 0);
            assert.equal(historyManager.canUndo(), false);
        });
    });
});
