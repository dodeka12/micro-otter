// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    FIRMWARE_CONTENT_MISMATCH,
    compareVersions,
    parseSemver,
    resolveFirmwareModulePlan,
} from '../../src/micro_otter/nodes/html/js/deployment/embedded-module-plan.js';

describe('parseSemver', () => {
    it('parses a strict x.y.z version', () => {
        assert.deepEqual(parseSemver('1.2.3'), {
            major: 1,
            minor: 2,
            patch: 3,
            prerelease: null,
        });
    });

    it('accepts a prerelease and build metadata', () => {
        assert.deepEqual(parseSemver('1.2.3-rc.1+build.7'), {
            major: 1,
            minor: 2,
            patch: 3,
            prerelease: ['rc', '1'],
        });
    });

    it('rejects non-semver values', () => {
        assert.equal(parseSemver('v1.2.3'), null);
        assert.equal(parseSemver('1.2'), null);
        assert.equal(parseSemver('1.2.3foo'), null);
        assert.equal(parseSemver('latest'), null);
        assert.equal(parseSemver(null), null);
    });
});

describe('compareVersions', () => {
    it('reports same for equal versions', () => {
        assert.equal(compareVersions('1.2.3', '1.2.3'), 'same');
    });

    it('reports host-newer when host is strictly newer', () => {
        assert.equal(compareVersions('1.0.0', '1.0.1'), 'host-newer');
        assert.equal(compareVersions('1.0.0', '1.1.0'), 'host-newer');
        assert.equal(compareVersions('1.0.0', '2.0.0'), 'host-newer');
    });

    it('reports device-newer when the firmware is strictly newer', () => {
        assert.equal(compareVersions('2.0.0', '1.0.0'), 'device-newer');
    });

    it('treats a prerelease firmware as older than the host release', () => {
        assert.equal(compareVersions('1.2.3-rc1', '1.2.3'), 'host-newer');
    });

    it('reports unknown for non-semver input', () => {
        assert.equal(compareVersions('v1.2.3', '1.2.3'), 'unknown');
        assert.equal(compareVersions('1.2.3', null), 'unknown');
    });
});


describe('resolveFirmwareModulePlan', () => {
    const hostHasPath = (known) => (path) => known.has(path);

    it('classifies every path as host-only in dynamic mode', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: false,
            declaredPaths: ['libs/foo.py'],
            pathToPackageId: new Map([['libs/foo.py', 'foo']]),
            packageAssetPaths: new Map([['foo', ['libs/foo.py']]]),
            globalPackageIds: new Set(['foo']),
            inventoryPaths: null,
            firmwareVersions: null,
            hostVersions: new Map([['foo', '1.0.0']]),
            hostHasPath: hostHasPath(new Set(['libs/foo.py'])),
        });

        assert.deepEqual([...plan.uploadPaths], ['libs/foo.py']);
        assert.equal(plan.shadowPackages.size, 0);
        assert.equal(plan.byPath.get('libs/foo.py').state, 'host-only');
    });

    it('keeps a current global package as firmware-provided', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_vars/store.py'],
            pathToPackageId: new Map([['otter_vars/store.py', 'vars']]),
            packageAssetPaths: new Map([['vars', ['otter_vars/store.py']]]),
            globalPackageIds: new Set(['vars']),
            inventoryPaths: new Set(['otter_vars/store.mpy']),
            firmwareVersions: new Map([['vars', '0.39.0']]),
            hostVersions: new Map([['vars', '0.39.0']]),
            hostHasPath: hostHasPath(new Set(['otter_vars/store.py'])),
        });

        assert.deepEqual([...plan.firmwareProvidedPaths], ['otter_vars/store.py']);
        assert.equal(plan.uploadPaths.size, 0);
        assert.equal(plan.shadowPackages.size, 0);
        assert.deepEqual([...plan.firmwareOwnedPackageIds], ['vars']);
    });

    it('reports packageProvidedIds from the firmware-provided set', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_vars/store.py'],
            pathToPackageId: new Map([['otter_vars/store.py', 'vars']]),
            packageAssetPaths: new Map([['vars', ['otter_vars/store.py']]]),
            globalPackageIds: new Set(['vars', 'pulse']),
            inventoryPaths: new Set(['otter_vars/store.mpy']),
            firmwareVersions: new Map([['vars', '0.39.0']]),
            hostVersions: new Map([['vars', '0.39.0']]),
            hostHasPath: hostHasPath(new Set(['otter_vars/store.py'])),
        });

        assert.deepEqual([...plan.packageProvidedIds].sort(), ['pulse', 'vars']);
    });

    it('echoes stalePackageFolders into the plan', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_vars/store.py'],
            pathToPackageId: new Map([['otter_vars/store.py', 'vars']]),
            packageAssetPaths: new Map([['vars', ['otter_vars/store.py']]]),
            globalPackageIds: new Set(['vars']),
            inventoryPaths: new Set(['otter_vars/store.mpy']),
            firmwareVersions: new Map([['vars', '0.39.0']]),
            hostVersions: new Map([['vars', '0.39.0']]),
            hostHasPath: hostHasPath(new Set(['otter_vars/store.py'])),
            stalePackageFolders: new Set(['moa_pulse']),
        });

        assert.deepEqual([...plan.stalePackageFolders], ['moa_pulse']);
        assert.deepEqual(plan.stalePackageFolders, new Set(['moa_pulse']));
    });

    it('shadows an outdated package and expands it to its complete asset set', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_vars/store.py'],
            pathToPackageId: new Map([['otter_vars/store.py', 'vars']]),
            packageAssetPaths: new Map([
                ['vars', ['otter_vars/__init__.py', 'otter_vars/store.py']],
            ]),
            globalPackageIds: new Set(['vars']),
            inventoryPaths: new Set(['otter_vars/__init__.py', 'otter_vars/store.py']),
            firmwareVersions: new Map([['vars', '0.38.0']]),
            hostVersions: new Map([['vars', '0.39.0']]),
            hostHasPath: hostHasPath(new Set(['otter_vars/__init__.py', 'otter_vars/store.py'])),
        });

        assert.equal(plan.shadowPackages.get('vars'), 'firmware-outdated');
        assert.deepEqual(
            [...plan.uploadPaths],
            ['otter_vars/__init__.py', 'otter_vars/store.py']
        );
        assert.equal(plan.byPath.get('otter_vars/__init__.py').state, 'firmware-outdated');
    });

    it('shadows a package whose firmware version is not strict semver', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_vars/store.py'],
            pathToPackageId: new Map([['otter_vars/store.py', 'vars']]),
            packageAssetPaths: new Map([['vars', ['otter_vars/store.py']]]),
            globalPackageIds: new Set(['vars']),
            inventoryPaths: new Set(['otter_vars/store.py']),
            firmwareVersions: new Map([['vars', 'v1.2.3']]),
            hostVersions: new Map([['vars', '0.39.0']]),
            hostHasPath: hostHasPath(new Set(['otter_vars/store.py'])),
        });

        assert.equal(plan.shadowPackages.get('vars'), 'firmware-unknown');
    });


    it('shadows a package whose equal-version firmware misses a needed file', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_vars/store.py', 'otter_vars/history.py'],
            pathToPackageId: new Map([
                ['otter_vars/store.py', 'vars'],
                ['otter_vars/history.py', 'vars'],
            ]),
            packageAssetPaths: new Map([
                ['vars', ['otter_vars/store.py', 'otter_vars/history.py']],
            ]),
            globalPackageIds: new Set(['vars']),
            inventoryPaths: new Set(['otter_vars/store.mpy']),
            firmwareVersions: new Map([['vars', '0.39.0']]),
            hostVersions: new Map([['vars', '0.39.0']]),
            hostHasPath: hostHasPath(new Set(['otter_vars/store.py', 'otter_vars/history.py'])),
        });

        assert.equal(plan.shadowPackages.get('vars'), 'firmware-incomplete');
        assert.deepEqual(
            [...plan.uploadPaths],
            ['otter_vars/history.py', 'otter_vars/store.py']
        );
    });

    it('blocks a package-owned path neither the firmware nor the host provides', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['libs/missing.py'],
            pathToPackageId: new Map([['libs/missing.py', 'pkg']]),
            packageAssetPaths: new Map([['pkg', ['libs/missing.py']]]),
            globalPackageIds: new Set(),
            inventoryPaths: new Set(),
            firmwareVersions: new Map(),
            hostVersions: new Map(),
            hostHasPath: hostHasPath(new Set()),
        });

        assert.deepEqual(plan.blockedPaths, ['libs/missing.py']);
        assert.equal(plan.byPath.get('libs/missing.py').state, 'host-missing');
    });

    it('silently skips an undeclared transitive import the host cannot provide', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_stdmo/servo_callable.py'],
            pathToPackageId: new Map(),
            packageAssetPaths: new Map(),
            globalPackageIds: new Set(),
            inventoryPaths: new Set(),
            firmwareVersions: new Map(),
            hostVersions: new Map(),
            hostHasPath: hostHasPath(new Set()),
        });

        assert.deepEqual(plan.blockedPaths, []);
        assert.equal(plan.uploadPaths.size, 0);
        assert.equal(plan.byPath.get('otter_stdmo/servo_callable.py').state, 'host-only');
    });

    it('treats an approved override as shadowing its package', () => {
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_vars/store.py'],
            pathToPackageId: new Map([['otter_vars/store.py', 'vars']]),
            packageAssetPaths: new Map([['vars', ['otter_vars/store.py']]]),
            globalPackageIds: new Set(['vars']),
            inventoryPaths: new Set(['otter_vars/store.py']),
            firmwareVersions: new Map([['vars', '0.39.0']]),
            hostVersions: new Map([['vars', '0.39.0']]),
            hostHasPath: hostHasPath(new Set(['otter_vars/store.py'])),
            approvedOverrides: new Set(['otter_vars/store.py']),
        });

        assert.equal(plan.shadowPackages.get('vars'), 'firmware-outdated');
        assert.deepEqual([...plan.uploadPaths], ['otter_vars/store.py']);
    });
});

describe('firmware-content-mismatch', () => {
    it('is exported as the fourth shadow reason', () => {
        assert.equal(FIRMWARE_CONTENT_MISMATCH, 'firmware-content-mismatch');
    });

    it('is never derived from versions and inventory alone', () => {
        // Only the device-side content probe can prove differing bytes; the pure plan keeps the
        // version+inventory verdict for an equal-version, fully inventoried package.
        const plan = resolveFirmwareModulePlan({
            embeddedMode: true,
            declaredPaths: ['otter_vars/store.py'],
            pathToPackageId: new Map([['otter_vars/store.py', 'vars']]),
            packageAssetPaths: new Map([['vars', ['otter_vars/store.py']]]),
            globalPackageIds: new Set(['vars']),
            inventoryPaths: new Set(['otter_vars/store.py']),
            firmwareVersions: new Map([['vars', '0.39.0']]),
            hostVersions: new Map([['vars', '0.39.0']]),
            hostHasPath: () => true,
        });

        assert.equal(plan.shadowPackages.size, 0);
        assert.equal(plan.byPath.get('otter_vars/store.py').state, 'firmware-current');
        assert.equal(
            [...plan.byPath.values()].some(
                (decision) => decision.state === FIRMWARE_CONTENT_MISMATCH
            ),
            false
        );
    });
});
