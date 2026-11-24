// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

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

describe('NodePackage variant mpAssets', () => {
    it('reads mpAssets from the v2 variants dict', async () => {
        const pkg = new NodePackage('/device/node_pkgs/vars/');
        await pkg.load(
            makeFetch({
                'node_pkgs/vars/manifest.json': {
                    id: 'vars',
                    nodeDefs: 'node_definitions.json',
                    variants: {
                        py: {
                            mpAssets: {
                                '*': ['otter_vars/__init__.py', 'otter_vars/store.py'],
                            },
                        },
                    },
                },
                'node_pkgs/vars/node_definitions.json': { nodeTypes: {} },
            })
        );

        assert.deepEqual(
            [...(pkg.mpAssets['*'] ?? [])].sort(),
            [
                '/device/node_pkgs/vars/otter_vars/__init__.py',
                '/device/node_pkgs/vars/otter_vars/store.py',
            ].sort()
        );
    });

    it('keeps a top-level mpAssets map over variant assets', async () => {
        const pkg = new NodePackage('/device/node_pkgs/legacy/');
        await pkg.load(
            makeFetch({
                'node_pkgs/legacy/manifest.json': {
                    id: 'legacy',
                    nodeDefs: 'node_definitions.json',
                    mpAssets: { '*': ['otter_legacy/__init__.py'] },
                    variants: { py: { mpAssets: { '*': ['otter_legacy_v2/__init__.py'] } } },
                },
                'node_pkgs/legacy/node_definitions.json': { nodeTypes: {} },
            })
        );

        assert.deepEqual(pkg.mpAssets['*'], [
            '/device/node_pkgs/legacy/otter_legacy/__init__.py',
        ]);
    });

    it('unions the mpAssets of multiple variants', async () => {
        const pkg = new NodePackage('/device/node_pkgs/pulse/');
        await pkg.load(
            makeFetch({
                'node_pkgs/pulse/manifest.json': {
                    id: 'pulse',
                    nodeDefs: 'node_definitions.json',
                    variants: {
                        py: { mpAssets: { '*': ['moa_pulse/__init__.py'] } },
                        viper: { mpAssets: { '*': ['moa_pulse_viper/__init__.py'] } },
                    },
                },
                'node_pkgs/pulse/node_definitions.json': { nodeTypes: {} },
            })
        );

        assert.deepEqual(
            [...(pkg.mpAssets['*'] ?? [])].sort(),
            [
                '/device/node_pkgs/pulse/moa_pulse/__init__.py',
                '/device/node_pkgs/pulse/moa_pulse_viper/__init__.py',
            ].sort()
        );
    });
});
