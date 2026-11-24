import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import DeviceRuntime from '../../src/micro_otter/nodes/html/js/data/device-runtime.js';
import { DEFAULT_VARIANT_ID } from '../../src/micro_otter/nodes/html/js/data/package-resolver.js';

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

describe('DeviceRuntime node package id resolution', () => {
    it('resolves a global package whose id matches its folder', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                'runtime/general/manifest.json': {
                    id: 'general',
                    nodePackages: { global: ['core'], local: [] },
                },
                'node_pkgs/index.json': {
                    version: 1,
                    packages: [{ id: 'core', manifest: 'core/manifest.json' }],
                },
                'node_pkgs/core/manifest.json': { id: 'core', nodeDefs: 'node_definitions.json' },
                'node_pkgs/core/node_definitions.json': {
                    nodeTypes: { const: makeNodeType('Constant') },
                },
            }),
            '/device/node_pkgs',
            null
        );

        assert.ok(runtime.getNodePackage('core'), 'expected core package to be registered');
        assert.ok(runtime.getNodeType('core.const'), 'expected core.const node type to resolve');
    });

    it('resolves a global package id to a differently-named folder', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                'runtime/general/manifest.json': {
                    id: 'general',
                    nodePackages: { global: ['pkg'], local: [] },
                },
                'node_pkgs/index.json': {
                    version: 1,
                    packages: [{ id: 'pkg', manifest: 'variant/manifest.json' }],
                },
                'node_pkgs/variant/manifest.json': {
                    id: 'pkg',
                    nodeDefs: 'node_definitions.json',
                },
                'node_pkgs/variant/node_definitions.json': {
                    nodeTypes: { foo: makeNodeType('Foo') },
                },
            }),
            '/device/node_pkgs',
            null
        );

        assert.ok(runtime.getNodePackage('pkg'), 'expected pkg to be registered under its id');
        assert.ok(runtime.getNodeType('pkg.foo'), 'expected pkg.foo node type to resolve');
    });

    it('reports the logical id as packageId in the node types summary', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                'runtime/general/manifest.json': {
                    id: 'general',
                    nodePackages: { global: ['pkg'], local: [] },
                },
                'node_pkgs/index.json': {
                    version: 1,
                    packages: [{ id: 'pkg', manifest: 'variant/manifest.json' }],
                },
                'node_pkgs/variant/manifest.json': {
                    id: 'pkg',
                    nodeDefs: 'node_definitions.json',
                },
                'node_pkgs/variant/node_definitions.json': {
                    nodeTypes: { foo: makeNodeType('Foo') },
                },
            }),
            '/device/node_pkgs',
            null
        );

        const summary = runtime.getNodeTypesSummary();
        assert.ok(
            summary.some((entry) => entry.packageId === 'pkg' && entry.id === 'pkg.foo'),
            'expected summary to report packageId pkg for pkg.foo'
        );
    });

    it('throws for a global package id missing from the index', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await assert.rejects(
            runtime.load(
                makeFetch({
                    'runtime/general/manifest.json': {
                        id: 'general',
                        nodePackages: { global: ['missing'], local: [] },
                    },
                    'node_pkgs/index.json': {
                        version: 1,
                        packages: [{ id: 'core', manifest: 'core/manifest.json' }],
                    },
                }),
                '/device/node_pkgs',
                null
            ),
            /Unknown node package id/
        );
    });

    it('loads a single-manifest package and records both variants', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                'runtime/general/manifest.json': {
                    id: 'general',
                    nodePackages: { global: [], local: [], addons: ['pulse'] },
                },
                'node_pkgs/index.json': {
                    version: 2,
                    packages: [
                        { id: 'pulse', manifest: 'pulse/manifest.json' },
                    ],
                },
                'node_pkgs/pulse/manifest.json': {
                    id: 'pulse',
                    nodeDefs: 'node_definitions.json',
                    variants: {
                        py: { precedence: 0 },
                        viper: { requiredCapabilities: ['viper'], precedence: 10 },
                    },
                },
                'node_pkgs/pulse/node_definitions.json': {
                    nodeTypes: { greet: makeNodeType('Greet') },
                },
            }),
            '/device/node_pkgs',
            null
        );

        assert.ok(runtime.getNodeType('pulse.greet'), 'expected base node def to load');
        assert.equal(runtime.nodePackages.length, 1, 'expected one NodePackage per id');
        const variants = runtime.getPackageVariants('pulse');
        assert.equal(variants.length, 2);
        assert.equal(variants[0].variantId, 'viper');
        assert.equal(variants[1].variantId, DEFAULT_VARIANT_ID);
    });
});
