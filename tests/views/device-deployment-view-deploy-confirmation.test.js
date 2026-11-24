// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let DeviceDeploymentView;
let DeviceState;

function createI18nService() {
    return {
        t(key, params) {
            if (params) {
                let result = key;
                for (const [k, v] of Object.entries(params)) {
                    result = result.replace(`{{${k}}}`, v);
                }
                return result;
            }
            return key;
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

function createMocks({ runtimeDeploymentMode = 'embedded' } = {}) {
    const deviceDeployment = {
        addEventListener() {},
        removeEventListener() {},
        getDeviceState() {
            return new DeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
                runtimeEmbedded: runtimeDeploymentMode === 'embedded',
                runtimeDeploymentMode,
                deviceInfoLoading: false,
                collectionDeployed: false,
            });
        },
        getDeviceConnection() {
            return { isConnected: () => true };
        },
        async refreshConnectionState() {},
        isConnected() {
            return true;
        },
        hasMicroPython() {
            return true;
        },
        async validateCollectionCompatibility() {
            return { compatible: true, errors: [] };
        },
        async deployCollectionInteractive() {},
        async syncCollectionFilesInteractive() {},
        async removeCollection() {},
    };

    const collectionManager = {
        getActiveCollection() {
            return {
                getId() {
                    return 'coll-1';
                },
                getTitle() {
                    return 'Test Collection';
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
    };

    const viewManager = {
        addReference() {},
        removeReference() {},
        async showError() {},
        async showConfirmation() {
            return true;
        },
    };

    return {
        deviceDeployment,
        runtimeCollection: {
            getRuntime(id) {
                return { id, name: id };
            },
        },
        collectionManager,
        viewManager,
        i18nService: createI18nService(),
    };
}

describe('DeviceDeploymentView – deploy/sync share the interactive path', () => {
    let dom;
    let container;

    beforeEach(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.customElements = dom.window.customElements;
        global.CustomEvent = dom.window.CustomEvent;
        global.EventTarget = dom.window.EventTarget;

        const viewModule = await import(
            '../../src/micro_otter/nodes/html/js/views/device-deployment-view.js'
        );
        const stateModule = await import(
            '../../src/micro_otter/nodes/html/js/data/device-state.js'
        );
        DeviceDeploymentView = viewModule.DeviceDeploymentView;
        DeviceState = stateModule.DeviceState;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('delegates deploy to the shared interactive entry point with no options', async () => {
        const mocks = createMocks();
        let deployCalls = 0;
        let deployOptions = null;
        mocks.deviceDeployment.deployCollectionInteractive = async (_collection, options) => {
            deployCalls += 1;
            deployOptions = options;
        };

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        await view._handleDeployCollection();

        assert.equal(deployCalls, 1);
        assert.deepEqual(deployOptions, {});
        view.detach();
    });

    it('delegates sync to the shared interactive entry point with no options', async () => {
        const mocks = createMocks();
        let syncCalls = 0;
        let syncOptions = null;
        mocks.deviceDeployment.syncCollectionFilesInteractive = async (_collection, options) => {
            syncCalls += 1;
            syncOptions = options;
        };

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        await view._handleSyncCollection();

        assert.equal(syncCalls, 1);
        assert.deepEqual(syncOptions, {});
        view.detach();
    });

    it('skips deploy when compatibility validation fails', async () => {
        const mocks = createMocks();
        let deployCalls = 0;
        let reported = 0;
        mocks.deviceDeployment.validateCollectionCompatibility = async () => ({
            compatible: false,
            errors: ['incompatible target'],
        });
        mocks.deviceDeployment.deployCollectionInteractive = async () => {
            deployCalls += 1;
        };
        mocks.viewManager.showError = async () => {
            reported += 1;
        };

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        await view._handleDeployCollection();

        assert.equal(deployCalls, 0);
        assert.equal(reported, 1);
        view.detach();
    });

    it('reports a non-cancellation deploy error once', async () => {
        const mocks = createMocks();
        let reported = 0;
        mocks.deviceDeployment.deployCollectionInteractive = async () => {
            throw new Error('upload boom');
        };
        mocks.viewManager.showError = async () => {
            reported += 1;
        };

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        await view._handleDeployCollection();

        assert.equal(reported, 1);
        view.detach();
    });

    it('stays silent when the options dialog is cancelled', async () => {
        const mocks = createMocks();
        let reported = 0;
        const cancel = new Error('Deployment options dialog cancelled.');
        cancel.code = 'DEPLOYMENT_OPTIONS_CANCELLED';
        mocks.deviceDeployment.deployCollectionInteractive = async () => {
            throw cancel;
        };
        mocks.viewManager.showError = async () => {
            reported += 1;
        };

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        await view._handleDeployCollection();

        assert.equal(reported, 0);
        view.detach();
    });

    it('stays silent when the embedded override is declined', async () => {
        const mocks = createMocks();
        let deployCalls = 0;
        let reported = 0;
        const decline = new Error('Embedded source override declined for: webview');
        decline.code = 'EMBEDDED_SOURCE_OVERRIDE_DECLINED';
        decline.packageIds = ['webview'];
        mocks.deviceDeployment.deployCollectionInteractive = async () => {
            deployCalls += 1;
            throw decline;
        };
        mocks.viewManager.showError = async () => {
            reported += 1;
        };

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        await view._handleDeployCollection();

        assert.equal(deployCalls, 1, 'the deploy must not be retried after a decline');
        assert.equal(reported, 0, 'the decline must stay silent');
        view.detach();
    });
});
