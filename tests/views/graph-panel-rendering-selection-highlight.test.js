import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    GraphPanelRendering,
    collectRelatedNodeIds,
} from '../../src/micro_otter/nodes/html/js/views/graph-panel-rendering.js';

function createContext() {
    return {
        save() {},
        restore() {},
        beginPath() {},
        stroke() {},
        moveTo() {},
        lineTo() {},
        fillRect() {},
        strokeStyle: '',
        lineWidth: 0,
        fillStyle: '',
        lineCap: 'round',
    };
}

function createRendering(connectionsUi) {
    return new GraphPanelRendering({
        constants: {},
        viewport: { screenToWorld: (point) => point },
        connectionsUi,
    });
}

describe('collectRelatedNodeIds', () => {
    it('returns selected nodes plus their one-hop neighbours', () => {
        const related = collectRelatedNodeIds(
            [
                { fromNode: 'a', toNode: 'b' },
                { fromNode: 'b', toNode: 'c' },
                { fromNode: 'c', toNode: 'd' },
            ],
            new Set(['b'])
        );

        assert.deepEqual(Array.from(related).sort(), ['a', 'b', 'c']);
    });

    it('returns an empty set for an empty selection', () => {
        const related = collectRelatedNodeIds(
            [{ fromNode: 'a', toNode: 'b' }],
            new Set()
        );
        assert.equal(related.size, 0);
    });
});

describe('GraphPanelRendering selection highlighting', () => {
    it('calls setRelatedHighlight for neighbours but not unrelated nodes', () => {
        const nodeUiMap = new Map(
            ['a', 'b', 'c', 'd'].map((id) => [
                id,
                {
                    selected: null,
                    highlighted: null,
                    setSelected(value) {
                        this.selected = value;
                    },
                    setRelatedHighlight(value) {
                        this.highlighted = value;
                    },
                    getBounds() {
                        return { x: 0, y: 0, width: 10, height: 10 };
                    },
                    draw() {},
                },
            ])
        );

        const rendering = createRendering({
            setHoverConnection() {},
            setHighlightedNodes() {},
            drawConnections() {},
            drawTempConnection() {},
        });

        const related = new Set(['b', 'a', 'c']); // b selected, a/c neighbours
        rendering.drawNodes(createContext(), {
            nodeUiMap,
            nodeOrderList: ['a', 'b', 'c', 'd'],
            selectedNodeIds: new Set(['b']),
            relatedNodeIds: related,
        });

        assert.equal(nodeUiMap.get('a').highlighted, true);
        assert.equal(nodeUiMap.get('b').highlighted, false); // selected, not "related"
        assert.equal(nodeUiMap.get('c').highlighted, true);
        assert.equal(nodeUiMap.get('d').highlighted, false);
    });

    it('forwards selected node IDs to setHighlightedNodes', () => {
        const highlightedCalls = [];
        const connectionsUi = {
            setHoverConnection() {},
            setHighlightedNodes(value) {
                highlightedCalls.push(value);
            },
            drawConnections() {},
            drawTempConnection() {},
        };
        const rendering = createRendering(connectionsUi);
        const selected = new Set(['b']);

        rendering.drawConnections(createContext(), new Map(), null, null, 'full', selected);

        assert.equal(highlightedCalls.length, 1);
        assert.equal(highlightedCalls[0], selected);
    });
});
