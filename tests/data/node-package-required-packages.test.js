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

async function loadPackage(manifest) {
    const pkg = new NodePackage('/device/node_pkgs/variant/');
    await pkg.load(
        makeFetch({
            'node_pkgs/variant/manifest.json': { id: 'variant', nodeDefs: 'node_definitions.json', ...manifest },
            'node_pkgs/variant/node_definitions.json': { nodeTypes: {} },
        })
    );
    return pkg;
}

describe('NodePackage requiredPackages', () => {
    it('parses required package ids from the manifest', async () => {
        const pkg = await loadPackage({ requiredPackages: ['vars'] });

        assert.deepEqual(pkg.requiredPackages, ['vars']);
    });

    it('defaults to an empty list when the manifest omits the field', async () => {
        const pkg = await loadPackage({});

        assert.deepEqual(pkg.requiredPackages, []);
    });

    it('ignores non-array values without throwing', async () => {
        for (const requiredPackages of ['vars', null, { vars: true }, 7]) {
            const pkg = await loadPackage({ requiredPackages });

            assert.deepEqual(pkg.requiredPackages, []);
        }
    });

    it('trims entries and drops empties and non-strings', async () => {
        const pkg = await loadPackage({ requiredPackages: [' vars ', '', 7] });

        assert.deepEqual(pkg.requiredPackages, ['vars']);
    });

    it('does not read the per-implementation dependencies key', async () => {
        const pkg = await loadPackage({ dependencies: ['vars'] });

        assert.deepEqual(pkg.requiredPackages, []);
    });
});
