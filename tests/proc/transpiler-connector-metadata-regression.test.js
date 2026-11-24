import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeConnectorMetadata } from '../../src/micro_otter/nodes/html/js/proc/transpiler-helpers.js';
import {
    createConnectorLookups,
    createTranspilerConnection,
    createTranspilerNode,
} from '../helpers/fixtures/transpiler-fixtures.js';

describe('Transpiler connector metadata regression', () => {
    it('flags connector metadata per slot based on graph connections', () => {
        const nodes = [
            createTranspilerNode('1', ['A'], ['O1']),
            createTranspilerNode('2', ['B1', 'B2'], ['O2']),
        ];
        const connections = [
            createTranspilerConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 1 }),
        ];
        const { inputLookup, outputLookup } = createConnectorLookups(connections);

        const metadata = computeConnectorMetadata(nodes, inputLookup, outputLookup);
        const node1Meta = metadata.get('1');
        const node2Meta = metadata.get('2');

        assert.ok(node1Meta);
        assert.ok(node2Meta);

        assert.deepEqual(node1Meta.inputsMeta, [{ id: 'in0', name: 'A', connected: false }]);
        assert.deepEqual(node1Meta.outputsMeta, [
            { id: 'out0', name: 'O1', varName: 'node_1_out0', connected: true },
        ]);

        assert.deepEqual(node2Meta.inputsMeta, [
            { id: 'in0', name: 'B1', connected: false },
            { id: 'in1', name: 'B2', connected: true },
        ]);
        assert.deepEqual(node2Meta.outputsMeta, [
            { id: 'out0', name: 'O2', varName: 'node_2_out0', connected: false },
        ]);
    });
});
