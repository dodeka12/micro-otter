// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { JSDOM } from 'jsdom';

/**
 * Shared fixtures for the FirmwareBuildView suites.
 *
 * This module describes *inputs only* (services, snapshots, frames, DOM setup).
 * It deliberately exports no selector map and no element-lookup helpers: each
 * suite declares the lookups it needs against the shared components' own classes.
 */

export function createI18nService(locale = 'en') {
    return {
        currentLocale: locale,
        t(key, params = {}) {
            const paramStr = Object.keys(params).length
                ? ':' +
                  Object.entries(params)
                      .map(([name, value]) => `${name}=${value}`)
                      .join(',')
                : '';
            return key + paramStr;
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

/**
 * An i18n fake whose translations change on demand. `setLocale` swaps the prefix
 * applied by `t` and dispatches `languagechange` to every listener, so a suite can
 * assert that a view re-renders its text after the user switches language.
 *
 * @param {'en'|'de'} locale Initial locale prefix.
 */
export function createSwitchableI18nService(locale = 'en') {
    const listeners = new Set();
    const service = {
        locale,
        currentLocale: locale,
        t(key) {
            return `${service.locale}:${key}`;
        },
        addEventListener(type, handler) {
            if (type === 'languagechange') {
                listeners.add(handler);
            }
        },
        removeEventListener(type, handler) {
            if (type === 'languagechange') {
                listeners.delete(handler);
            }
        },
        setLocale(next) {
            service.locale = next;
            service.currentLocale = next;
            for (const handler of [...listeners]) {
                handler({ type: 'languagechange', detail: { locale: next } });
            }
        },
    };
    return service;
}

export function readySnapshot(features = [
    'firmware-compile',
    'firmware-deploy',
    'local-package-scan',
    'node-package-addons',
]) {
    return {
        state: 'ready',
        capabilities: {
            serverType: 'micro-otter',
            version: '1.2.3',
            features,
            buildBackends: [{ id: 'esp-idf', available: true, version: '5.4', reason: null, targets: ['esp32'] }],
            flashBackends: [{ id: 'esptool', available: true, version: '4.8', reason: null, targets: ['esp32'] }],
            firmwareSources: ['local'],
            releaseIndexUrl: '',
        },
        reason: null,
        detail: null,
    };
}

export function unavailableSnapshot(reason, detail = null) {
    return { state: 'unavailable', capabilities: null, reason, detail };
}

export function createStore(snapshot, { stale = false, refreshResult = null } = {}) {
    let current = snapshot;
    const listeners = new Set();
    return {
        refreshCalls: 0,
        listeners,
        isStale() {
            return stale;
        },
        async refresh({ force: _force }) {
            this.refreshCalls += 1;
            if (refreshResult) {
                current = refreshResult;
            }
            return current;
        },
        getSnapshot() {
            return current;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

export function createTarget(id, displayName) {
    return {
        id,
        displayName,
        generalCapabilities: {},
        resources: {},
        capabilityRegistry: { getDomain: () => 'general', get: () => null },
    };
}

export function createRuntime(overrides = {}) {
    const nodePackages = [
        { id: 'core', name: 'Core', version: '1.0.0', requiredCapabilities: null },
    ];
    return {
        id: 'general',
        version: '1.0.0',
        nodePackages,
        nodePackagesGlobal: ['core'],
        nodePackagesLocal: [],
        nodePackagesAddons: [],
        nodePackagesOptional: [],
        defaultDeviceTargetId: 'esp32-test',
        isOptionalPackage: () => false,
        packageProvenance: () => 'builtin',
        packageVariants: {},
        getPackageVariants(packageId) {
            return this.packageVariants[packageId] ?? [];
        },
        getCompileTarget() {
            return { board: 'esp32:esp32:esp32', port: 'esp32' };
        },
        getAvailableTargets() {
            return [createTarget('esp32-test', 'ESP32 Test')];
        },
        ...overrides,
    };
}

/**
 * A runtime with one built-in (`core`) and one installed add-on (`pulse`).
 *
 * This is the state a "Minimal" build leaves behind: the collection may use only
 * `core`, while the checklist still ticks every installed add-on.
 */
export function createTwoPackageRuntime() {
    return createRuntime({
        nodePackages: [
            { id: 'core', name: 'Core', version: '1.0.0', requiredCapabilities: null },
            { id: 'pulse', name: 'Pulse', version: '0.1.0', requiredCapabilities: null },
        ],
        nodePackagesGlobal: ['core'],
        nodePackagesAddons: ['pulse'],
        packageProvenance: (id) => (id === 'pulse' ? 'addon' : 'builtin'),
    });
}

/**
 * A fake active collection that exposes only what the view consumes: its identity,
 * target, graphs' node types and a graph-change subscription. *graphs* is one array
 * of node-type ids per graph and is mutated in place by the tests.
 * @param {string[][]} graphs - Node-type ids per graph.
 * @param {{ id?: string, targetId?: string | null }} [options] - Collection identity.
 */
export function createFakeCollection(graphs, { id = 'collection-1', targetId = null } = {}) {
    const listeners = new Set();
    return {
        getId: () => id,
        getTargetId: () => targetId,
        getDeviceRuntimeId: () => 'general',
        getGraphArray: () =>
            graphs.map((types) => ({ getNodes: () => types.map((type) => ({ type })) })),
        onGraphChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        listenerCount: () => listeners.size,
        emitGraphEvent(name) {
            for (const listener of [...listeners]) {
                listener({ name });
            }
        },
    };
}

export function createOptions({
    store,
    runtime,
    client,
    deviceConnection,
    viewManager,
    i18nService,
    collection,
}) {
    return {
        firmwareCapabilities: store,
        deviceConnection: deviceConnection ?? {
            isConnected: () => false,
            disconnect: async () => {},
        },
        runtimeCollection: { getRuntime: () => runtime, async load() {} },
        collectionManager: {
            on: () => () => {},
            getActiveCollection: () =>
                collection ?? { getId: () => 'collection-1', getTargetId: () => null, getDeviceRuntimeId: () => 'general' },
        },
        viewManager: viewManager ?? createFakeViewManager(),
        jobClient: client,
        i18nService: i18nService ?? createI18nService(),
    };
}

/**
 * A recording fake for the `FirmwareViewManagerLike` subset. `showConfirmation`
 * resolves `true` by default and each call is recorded so suites can assert the
 * view opened the expected whole-app confirmation dialog.
 */
export function createFakeViewManager(overrides = {}) {
    const manager = {
        confirmations: [],
        confirmResult: true,
        modals: [],
        formDialogs: [],
        formDialogResult: { confirmed: true, formData: {} },
        async showConfirmation(options) {
            this.confirmations.push(options);
            return this.confirmResult;
        },
        showModal(dialog, options = {}) {
            this.modals.push({ dialog, options });
        },
        async showFormDialog(options) {
            this.formDialogs.push(options);
            return this.formDialogResult;
        },
        ...overrides,
    };
    return manager;
}

export function createFakeClient() {
    const client = {
        sent: [],
        listeners: {},
        open: false,
        connectCalls: 0,
        isOpen() {
            return this.open;
        },
        async connect() {
            this.connectCalls += 1;
            this.open = true;
        },
        close() {
            this.open = false;
        },
        startCompile(request) {
            this.sent.push({ type: 'compile.start', ...request });
        },
        startDeploy(request) {
            this.sent.push({ type: 'deploy.start', ...request });
        },
        scanLocal(request) {
            this.sent.push({ type: 'scan-local', ...request });
        },
        listFirmware() {
            this.sent.push({ type: 'firmware.list' });
        },
        deleteFirmware(request) {
            this.sent.push({ type: 'firmware.delete', ...request });
        },
        importFirmware(request) {
            this.sent.push({ type: 'firmware.import', ...request });
        },
        importFirmwareBinary(request) {
            this.sent.push({ type: 'firmware.import-binary', ...request });
        },
        exportFirmware(request) {
            this.sent.push({ type: 'firmware.export', ...request });
        },
        installAddon(request) {
            this.sent.push({ type: 'addon.install', ...request });
        },
        listDirectory(request) {
            this.sent.push({ type: 'fs.list', ...request });
            return Promise.resolve(this.listResult ?? {
                path: request.path ?? '/home',
                parent: null,
                roots: [],
                entries: [],
                truncated: false,
            });
        },
        uninstallAddon(request) {
            this.sent.push({ type: 'addon.uninstall', ...request });
        },
        cancel() {
            this.sent.push({ type: 'cancel' });
        },
        on(type, listener) {
            (this.listeners[type] = this.listeners[type] || []).push(listener);
            return () => {};
        },
        emitFrame(frame) {
            for (const listener of this.listeners.frame || []) {
                listener({ detail: { frame } });
            }
        },
        emitSocketClose(reason = 'closed') {
            for (const listener of this.listeners.socketState || []) {
                listener({ detail: { open: false, reason } });
            }
        },
    };
    return client;
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * One imported raw-binary inventory entry, sharing the shape the inventory and
 * import suites assert against.
 */
export function importedEntry(overrides = {}) {
    return {
        path: '/opt/fw/imported.bin',
        filename: 'micro-otter-1.27.0-esp32-imported-0.0.0-000000000000.bin',
        boardId: 'esp32',
        runtimeId: 'imported',
        micropythonVersion: '1.27.0',
        runtimeFirmwareVersion: '0.0.0',
        contentHash: '000000000000',
        sizeBytes: 1024,
        modifiedAt: '2026-01-01T00:00:00+00:00',
        hasManifest: false,
        embeddedPackages: {},
        notEmbedded: [],
        addonPackages: {},
        packageVariants: {},
        selection: {},
        channel: '',
        versionSource: null,
        isPrerelease: false,
        isLatest: false,
        isChannelLatest: false,
        source: 'imported-binary',
        targetId: 'esp32_s3_mini',
        originalFilename: 'esp32-20240602.bin',
        ...overrides,
    };
}

export function setupDom() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;
    global.window = dom.window;
    global.HTMLElement = dom.window.HTMLElement;
    global.HTMLButtonElement = dom.window.HTMLButtonElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;
    global.HTMLSelectElement = dom.window.HTMLSelectElement;
    const container = document.createElement('div');
    document.body.appendChild(container);
    return { dom, container };
}

export function teardownDom({ dom, container }) {
    container?.remove();
    delete global.document;
    delete global.window;
    delete global.HTMLElement;
    delete global.HTMLButtonElement;
    delete global.HTMLInputElement;
    delete global.HTMLSelectElement;
    delete global.fetch;
    dom?.window?.close();
}

export function portFetch(ports) {
    return async (url) => {
        const path = String(url);
        if (path.includes('/api/serial-ports')) {
            return { ok: true, status: 200, json: async () => ports };
        }
        return { ok: true, status: 200, json: async () => EMPTY_BOARD_CATALOG };
    };
}

export const EMPTY_BOARD_CATALOG = { schemaVersion: 2, boards: [] };

export const BOARD_CATALOG = {
    schemaVersion: 2,
    boards: [
        {
            name: 'esp32:esp32:esp32',
            slug: 'esp32_esp32_esp32',
            displayName: 'ESP32 Dev Module',
            buildBackend: 'esp-idf',
            flashBackend: 'esptool',
            chip: 'ESP32',
            build: { port: 'esp32', board: 'esp32:esp32:esp32', buildDirName: 'esp32' },
            flash: { offset: '0x0' },
        },
    ],
};

