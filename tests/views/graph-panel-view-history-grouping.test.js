import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';
import { GraphPanelClipboard } from '../../src/micro_otter/nodes/html/js/views/graph-panel-clipboard.js';

describe('GraphPanelView history grouping for batch node operations', () => {
    it('wraps multi-node delete in a single history group', () => {
        const historyEvents = [];
        const removedNodeIds = [];

        const viewLike = {
            selection: {
                selectedNodes: new Set(['node-a', 'node-b']),
                getSelectedNodeIds() {
                    return ['node-a', 'node-b'];
                },
            },
            collection: {
                getHistoryManager() {
                    return {
                        beginGroup(description) {
                            historyEvents.push({ type: 'begin', description });
                        },
                        beforeNodeRemove(nodeId) {
                            historyEvents.push({ type: 'before', nodeId });
                        },
                        endGroup() {
                            historyEvents.push({ type: 'end' });
                        },
                    };
                },
            },
            graph: {
                removeNode(nodeId) {
                    removedNodeIds.push(nodeId);
                    return true;
                },
            },
            _clearSelection() {
                this.selection.selectedNodes.clear();
            },
            _removeNodes: GraphPanelView.prototype._removeNodes,
            _log() {},
        };

        GraphPanelView.prototype._deleteSelected.call(viewLike);

        assert.deepEqual(removedNodeIds, ['node-a', 'node-b']);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Delete nodes' },
            { type: 'before', nodeId: 'node-a' },
            { type: 'before', nodeId: 'node-b' },
            { type: 'end' },
        ]);
    });

    it('wraps paste-at-center in a single history group', () => {
        const historyEvents = [];
        let selectionUpdated = 0;

        const viewLike = {
            canvas: { width: 1200, height: 900 },
            _isApplyingSelectionHistory: false,
            selection: {
                selectedNodes: new Set(['old-node']),
                clearSelection() {
                    this.selectedNodes.clear();
                },
                getSelectedNodeIds() {
                    return [...this.selectedNodes];
                },
            },
            collection: {
                getHistoryManager() {
                    return {
                        beginGroup(description) {
                            historyEvents.push({ type: 'begin', description });
                        },
                        endGroup() {
                            historyEvents.push({ type: 'end' });
                        },
                        recordSelectionChange() {},
                    };
                },
            },
            clipboard: {
                pasteAtCenter() {
                    return ['new-a', 'new-b'];
                },
            },
            _setSelectionNodeIds: GraphPanelView.prototype._setSelectionNodeIds,
            _updateSelection() {
                selectionUpdated += 1;
            },
            _log() {},
        };

        GraphPanelView.prototype._pasteAtCenter.call(viewLike);

        assert.equal(selectionUpdated, 1);
        assert.deepEqual([...viewLike.selection.selectedNodes], ['new-a', 'new-b']);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Paste nodes' },
            { type: 'end' },
        ]);
    });

    it('wraps paste-at-position in a single history group', () => {
        const historyEvents = [];

        const viewLike = {
            _isApplyingSelectionHistory: false,
            selection: {
                selectedNodes: new Set(),
                clearSelection() {
                    this.selectedNodes.clear();
                },
                getSelectedNodeIds() {
                    return [...this.selectedNodes];
                },
            },
            collection: {
                getHistoryManager() {
                    return {
                        beginGroup(description) {
                            historyEvents.push({ type: 'begin', description });
                        },
                        endGroup() {
                            historyEvents.push({ type: 'end' });
                        },
                        recordSelectionChange() {},
                    };
                },
            },
            clipboard: {
                pasteAt(position) {
                    assert.deepEqual(position, { x: 200, y: 300 });
                    return ['new-node'];
                },
            },
            _setSelectionNodeIds: GraphPanelView.prototype._setSelectionNodeIds,
            _updateSelection() {},
            _log() {},
        };

        GraphPanelView.prototype._pasteAt.call(viewLike, { x: 200, y: 300 });

        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Paste nodes' },
            { type: 'end' },
        ]);
    });

    it('wraps duplicate in a single history group', () => {
        const historyEvents = [];

        const viewLike = {
            canvas: null,
            _isApplyingSelectionHistory: false,
            selection: {
                selectedNodes: new Set(['original-a', 'original-b']),
                clearSelection() {
                    this.selectedNodes.clear();
                },
                getSelectedNodeIds() {
                    return [...this.selectedNodes];
                },
            },
            collection: {
                getHistoryManager() {
                    return {
                        beginGroup(description) {
                            historyEvents.push({ type: 'begin', description });
                        },
                        endGroup() {
                            historyEvents.push({ type: 'end' });
                        },
                        recordSelectionChange() {},
                    };
                },
            },
            clipboard: {
                duplicateSelected() {
                    return ['dup-a', 'dup-b'];
                },
            },
            _setSelectionNodeIds: GraphPanelView.prototype._setSelectionNodeIds,
            _updateSelection() {},
            _log() {},
        };

        GraphPanelView.prototype._duplicateSelected.call(viewLike);

        assert.deepEqual([...viewLike.selection.selectedNodes], ['dup-a', 'dup-b']);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Duplicate nodes' },
            { type: 'end' },
        ]);
    });

    it('records clear-selection as history operation', () => {
        const selectionHistoryCalls = [];
        let selectionUpdated = 0;

        const viewLike = {
            _isApplyingSelectionHistory: false,
            selection: {
                selectedNodes: new Set(['node-a', 'node-b']),
                clearSelection() {
                    this.selectedNodes.clear();
                },
                getSelectedNodeIds() {
                    return [...this.selectedNodes];
                },
            },
            collection: {
                getHistoryManager() {
                    return {
                        recordSelectionChange(previousNodeIds, nextNodeIds, description) {
                            selectionHistoryCalls.push({ previousNodeIds, nextNodeIds, description });
                        },
                    };
                },
            },
            _setSelectionNodeIds: GraphPanelView.prototype._setSelectionNodeIds,
            _updateSelection() {
                selectionUpdated += 1;
            },
        };

        GraphPanelView.prototype._clearSelection.call(viewLike);

        assert.equal(selectionUpdated, 1);
        assert.deepEqual([...viewLike.selection.selectedNodes], []);
        assert.deepEqual(selectionHistoryCalls, [
            {
                previousNodeIds: ['node-a', 'node-b'],
                nextNodeIds: [],
                description: 'Clear selection',
            },
        ]);
    });

    it('applies selection from history without recording another selection operation', () => {
        const selectionHistoryCalls = [];
        let selectionUpdated = 0;

        const viewLike = {
            _isApplyingSelectionHistory: false,
            selection: {
                selectedNodes: new Set(['old-node']),
                clearSelection() {
                    this.selectedNodes.clear();
                },
                getSelectedNodeIds() {
                    return [...this.selectedNodes];
                },
            },
            collection: {
                getHistoryManager() {
                    return {
                        recordSelectionChange(previousNodeIds, nextNodeIds, description) {
                            selectionHistoryCalls.push({ previousNodeIds, nextNodeIds, description });
                        },
                    };
                },
            },
            _setSelectionNodeIds: GraphPanelView.prototype._setSelectionNodeIds,
            _applySelectionHistoryState: GraphPanelView.prototype._applySelectionHistoryState,
            _updateSelection() {
                selectionUpdated += 1;
            },
        };

        GraphPanelView.prototype._applySelectionHistoryState.call(viewLike, ['node-a', 'node-b']);

        assert.equal(selectionUpdated, 1);
        assert.deepEqual([...viewLike.selection.selectedNodes], ['node-a', 'node-b']);
        assert.deepEqual(selectionHistoryCalls, []);
        assert.equal(viewLike._isApplyingSelectionHistory, false);
    });

    it('removes cut nodes in one history group through the clipboard callback', () => {
        const historyEvents = [];
        const removedNodeIds = [];
        const clipboardNodeIds = [];

        const selection = {
            selectedNodes: new Set(['node-a', 'node-b']),
            clearSelection() {
                this.selectedNodes.clear();
            },
            getSelectedNodeIds() {
                return [...this.selectedNodes];
            },
        };

        const viewLike = {
            selection,
            collection: {
                getHistoryManager() {
                    return {
                        beginGroup(description) {
                            historyEvents.push({ type: 'begin', description });
                        },
                        beforeNodeRemove(nodeId) {
                            historyEvents.push({ type: 'before', nodeId });
                        },
                        endGroup() {
                            historyEvents.push({ type: 'end' });
                        },
                    };
                },
            },
            graph: {
                removeNode(nodeId) {
                    removedNodeIds.push(nodeId);
                    return true;
                },
            },
            _clearSelection() {
                selection.clearSelection();
            },
            _removeNodes: GraphPanelView.prototype._removeNodes,
            _log() {},
        };

        viewLike.clipboard = new GraphPanelClipboard({
            graph: viewLike.graph,
            clipboardManager: {
                copy: () => true,
                cut(graph, nodeIds) {
                    clipboardNodeIds.push([...nodeIds]);
                    return true;
                },
                paste: () => [],
                duplicate: () => [],
                hasData: () => true,
            },
            viewport: { screenToWorld: (point) => point },
            getSelectedNodeIds: () => selection.getSelectedNodeIds(),
            ensureNodesInsideGrid: () => {},
            removeNodes: (nodeIds, description) => viewLike._removeNodes(nodeIds, description),
        });

        GraphPanelView.prototype._cutSelected.call(viewLike);

        assert.deepEqual(clipboardNodeIds, [['node-a', 'node-b']]);
        assert.deepEqual(removedNodeIds, ['node-a', 'node-b']);
        assert.deepEqual([...selection.selectedNodes], []);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Cut nodes' },
            { type: 'before', nodeId: 'node-a' },
            { type: 'before', nodeId: 'node-b' },
            { type: 'end' },
        ]);
    });
});
