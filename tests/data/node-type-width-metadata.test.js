import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import NodePackage from '../../src/micro_otter/nodes/html/js/data/node-package.js';
import { NodeType } from '../../src/micro_otter/nodes/html/js/data/node-type.js';

function createJsonResponse(payload) {
    return {
        ok: true,
        json: async () => payload,
    };
}

function createFetchFromMap(payloadByUrl) {
    return async (input) => {
        const url = String(input);
        if (!payloadByUrl.has(url)) {
            return { ok: false, json: async () => ({}) };
        }
        return createJsonResponse(payloadByUrl.get(url));
    };
}

describe('NodeType width metadata', () => {
    it('preserves width metadata through toDefinition()', () => {
        const nodeType = new NodeType({
            type: 'test.node',
            title: { en: 'Test Node' },
            defaultWidth: 220,
            minWidth: 160,
            maxWidth: 360,
        });

        assert.equal(nodeType.defaultWidth, 220);
        assert.equal(nodeType.minWidth, 160);
        assert.equal(nodeType.maxWidth, 360);

        const serialized = nodeType.toDefinition();
        assert.equal(serialized.defaultWidth, 220);
        assert.equal(serialized.minWidth, 160);
        assert.equal(serialized.maxWidth, 360);
    });

    it('accepts omitted and decimal width metadata values', () => {
        const nodeType = new NodeType({
            type: 'test.decimal',
            title: { en: 'Decimal Width Node' },
            defaultWidth: 200.5,
            minWidth: 120.25,
        });

        assert.equal(nodeType.defaultWidth, 200.5);
        assert.equal(nodeType.minWidth, 120.25);
        assert.equal(nodeType.maxWidth, null);
    });

    it('rejects invalid width metadata combinations', () => {
        assert.throws(
            () => new NodeType({ type: 'test.invalid.negative', defaultWidth: -1 }),
            /must be >= 0/
        );

        assert.throws(
            () => new NodeType({ type: 'test.invalid.bounds', minWidth: 300, maxWidth: 200 }),
            /minWidth cannot be greater than maxWidth/
        );

        assert.throws(
            () =>
                new NodeType({
                    type: 'test.invalid.default.min',
                    defaultWidth: 100,
                    minWidth: 120,
                }),
            /below minWidth/
        );

        assert.throws(
            () =>
                new NodeType({
                    type: 'test.invalid.default.max',
                    defaultWidth: 280,
                    maxWidth: 240,
                }),
            /exceeds maxWidth/
        );
    });
});

describe('NodePackage width metadata validation', () => {
    it('rejects malformed node width metadata during package load', async () => {
        const fetchImpl = createFetchFromMap(
            new Map([
                [
                    '/device/node_pkgs/test/manifest.json',
                    {
                        id: 'test',
                        nodeDefs: 'node_definitions.json',
                    },
                ],
                [
                    '/device/node_pkgs/test/node_definitions.json',
                    {
                        nodeTypes: {
                            bad: {
                                title: { en: 'Bad Width Node' },
                                defaultWidth: 100,
                                minWidth: 140,
                            },
                        },
                    },
                ],
            ])
        );

        const nodePackage = new NodePackage('/device/node_pkgs/test/');

        await assert.rejects(
            () => nodePackage.load(fetchImpl),
            /Invalid defaultWidth for node type "test.bad": defaultWidth is below minWidth\./
        );
    });
});
