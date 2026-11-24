// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    collectUsedPackageIds,
    packageIdForNodeType,
} from '../../src/micro_otter/nodes/html/js/data/node-package-usage.js';

describe('packageIdForNodeType', () => {
    it('splits dot ids at the first dot', () => {
        assert.equal(packageIdForNodeType('led.led-neopixel-output'), 'led');
    });

    it('splits legacy dash ids at the dash', () => {
        assert.equal(packageIdForNodeType('led-led-neopixel'), 'led');
    });

    it('keeps a bare id without a separator', () => {
        assert.equal(packageIdForNodeType('core'), 'core');
    });

    it('returns an empty string for a blank id', () => {
        assert.equal(packageIdForNodeType('   '), '');
        assert.equal(packageIdForNodeType(''), '');
    });

    it('prefers the earliest of a dot and a dash', () => {
        assert.equal(packageIdForNodeType('a.b-c'), 'a');
    });
});

describe('collectUsedPackageIds', () => {
    const packages = [
        { id: 'core', requiredPackages: ['vars'] },
        { id: 'vars', requiredPackages: null },
        { id: 'led', requiredPackages: ['core'] },
        { id: 'a', requiredPackages: ['b'] },
        { id: 'b', requiredPackages: ['a'] },
    ];

    it('collects packages from node ids and their transitive requirements', () => {
        const used = collectUsedPackageIds(['led.led-neopixel-output'], packages);

        assert.deepEqual([...used].sort(), ['core', 'led', 'vars']);
    });

    it('closes over cycles and unknown ids without looping', () => {
        const used = collectUsedPackageIds(['a.one'], packages);

        assert.deepEqual([...used].sort(), ['a', 'b']);
    });

    it('ignores node ids that resolve to no package', () => {
        const used = collectUsedPackageIds(['', '   '], packages);

        assert.equal(used.size, 0);
    });

    it('treats a missing requiredPackages field as no dependencies', () => {
        const used = collectUsedPackageIds(['vars.one'], packages);

        assert.deepEqual([...used], ['vars']);
    });

    it('skips function-graph-managed ids, which no firmware package provides', () => {
        const used = collectUsedPackageIds(
            [
                'function_graph.graph-6',
                'graph.function.input',
                'graph.function.output',
                'led.led-neopixel-output',
            ],
            packages
        );

        assert.deepEqual([...used].sort(), ['core', 'led', 'vars']);
    });
});
