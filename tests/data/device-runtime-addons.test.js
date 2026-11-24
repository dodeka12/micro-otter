import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import DeviceRuntime from '../../src/micro_otter/nodes/html/js/data/device-runtime.js';

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

function makeNodeType(title) {
    return { title: { en: title }, inputs: [], outputs: [], controls: [] };
}

const MERGED_INDEX = {
    version: 1,
    packages: [
        { id: 'core', manifest: 'core/manifest.json' },
        { id: 'sample_addon', manifest: 'sample_addon/manifest.json', root: 'addons' },
    ],
};

function mergedRoutes(nodePackages) {
    return {
        'runtime/general/manifest.json': { id: 'general', nodePackages },
        'node_pkgs/index.json': MERGED_INDEX,
        'node_pkgs/core/manifest.json': { id: 'core', nodeDefs: 'node_definitions.json' },
        'node_pkgs/core/node_definitions.json': { nodeTypes: { const: makeNodeType('Constant') } },
        'node_pkgs/sample_addon/manifest.json': {
            id: 'sample_addon',
            version: '1.0.0',
            nodeDefs: 'node_definitions.json',
        },
        'node_pkgs/sample_addon/node_definitions.json': {
            nodeTypes: { hello: makeNodeType('Hello') },
        },
    };
}

describe('DeviceRuntime add-on node packages', () => {
    it('treats an absent addons key as an empty list', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch(mergedRoutes({ global: ['core'], local: [] })),
            '/device/node_pkgs',
            null
        );

        assert.deepEqual(runtime.nodePackagesAddons, []);
        assert.deepEqual(
            runtime.nodePackages.map((nodePackage) => nodePackage.id),
            ['core']
        );
        assert.equal(runtime.packageProvenance('core'), 'builtin');
        assert.equal(runtime.packageProvenance('unknown_pkg'), 'builtin');
    });

    it('loads an add-on package through the merged index', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch(
                mergedRoutes({ global: ['core'], local: [], addons: ['sample_addon'] })
            ),
            '/device/node_pkgs',
            null
        );

        assert.deepEqual(runtime.nodePackagesAddons, ['sample_addon']);
        assert.deepEqual(
            runtime.nodePackages.map((nodePackage) => nodePackage.id),
            ['core', 'sample_addon']
        );
        assert.ok(runtime.getNodePackage('sample_addon'));
        assert.ok(runtime.getNodeType('sample_addon.hello'));
        assert.equal(runtime.packageProvenance('sample_addon'), 'addon');
        assert.equal(runtime.packageProvenance('core'), 'builtin');
    });

    it('loads add-ons even when no global package is declared', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch(mergedRoutes({ global: [], local: [], addons: ['sample_addon'] })),
            '/device/node_pkgs',
            null
        );

        assert.deepEqual(
            runtime.nodePackages.map((nodePackage) => nodePackage.id),
            ['sample_addon']
        );
    });

    it('raises the duplicate-id error when a package is listed twice', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');

        await assert.rejects(
            runtime.load(
                makeFetch(
                    mergedRoutes({
                        global: ['sample_addon'],
                        local: [],
                        addons: ['sample_addon'],
                    })
                ),
                '/device/node_pkgs',
                null
            ),
            /Duplicate node package id "sample_addon"/
        );
    });
});
