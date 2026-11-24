// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let DeviceDeploymentView;
let DeviceState;

const EN = JSON.parse(
    readFileSync(
        new URL('../../src/micro_otter/nodes/html/locales/en.json', import.meta.url),
        'utf8'
    )
);

/**
 * Minimal i18n double over the shipped English locale.
 */
function createI18nService() {
    return {
        currentLocale: 'en',
        t(key) {
            const value = key.split('.').reduce((node, part) => (node == null ? node : node[part]), EN);
            return typeof value === 'string' ? value : key;
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

/**
 * Mock the deployment service for one device state.
 * @param {object} state `DeviceState` instance the view renders.
 */
function createMocks(state) {
    const mutable = {
        connectCalls: 0,
        connected: Boolean(state.connected),
        state,
    };

    const deviceConnection = {
        isConnected() {
            return mutable.connected;
        },
        async connect() {
            mutable.connectCalls += 1;
        },
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
            return mutable.connected;
        },
        hasMicroPython() {
            return Boolean(mutable.state.hasMicroPython);
        },
        async refreshDeviceInfo() {},
        async reconfigureDeviceTarget() {},
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
                        getId: () => 'collection-1',
                        getTitle: () => 'Collection 1',
                        getVersionString: () => '1.0.0',
                        getDeviceRuntimeId: () => 'general',
                        getTargetId: () => 'esp32-test',
                        on: () => () => {},
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

describe('DeviceDeploymentView empty state', () => {
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
        const stateModule = await import('../../src/micro_otter/nodes/html/js/data/device-state.js');
        DeviceDeploymentView = viewModule.DeviceDeploymentView;
        DeviceState = stateModule.DeviceState;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
        delete global.customElements;
        delete global.CustomEvent;
        delete global.EventTarget;
    });

    /**
     * Return the split's direct pane elements.
     * @param {Element} split Split host element.
     * @returns {Element[]} Direct panes in display order.
     */
    function splitPanes(split) {
        return Array.from(split.children).filter((child) =>
            child.classList.contains('split-view__pane')
        );
    }

    it('shows the Help collapsible as the only pane while disconnected', () => {
        const state = new DeviceState({
            connected: false,
            hasMicroPython: false,
            runtimeInstalled: false,
            deviceInfoLoading: false,
            collectionDeployed: false,
        });
        const { options, mutable } = createMocks(state);

        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const split = container.querySelector(
            '.device-deployment-view__split-host > .split-view'
        );
        assert.ok(split, 'the disconnected state uses the standard split shell');
        const panes = splitPanes(split);
        assert.equal(panes.length, 1, 'the Help section is the only split pane');

        const helpPane = panes[0];
        const collapsible = helpPane.firstElementChild;
        assert.ok(collapsible?.classList.contains('collapsible-view'));
        assert.equal(
            collapsible.querySelector('.collapsible-view__title').textContent,
            EN.deployment.helpTitle
        );
        assert.equal(
            collapsible.querySelector('.collapsible-view__header').style.height,
            '28px',
            'the Help pane uses the shared 28px header default'
        );
        assert.match(helpPane.textContent, new RegExp(EN.deployment.noDeviceConnected));
        assert.match(helpPane.textContent, new RegExp(EN.deployment.connectViaTitleBar));
        assert.ok(helpPane.querySelector('.view-markdown'), 'the prompt renders through MarkdownView');
        assert.ok(
            collapsible.querySelector('.collapsible-view__toggle'),
            'the Help section stays collapsible'
        );
        assert.equal(mutable.connectCalls, 0, 'rendering never connects the device');

        view.detach();
    });

    it('swaps the same split to the normal panes while connected', () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            deviceInfoLoading: false,
            collectionDeployed: false,
        });
        const { options } = createMocks(state);

        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const split = container.querySelector(
            '.device-deployment-view__split-host > .split-view'
        );
        assert.ok(split);
        assert.equal(splitPanes(split).length, 5);
        assert.equal(
            container.querySelector('.deployment-empty-state__body'),
            null,
            'the disconnected Help pane is not mounted'
        );

        view.detach();
    });

    it('swaps between Help and the five panes when the connection changes', () => {
        const state = new DeviceState({
            connected: false,
            hasMicroPython: false,
            runtimeInstalled: false,
            deviceInfoLoading: false,
        });
        const { options, mutable } = createMocks(state);

        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const split = container.querySelector(
            '.device-deployment-view__split-host > .split-view'
        );
        assert.ok(split);
        assert.equal(splitPanes(split).length, 1);

        mutable.connected = true;
        mutable.state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            deviceInfoLoading: false,
        });
        view._updateUI();

        assert.equal(
            split,
            container.querySelector('.device-deployment-view__split-host > .split-view'),
            'the same SplitView instance stays mounted'
        );
        assert.equal(splitPanes(split).length, 5);
        const deployButton = split.querySelector(
            '.device-deployment-view__toolbar-btn--deploy-collection'
        );
        assert.ok(deployButton, 'the reattached toolbar renders its controls');
        assert.equal(deployButton.disabled, false, 'toolbar state is applied after reattachment');

        mutable.connected = false;
        mutable.state = state;
        view._updateUI();

        const panes = splitPanes(split);
        assert.equal(panes.length, 1);
        assert.equal(
            panes[0].querySelector('.collapsible-view__title').textContent,
            EN.deployment.helpTitle
        );
        assert.ok(panes[0].querySelector('.view-markdown'));

        view.detach();
    });
});

