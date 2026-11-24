// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for GraphPanelClipboard's cut behaviour.
 *
 * A cut must copy the payload and remove the source nodes immediately. Removal is
 * delegated to the panel's removeNodes callback so the view records one undoable
 * history group; the clipboard manager itself never deletes nodes.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelClipboard } from '../../src/micro_otter/nodes/html/js/views/graph-panel-clipboard.js';
import { clipboardManager } from '../../src/micro_otter/nodes/html/js/core/clipboard-manager.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

function createHarness({ selection = ['node-a', 'node-b'], cutResult = true } = {}) {
    const calls = [];
    const clipboard = new GraphPanelClipboard({
        graph: { getId: () => 'graph-a' },
        clipboardManager: {
            copy: () => true,
            cut: (graph, nodeIds) => {
                calls.push({ op: 'cut', graph, nodeIds: [...nodeIds] });
                return cutResult;
            },
            paste: () => [],
            duplicate: () => [],
            hasData: () => true,
        },
        viewport: { screenToWorld: (point) => point },
        getSelectedNodeIds: () => [...selection],
        ensureNodesInsideGrid: () => {},
        removeNodes: (nodeIds, description) => {
            calls.push({ op: 'remove', nodeIds: [...nodeIds], description });
        },
    });

    return { clipboard, calls };
}

describe('GraphPanelClipboard cut', () => {
    it('copies the selection and removes the source nodes immediately', () => {
        const { clipboard, calls } = createHarness();

        const result = clipboard.cutSelected();

        assert.equal(result, true);
        assert.deepEqual(
            calls.map((call) => call.op),
            ['cut', 'remove']
        );
        assert.deepEqual(calls[0].nodeIds, ['node-a', 'node-b']);
        assert.deepEqual(calls[1].nodeIds, ['node-a', 'node-b']);
        assert.equal(calls[1].description, 'Cut nodes');
    });

    it('uses the singular history description for a single node', () => {
        const { clipboard, calls } = createHarness({ selection: ['node-a'] });

        assert.equal(clipboard.cutSelected(), true);
        assert.equal(calls[1].description, 'Cut node');
    });

    it('does not remove nodes when nothing is selected', () => {
        const { clipboard, calls } = createHarness({ selection: [] });

        assert.equal(clipboard.cutSelected(), false);
        assert.deepEqual(calls, []);
    });

    it('does not remove nodes when copying to the clipboard fails', () => {
        const { clipboard, calls } = createHarness({ cutResult: false });

        assert.equal(clipboard.cutSelected(), false);
        assert.deepEqual(
            calls.map((call) => call.op),
            ['cut']
        );
    });
});

describe('GraphPanelClipboard cut against a real graph and clipboard manager', () => {
    afterEach(() => {
        clipboardManager.clear();
    });

    it('removes the selected nodes and keeps a pasteable payload on the clipboard', () => {
        const graph = new NodeGraph({ id: 'graph-cut', name: 'Cut' });
        const node = graph.addNode({ type: 'const', title: 'Constant', x: 100, y: 100 });
        const selection = new Set([node.id]);
        let removedCount = 0;

        const clipboard = new GraphPanelClipboard({
            graph,
            clipboardManager,
            viewport: { screenToWorld: (point) => point },
            getSelectedNodeIds: () => [...selection],
            ensureNodesInsideGrid: () => {},
            removeNodes: (nodeIds) => {
                for (const nodeId of nodeIds) {
                    if (graph.removeNode(nodeId)) {
                        removedCount += 1;
                    }
                }
                selection.clear();
            },
        });

        assert.equal(clipboard.cutSelected(), true);
        assert.equal(removedCount, 1);
        assert.equal(graph.getNode(node.id), null);
        assert.equal(clipboard.hasData(), true);

        const pastedIds = clipboard.pasteAt({ x: 300, y: 300 });

        assert.equal(pastedIds.length, 1);
        assert.ok(graph.getNode(pastedIds[0]));
    });
});
describe('GraphPanelClipboard documentation areas', () => {
    function createAreaHarness({
        selection = [],
        activeAreaId = 'area-1',
        pastedNodeIds = [],
        pastedAreaIds = ['area-new'],
        reportPastedAreaIds = true,
    } = {}) {
        const calls = [];
        const clipboard = new GraphPanelClipboard({
            graph: { getId: () => 'graph-a' },
            clipboardManager: {
                copy: (graph, nodeIds, options) => {
                    calls.push({ op: 'copy', nodeIds: [...nodeIds], areaIds: options?.areaIds });
                    return true;
                },
                cut: (graph, nodeIds, options) => {
                    calls.push({ op: 'cut', nodeIds: [...nodeIds], areaIds: options?.areaIds });
                    return true;
                },
                paste: () => {
                    calls.push({ op: 'paste' });
                    return pastedNodeIds;
                },
                pasteAreas: (_graph, worldPos) => {
                    calls.push({ op: 'pasteAreas', worldPos });
                    return pastedAreaIds;
                },
                getLastPastedAreaIds: () => (reportPastedAreaIds ? pastedAreaIds : []),
                getAreaCount: () => 1,
                duplicate: () => [],
                hasData: () => true,
            },
            viewport: { screenToWorld: (point) => point },
            getSelectedNodeIds: () => [...selection],
            ensureNodesInsideGrid: () => {},
            removeNodes: (nodeIds, description) => {
                calls.push({ op: 'removeNodes', nodeIds: [...nodeIds], description });
            },
            getActiveDocumentationAreaId: () => activeAreaId,
            removeDocumentationArea: (areaId, description) => {
                calls.push({ op: 'removeArea', areaId, description });
            },
            beginHistoryGroup: (description) => calls.push({ op: 'beginGroup', description }),
            endHistoryGroup: () => calls.push({ op: 'endGroup' }),
        });

        return { clipboard, calls };
    }

    it('forwards the active area id to copy', () => {
        const { clipboard, calls } = createAreaHarness();

        assert.equal(clipboard.copySelected(), true);
        assert.deepEqual(calls[0], { op: 'copy', nodeIds: [], areaIds: ['area-1'] });
    });

    it('cuts an active area without touching nodes', () => {
        const { clipboard, calls } = createAreaHarness();

        assert.equal(clipboard.cutSelected(), true);

        assert.deepEqual(
            calls.map((call) => call.op),
            ['cut', 'removeArea']
        );
        assert.equal(calls[1].areaId, 'area-1');
        assert.equal(calls[1].description, 'Cut documentation area');
    });

    it('groups a mixed cut so nodes and area undo together', () => {
        const { clipboard, calls } = createAreaHarness({ selection: ['node-a'] });

        assert.equal(clipboard.cutSelected(), true);

        assert.deepEqual(
            calls.map((call) => call.op),
            ['cut', 'beginGroup', 'removeNodes', 'removeArea', 'endGroup']
        );
        assert.equal(calls[1].description, 'Cut selection');
    });

    it('does nothing when neither nodes nor an area are active', () => {
        const { clipboard, calls } = createAreaHarness({ activeAreaId: null });

        assert.equal(clipboard.copySelected(), false);
        assert.equal(clipboard.cutSelected(), false);
        assert.deepEqual(calls, []);
    });

    it('remembers the pasted area ids after a paste', () => {
        const { clipboard, calls } = createAreaHarness({
            pastedNodeIds: ['node-new'],
            pastedAreaIds: ['area-new'],
        });

        const nodeIds = clipboard.pasteAt({ x: 10, y: 20 });

        assert.deepEqual(nodeIds, ['node-new']);
        assert.deepEqual(
            calls.map((call) => call.op),
            ['paste']
        );
        assert.deepEqual(clipboard.getLastPastedAreaIds(), ['area-new']);
    });

    it('falls back to the area-only paste when the payload has no nodes', () => {
        // An older manager that cannot paste areas inside `paste()` reports nothing, so the
        // facade has to fall back to `pasteAreas()` explicitly.
        const { clipboard, calls } = createAreaHarness({
            pastedNodeIds: [],
            reportPastedAreaIds: false,
        });

        clipboard.pasteAt({ x: 10, y: 20 });

        assert.deepEqual(
            calls.map((call) => call.op),
            ['paste', 'pasteAreas']
        );
        assert.deepEqual(clipboard.getLastPastedAreaIds(), ['area-new']);
    });

    it('copies and cuts a single area through the facade helpers', () => {
        const { clipboard, calls } = createAreaHarness();

        assert.equal(clipboard.copyArea('area-1'), true);
        assert.equal(clipboard.cutArea('area-1'), true);

        assert.deepEqual(
            calls.map((call) => call.op),
            ['copy', 'copy', 'removeArea']
        );
    });
});
