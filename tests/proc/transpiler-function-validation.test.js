// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Function-graph validation tests for the transpiler.
 *
 * Every failure carries a stable message id plus graph and node details: self calls,
 * call cycles, disabled and removed callees, port-count mismatches, declared outputs
 * without an output node, and structural nodes outside a function graph.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS,
    GraphValidationError,
} from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';
import {
    MockNodeData,
    addCallNode,
    createCallingGraph,
    createEmitGraph,
    createFunctionGraph,
    transpile,
} from '../helpers/transpiler-function-harness.js';

/**
 * Transpile and return the failure.
 * @param {object[]} graphs - Graphs of the collection.
 * @returns {Promise<GraphValidationError>} The validation error.
 */
async function captureError(graphs) {
    try {
        await transpile(graphs);
    } catch (error) {
        assert.ok(error instanceof GraphValidationError, `unexpected error: ${error}`);
        return error;
    }
    assert.fail('expected transpilation to fail');
}

describe('transpiler function validation', () => {
    it('rejects a direct self call', async () => {
        const fn = createFunctionGraph({ id: 'fn-self', name: 'Recursive' });
        addCallNode(fn, { id: 'selfcall', calleeGraphId: 'fn-self' });

        const error = await captureError([fn]);

        assert.equal(error.messageId, FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.selfCall);
        assert.equal(error.details.graphId, 'fn-self');
        assert.equal(error.details.graphName, 'Recursive');
        assert.match(error.message, /^\[function-graph-self-call\]/);
    });

    it('rejects a cycle between two function graphs', async () => {
        const first = createFunctionGraph({ id: 'fn-a', name: 'First' });
        const second = createFunctionGraph({ id: 'fn-b', name: 'Second' });
        addCallNode(first, { id: 'callb', calleeGraphId: 'fn-b' });
        addCallNode(second, { id: 'calla', calleeGraphId: 'fn-a' });

        const error = await captureError([first, second]);

        assert.equal(error.messageId, FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.cycle);
        assert.deepEqual(error.details.graphNames, ['First', 'Second', 'First']);
    });

    it('rejects a call to a disabled function graph', async () => {
        const callee = createFunctionGraph({ id: 'fn-off', name: 'Disabled Function' });
        callee.enabled = false;
        const main = createCallingGraph({ name: 'Main', calleeGraphId: 'fn-off' });

        const error = await captureError([main, callee]);

        assert.equal(error.messageId, FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.disabledCallee);
        assert.equal(error.details.calleeGraphId, 'fn-off');
        assert.equal(error.details.graphName, 'Main');
    });

    it('rejects a call to a removed function graph', async () => {
        const main = createCallingGraph({ name: 'Main', typeId: 'function_graph.gone' });

        const error = await captureError([main]);

        assert.equal(error.messageId, FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.unknownCallee);
        assert.equal(error.details.calleeTypeId, 'function_graph.gone');
        assert.equal(error.details.nodeId, 'call');
    });

    it('rejects a call node whose connectors no longer match the signature', async () => {
        const callee = createFunctionGraph({
            id: 'fn-one',
            name: 'One Input',
            inputNames: ['only'],
        });
        const main = createCallingGraph({
            name: 'Main',
            calleeGraphId: 'fn-one',
            arguments: [1, 2],
        });

        const error = await captureError([main, callee]);

        assert.equal(error.messageId, FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.portCountMismatch);
        assert.equal(error.details.expectedInputs, 1);
        assert.equal(error.details.actualInputs, 2);
    });

    it('rejects declared outputs without an output node', async () => {
        const fn = createFunctionGraph({ id: 'fn-noout', name: 'No Output Node' });
        fn.nodes.delete('out');
        fn.connections = fn.connections.filter((connection) => connection.toNode !== 'out');

        const error = await captureError([fn]);

        assert.equal(error.messageId, FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.missingOutputNode);
        assert.equal(error.details.outputCount, 1);
        assert.equal(error.details.graphName, 'No Output Node');
    });

    it('rejects a structural function node in a non-function graph', async () => {
        const graph = createEmitGraph({ name: 'Main' });
        graph.addNode(
            'inputnode',
            new MockNodeData({
                id: 'inputnode',
                type: 'graph.function.input',
                outputs: [{ id: 'in_0', name: 'channel' }],
            })
        );

        const error = await captureError([graph]);

        assert.equal(
            error.messageId,
            FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.structuralInNonFunctionGraph
        );
        assert.equal(error.details.nodeType, 'graph.function.input');
        assert.equal(error.details.executionType, 'continuous');
    });
});
