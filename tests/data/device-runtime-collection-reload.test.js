// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Runtime-collection reloads: in-place runtime reuse and the `runtimesLoaded` event.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceRuntimeCollection } from '../../src/micro_otter/nodes/html/js/data/device-runtime-collection.js';

function jsonResponse(data) {
    return { ok: true, status: 200, json: async () => data };
}

function makeNodeType(title) {
    return { title: { en: title }, inputs: [], outputs: [], controls: [] };
}

/**
 * Build the served documents for a given set of installed add-on packages.
 * @param {string[]} addons - Add-on package ids the server currently reports in the merged index.
 * @returns {Record<string, unknown>} Route table keyed by URL suffix.
 */
function buildRoutes(addons) {
    const routes = {
        'device/manifest.json': {
            version: '1.0.0',
            nodePackagesPath: 'node_pkgs',
            deviceTargetsPath: 'targets',
            runtimesPath: 'runtime',
        },
        'device/runtime/manifest.json': {
            defaultRuntime: 'general',
            runtimes: { general: 'general' },
        },
        'device/runtime/general/manifest.json': {
            id: 'general',
            nodePackages: { global: ['core'], local: [], addons },
        },
        'device/targets/index.json': { version: 1, defaultTargetId: null, targets: [] },
        'device/node_pkgs/index.json': {
            version: 1,
            packages: [
                { id: 'core', manifest: 'core/manifest.json' },
                ...addons.map((id) => ({ id, manifest: `${id}/manifest.json` })),
            ],
        },
        'device/node_pkgs/core/manifest.json': { id: 'core', nodeDefs: 'node_definitions.json' },
        'device/node_pkgs/core/node_definitions.json': {
            nodeTypes: { const: makeNodeType('Constant') },
        },
    };

    for (const id of addons) {
        routes[`device/node_pkgs/${id}/manifest.json`] = {
            id,
            version: '1.0.0',
            nodeDefs: 'node_definitions.json',
            variants: { py: {} },
        };
        routes[`device/node_pkgs/${id}/node_definitions.json`] = {
            nodeTypes: { hello: makeNodeType('Hello') },
        };
    }

    return routes;
}

/**
 * Create a fetch stub over a mutable install state, so a test can install and uninstall packages.
 * @returns {{state: {addons: string[], failRuntimeManifest: boolean}, fetchImpl: (input: unknown) => Promise<{ok: boolean, status: number, json: () => Promise<unknown>}>}} Server stub.
 */
function createServer() {
    const state = { addons: [], failRuntimeManifest: false };

    const fetchImpl = async (input) => {
        const url = String(input);

        if (state.failRuntimeManifest && url.endsWith('device/runtime/manifest.json')) {
            return { ok: false, status: 404, json: async () => ({}) };
        }

        const routes = buildRoutes(state.addons);
        for (const [suffix, data] of Object.entries(routes)) {
            if (url.endsWith(suffix)) {
                return jsonResponse(data);
            }
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };

    return { state, fetchImpl };
}

describe('DeviceRuntimeCollection reloads', () => {
    it('keeps the runtime instance and announces the reload', async () => {
        const { state, fetchImpl } = createServer();
        const collection = new DeviceRuntimeCollection('/device/runtime');

        await collection.load(fetchImpl);
        const runtime = collection.getRuntime('general');
        assert.ok(runtime);
        assert.equal(runtime.getNodeType('sample_addon.hello'), null);
        assert.deepEqual(runtime.getPackageVariants('sample_addon'), []);

        const events = [];
        collection.on('runtimesLoaded', (event) => events.push(event));

        state.addons.push('sample_addon');
        await collection.load(fetchImpl);

        // The very same instance now reports the installed package: views that captured the
        // reference (palette, graph panel) stay valid.
        assert.equal(collection.getRuntime('general'), runtime);
        assert.ok(runtime.getNodeType('sample_addon.hello'));
        assert.ok(runtime.getPackageVariants('sample_addon').length > 0);

        assert.equal(events.length, 1);
        assert.equal(events[0].name, 'runtimesLoaded');
        assert.equal(events[0].detail.payloadTypeId, 'RuntimeCollection.RuntimesLoaded.v1');
        assert.deepEqual(events[0].detail.runtimeIds, ['general']);
        assert.equal(events[0].detail.activeRuntimeId, 'general');
    });

    it('forgets an uninstalled package on the reused instance', async () => {
        const { state, fetchImpl } = createServer();
        const collection = new DeviceRuntimeCollection('/device/runtime');

        state.addons.push('sample_addon');
        await collection.load(fetchImpl);
        const runtime = collection.getRuntime('general');
        assert.ok(runtime.getNodeType('sample_addon.hello'));

        state.addons.length = 0;
        await collection.load(fetchImpl);

        assert.equal(collection.getRuntime('general'), runtime);
        assert.equal(runtime.getNodeType('sample_addon.hello'), null);
        // Variant records are index-derived: they must not survive the reload either.
        assert.deepEqual(runtime.getPackageVariants('sample_addon'), []);
    });

    it('stays silent when the reload fails', async () => {
        const { state, fetchImpl } = createServer();
        const collection = new DeviceRuntimeCollection('/device/runtime');

        await collection.load(fetchImpl);

        const events = [];
        collection.on('runtimesLoaded', (event) => events.push(event));

        state.failRuntimeManifest = true;
        await assert.rejects(collection.load(fetchImpl));

        // A failed reload must not look like a successful one: the palette would otherwise rebuild
        // from an empty package list.
        assert.deepEqual(events, []);
    });
});
