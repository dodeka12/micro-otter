import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

describe('NodeGraph naming updates', () => {
    it('updates userName via updateNode and keeps title in sync', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const node = graph.addNode({
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: null,
        });

        graph.updateNode(node.id, { userName: 'Living Room Value' });

        const updated = graph.getNode(node.id);
        assert.deepEqual(updated.userName, { en: 'Living Room Value' });
        assert.equal(updated.title, 'Living Room Value');
    });

    it('clears userName when empty title is passed and falls back to typeName', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const node = graph.addNode({
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: { en: 'Custom Name' },
        });

        graph.updateNode(node.id, { title: '   ' });

        const updated = graph.getNode(node.id);
        assert.equal(updated.userName, null);
        assert.equal(updated.title, 'Constant');
        assert.equal(updated.getDisplayName('de'), 'Konstante');
    });

    it('updates typeName via updateNode and refreshes derived title when userName is empty', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const node = graph.addNode({
            type: 'core.constant',
            typeName: { en: 'Constant' },
            userName: null,
        });

        graph.updateNode(node.id, { typeName: { en: 'Const', de: 'Konst' } });

        const updated = graph.getNode(node.id);
        assert.deepEqual(updated.typeName, { en: 'Const', de: 'Konst' });
        assert.equal(updated.title, 'Const');
    });

    it('updates only one locale entry via userNameByLocale patch', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const node = graph.addNode({
            type: 'core.constant',
            typeName: { en: 'Constant', de: 'Konstante' },
            userName: { en: 'Custom EN', de: 'Custom DE' },
        });

        graph.updateNode(node.id, {
            userNameByLocale: {
                locale: 'de',
                value: 'Raumwert',
            },
        });

        const updated = graph.getNode(node.id);
        assert.deepEqual(updated.userName, { en: 'Custom EN', de: 'Raumwert' });
        assert.equal(updated.getDisplayName('de'), 'Raumwert');
        assert.equal(updated.getDisplayName('en'), 'Custom EN');
        assert.equal(updated.title, 'Custom EN');
    });
});
