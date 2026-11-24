import {
    buildInputConnectionLookup,
    buildOutputConnectionLookup,
} from '../../../src/micro_otter/nodes/html/js/proc/transpiler-helpers.js';

export function createTranspilerNode(id, inputNames = [], outputNames = []) {
    return {
        id,
        type: 'dummy',
        title: `Node ${id}`,
        inputs: inputNames.map((name, idx) => ({ id: `in${idx}`, name })),
        outputs: outputNames.map((name, idx) => ({ id: `out${idx}`, name })),
    };
}

export function createTranspilerConnection({ fromNode, fromIndex = 0, toNode, toIndex = 0 }) {
    return {
        fromNode,
        fromIndex,
        toNode,
        toIndex,
    };
}

export function createConnectorLookups(connections = []) {
    return {
        inputLookup: buildInputConnectionLookup(connections),
        outputLookup: buildOutputConnectionLookup(connections),
    };
}
