import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let DeviceDeploymentView;
let DeviceState;

function createI18nService() {
    const translations = {
        'deployment.installRuntime': 'Install Runtime',
        'deployment.upgradeRuntime': 'Upgrade Runtime',
        'deployment.removeRuntime': 'Remove Runtime',
        'deployment.refreshDeviceInfo': 'Refresh Device Info',
        'deployment.editDeviceTarget': 'Edit Device Target',
        'deployment.deployCollection': 'Deploy Collection',
        'deployment.syncCollection': 'Sync Collection',
        'deployment.removeCollection': 'Remove Collection',
        'deployment.runtimeMode': 'Runtime Mode',
        'deployment.runtimeModeDynamic': 'Dynamic',
        'deployment.runtimeModeEmbedded': 'Embedded',
        'deployment.embeddedPackagesSummary': 'Embedded Packages',
        'deployment.runtimeActionDisabledEmbedded':
            'Runtime reinstall actions are disabled because this runtime is embedded in firmware.',
    };

    return {
        t(key) {
            return translations[key] || key;
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

function createMocks(state) {
    const mutable = { state };

    const deviceConnection = {
        isConnected() {
            return true;
        },
        async connect() {},
        async readTextFile() {
            return '{}';
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
        async reconfigureDeviceTarget() {
            mutable.reconfigureCalls = (mutable.reconfigureCalls || 0) + 1;
        },
        async installRuntime() {},
        async upgradeRuntime() {},
        async refreshRuntime() {},
        async removeRuntime() {},
        async validateCollectionCompatibility() {
            return { compatible: true, errors: [] };
        },
        async validateNodePackages() {
            return { errors: [] };
        },
        async deployCollection() {},
        async syncCollectionFiles() {},
        async removeCollection() {},
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
                addReference() {},
                removeReference() {},
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

describe('DeviceDeploymentView runtime mode gating', () => {
    let dom;
    let container;

    beforeEach(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.customElements = dom.window.customElements;
        global.CustomEvent = dom.window.CustomEvent;
        global.EventTarget = dom.window.EventTarget;

        const viewModule =
            await import('../../src/micro_otter/nodes/html/js/views/device-deployment-view.js');
        const stateModule =
            await import('../../src/micro_otter/nodes/html/js/data/device-state.js');
        DeviceDeploymentView = viewModule.DeviceDeploymentView;
        DeviceState = stateModule.DeviceState;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('keeps runtime deploy action enabled and runtime remove disabled in embedded mode', () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const installButton = container.querySelector(
            '.device-deployment-view__toolbar-btn--install-upgrade-runtime'
        );
        const removeButton = container.querySelector(
            '.device-deployment-view__toolbar-btn--remove-runtime'
        );
        const deployCollectionButton = container.querySelector(
            '.device-deployment-view__toolbar-btn--deploy-collection'
        );

        assert.ok(installButton);
        assert.ok(removeButton);
        assert.ok(deployCollectionButton);

        assert.equal(installButton.disabled, false);
        assert.equal(removeButton.disabled, true);
        assert.equal(deployCollectionButton.disabled, false);
        assert.notEqual(
            installButton.title,
            'Runtime reinstall actions are disabled because this runtime is embedded in firmware.'
        );
        assert.equal(
            removeButton.title,
            'Runtime reinstall actions are disabled because this runtime is embedded in firmware.'
        );

        view.detach();
    });

    it('restores default runtime button labels outside embedded mode', () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            runtimeEmbedded: false,
            runtimeDeploymentMode: 'dynamic',
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const installButton = container.querySelector(
            '.device-deployment-view__toolbar-btn--install-upgrade-runtime'
        );
        const removeButton = container.querySelector(
            '.device-deployment-view__toolbar-btn--remove-runtime'
        );

        assert.ok(installButton);
        assert.ok(removeButton);

        assert.equal(installButton.disabled, false);
        assert.equal(removeButton.disabled, false);
        assert.notEqual(
            installButton.title,
            'Runtime reinstall actions are disabled because this runtime is embedded in firmware.'
        );
        assert.equal(removeButton.title, 'Remove Runtime');

        view.detach();
    });

    it('renders runtime mode and embedded package summary in status panel', () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            runtimeName: 'Embedded General Runtime',
            runtimeVersion: '1.2.3-embedded',
            embeddedPackagesSummary: {
                totalPackages: 3,
                totalFiles: 12,
                totalBytes: 4096,
            },
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const runtimeModeField = container.querySelector('[data-field="runtime-mode"]');
        const embeddedPackagesField = container.querySelector(
            '[data-field="embedded-packages-summary"]'
        );

        assert.ok(runtimeModeField);
        assert.ok(embeddedPackagesField);
        assert.equal(runtimeModeField.textContent, 'Embedded');
        assert.equal(embeddedPackagesField.textContent, '3 pkg, 12 files, 4096 B');

        view.detach();
    });

    it('keeps collection deploy/sync/remove actions enabled in embedded mode when runtime is present', () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            deviceInfoLoading: false,
            collectionDeployed: true,
            collectionName: 'Collection 1',
            collectionVersion: '1.0.0',
        });

        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const deployCollectionButton = container.querySelector(
            '.device-deployment-view__toolbar-btn--deploy-collection'
        );
        const syncCollectionButton = container.querySelector(
            '.device-deployment-view__toolbar-btn--sync-collection'
        );
        const removeCollectionButton = container.querySelector(
            '.device-deployment-view__toolbar-btn--remove-collection'
        );

        assert.ok(deployCollectionButton);
        assert.ok(syncCollectionButton);
        assert.ok(removeCollectionButton);
        assert.equal(deployCollectionButton.disabled, false);
        assert.equal(syncCollectionButton.disabled, false);
        assert.equal(removeCollectionButton.disabled, false);

        view.detach();
    });

    it('prompts for embedded setup API on device-info-loaded and runs upgrade when accepted', async () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: false,
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            runtimeId: 'general',
            runtimeName: 'General Runtime',
            bootstrapSetupReady: false,
            bootstrapSetupStatus: {
                missingOrInvalid: [{ path: '/device.json', reason: 'missing' }],
                errors: [],
            },
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { options } = createMocks(state);
        let confirmationCalls = 0;
        let upgradeCalls = 0;
        let upgradedRuntimeId = null;
        let confirmationOptions = null;

        options.viewManager.showConfirmation = async (promptOptions) => {
            confirmationCalls += 1;
            confirmationOptions = promptOptions;
            return true;
        };
        options.deviceDeployment.upgradeRuntime = async (runtimeId) => {
            upgradeCalls += 1;
            upgradedRuntimeId = runtimeId;
        };

        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        view._onDeviceInfoLoaded(
            new CustomEvent('device-info-loaded', {
                detail: {
                    payloadTypeId: 'DeviceDeployment.DeviceInfoLoaded.v1',
                    state,
                },
            })
        );

        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(confirmationCalls, 1);
        assert.equal(upgradeCalls, 1);
        assert.equal(upgradedRuntimeId, 'general');
        assert.match(confirmationOptions.message, /firmware setup API/i);
        assert.equal(confirmationOptions.confirmLabel, 'Run Setup API');

        view.detach();
    });

    it('uses runtime deploy button to trigger embedded setup API when setup is incomplete', async () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: false,
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            runtimeId: 'general',
            runtimeName: 'General Runtime',
            bootstrapSetupReady: false,
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { options } = createMocks(state);
        let upgradeCalls = 0;
        let upgradedRuntimeId = null;

        options.viewManager.showConfirmation = async () => true;
        options.deviceDeployment.upgradeRuntime = async (runtimeId) => {
            upgradeCalls += 1;
            upgradedRuntimeId = runtimeId;
        };

        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        await view._handleInstallOrUpgradeRuntime();

        assert.equal(upgradeCalls, 1);
        assert.equal(upgradedRuntimeId, 'general');

        view.detach();
    });

    it('shows per-file setup result summary from setup API response', async () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: false,
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            runtimeId: 'general',
            runtimeName: 'General Runtime',
            bootstrapSetupReady: false,
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { options } = createMocks(state);
        let infoDialogOptions = null;
        options.viewManager.showInfo = async (dialogOptions) => {
            infoDialogOptions = dialogOptions;
        };

        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        await view._showEmbeddedBootstrapSetupResultSummary({
            ok: true,
            results: [
                { path: '/manifest.json', action: 'updated' },
                { path: '/device.json', action: 'created' },
                { path: '/app/main_loop.py', action: 'unchanged' },
            ],
            errors: [],
        });

        assert.ok(infoDialogOptions);
        assert.equal(infoDialogOptions.title, 'Runtime Setup Result');
        assert.match(infoDialogOptions.message, /\/manifest.json: updated/);
        assert.match(infoDialogOptions.message, /\/device.json: created/);
        assert.match(infoDialogOptions.message, /\/app\/main_loop.py: unchanged/);

        view.detach();
    });

    it('renders the edit device target button and invokes reconfigureDeviceTarget on click', async () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            runtimeId: 'general',
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { mutable, options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const button = container.querySelector(
            '.device-deployment-view__toolbar-btn--edit-device-target'
        );

        assert.ok(button);
        assert.equal(button.disabled, false);
        assert.equal(button.title, 'Edit Device Target');

        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(mutable.reconfigureCalls, 1);

        view.detach();
    });

    it('disables the edit device target button when no runtime id is available', () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            runtimeId: null,
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const button = container.querySelector(
            '.device-deployment-view__toolbar-btn--edit-device-target'
        );

        assert.ok(button);
        assert.equal(button.disabled, true);

        view.detach();
    });

    it('does not mount the edit device target button when disconnected', () => {
        const state = new DeviceState({
            connected: false,
            hasMicroPython: false,
            runtimeInstalled: false,
            runtimeId: null,
            deviceInfoLoading: false,
            collectionDeployed: false,
        });

        const { options } = createMocks(state);
        options.deviceDeployment.getDeviceConnection = () => ({
            isConnected() {
                return false;
            },
            async connect() {},
            async readTextFile() {
                return '{}';
            },
        });

        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        assert.equal(
            container.querySelector(
                '.device-deployment-view__toolbar-btn--edit-device-target'
            ),
            null,
            'The disconnected shell only mounts the Help pane'
        );

        view.detach();
    });
});
