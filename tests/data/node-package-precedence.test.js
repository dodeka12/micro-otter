import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import NodePackage from '../../src/micro_otter/nodes/html/js/data/node-package.js';

function jsonResponse(data) {
    return { ok: true, status: 200, json: async () => data };
}

function makeFetch(routes) {
    return async (input) => {
        const url = String(input);
        for (const [suffix, data] of Object.entries(routes)) {
            if (url.endsWith(suffix)) {
                return jsonResponse(data);
            }
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
}

describe('NodePackage precedence', () => {
    it('parses precedence from the manifest', async () => {
        const pkg = new NodePackage('/device/node_pkgs/variant/');
        await pkg.load(
            makeFetch({
                'node_pkgs/variant/manifest.json': {
                    id: 'audio',
                    nodeDefs: 'node_definitions.json',
                    precedence: 100,
                },
                'node_pkgs/variant/node_definitions.json': { nodeTypes: {} },
            })
        );

        assert.equal(pkg.precedence, 100);
    });

    it('defaults precedence to 0 when absent', async () => {
        const pkg = new NodePackage('/device/node_pkgs/variant/');
        await pkg.load(
            makeFetch({
                'node_pkgs/variant/manifest.json': { id: 'audio', nodeDefs: 'node_definitions.json' },
                'node_pkgs/variant/node_definitions.json': { nodeTypes: {} },
            })
        );

        assert.equal(pkg.precedence, 0);
    });
});
