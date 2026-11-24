// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for transpiler helper functions.
 *
 * These tests verify the pure utility functions used by the transpiler.
 * All helpers are side-effect-free and can be tested in Node.js without
 * a browser environment.
 *
 * Target: 100% code coverage
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createOutputVariableName,
    getNullLiteral,
    formatLiteral,
    indentMultiLine,
    createObjectLiteral,
    buildOutputConnectionLookup,
    buildInputConnectionLookup,
    computeConnectorMetadata,
    getTopologicallySortedNodeIds,
    normalizeNodeExecutionPhase,
    normalizeConnectorPhase,
    isNodeExecutionPhaseCompatible,
    isEdgePhaseCompatible,
    getPhaseCompatibleConnections,
    getTopologicallySortedNodeIdsForExecutionPhase,
    registerImportStatement,
    registerPythonFunctionImport,
    renderTemplate,
    resolveGlobalFunction,
    buildAssignmentStatement,
    cloneNodeForGenerator,
    sanitizeGraphFunctionName,
} from '../../src/micro_otter/nodes/html/js/proc/transpiler-helpers.js';

describe('Transpiler Helpers', () => {
    describe('createOutputVariableName', () => {
        it('creates variable name from node ID and output index', () => {
            assert.equal(createOutputVariableName('abc123', 0), 'node_abc123_out0');
            assert.equal(createOutputVariableName('my-node', 2), 'node_my-node_out2');
            assert.equal(createOutputVariableName('node_1', 5), 'node_node_1_out5');
        });

        it('handles special characters in node ID', () => {
            assert.equal(
                createOutputVariableName('node-with-dashes', 0),
                'node_node-with-dashes_out0'
            );
            assert.equal(
                createOutputVariableName('node_with_underscores', 1),
                'node_node_with_underscores_out1'
            );
        });
    });

    describe('getNullLiteral', () => {
        it('returns Python None literal', () => {
            assert.equal(getNullLiteral(), 'None');
        });
    });

    describe('formatLiteral', () => {
        it('converts null and undefined to None', () => {
            assert.equal(formatLiteral(null), 'None');
            assert.equal(formatLiteral(undefined), 'None');
        });

        it('converts numbers to Python literals', () => {
            assert.equal(formatLiteral(42), '42');
            assert.equal(formatLiteral(3.14), '3.14');
            assert.equal(formatLiteral(0), '0');
            assert.equal(formatLiteral(-10), '-10');
            assert.equal(formatLiteral(0.001), '0.001');
        });

        it('converts NaN and Infinity to None', () => {
            assert.equal(formatLiteral(NaN), 'None');
            assert.equal(formatLiteral(Infinity), 'None');
            assert.equal(formatLiteral(-Infinity), 'None');
        });

        it('converts booleans to Python True/False', () => {
            assert.equal(formatLiteral(true), 'True');
            assert.equal(formatLiteral(false), 'False');
        });

        it('converts strings with proper escaping', () => {
            assert.equal(formatLiteral('hello'), "'hello'");
            assert.equal(formatLiteral('world'), "'world'");
        });

        it('escapes single quotes in strings', () => {
            assert.equal(formatLiteral("it's"), "'it\\'s'");
            assert.equal(formatLiteral("can't"), "'can\\'t'");
        });

        it('escapes backslashes in strings', () => {
            assert.equal(formatLiteral('back\\slash'), "'back\\\\slash'");
            assert.equal(formatLiteral('path\\to\\file'), "'path\\\\to\\\\file'");
        });

        it('handles empty strings', () => {
            assert.equal(formatLiteral(''), "''");
        });

        it('converts other types to string', () => {
            assert.equal(formatLiteral({ toString: () => 'custom' }), 'custom');
        });
    });

    describe('indentMultiLine', () => {
        it('indents single line code', () => {
            assert.equal(indentMultiLine('x = 1', '    '), '    x = 1');
            assert.equal(indentMultiLine('print(hello)', '  '), '  print(hello)');
        });

        it('indents multi-line code with proper indentation on each line', () => {
            const code = 'x = 1\ny = 2\nz = 3';
            const result = indentMultiLine(code, '    ');
            assert.equal(result, '    x = 1\n    y = 2\n    z = 3');
        });

        it('preserves empty lines without indenting them', () => {
            const code = 'a = 1\n\nb = 2';
            const result = indentMultiLine(code, '    ');
            assert.equal(result, '    a = 1\n\n    b = 2');
        });

        it('handles code with multiple consecutive empty lines', () => {
            const code = 'a = 1\n\n\nb = 2';
            const result = indentMultiLine(code, '  ');
            assert.equal(result, '  a = 1\n\n\n  b = 2');
        });

        it('returns empty string for null or undefined input', () => {
            assert.equal(indentMultiLine(null, '    '), '');
            assert.equal(indentMultiLine(undefined, '    '), '');
            assert.equal(indentMultiLine('', '    '), '');
        });

        it('returns original code when indent is empty', () => {
            assert.equal(indentMultiLine('x = 1\ny = 2', ''), 'x = 1\ny = 2');
            assert.equal(indentMultiLine('code', null), 'code');
            assert.equal(indentMultiLine('code', undefined), 'code');
        });

        it('handles code that is already indented', () => {
            const code = '    x = 1\n    y = 2';
            const result = indentMultiLine(code, '    ');
            // Adds additional indent to each line
            assert.equal(result, '        x = 1\n        y = 2');
        });

        it('handles mixed indentation correctly', () => {
            const code = 'x = 1\n    y = 2\nz = 3';
            const result = indentMultiLine(code, '  ');
            assert.equal(result, '  x = 1\n      y = 2\n  z = 3');
        });

        it('works with double indent (for while loop bodies)', () => {
            const code = 'a = time.ticks_ms()\nb = a / 1000';
            const result = indentMultiLine(code, '        ');
            assert.equal(result, '        a = time.ticks_ms()\n        b = a / 1000');
        });

        it('handles time node generator output format', () => {
            // Real-world example from time node generator
            const code =
                'TIME_NODE_CURR_8 = time.ticks_ms()\nTIME_NODE_DELTA_8 = time.ticks_diff(TIME_NODE_CURR_8, TIME_NODE_PREV_8)\nTIME_NODE_PREV_8 = TIME_NODE_CURR_8\nnode_8_out0 = (TIME_NODE_CURR_8 / 1000)';
            const result = indentMultiLine(code, '        ');
            const expected =
                '        TIME_NODE_CURR_8 = time.ticks_ms()\n        TIME_NODE_DELTA_8 = time.ticks_diff(TIME_NODE_CURR_8, TIME_NODE_PREV_8)\n        TIME_NODE_PREV_8 = TIME_NODE_CURR_8\n        node_8_out0 = (TIME_NODE_CURR_8 / 1000)';
            assert.equal(result, expected);
        });
    });

    describe('createObjectLiteral', () => {
        it('converts empty object to empty dict', () => {
            assert.equal(createObjectLiteral({}), '{}');
        });

        it('handles null and undefined', () => {
            assert.equal(createObjectLiteral(null), '{}');
            assert.equal(createObjectLiteral(undefined), '{}');
        });

        it('converts object with single property', () => {
            assert.equal(createObjectLiteral({ a: 1 }), "{ 'a': 1 }");
        });

        it('converts object with multiple properties', () => {
            const result = createObjectLiteral({ a: 1, b: 'test' });
            // Values are not quoted - they're passed as-is for Python formatting
            assert.equal(result, "{ 'a': 1, 'b': test }");
        });

        it('filters out null and undefined values', () => {
            const result = createObjectLiteral({ a: 1, b: null, c: undefined, d: 2 });
            assert.equal(result, "{ 'a': 1, 'd': 2 }");
        });

        it('returns empty dict when all values are null/undefined', () => {
            assert.equal(createObjectLiteral({ a: null, b: undefined }), '{}');
        });
    });

    describe('buildOutputConnectionLookup', () => {
        it('builds map from empty connections', () => {
            const result = buildOutputConnectionLookup([]);
            assert.ok(result instanceof Map);
            assert.equal(result.size, 0);
        });

        it('handles null/undefined input', () => {
            const resultNull = buildOutputConnectionLookup(null);
            assert.equal(resultNull.size, 0);

            const resultUndef = buildOutputConnectionLookup(undefined);
            assert.equal(resultUndef.size, 0);
        });

        it('builds map with single connection', () => {
            const connections = [{ fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 }];
            const result = buildOutputConnectionLookup(connections);

            assert.equal(result.size, 1);
            assert.ok(result.has('a'));
            assert.ok(result.get('a').has(0));
        });

        it('builds map with multiple connections from same node', () => {
            const connections = [
                { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 },
                { fromNode: 'a', fromIndex: 1, toNode: 'c', toIndex: 0 },
                { fromNode: 'a', fromIndex: 0, toNode: 'd', toIndex: 0 }, // Duplicate fromIndex
            ];
            const result = buildOutputConnectionLookup(connections);

            assert.equal(result.size, 1);
            assert.ok(result.has('a'));
            assert.equal(result.get('a').size, 2); // Only indices 0 and 1
            assert.ok(result.get('a').has(0));
            assert.ok(result.get('a').has(1));
        });

        it('builds map with connections from multiple nodes', () => {
            const connections = [
                { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 },
                { fromNode: 'b', fromIndex: 0, toNode: 'c', toIndex: 0 },
                { fromNode: 'c', fromIndex: 1, toNode: 'd', toIndex: 0 },
            ];
            const result = buildOutputConnectionLookup(connections);

            assert.equal(result.size, 3);
            assert.ok(result.has('a'));
            assert.ok(result.has('b'));
            assert.ok(result.has('c'));
            assert.ok(result.get('a').has(0));
            assert.ok(result.get('b').has(0));
            assert.ok(result.get('c').has(1));
        });
    });

    describe('buildInputConnectionLookup', () => {
        it('builds map from empty connections', () => {
            const result = buildInputConnectionLookup([]);
            assert.ok(result instanceof Map);
            assert.equal(result.size, 0);
        });

        it('handles null/undefined input', () => {
            const resultNull = buildInputConnectionLookup(null);
            assert.equal(resultNull.size, 0);

            const resultUndef = buildInputConnectionLookup(undefined);
            assert.equal(resultUndef.size, 0);
        });

        it('builds map with single connection', () => {
            const connections = [{ fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 }];
            const result = buildInputConnectionLookup(connections);

            assert.equal(result.size, 1);
            assert.ok(result.has('b'));
            assert.deepEqual(result.get('b')[0], { fromNode: 'a', fromIndex: 0 });
        });

        it('builds map with multiple inputs to same node', () => {
            const connections = [
                { fromNode: 'a', fromIndex: 0, toNode: 'c', toIndex: 0 },
                { fromNode: 'b', fromIndex: 1, toNode: 'c', toIndex: 1 },
            ];
            const result = buildInputConnectionLookup(connections);

            assert.equal(result.size, 1);
            assert.ok(result.has('c'));
            assert.deepEqual(result.get('c')[0], { fromNode: 'a', fromIndex: 0 });
            assert.deepEqual(result.get('c')[1], { fromNode: 'b', fromIndex: 1 });
        });

        it('overwrites duplicate connections to same input index', () => {
            const connections = [
                { fromNode: 'a', fromIndex: 0, toNode: 'c', toIndex: 0 },
                { fromNode: 'b', fromIndex: 1, toNode: 'c', toIndex: 0 }, // Overwrites previous
            ];
            const result = buildInputConnectionLookup(connections);

            assert.deepEqual(result.get('c')[0], { fromNode: 'b', fromIndex: 1 });
        });
    });

    describe('computeConnectorMetadata', () => {
        it('computes metadata for empty node list', () => {
            const result = computeConnectorMetadata([], new Map(), new Map());
            assert.equal(result.size, 0);
        });

        it('computes metadata for node with no connections', () => {
            const nodes = [
                {
                    id: 'node-1',
                    inputs: [{ id: 'in0', name: 'Value' }],
                    outputs: [{ id: 'out0', name: 'Result' }],
                },
            ];
            const result = computeConnectorMetadata(nodes, new Map(), new Map());

            assert.equal(result.size, 1);
            const meta = result.get('node-1');
            assert.equal(meta.inputsMeta.length, 1);
            assert.equal(meta.outputsMeta.length, 1);
            assert.equal(meta.inputsMeta[0].id, 'in0');
            assert.equal(meta.inputsMeta[0].name, 'Value');
            assert.equal(meta.inputsMeta[0].connected, false);
            assert.equal(meta.outputsMeta[0].id, 'out0');
            assert.equal(meta.outputsMeta[0].name, 'Result');
            assert.equal(meta.outputsMeta[0].varName, 'node_node-1_out0');
            assert.equal(meta.outputsMeta[0].connected, false);
        });

        it('computes metadata with connected inputs', () => {
            const nodes = [
                { id: 'a', inputs: [{ id: 'in0' }], outputs: [{ id: 'out0' }] },
                { id: 'b', inputs: [{ id: 'in0' }], outputs: [{ id: 'out0' }] },
            ];
            const inputLookup = new Map([['b', { 0: { fromNode: 'a', fromIndex: 0 } }]]);
            const outputLookup = new Map([['a', new Set([0])]]);

            const result = computeConnectorMetadata(nodes, inputLookup, outputLookup);

            assert.equal(result.get('b').inputsMeta[0].connected, true);
            assert.equal(result.get('a').outputsMeta[0].connected, true);
        });

        it('handles nodes with missing input/output names', () => {
            const nodes = [{ id: 'node-1', inputs: [{ id: 'in0' }], outputs: [{}] }];
            const result = computeConnectorMetadata(nodes, new Map(), new Map());

            const meta = result.get('node-1');
            assert.equal(meta.inputsMeta[0].name, 'in0'); // Falls back to id
            assert.equal(meta.outputsMeta[0].id, 'out0'); // Auto-generated
            assert.equal(meta.outputsMeta[0].name, 'out0'); // Auto-generated
        });

        it('handles nodes with no inputs or outputs', () => {
            const nodes = [{ id: 'node-1', inputs: [], outputs: [] }];
            const result = computeConnectorMetadata(nodes, new Map(), new Map());

            const meta = result.get('node-1');
            assert.equal(meta.inputsMeta.length, 0);
            assert.equal(meta.outputsMeta.length, 0);
        });
    });

    describe('getTopologicallySortedNodeIds', () => {
        it('sorts nodes with no connections', () => {
            const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
            const result = getTopologicallySortedNodeIds(nodes, []);

            assert.equal(result.length, 3);
            assert.ok(result.includes('a'));
            assert.ok(result.includes('b'));
            assert.ok(result.includes('c'));
        });

        it('sorts nodes in dependency order', () => {
            const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
            const connections = [
                { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 },
                { fromNode: 'b', fromIndex: 0, toNode: 'c', toIndex: 0 },
            ];
            const result = getTopologicallySortedNodeIds(nodes, connections);

            assert.deepEqual(result, ['a', 'b', 'c']);
        });

        it('handles multiple dependency paths', () => {
            const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
            const connections = [
                { fromNode: 'a', fromIndex: 0, toNode: 'c', toIndex: 0 },
                { fromNode: 'b', fromIndex: 0, toNode: 'c', toIndex: 1 },
                { fromNode: 'c', fromIndex: 0, toNode: 'd', toIndex: 0 },
            ];
            const result = getTopologicallySortedNodeIds(nodes, connections);

            // a and b can be in any order, but both must come before c, and c before d
            const aIndex = result.indexOf('a');
            const bIndex = result.indexOf('b');
            const cIndex = result.indexOf('c');
            const dIndex = result.indexOf('d');

            assert.ok(aIndex < cIndex);
            assert.ok(bIndex < cIndex);
            assert.ok(cIndex < dIndex);
        });

        it('throws error on cyclic graph (2 nodes)', () => {
            const nodes = [{ id: 'a' }, { id: 'b' }];
            const connections = [
                { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 },
                { fromNode: 'b', fromIndex: 0, toNode: 'a', toIndex: 0 },
            ];

            assert.throws(
                () => getTopologicallySortedNodeIds(nodes, connections),
                /Cycle detected in node graph/
            );
        });

        it('throws error on cyclic graph (3 nodes)', () => {
            const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
            const connections = [
                { fromNode: 'a', fromIndex: 0, toNode: 'b', toIndex: 0 },
                { fromNode: 'b', fromIndex: 0, toNode: 'c', toIndex: 0 },
                { fromNode: 'c', fromIndex: 0, toNode: 'a', toIndex: 0 },
            ];

            assert.throws(
                () => getTopologicallySortedNodeIds(nodes, connections),
                /Cycle detected in node graph/
            );
        });

        it('handles self-loop as cycle', () => {
            const nodes = [{ id: 'a' }];
            const connections = [{ fromNode: 'a', fromIndex: 0, toNode: 'a', toIndex: 0 }];

            assert.throws(
                () => getTopologicallySortedNodeIds(nodes, connections),
                /Cycle detected in node graph/
            );
        });

        it('handles empty inputs gracefully', () => {
            const result1 = getTopologicallySortedNodeIds(null, []);
            assert.deepEqual(result1, []);

            const result2 = getTopologicallySortedNodeIds([], null);
            assert.deepEqual(result2, []);
        });
    });

    describe('phase helpers', () => {
        it('normalizes node execution phase with loop default', () => {
            assert.equal(normalizeNodeExecutionPhase('init'), 'init');
            assert.equal(normalizeNodeExecutionPhase('loop'), 'loop');
            assert.equal(normalizeNodeExecutionPhase('both'), 'both');
            assert.equal(normalizeNodeExecutionPhase(undefined), 'loop');
            assert.equal(normalizeNodeExecutionPhase('invalid'), 'loop');
        });

        it('normalizes connector phase with both default', () => {
            assert.equal(normalizeConnectorPhase('init'), 'init');
            assert.equal(normalizeConnectorPhase('loop'), 'loop');
            assert.equal(normalizeConnectorPhase('both'), 'both');
            assert.equal(normalizeConnectorPhase(undefined), 'both');
            assert.equal(normalizeConnectorPhase('invalid'), 'both');
        });

        it('checks node and edge compatibility by execution phase', () => {
            assert.equal(isNodeExecutionPhaseCompatible('init', 'init'), true);
            assert.equal(isNodeExecutionPhaseCompatible('init', 'loop'), false);
            assert.equal(isNodeExecutionPhaseCompatible(undefined, 'loop'), true);

            assert.equal(isEdgePhaseCompatible('both', 'both', 'init'), true);
            assert.equal(isEdgePhaseCompatible('loop', 'both', 'init'), false);
            assert.equal(isEdgePhaseCompatible(undefined, undefined, 'loop'), true);
        });

        it('filters and sorts phase-compatible graph slices from one DAG', () => {
            const nodes = [
                { id: 'initA', executionPhase: 'init' },
                { id: 'bothB', executionPhase: 'both' },
                { id: 'loopC', executionPhase: 'loop' },
            ];
            const connections = [
                {
                    fromNode: 'initA',
                    fromIndex: 0,
                    toNode: 'bothB',
                    toIndex: 0,
                    outputPhase: 'init',
                    inputPhase: 'init',
                },
                {
                    fromNode: 'bothB',
                    fromIndex: 0,
                    toNode: 'loopC',
                    toIndex: 0,
                    outputPhase: 'loop',
                    inputPhase: 'loop',
                },
            ];

            const initConnections = getPhaseCompatibleConnections(nodes, connections, 'init');
            const loopConnections = getPhaseCompatibleConnections(nodes, connections, 'loop');
            assert.deepEqual(initConnections.map((conn) => `${conn.fromNode}->${conn.toNode}`), [
                'initA->bothB',
            ]);
            assert.deepEqual(loopConnections.map((conn) => `${conn.fromNode}->${conn.toNode}`), [
                'bothB->loopC',
            ]);

            const initPlan = getTopologicallySortedNodeIdsForExecutionPhase(
                nodes,
                connections,
                'init'
            );
            const loopPlan = getTopologicallySortedNodeIdsForExecutionPhase(
                nodes,
                connections,
                'loop'
            );

            assert.deepEqual(initPlan, ['initA', 'bothB']);
            assert.deepEqual(loopPlan, ['bothB', 'loopC']);
        });

        it('keeps legacy nodes without executionPhase in loop scheduling', () => {
            const nodes = [
                { id: 'legacySource' },
                { id: 'legacyTarget' },
            ];
            const connections = [
                {
                    fromNode: 'legacySource',
                    fromIndex: 0,
                    toNode: 'legacyTarget',
                    toIndex: 0,
                },
            ];

            const initPlan = getTopologicallySortedNodeIdsForExecutionPhase(
                nodes,
                connections,
                'init'
            );
            const loopPlan = getTopologicallySortedNodeIdsForExecutionPhase(
                nodes,
                connections,
                'loop'
            );

            assert.deepEqual(initPlan, []);
            assert.deepEqual(loopPlan, ['legacySource', 'legacyTarget']);
        });
    });

    describe('registerImportStatement', () => {
        it('adds import to Set', () => {
            const imports = new Set();
            registerImportStatement(imports, 'import machine');

            assert.equal(imports.size, 1);
            assert.ok(imports.has('import machine'));
        });

        it('deduplicates imports', () => {
            const imports = new Set();
            registerImportStatement(imports, 'import machine');
            registerImportStatement(imports, 'import machine');
            registerImportStatement(imports, 'import machine');

            assert.equal(imports.size, 1);
        });

        it('trims whitespace', () => {
            const imports = new Set();
            registerImportStatement(imports, '  import machine  ');

            assert.ok(imports.has('import machine'));
        });

        it('ignores empty strings', () => {
            const imports = new Set();
            registerImportStatement(imports, '');
            registerImportStatement(imports, '   ');

            assert.equal(imports.size, 0);
        });

        it('handles null collector gracefully', () => {
            assert.doesNotThrow(() => {
                registerImportStatement(null, 'import machine');
            });
        });

        it('handles non-string statements', () => {
            const imports = new Set();
            registerImportStatement(imports, null);
            registerImportStatement(imports, undefined);
            registerImportStatement(imports, 123);

            assert.equal(imports.size, 0);
        });

        it('adds multiple different imports', () => {
            const imports = new Set();
            registerImportStatement(imports, 'import machine');
            registerImportStatement(imports, 'from utime import sleep');
            registerImportStatement(imports, 'import sys');

            assert.equal(imports.size, 3);
            assert.ok(imports.has('import machine'));
            assert.ok(imports.has('from utime import sleep'));
            assert.ok(imports.has('import sys'));
        });
    });

    describe('registerPythonFunctionImport', () => {
        it('registers function import from dotted path', () => {
            const imports = new Set();
            const result = registerPythonFunctionImport('otter_stdmo.servo.ServoFn', imports);

            assert.equal(result, 'ServoFn');
            assert.ok(imports.has('from otter_stdmo.servo import ServoFn'));
        });

        it('handles single-segment module path', () => {
            const imports = new Set();
            const result = registerPythonFunctionImport('module.Function', imports);

            assert.equal(result, 'Function');
            assert.ok(imports.has('from module import Function'));
        });

        it('handles deeply nested paths', () => {
            const imports = new Set();
            const result = registerPythonFunctionImport('a.b.c.d.e.MyFunc', imports);

            assert.equal(result, 'MyFunc');
            assert.ok(imports.has('from a.b.c.d.e import MyFunc'));
        });

        it('returns null for invalid paths', () => {
            const imports = new Set();

            assert.equal(registerPythonFunctionImport('', imports), null);
            assert.equal(registerPythonFunctionImport('   ', imports), null);
            assert.equal(registerPythonFunctionImport('SingleSegment', imports), null);
            assert.equal(imports.size, 0);
        });

        it('handles null/undefined inputs', () => {
            const imports = new Set();

            assert.equal(registerPythonFunctionImport(null, imports), null);
            assert.equal(registerPythonFunctionImport(undefined, imports), null);
            assert.equal(registerPythonFunctionImport('valid.path', null), null);
        });

        it('trims whitespace from path', () => {
            const imports = new Set();
            const result = registerPythonFunctionImport('  module.Function  ', imports);

            assert.equal(result, 'Function');
            assert.ok(imports.has('from module import Function'));
        });
    });

    describe('renderTemplate', () => {
        it('replaces single placeholder', () => {
            const result = renderTemplate('Hello {{name}}!', { name: 'World' });
            assert.equal(result, 'Hello World!');
        });

        it('replaces multiple placeholders', () => {
            const result = renderTemplate('{{a}} + {{b}} = {{c}}', { a: '5', b: '3', c: '8' });
            assert.equal(result, '5 + 3 = 8');
        });

        it('trims whitespace around placeholder names', () => {
            const result = renderTemplate('{{ name }}', { name: 'Test' });
            assert.equal(result, 'Test');
        });

        it('replaces missing keys with empty string', () => {
            const result = renderTemplate('{{exists}} {{missing}}', { exists: 'yes' });
            assert.equal(result, 'yes ');
        });

        it('handles empty template', () => {
            assert.equal(renderTemplate('', { name: 'Test' }), '');
        });

        it('handles null/undefined template', () => {
            assert.equal(renderTemplate(null, { name: 'Test' }), '');
            assert.equal(renderTemplate(undefined, { name: 'Test' }), '');
        });

        it('handles template with no placeholders', () => {
            const result = renderTemplate('Plain text', { name: 'Test' });
            assert.equal(result, 'Plain text');
        });

        it('handles repeated placeholders', () => {
            const result = renderTemplate('{{x}} and {{x}} and {{x}}', { x: 'value' });
            assert.equal(result, 'value and value and value');
        });

        it('handles special characters in values', () => {
            const result = renderTemplate('{{value}}', { value: 'it\'s "quoted"' });
            assert.equal(result, 'it\'s "quoted"');
        });
    });

    describe('resolveGlobalFunction', () => {
        it('resolves global function from path', () => {
            global.TestLib = { myFunc: () => 'test' };

            const result = resolveGlobalFunction('TestLib.myFunc');
            assert.equal(typeof result, 'function');
            assert.equal(result(), 'test');

            delete global.TestLib;
        });

        it('resolves nested paths', () => {
            global.A = { B: { C: { func: () => 42 } } };

            const result = resolveGlobalFunction('A.B.C.func');
            assert.equal(result(), 42);

            delete global.A;
        });

        it('returns undefined for non-existent paths', () => {
            const result = resolveGlobalFunction('DoesNotExist.func');
            assert.equal(result, undefined);
        });

        it('returns null for null/undefined input', () => {
            assert.equal(resolveGlobalFunction(null), null);
            assert.equal(resolveGlobalFunction(undefined), null);
            assert.equal(resolveGlobalFunction(''), null);
        });

        it('handles empty segments', () => {
            global.Test = { value: 123 };

            const result = resolveGlobalFunction('Test..value');
            // Empty segments are filtered, so Test..value becomes Test.value
            assert.equal(result, 123);

            delete global.Test;
        });

        it('resolves top-level global', () => {
            global.topLevel = 'value';

            const result = resolveGlobalFunction('topLevel');
            assert.equal(result, 'value');

            delete global.topLevel;
        });
    });

    describe('buildAssignmentStatement', () => {
        it('builds simple assignment', () => {
            const result = buildAssignmentStatement(['result'], '5 + 3');
            assert.equal(result, 'result = 5 + 3');
        });

        it('builds tuple unpacking for multiple outputs', () => {
            const result = buildAssignmentStatement(['x', 'y'], 'divmod(10, 3)');
            assert.equal(result, 'x, y = divmod(10, 3)');
        });

        it('returns expression for no outputs', () => {
            const result = buildAssignmentStatement([], 'print("side effect")');
            assert.equal(result, 'print("side effect")');
        });

        it('handles null/undefined output vars', () => {
            const result1 = buildAssignmentStatement(null, 'expression');
            assert.equal(result1, 'expression');

            const result2 = buildAssignmentStatement(undefined, 'expression');
            assert.equal(result2, 'expression');
        });

        it('returns empty string for empty expression', () => {
            assert.equal(buildAssignmentStatement(['x'], ''), '');
            assert.equal(buildAssignmentStatement(['x'], null), '');
            assert.equal(buildAssignmentStatement(['x'], undefined), '');
        });

        it('trims expression whitespace', () => {
            const result = buildAssignmentStatement(['x'], '  expression  ');
            assert.equal(result, 'x = expression');
        });

        it('handles three or more outputs', () => {
            const result = buildAssignmentStatement(['a', 'b', 'c', 'd'], 'unpack()');
            assert.equal(result, 'a, b, c, d = unpack()');
        });
    });

    describe('cloneNodeForGenerator', () => {
        it('clones node with all properties', () => {
            const node = {
                id: 'node-1',
                type: 'math',
                title: 'Math Node',
                inputs: [{ id: 'in0', name: 'Value' }],
                outputs: [{ id: 'out0', name: 'Result' }],
                controls: [{ type: 'number', id: 'factor', value: 2 }],
                controlValues: { factor: 2 },
                inputDefaults: { in0: 0 },
            };

            const clone = cloneNodeForGenerator(node);

            assert.equal(clone.id, 'node-1');
            assert.equal(clone.type, 'math');
            assert.equal(clone.title, 'Math Node');
            assert.deepEqual(clone.inputs, node.inputs);
            assert.deepEqual(clone.outputs, node.outputs);
            assert.deepEqual(clone.controls, node.controls);
            assert.deepEqual(clone.controlValues, { in0: 0, factor: 2 });
            assert.deepEqual(clone.inputDefaults, { in0: 0 });
            assert.notEqual(clone, node); // Different object
        });

        it('merges inputDefaults into controlValues with controlValues taking precedence', () => {
            const node = {
                id: 'node-1',
                type: 'web-view-select',
                controls: [{ id: 'optionCount', type: 'dropdown' }],
                controlValues: { optionCount: 2, defaultIndex: 1 },
                inputDefaults: { value_1: '1', value_2: '2', optionCount: 99 },
            };

            const clone = cloneNodeForGenerator(node);

            assert.deepEqual(clone.controlValues, {
                value_1: '1',
                value_2: '2',
                optionCount: 2,
                defaultIndex: 1,
            });
            assert.deepEqual(clone.inputDefaults, {
                value_1: '1',
                value_2: '2',
                optionCount: 99,
            });
        });

        it('deep clones nested objects', () => {
            const node = {
                id: 'node-1',
                type: 'test',
                controls: [{ nested: { value: 42 } }],
                controlValues: {},
                inputDefaults: {},
            };

            const clone = cloneNodeForGenerator(node);

            clone.controls[0].nested.value = 100;
            assert.equal(node.controls[0].nested.value, 42); // Original unchanged
        });

        it('returns null for null/undefined input', () => {
            assert.equal(cloneNodeForGenerator(null), null);
            assert.equal(cloneNodeForGenerator(undefined), null);
        });

        it('handles missing properties with defaults', () => {
            const node = { id: 'node-1', type: 'simple' };
            const clone = cloneNodeForGenerator(node);

            assert.deepEqual(clone.inputs, []);
            assert.deepEqual(clone.outputs, []);
            assert.deepEqual(clone.controls, []);
            assert.deepEqual(clone.controlValues, {});
            assert.deepEqual(clone.inputDefaults, {});
        });
    });

    describe('sanitizeGraphFunctionName', () => {
        it('sanitizes simple graph name', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('Main Graph', 'graph', used);

            assert.equal(result, 'main_graph');
            assert.ok(used.has('main_graph'));
        });

        it('makes name unique when already used', () => {
            const used = new Set(['main_graph']);
            const result = sanitizeGraphFunctionName('Main Graph', 'graph', used);

            assert.equal(result, 'main_graph_2');
            assert.ok(used.has('main_graph_2'));
        });

        it('increments counter for multiple duplicates', () => {
            const used = new Set(['test', 'test_2', 'test_3']);
            const result = sanitizeGraphFunctionName('Test', 'graph', used);

            assert.equal(result, 'test_4');
        });

        it('removes non-alphanumeric characters', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('My-Cool Graph!', 'graph', used);

            assert.equal(result, 'my_cool_graph');
        });

        it('strips leading and trailing underscores', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('__graph__', 'graph', used);

            assert.equal(result, 'graph');
        });

        it('prepends g_ if name starts with digit', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('123 Graph', 'graph', used);

            assert.equal(result, 'g_123_graph');
        });

        it('uses fallback for empty name', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('', 'fallback', used);

            assert.equal(result, 'fallback');
        });

        it('uses default fallback when none provided', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('', null, used);

            assert.equal(result, 'graph');
        });

        it('handles whitespace-only names', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('   ', 'graph', used);

            assert.equal(result, 'graph');
        });

        it('preserves valid Python identifiers', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('valid_name', 'graph', used);

            assert.equal(result, 'valid_name');
        });

        it('handles multiple consecutive underscores', () => {
            const used = new Set();
            const result = sanitizeGraphFunctionName('test___name', 'graph', used);

            // Multiple underscores are preserved (not collapsed)
            assert.equal(result, 'test___name');
        });
    });
});
