// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

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

const INDEX = {
    version: 1,
    packages: [{ id: 'core', manifest: 'core/manifest.json' }],
};

function routes(nodePackages) {
    return {
        'runtime/general/manifest.json': { id: 'general', nodePackages },
        'node_pkgs/index.json': INDEX,
        'node_pkgs/core/manifest.json': { id: 'core', nodeDefs: 'node_definitions.json' },
        'node_pkgs/core/node_definitions.json': { nodeTypes: { const: makeNodeType('Constant') } },
    };
}

async function loadRuntime(nodePackages) {
    const runtime = new DeviceRuntime('/device/runtime/general');
    await runtime.load(makeFetch(routes(nodePackages)), '/device/node_pkgs', null);
    return runtime;
}

describe('DeviceRuntime optional node packages', () => {
    it('treats an absent optional key as an empty list', async () => {
        const runtime = await loadRuntime({ global: ['core'], local: [] });
        assert.deepEqual(runtime.nodePackagesOptional, []);
        assert.equal(runtime.isOptionalPackage('core'), false);
        assert.equal(runtime.isOptionalPackage('unknown_pkg'), false);
    });

    it('parses a present optional key in manifest order', async () => {
        const runtime = await loadRuntime({
            global: ['core'],
            local: [],
            optional: ['core'],
        });
        assert.deepEqual(runtime.nodePackagesOptional, ['core']);
        assert.equal(runtime.isOptionalPackage('core'), true);
        assert.equal(runtime.isOptionalPackage('unknown_pkg'), false);
    });

    it('normalises a non-array optional key to an empty list', async () => {
        const runtime = await loadRuntime({ global: ['core'], local: [], optional: 'core' });
        assert.deepEqual(runtime.nodePackagesOptional, []);
    });

    it('does not filter packages based on optional', async () => {
        const runtime = await loadRuntime({
            global: ['core'],
            local: [],
            optional: ['unlisted_pkg'],
        });
        assert.deepEqual(
            runtime.nodePackages.map((nodePackage) => nodePackage.id),
            ['core']
        );
        assert.equal(runtime.isOptionalPackage('unlisted_pkg'), true);
    });
});
