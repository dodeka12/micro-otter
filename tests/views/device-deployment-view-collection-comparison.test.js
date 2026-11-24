// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('DeviceDeploymentView - Collection Comparison Panel', () => {
    let dom;
    let container;
    let DeviceDeploymentView;
    let DeviceState;

    beforeEach(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;
        global.EventTarget = dom.window.EventTarget;

        container = document.createElement('div');
        document.body.appendChild(container);

        // Load modules
        const viewModule =
            await import('../../src/micro_otter/nodes/html/js/views/device-deployment-view.js');
        DeviceDeploymentView = viewModule.DeviceDeploymentView;

        const stateModule =
            await import('../../src/micro_otter/nodes/html/js/data/device-state.js');
        DeviceState = stateModule.DeviceState;
    });

    afterEach(() => {
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        global.CustomEvent = undefined;
        global.EventTarget = undefined;
        dom.window.close();
    });

    // Helper to create mock dependencies
    function createMocks() {
        const mockDeviceDeployment = new EventTarget();
        mockDeviceDeployment.getDeviceState = () => new DeviceState({ connected: false });
        const mockDeviceConnection = {
            isConnected: () => {
                return Boolean(mockDeviceDeployment.getDeviceState()?.connected);
            },
        };
        mockDeviceDeployment.getDeviceConnection = () => mockDeviceConnection;

        const mockRuntimeCollection = {
            runtimesById: new Map(),
            getRuntime: (_id) => null,
        };

        const mockCollectionManager = new EventTarget();
        mockCollectionManager.getActiveCollection = () => null;
        mockCollectionManager.onChange = () => () => {};
        mockCollectionManager.on = () => () => {};

        const mockViewManager = {
            showError: async () => {},
            showConfirm: async () => ({ confirmed: false }),
            showFormDialog: async () => ({ confirmed: false }),
        };

        const mockI18nService = {
            t: (key, params) => {
                if (params) {
                    let result = key;
                    for (const [k, v] of Object.entries(params)) {
                        result = result.replace(`{{${k}}}`, v);
                    }
                    return result;
                }
                return key;
            },
            addEventListener: () => {},
            removeEventListener: () => {},
            onLanguageChanged: () => () => {},
        };

        return {
            deviceDeployment: mockDeviceDeployment,
            runtimeCollection: mockRuntimeCollection,
            collectionManager: mockCollectionManager,
            viewManager: mockViewManager,
            i18nService: mockI18nService,
        };
    }

    // Helper to create mock collection
    function createMockCollection() {
        return {
            getTitle: () => 'Test Collection',
            getVersionString: () => '1.0.0',
            getDeviceRuntimeId: () => 'general',
            getTargetId: () => 'ESP32-S3',
            getId: () => 'test-uuid',
            onChange: () => () => {},
            on: () => () => {},
        };
    }

    test('creates collection comparison panel with correct structure', () => {
        const mocks = createMocks();
        mocks.deviceDeployment.getDeviceState = () => new DeviceState({ connected: true });
        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        assert.ok(panel, 'Collection comparison panel should exist');

        const sections = panel.querySelectorAll('.collection-comparison-section');
        assert.equal(sections.length, 3, 'Panel should have three sections');

        const statusSection = sections[0];
        assert.ok(statusSection.classList.contains('status-section'));
        assert.strictEqual(
            statusSection.querySelector('h4').textContent,
            'deviceCollection.status.title',
            'Status section should be first and have correct heading'
        );

        // Check local section
        const localSection = panel.querySelector('.local-collection');
        assert.ok(localSection, 'Local collection section should exist');
        assert.strictEqual(
            localSection.querySelector('h4').textContent,
            'deviceCollection.local.title',
            'Local section should have correct heading'
        );

        // Check device section
        const deviceSection = panel.querySelector('.device-collection');
        assert.ok(deviceSection, 'Device collection section should exist');
        assert.strictEqual(
            deviceSection.querySelector('h4').textContent,
            'deviceCollection.device.title',
            'Device section should have correct heading'
        );

        view.detach();
    });

    test('does not mount the comparison panel when device not connected', () => {
        const mocks = createMocks();
        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        assert.strictEqual(
            container.querySelector('.deployment-collection-comparison-panel'),
            null,
            'The disconnected shell only mounts the Help pane'
        );

        view.detach();
    });

    test('hides comparison panel when no active collection', () => {
        const mocks = createMocks();

        // Mock connected device with runtime
        mocks.deviceDeployment.getDeviceState = () =>
            new DeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
            });

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        assert.strictEqual(
            panel.style.display,
            'none',
            'Panel should be hidden when no active collection'
        );

        view.detach();
    });

    test('shows comparison panel when device connected with runtime and active collection', () => {
        const mocks = createMocks();

        // Mock connected device with runtime
        mocks.deviceDeployment.getDeviceState = () =>
            new DeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
            });

        // Mock active collection
        mocks.collectionManager.getActiveCollection = createMockCollection;

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        assert.strictEqual(
            panel.style.display,
            '',
            'Panel should be visible when device connected with runtime and collection'
        );

        view.detach();
    });

    test('displays local collection information correctly', () => {
        const mocks = createMocks();

        mocks.deviceDeployment.getDeviceState = () =>
            new DeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
            });

        mocks.collectionManager.getActiveCollection = createMockCollection;

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        const localName = panel.querySelector('[data-field="local-name"]');
        const localVersion = panel.querySelector('[data-field="local-version"]');
        const localRuntime = panel.querySelector('[data-field="local-runtime"]');
        const localTarget = panel.querySelector('[data-field="local-target"]');

        assert.strictEqual(localName.textContent, 'Test Collection');
        assert.strictEqual(localVersion.textContent, '1.0.0');
        assert.strictEqual(localRuntime.textContent, 'general');
        assert.strictEqual(localTarget.textContent, 'ESP32-S3');

        view.detach();
    });

    test('displays device collection information when deployed', () => {
        const mocks = createMocks();

        mocks.deviceDeployment.getDeviceState = () =>
            new DeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                collectionDeployed: true,
                collectionName: 'Device Collection',
                collectionVersion: '0.9.0',
                collectionHasFullDefinition: true,
                deviceTargetInfo: { id: 'ESP32-S3' },
            });

        mocks.collectionManager.getActiveCollection = createMockCollection;

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        const deviceName = panel.querySelector('[data-field="device-name"]');
        const deviceVersion = panel.querySelector('[data-field="device-version"]');
        const deviceRuntime = panel.querySelector('[data-field="device-runtime"]');
        const deviceTarget = panel.querySelector('[data-field="device-target"]');
        const graphStatus = panel.querySelector('[data-field="device-graph-status"]');

        assert.strictEqual(deviceName.textContent, 'Device Collection');
        assert.strictEqual(deviceVersion.textContent, '0.9.0');
        assert.strictEqual(deviceRuntime.textContent, 'general');
        assert.strictEqual(deviceTarget.textContent, 'ESP32-S3');
        assert.ok(
            graphStatus.textContent.includes('deviceCollection.device.graphIncluded'),
            'Should show graph included message'
        );
        assert.ok(graphStatus.classList.contains('has-graph'));

        view.detach();
    });

    test('displays correct graph status when hasFullDefinition is false', () => {
        const mocks = createMocks();

        mocks.deviceDeployment.getDeviceState = () =>
            new DeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                collectionDeployed: true,
                collectionName: 'Device Collection',
                collectionVersion: '0.9.0',
                collectionHasFullDefinition: false,
                deviceTargetInfo: { id: 'ESP32-S3' },
            });

        mocks.collectionManager.getActiveCollection = createMockCollection;

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        const graphStatus = panel.querySelector('[data-field="device-graph-status"]');

        assert.ok(
            graphStatus.textContent.includes('deviceCollection.device.graphMetadataOnly'),
            'Should show metadata only message'
        );
        assert.ok(graphStatus.classList.contains('no-graph'));
        assert.ok(!graphStatus.classList.contains('has-graph'));

        view.detach();
    });

    test('displays compatible status badge when targets match', () => {
        const mocks = createMocks();

        mocks.deviceDeployment.getDeviceState = () =>
            new DeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                collectionDeployed: true,
                collectionName: 'Device Collection',
                collectionVersion: '0.9.0',
                deviceTargetInfo: { id: 'ESP32-S3' },
            });

        mocks.collectionManager.getActiveCollection = createMockCollection;

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        const compatibilityBadge = panel.querySelector('.status-badge.compatible');

        assert.ok(compatibilityBadge, 'Compatible badge should exist');
        assert.ok(
            compatibilityBadge.textContent.includes('deviceCollection.status.compatible'),
            'Should show compatible message'
        );

        view.detach();
    });

    test('displays incompatible status badge when targets mismatch', () => {
        const mocks = createMocks();

        mocks.deviceDeployment.getDeviceState = () =>
            new DeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                collectionDeployed: true,
                collectionName: 'Device Collection',
                collectionVersion: '0.9.0',
                deviceTargetInfo: { id: 'ESP32-S2' },
            });

        mocks.collectionManager.getActiveCollection = createMockCollection;

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        const incompatibleBadge = panel.querySelector('.status-badge.incompatible');

        assert.ok(incompatibleBadge, 'Incompatible badge should exist');
        assert.ok(
            incompatibleBadge.textContent.includes('deviceCollection.status.incompatible'),
            'Should show incompatible message'
        );

        view.detach();
    });

    test('no longer treats the removed custom target as compatible', () => {
        const mocks = createMocks();

        mocks.deviceDeployment.getDeviceState = () =>
            new DeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                collectionDeployed: true,
                collectionName: 'Device Collection',
                collectionVersion: '0.9.0',
                deviceTargetInfo: { id: 'custom' },
            });

        mocks.collectionManager.getActiveCollection = createMockCollection;

        const view = new DeviceDeploymentView(mocks);
        view.attachTo(container);

        const panel = container.querySelector('.deployment-collection-comparison-panel');
        const incompatibleBadge = panel.querySelector('.status-badge.incompatible');

        assert.ok(incompatibleBadge, 'Incompatible badge should exist for the removed custom target');

        view.detach();
    });
});

describe('DeviceDeploymentView - package version warnings rendering (phase 4.5 step 5)', () => {
    let dom;
    let container;
    let DeviceDeploymentView;
    let DeviceState;

    beforeEach(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;
        global.EventTarget = dom.window.EventTarget;

        container = document.createElement('div');
        document.body.appendChild(container);

        const viewModule =
            await import('../../src/micro_otter/nodes/html/js/views/device-deployment-view.js');
        DeviceDeploymentView = viewModule.DeviceDeploymentView;

        const stateModule =
            await import('../../src/micro_otter/nodes/html/js/data/device-state.js');
        DeviceState = stateModule.DeviceState;
    });

    afterEach(() => {
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        global.CustomEvent = undefined;
        global.EventTarget = undefined;
        dom.window.close();
    });

    function makeConnectedState(DeviceState) {
        return new DeviceState({
            connected: true,
            runtimeInstalled: true,
            runtimeId: 'general',
            deviceTargetInfo: { id: 'ESP32-S3' },
        });
    }

    function createMockCollection() {
        return {
            getTitle: () => 'Test Collection',
            getVersionString: () => '1.0.0',
            getDeviceRuntimeId: () => 'general',
            getTargetId: () => 'ESP32-S3',
            getId: () => 'test-uuid',
            onChange: () => () => {},
            on: () => () => {},
        };
    }

    /**
     * Build a view whose validateNodePackages returns the given warnings/errors,
     * trigger _updateCollectionComparisonStatus, and wait for the async check to settle.
     * @param {object} [opts] - Validation result handed to the fake validateNodePackages
     * @param {string[]} [opts.warnings] - Warnings the fake validation reports
     * @param {string[]} [opts.errors] - Errors the fake validation reports
     * @param {string[]} [opts.compatErrors] - Compatibility errors the fake validation reports
     */
    async function renderWithValidationResult({
        warnings = [],
        errors = [],
        compatErrors = [],
    } = {}) {
        const mockDeviceDeployment = new EventTarget();
        mockDeviceDeployment.getDeviceState = () => makeConnectedState(DeviceState);
        const mockDeviceConnection = { isConnected: () => true };
        mockDeviceDeployment.getDeviceConnection = () => mockDeviceConnection;
        mockDeviceDeployment.isConnected = () => true;
        mockDeviceDeployment.hasMicroPython = () => true;
        mockDeviceDeployment.validateCollectionCompatibility = async () => ({
            compatible: compatErrors.length === 0,
            errors: compatErrors,
        });
        mockDeviceDeployment.validateNodePackages = () => ({
            compatible: errors.length === 0,
            errors,
            warnings,
        });

        const mockCollectionManager = new EventTarget();
        mockCollectionManager.getActiveCollection = createMockCollection;
        mockCollectionManager.onChange = () => () => {};
        mockCollectionManager.on = () => () => {};

        const mockI18nService = {
            t: (key, params) => {
                if (params) {
                    let result = key;
                    for (const [k, v] of Object.entries(params)) {
                        result = result.replace(`{{${k}}}`, String(v));
                    }
                    return result;
                }
                return key;
            },
            addEventListener: () => {},
            removeEventListener: () => {},
            onLanguageChanged: () => () => {},
        };

        const view = new DeviceDeploymentView({
            deviceDeployment: mockDeviceDeployment,
            runtimeCollection: { runtimesById: new Map(), getRuntime: () => null },
            collectionManager: mockCollectionManager,
            viewManager: {
                showError: async () => {},
                showConfirm: async () => ({ confirmed: false }),
                showFormDialog: async () => ({ confirmed: false }),
            },
            i18nService: mockI18nService,
        });
        view.attachTo(container);

        // Allow the async validation promise to settle
        await new Promise((resolve) => setTimeout(resolve, 20));

        const statusBody = container.querySelector(
            '.deployment-collection-comparison-panel .status-body'
        );
        return { view, statusBody };
    }

    test('renders warning section when validateNodePackages returns non-empty warnings', async () => {
        const { view, statusBody } = await renderWithValidationResult({
            warnings: ['servo: firmware has v1.0.0, host has v1.0.1'],
        });

        try {
            assert.ok(statusBody, 'status-body should exist');
            const warningRow = statusBody.querySelector('.status-row.warning');
            assert.ok(warningRow, 'Warning section should be rendered when warnings are present');
        } finally {
            view.detach();
        }
    });

    test('warning section contains the warning heading', async () => {
        const { view, statusBody } = await renderWithValidationResult({
            warnings: ['servo: firmware has v1.0.0, host has v1.0.1'],
        });

        try {
            const warningRow = statusBody.querySelector('.status-row.warning');
            assert.ok(warningRow, 'Warning row should exist');
            assert.ok(
                warningRow.textContent.includes('deployment.packageVersionWarningHeading'),
                'Warning section should include the heading i18n key'
            );
        } finally {
            view.detach();
        }
    });

    test('warning section contains the warning text', async () => {
        const warningText = 'servo: firmware has v1.0.0, host has v1.0.1';
        const { view, statusBody } = await renderWithValidationResult({
            warnings: [warningText],
        });

        try {
            const warningRow = statusBody.querySelector('.status-row.warning');
            assert.ok(warningRow, 'Warning row should exist');
            assert.ok(
                warningRow.textContent.includes(warningText),
                'Warning section should contain the warning text'
            );
        } finally {
            view.detach();
        }
    });

    test('no warning section when warnings array is empty', async () => {
        const { view, statusBody } = await renderWithValidationResult({ warnings: [] });

        try {
            const warningRow = statusBody.querySelector('.status-row.warning');
            assert.equal(warningRow, null, 'No warning section when warnings is empty');
        } finally {
            view.detach();
        }
    });

    test('badge remains compatible when there are only warnings and no errors', async () => {
        const { view, statusBody } = await renderWithValidationResult({
            warnings: ['servo: firmware has v1.0.0, host has v1.0.1'],
            errors: [],
        });

        try {
            const badge = statusBody.querySelector('.status-badge.compatible');
            assert.ok(badge, 'Badge should remain compatible when there are only warnings');
        } finally {
            view.detach();
        }
    });

    test('badge is incompatible when there are errors (warnings present too)', async () => {
        const { view, statusBody } = await renderWithValidationResult({
            warnings: ['some warning'],
            errors: ['Node type not found: servo'],
        });

        try {
            const badge = statusBody.querySelector('.status-badge.incompatible');
            assert.ok(badge, 'Badge should be incompatible when there are errors');
        } finally {
            view.detach();
        }
    });
});
