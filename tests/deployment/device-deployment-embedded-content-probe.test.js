// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Content-based staleness probe: a firmware package whose declared version equals the host
// version can still ship different bytes. The probe compares host SHA-256 with the device copy
// and promotes only a proven mismatch to a shadow upload.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    DeviceDeployment,
    EMBEDDED_CONTENT_PROBE_LIMIT,
} from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';
import { calculateFileHash } from '../../src/micro_otter/nodes/html/js/deployment/deployment-utils.js';

let originalWindow;
let originalFetch;
let originalLog;

beforeEach(() => {
    originalWindow = globalThis.window;
    originalFetch = globalThis.fetch;
    originalLog = globalThis.__microOtterLog;
    globalThis.window = { location: { origin: 'http://localhost' } };
});

afterEach(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
    if (originalLog === undefined) delete globalThis.__microOtterLog;
    else globalThis.__microOtterLog = originalLog;
});

const VARS_PATHS = ['otter_vars/__init__.py', 'otter_vars/store.py'];

const HOST_CONTENT = {
    'otter_vars/__init__.py': '# vars init\n',
    'otter_vars/store.py': '# vars store with clamp\n',
};

const STALE_CONTENT = {
    'otter_vars/__init__.py': '# vars init\n',
    'otter_vars/store.py': '# vars store without clamp\n',
};

/**
 * Device-relative library path to its host asset URL.
 * @param {string} path - Device path such as `otter_vars/store.py`
 * @returns {string} Host URL used by the runtime manifest
 */
function assetUrl(path) {
    return `/device/node_pkgs/vars/${path}`;
}

/** Minimal EventTarget-based connection; hashing is added per test. */
class MockDeviceConnection extends EventTarget {
    isConnected() {
        return false;
    }
    getState() {
        return 'disconnected';
    }
    getDeviceInfoData() {
        return null;
    }
    async readTextFile() {
        throw new Error('ENOENT');
    }
    async writeTextFile() {}
}

class MockCollectionManager {
    getNodeType() {
        return null;
    }
}

class MockTranspiler {
    transpile() {
        return { code: '' };
    }
}

class MockI18nService {
    /**
     * Encode key and parameters into the returned string for easy assertions.
     * @param {string} key - Translation key
     * @param {object} [params] - Interpolation parameters
     * @returns {string} Encoded translation
     */
    t(key, params = {}) {
        const paramStr = Object.keys(params).length
            ? ':' +
              Object.entries(params)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(',')
            : '';
        return key + paramStr;
    }
}

/**
 * Capture DeviceDeployment log entries while a test runs.
 * @returns {{entries: Array<object>, restore: () => void}} Captured entries and restore hook
 */
function captureLogs() {
    const entries = [];
    globalThis.__microOtterLog = {
        log(scope, reason, level, ...data) {
            entries.push({ scope, reason, level, data });
        },
    };
    return {
        entries,
        restore() {
            if (originalLog === undefined) delete globalThis.__microOtterLog;
            else globalThis.__microOtterLog = originalLog;
        },
    };
}

/**
 * View-manager mock that records confirmation calls and always accepts.
 * @returns {object} View-manager mock exposing the recorded calls
 */
function makeViewManagerMock() {
    const calls = [];
    return {
        calls,
        async showConfirmationWithCheckbox(options) {
            calls.push(options);
            return { confirmed: true, checkboxChecked: false };
        },
    };
}

/**
 * Build an embedded deployment whose firmware bundles one `vars` package.
 * @param {object} [opts] - Deployment options
 * @param {string} [opts.deviceVersion] - Firmware `vars` version
 * @param {string} [opts.hostVersion] - Host `vars` version
 * @param {Record<string, string>} [opts.deviceContent] - Device file contents by path
 * @param {boolean} [opts.withCalculateHash] - Whether the connection can hash on the device
 * @param {Function|null} [opts.calculateHash] - Override for the device hash implementation
 * @param {string[]} [opts.assetPaths] - Package asset paths (defaults to the vars pair)
 * @returns {{deployment: DeviceDeployment, viewManager: object, hashCalls: string[]}} Harness
 */
function makeDeployment({
    deviceVersion = '0.59.0',
    hostVersion = '0.59.0',
    deviceContent = HOST_CONTENT,
    withCalculateHash = true,
    calculateHash = null,
    assetPaths = VARS_PATHS,
} = {}) {
    const hashCalls = [];
    const deviceConnection = new MockDeviceConnection();
    if (withCalculateHash) {
        deviceConnection.calculateHash =
            calculateHash ||
            (async (path) => {
                hashCalls.push(path);
                const content = deviceContent[path];
                if (content === undefined) {
                    throw new Error(`ENOENT: ${path}`);
                }
                return calculateFileHash(content);
            });
    }

    const runtime = {
        id: 'general',
        getNodeType: () => null,
        nodePackagesGlobal: ['vars'],
        nodePackages: [
            {
                id: 'vars',
                manifest: { version: hostVersion },
                mpAssets: { '*': assetPaths.map((path) => assetUrl(path)) },
            },
        ],
    };

    const viewManager = makeViewManagerMock();
    const deployment = new DeviceDeployment({
        deviceConnection,
        collectionManager: new MockCollectionManager(),
        runtimeCollection: { getRuntime: () => runtime },
        transpiler: new MockTranspiler(),
        i18nService: new MockI18nService(),
        viewManager,
    });

    deployment._updateDeviceState({
        runtimeId: 'general',
        runtimeInstalled: true,
        runtimeEmbedded: true,
        runtimeDeploymentMode: 'embedded',
        firmwareFullVersion: '1.25.1.dev640',
        embeddedPackagesSummary: {
            totalPackages: 1,
            totalFiles: assetPaths.length,
            totalBytes: 100,
            packages: [{ name: 'vars', version: deviceVersion }],
        },
        embeddedInventory: {
            files: assetPaths.map((path) => ({ path, source: 'embedded' })),
        },
        firmwareConstituentVersions: null,
    });

    globalThis.fetch = async (url) => {
        const key = String(url);
        const path = VARS_PATHS.find((candidate) => assetUrl(candidate) === key);
        if (path) {
            return { ok: true, text: async () => HOST_CONTENT[path] };
        }
        if (key.includes('/otter_vars/')) {
            return { ok: true, text: async () => '# module\n' };
        }
        return { ok: false, status: 404, text: async () => '' };
    };

    return { deployment, viewManager, hashCalls };
}

/**
 * Build a collection whose graph uses the vars package.
 * @param {string[]} [nodeTypes] - Node types of the graph
 * @returns {object} Collection mock
 */
function makeCollection(nodeTypes = ['vars.array-generate']) {
    return {
        getDeviceRuntimeId: () => 'general',
        getId: () => 'col-1',
        getTitle: () => 'Collection',
        getGraphArray: () => [
            {
                getNodes: () => nodeTypes.map((type, index) => ({ id: `n${index}`, type })),
            },
        ],
    };
}

describe('DeviceDeployment — embedded content probe', () => {
    it('shadows a package whose version matches but whose bytes differ', async () => {
        const { deployment, viewManager } = makeDeployment({ deviceContent: STALE_CONTENT });

        const paths = await deployment._resolveEmbeddedSourceOverrides(makeCollection());

        assert.deepEqual(paths, VARS_PATHS, 'the whole package must be uploaded');
        assert.equal(viewManager.calls.length, 1, 'the shadow upload is consented to');
        assert.ok(viewManager.calls[0].table, 'the content mismatch must be listed in a table');
        assert.deepEqual(
            viewManager.calls[0].table.rows.map((row) => row.cells.map((cell) => cell.text)),
            [['vars', '0.59.0', '0.59.0']]
        );
    });

    it('does not shadow when versions and bytes both match', async () => {
        const { deployment, viewManager, hashCalls } = makeDeployment();

        const paths = await deployment._resolveEmbeddedSourceOverrides(makeCollection());

        assert.deepEqual(paths, []);
        assert.equal(viewManager.calls.length, 0, 'no dialog when the firmware copy is identical');
        assert.deepEqual(hashCalls.sort(), VARS_PATHS, 'both files were compared');
    });

    it('lets the version rule win when the firmware is older but the bytes match', async () => {
        const { deployment, viewManager } = makeDeployment({
            deviceVersion: '0.58.0',
            deviceContent: HOST_CONTENT,
        });

        const preflight = deployment._computeEmbeddedOverridePlan(makeCollection());
        const paths = await deployment._resolveEmbeddedSourceOverrides(makeCollection());

        assert.deepEqual(
            preflight.shadowPackages.map((entry) => entry.reason),
            ['firmware-outdated'],
            'an older firmware version stays an outdated package, not a content mismatch'
        );
        assert.deepEqual(paths, VARS_PATHS);
        assert.ok(viewManager.calls[0].table, 'the outdated package must be listed in a table');
        assert.deepEqual(
            viewManager.calls[0].table.rows.map((row) => row.cells.map((cell) => cell.text)),
            [['vars', '0.58.0', '0.59.0']]
        );
    });

    it('does not invent a mismatch when the device hash probe fails', async () => {
        const { deployment } = makeDeployment({
            calculateHash: async () => {
                throw new Error('hash command failed');
            },
        });
        const captured = captureLogs();

        try {
            const preflight = deployment._computeEmbeddedOverridePlan(makeCollection());
            const mismatches = await deployment._probeEmbeddedContentMismatches(
                makeCollection(),
                preflight.runtime,
                preflight.plan
            );

            assert.equal(mismatches.size, 0);
            assert.ok(
                captured.entries.some((entry) => entry.reason === 'embedded-content-probe-error'),
                'a failed probe must be observable'
            );
        } finally {
            captured.restore();
        }
    });

    it('skips the probe when the connection cannot hash on the device', async () => {
        const { deployment, viewManager } = makeDeployment({ withCalculateHash: false });
        const captured = captureLogs();

        try {
            const paths = await deployment._resolveEmbeddedSourceOverrides(makeCollection());

            assert.deepEqual(paths, []);
            assert.equal(viewManager.calls.length, 0);
            const skipped = captured.entries.filter(
                (entry) => entry.reason === 'embedded-content-probe-skipped'
            );
            assert.equal(skipped.length, 1);
            assert.equal(skipped[0].data[0].reason, 'calculateHash unavailable');
        } finally {
            captured.restore();
        }
    });

    it('reuses the cached verdict on a second deploy', async () => {
        const { deployment, hashCalls } = makeDeployment({ deviceContent: STALE_CONTENT });
        const collection = makeCollection();

        await deployment._resolveEmbeddedSourceOverrides(collection);
        const firstRunCalls = hashCalls.length;
        assert.equal(firstRunCalls, 2, 'one hash per in-use file');

        const paths = await deployment._resolveEmbeddedSourceOverrides(collection);

        assert.equal(hashCalls.length, firstRunCalls, 'the cached verdict must not re-probe');
        assert.deepEqual(paths, VARS_PATHS, 'the cached verdict still shadows the package');
    });

    it('respects the probe limit and logs it', async () => {
        const assetPaths = [];
        for (let index = 0; index < EMBEDDED_CONTENT_PROBE_LIMIT + 4; index++) {
            assetPaths.push(`otter_vars/module_${index}.py`);
        }
        const { deployment, hashCalls } = makeDeployment({ assetPaths });
        const captured = captureLogs();

        try {
            const preflight = deployment._computeEmbeddedOverridePlan(makeCollection());
            const mismatches = await deployment._probeEmbeddedContentMismatches(
                makeCollection(),
                preflight.runtime,
                preflight.plan
            );

            assert.equal(mismatches.size, 0, 'no file beyond the cap was compared');
            assert.equal(hashCalls.length, EMBEDDED_CONTENT_PROBE_LIMIT);
            assert.ok(
                captured.entries.some((entry) => entry.reason === 'embedded-content-probe-limit')
            );
        } finally {
            captured.restore();
        }
    });
});
