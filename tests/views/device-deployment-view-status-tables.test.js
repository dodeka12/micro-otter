// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { DeviceDeploymentView } from '../../src/micro_otter/nodes/html/js/views/device-deployment-view.js';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

function createI18nService() {
    return {
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

function createMocks(state) {
    const mutable = { state, dynamicPaths: [], dynamicPathsError: null, dynamicPathsCalls: 0 };

    const deviceConnection = {
        isConnected() {
            return true;
        },
    };

    const deviceDeployment = {
        addEventListener() {},
        removeEventListener() {},
        getDeviceState() {
            return mutable.state;
        },
        getDeviceConnection() {
            return deviceConnection;
        },
        async refreshConnectionState() {},
        isConnected() {
            return true;
        },
        hasMicroPython() {
            return true;
        },
        async refreshDeviceInfo() {},
        async validateCollectionCompatibility() {
            return { compatible: true, errors: [] };
        },
        async validateNodePackages() {
            return { errors: [] };
        },
        async deployCollection() {},
        async syncCollectionFiles() {},
        async removeCollection() {},
        async getDynamicLibraryPathsOnDevice() {
            mutable.dynamicPathsCalls += 1;
            if (mutable.dynamicPathsError) {
                throw mutable.dynamicPathsError;
            }
            return mutable.dynamicPaths;
        },
    };

    return {
        mutable,
        options: {
            deviceDeployment,
            runtimeCollection: {
                getRuntime(id) {
                    return { id, name: id };
                },
            },
            collectionManager: {
                getActiveCollection() {
                    return {
                        getId() {
                            return 'collection-1';
                        },
                        getTitle() {
                            return 'Collection 1';
                        },
                        getVersionString() {
                            return '1.0.0';
                        },
                        getDeviceRuntimeId() {
                            return 'general';
                        },
                        getTargetId() {
                            return 'esp32-test';
                        },
                        on() {
                            return () => {};
                        },
                    };
                },
                on() {
                    return () => {};
                },
            },
            viewManager: {
                async showConfirmation() {
                    return false;
                },
                async showError() {},
                async showInfo() {},
                async showFormDialog() {
                    return { confirmed: false, formData: {} };
                },
            },
            i18nService: createI18nService(),
        },
    };
}

function createState(overrides = {}) {
    return new DeviceState({
        connected: true,
        hasMicroPython: true,
        runtimeInstalled: true,
        deviceInfoLoading: false,
        ...overrides,
    });
}

describe('DeviceDeploymentView status tables', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.customElements = dom.window.customElements;
        global.CustomEvent = dom.window.CustomEvent;
        global.EventTarget = dom.window.EventTarget;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
        delete global.CustomEvent;
        dom?.window?.close();
    });

    it('renders the three status panes and populates values', () => {
        const state = createState();
        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const devicePane = container.querySelector('.deployment-device-info');
        assert.ok(devicePane);
        assert.equal(devicePane.querySelectorAll('table.data-table-view').length, 1);

        const runtimePane = container.querySelector('.deployment-runtime-info');
        assert.ok(runtimePane);
        assert.equal(runtimePane.querySelectorAll('table.data-table-view').length, 3);
        assert.equal(runtimePane.querySelectorAll('.status-subtables').length, 1);

        const collectionPane = container.querySelector('.deployment-collection-info');
        assert.ok(collectionPane);
        assert.equal(collectionPane.querySelectorAll('table.data-table-view').length, 1);

        assert.equal(container.querySelectorAll('table.data-table-view').length, 5);

        const connection = container.querySelector('[data-field="connection"]');
        assert.ok(connection);
        assert.equal(connection.textContent, 'deployment.connected');

        view.detach();
    });

    it('renders constituent versions and node packages as sibling sub-tables', () => {
        const state = createState({
            firmwareConstituentVersions: {
                micropythonVersion: '1.27.0',
                runtimeSourceVersion: '1.11.0',
                runtimeFirmwareVersion: '0.3.0',
                deviceToolsVersion: '1.2.0',
                nodePackages: {
                    core: '1.0.2',
                    webview: '1.0.0',
                },
            },
        });
        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const subtables = container.querySelector('.status-subtables');
        assert.ok(subtables);
        const subTables = Array.from(subtables.querySelectorAll('table.data-table-view'));
        assert.equal(subTables.length, 2);

        const constituent = subTables[0];
        const constituentValues = Array.from(
            constituent.querySelectorAll('tbody tr td:nth-child(2)')
        ).map((td) => td.textContent);
        assert.deepEqual(constituentValues, ['1.27.0', '1.11.0', '0.3.0', '1.2.0']);

        const nodePackages = subTables[1];
        const packageRows = Array.from(nodePackages.querySelectorAll('tbody tr')).map((row) =>
            Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
        );
        assert.deepEqual(packageRows, [
            ['core', '1.0.2'],
            ['webview', '1.0.0'],
        ]);
        assert.equal(nodePackages.textContent.includes('[object Object]'), false);

        view.detach();
    });

    it('shows a frozen add-on row with its variant, not as a plain version', () => {
        const state = createState({
            firmwareConstituentVersions: {
                micropythonVersion: '1.27.0',
                runtimeSourceVersion: '1.11.0',
                runtimeFirmwareVersion: '0.3.0',
                deviceToolsVersion: '1.2.0',
                nodePackages: {
                    core: '1.0.2',
                },
                addonPackages: {
                    pulse: '0.4.0',
                },
                frozenAddons: {
                    pulse: { variant: 'viper', version: '0.4.0' },
                },
            },
        });
        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const subtables = container.querySelector('.status-subtables');
        const subTables = Array.from(subtables.querySelectorAll('table.data-table-view'));
        const nodePackages = subTables[1];
        const packageRows = Array.from(nodePackages.querySelectorAll('tbody tr')).map((row) =>
            Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
        );
        assert.deepEqual(packageRows, [
            ['core', '1.0.2'],
            ['pulse', '0.4.0 (viper)'],
        ]);

        view.detach();
    });

    it('shows the on-device library count for embedded devices', async () => {
        const state = createState({ runtimeEmbedded: true, runtimeDeploymentMode: 'embedded' });
        const { options, mutable } = createMocks(state);
        mutable.dynamicPaths = ['otter_stdmo/servo.py', 'otter_vars/arrays.py'];
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const cell = container.querySelector('[data-field="dynamic-libraries-on-device"]');
        assert.ok(cell, 'the Device Info table must expose the libraries-on-device row');

        await view._refreshDynamicLibrariesOnDevice(state);

        assert.equal(
            container.querySelector('[data-field="dynamic-libraries-on-device"]').textContent,
            'deployment.fileCountOnDevice:count=2'
        );
        assert.equal(mutable.dynamicPathsCalls, 1);

        view.detach();
    });

    it('shows "none" when the device holds no dynamic libraries', async () => {
        const state = createState({ runtimeEmbedded: true, runtimeDeploymentMode: 'embedded' });
        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        await view._refreshDynamicLibrariesOnDevice(state);

        assert.equal(
            container.querySelector('[data-field="dynamic-libraries-on-device"]').textContent,
            'deployment.noneOnDevice'
        );

        view.detach();
    });

    it('shows "-" for dynamic runtimes without querying the manifest', async () => {
        const state = createState({ runtimeEmbedded: false, runtimeDeploymentMode: 'dynamic' });
        const { options, mutable } = createMocks(state);
        mutable.dynamicPaths = ['otter_stdmo/servo.py'];
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        await view._refreshDynamicLibrariesOnDevice(state);

        assert.equal(
            container.querySelector('[data-field="dynamic-libraries-on-device"]').textContent,
            '-'
        );
        assert.equal(mutable.dynamicPathsCalls, 0, 'dynamic mode never reads the manifest');

        view.detach();
    });

    it('shows "-" when the manifest cannot be read', async () => {
        const state = createState({ runtimeEmbedded: true, runtimeDeploymentMode: 'embedded' });
        const { options, mutable } = createMocks(state);
        mutable.dynamicPathsError = new Error('manifest unavailable');
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        await assert.doesNotReject(() => view._refreshDynamicLibrariesOnDevice(state));
        assert.equal(
            container.querySelector('[data-field="dynamic-libraries-on-device"]').textContent,
            '-'
        );

        view.detach();
    });
});

