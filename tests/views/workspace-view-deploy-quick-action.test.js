// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { WorkspaceView } from '../../src/micro_otter/nodes/html/js/views/workspace-view.js';
import { AppEvent, AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';

class MockPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

// Mock Collection
class MockCollection {
    constructor({ id = 'col-1', title = 'Collection One' } = {}) {
        this._id = id;
        this._title = title;
        this._listeners = new Set();
        this._historyManager = {
            canUndo: () => false,
            canRedo: () => false,
            undo: () => false,
            redo: () => false,
        };
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockCollection only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(name, new MockPayload(payloadTypeId, detail));
        for (const listener of this._listeners) {
            listener(event);
        }
    }

    getId() {
        return this._id;
    }

    getTitle() {
        return this._title;
    }

    getVersionString() {
        return '1.0.0';
    }

    getDeviceRuntimeId() {
        return 'general';
    }

    getTargetId() {
        return 'esp32';
    }

    getHistoryManager() {
        return this._historyManager;
    }
}

// Mock Workspace
class MockWorkspace {
    constructor({ deviceDeployment = null } = {}) {
        this.collections = new Map();
        this.activeCollectionId = null;
        this._listeners = new Set();
        this.deviceDeployment = deviceDeployment;

        const col1 = new MockCollection({ id: 'col-1', title: 'Collection One' });
        this.collections.set('col-1', col1);
        this.activeCollectionId = 'col-1';
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockWorkspace only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    getCollectionIds() {
        return Array.from(this.collections.keys());
    }

    getActiveCollectionId() {
        return this.activeCollectionId;
    }

    getActiveCollection() {
        return this.collections.get(this.activeCollectionId) || null;
    }

    listAvailableRuntimes() {
        return [{ id: 'general', name: 'General' }];
    }

    listTargetsForRuntime() {
        return [{ id: 'esp32', name: 'ESP32' }];
    }
}

function createDeviceDeployment(overrides = {}) {
    return {
        getDeviceConnection: () => ({ isConnected: () => true }),
        validateCollectionCompatibility: async () => ({ compatible: true, errors: [] }),
        deployCollectionInteractive: async () => 3,
        addEventListener() {},
        removeEventListener() {},
        ...overrides,
    };
}

describe('WorkspaceView deploy quick action', () => {
    let dom;
    let container;
    let workspace;
    let deviceDeployment;
    let deploySpy;
    let showFormDialogSpy;
    let showModalSpy;
    let viewManager;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        container = document.createElement('div');
        document.body.appendChild(container);

        deploySpy = mock.fn(async () => 3);
        showFormDialogSpy = mock.fn(async () => ({ confirmed: true, formData: {} }));
        showModalSpy = mock.fn(() => {});

        deviceDeployment = createDeviceDeployment({ deployCollectionInteractive: deploySpy });
        workspace = new MockWorkspace({ deviceDeployment });
        viewManager = {
            showFormDialog: showFormDialogSpy,
            showModal: showModalSpy,
        };
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        delete global.ResizeObserver;
    });

    function flush() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('deploys the active collection without showing an options dialog', async () => {
        const view = new WorkspaceView({ workspace, viewManager });
        view.attachTo(container);

        view._deployCollectionButton.click();
        await flush();

        assert.equal(deploySpy.mock.calls.length, 1, 'deployCollection should be called once');
        assert.equal(showFormDialogSpy.mock.calls.length, 0, 'options dialog must not be shown');
        assert.equal(showModalSpy.mock.calls.length, 0, 'no error dialog on success');

        const [collectionArg, optionsArg] = deploySpy.mock.calls[0].arguments;
        assert.equal(collectionArg.getId(), 'col-1');
        assert.deepEqual(optionsArg, { quickAction: true, includeFullDefinition: false, force: false });
        assert.equal(
            view._deployCollectionButton.disabled,
            false,
            'button re-enabled after deploy'
        );

        view.detach();
    });

    it('places the upload button directly next to the collection selector', () => {
        const view = new WorkspaceView({ workspace, viewManager });
        view.attachTo(container);

        assert.ok(view._collectionDropdownContainer, 'collection selector container should exist');
        assert.ok(view._deployCollectionButton, 'upload button should exist');
        assert.equal(
            view._collectionDropdownContainer.nextElementSibling,
            view._deployCollectionButton,
            'upload button must directly follow the collection selector'
        );

        view.detach();
    });

    it('disables the toolbar button and ignores re-entry while a deploy is in flight', async () => {
        let resolveDeploy;
        const pending = new Promise((resolve) => {
            resolveDeploy = resolve;
        });
        deviceDeployment.deployCollectionInteractive = mock.fn(() => pending);

        const view = new WorkspaceView({ workspace, viewManager });
        view.attachTo(container);

        const firstDeploy = view._handleUploadToDevice();
        await flush();

        assert.equal(deviceDeployment.deployCollectionInteractive.mock.calls.length, 1);
        assert.equal(
            view._deployCollectionButton.disabled,
            true,
            'button disabled while deploying'
        );

        await view._handleUploadToDevice();
        await flush();
        assert.equal(
            deviceDeployment.deployCollectionInteractive.mock.calls.length,
            1,
            'second deploy must not start while the first is running'
        );

        resolveDeploy(2);
        await firstDeploy;
        assert.equal(view._deployCollectionButton.disabled, false, 'button re-enabled when done');

        view.detach();
    });

    it('shows the error dialog and skips deploy when validation fails', async () => {
        deviceDeployment.validateCollectionCompatibility = async () => ({
            compatible: false,
            errors: ['incompatible target'],
        });

        const view = new WorkspaceView({ workspace, viewManager });
        view.attachTo(container);

        await view._handleUploadToDevice();

        assert.equal(deploySpy.mock.calls.length, 0, 'deploy should be skipped');
        assert.equal(showFormDialogSpy.mock.calls.length, 0, 'options dialog must not be shown');
        assert.equal(showModalSpy.mock.calls.length, 1, 'error dialog should be shown');
        assert.equal(view._deployCollectionButton.disabled, false);

        view.detach();
    });

    it('re-enables the toolbar button after a failed deployment', async () => {
        deviceDeployment.deployCollectionInteractive = mock.fn(async () => {
            throw new Error('upload boom');
        });

        const view = new WorkspaceView({ workspace, viewManager });
        view.attachTo(container);

        await view._handleUploadToDevice();

        assert.equal(deviceDeployment.deployCollectionInteractive.mock.calls.length, 1);
        assert.equal(showModalSpy.mock.calls.length, 1, 'error dialog should be shown');
        assert.equal(view._deployCollectionButton.disabled, false, 'button re-enabled after error');

        view.detach();
    });

    it('stays silent when the user declined the embedded source override', async () => {
        const decline = new Error('Embedded source override declined for: vars');
        decline.code = 'EMBEDDED_SOURCE_OVERRIDE_DECLINED';
        decline.packageIds = ['vars'];
        deviceDeployment.deployCollectionInteractive = mock.fn(async () => {
            throw decline;
        });

        const view = new WorkspaceView({ workspace, viewManager });
        view.attachTo(container);

        await view._handleUploadToDevice();

        assert.equal(deviceDeployment.deployCollectionInteractive.mock.calls.length, 1);
        assert.equal(
            showModalSpy.mock.calls.length,
            0,
            'the user already answered the override dialog — no error dialog'
        );
        assert.equal(view._deployCollectionButton.disabled, false, 'button re-enabled');
        assert.equal(view._deployInFlight, false, 'deploy lock released');

        view.detach();
    });

    it('keeps the deploy options dialog out of the quick action even when the firmware is outdated', async () => {
        // The consent for shadowing outdated firmware packages belongs to DeviceDeployment: it
        // raises the shared confirmation while the deploy runs. The toolbar must not add a second
        // (options) dialog in front of it.
        deviceDeployment.validateNodePackages = mock.fn(() => ({
            compatible: true,
            errors: [],
            warnings: ['vars: firmware has v0.19.0, host has v0.20.0'],
            shadowPackages: [
                {
                    packageId: 'vars',
                    deviceVersion: '0.19.0',
                    hostVersion: '0.20.0',
                    reason: 'firmware-outdated',
                },
            ],
        }));

        const view = new WorkspaceView({ workspace, viewManager });
        view.attachTo(container);

        view._deployCollectionButton.click();
        await flush();

        assert.equal(
            showFormDialogSpy.mock.calls.length,
            0,
            'no deploy options dialog from the toolbar'
        );
        assert.equal(showModalSpy.mock.calls.length, 0, 'no dialog while the gate still prompts');
        assert.equal(deploySpy.mock.calls.length, 1);
        assert.deepEqual(
            deploySpy.mock.calls[0].arguments[1],
            { quickAction: true, includeFullDefinition: false, force: false },
            'the toolbar leaves the override decision to the deploy-time consent gate'
        );

        view.detach();
    });

    it('explains a blocked firmware package override instead of a generic upload failure', async () => {
        const blocked = new Error(
            'Deployment blocked: embedded override approval is missing for vars (3 unapproved files)'
        );
        blocked.code = 'EMBEDDED_OVERRIDE_APPROVAL_REQUIRED';
        blocked.packageIds = ['vars'];
        blocked.missingPaths = [
            '/device/node_pkgs/vars/otter_vars/__init__.py',
            '/device/node_pkgs/vars/otter_vars/array.py',
            '/device/node_pkgs/vars/otter_vars/store.py',
        ];
        deviceDeployment.deployCollectionInteractive = mock.fn(async () => {
            throw blocked;
        });

        const view = new WorkspaceView({ workspace, viewManager });
        view.attachTo(container);

        await view._handleUploadToDevice();

        assert.equal(
            showFormDialogSpy.mock.calls.length,
            0,
            'no deploy options dialog from the toolbar'
        );
        assert.equal(showModalSpy.mock.calls.length, 1, 'the blocked override must be explained');
        const dialog = showModalSpy.mock.calls[0].arguments[0];
        assert.equal(dialog.title, 'Firmware Packages Outdated');
        assert.ok(dialog.message.includes('vars'), 'the affected packages must be named');
        assert.ok(
            dialog.message.includes('Upload firmware package source'),
            'the dialog must point at the option that grants the override'
        );
        assert.equal(view._deployCollectionButton.disabled, false, 'button re-enabled');
        assert.equal(view._deployInFlight, false, 'deploy lock released');

        view.detach();
    });
});
