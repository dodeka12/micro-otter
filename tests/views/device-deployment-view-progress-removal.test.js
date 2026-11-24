// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// The Device tab no longer draws deployment progress: the inline panel, its builders and its
// stylesheet block are gone, and the view subscribes to `device-info-load` only. Deployment and
// runtime progress belongs to `DeploymentProgressDialogView` (app/deployment-progress-controller).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import {
    ProgressEvent,
    ProgressEventBus,
    ProgressEventType,
} from '../../src/micro_otter/nodes/html/js/core/progress-events.js';

let DeviceDeploymentView;
let DeviceState;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlRoot = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html');
const viewPath = path.join(htmlRoot, 'js', 'views', 'device-deployment-view.ts');
const cssPath = path.join(htmlRoot, 'styles', 'standard', 'device-deployment-view.css');
const dialogCssPath = path.join(htmlRoot, 'styles', 'standard', 'deployment-progress-dialog.css');
const detailCssPath = path.join(htmlRoot, 'styles', 'standard', 'progress-detail-view.css');
const themesPath = path.join(htmlRoot, 'styles', 'themes.json');

const EN = JSON.parse(readFileSync(path.join(htmlRoot, 'locales', 'en.json'), 'utf8'));

/** Removed selectors; none of them may survive in the Device tab stylesheet. */
const REMOVED_SELECTORS = [
    '.deployment-progress-panel',
    '.deployment-progress-content',
    '.progress-message',
    '.progress-message.error',
    '.progress-tier',
    '.progress-label',
    '.progress-text',
    '.progress-section-divider',
    '.progress-bar-wrapper',
    '.progress-bar',
];

/** Minimal i18n double over the shipped English locale. */
function createI18nService() {
    return {
        currentLocale: 'en',
        t(key) {
            const value = key
                .split('.')
                .reduce((node, part) => (node == null ? node : node[part]), EN);
            return typeof value === 'string' ? value : key;
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

/**
 * Deployment service double for one device state.
 * @param {object} state `DeviceState` instance the view renders.
 */
function createMocks(state) {
    const deviceConnection = {
        isConnected: () => Boolean(state.connected),
        async connect() {},
        async readTextFile() {
            return '{}';
        },
    };

    const deviceDeployment = {
        addEventListener() {},
        removeEventListener() {},
        getDeviceState: () => state,
        getDeviceConnection: () => deviceConnection,
        async refreshConnectionState() {},
        isConnected: () => Boolean(state.connected),
        hasMicroPython: () => Boolean(state.hasMicroPython),
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
        deviceDeployment,
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

describe('DeviceDeploymentView — deployment progress removed', () => {
    let dom;
    let container;

    beforeEach(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
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
     * Attach a connected view.
     * @returns {import('../../src/micro_otter/nodes/html/js/views/device-deployment-view.js').DeviceDeploymentView}
     *   The attached view.
     */
    function attachView() {
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
        return view;
    }

    /**
     * Publish one event on the production bus.
     * @param {string} source Tracker name.
     * @param {string} type Event type.
     * @param {string} message Message text.
     * @param {number} [progress] Percentage.
     */
    function publish(source, type, message, progress) {
        ProgressEventBus.emit(
            new ProgressEvent({
                source,
                type,
                message,
                ...(progress === undefined ? {} : { progress }),
            })
        );
    }

    it('renders no deployment progress panel for a collection deploy', () => {
        const view = attachView();

        publish('collection-sync', ProgressEventType.START, 'Syncing collection: Demo');
        publish('collection-sync', ProgressEventType.UPDATE, 'Writing 2/4', 50);
        publish('collection-sync', ProgressEventType.COMPLETE, 'Collection synced');

        assert.equal(container.querySelector('.deployment-progress-panel'), null);
        assert.equal(container.querySelector('.deployment-progress-content'), null);
        assert.equal(container.querySelectorAll('[role="progressbar"]').length, 0);
        assert.equal(
            container.textContent.includes('Syncing collection: Demo'),
            false,
            'the published message is not rendered in the Device tab'
        );

        view.detach();
    });

    it('keeps the loading panel for device-info-load', () => {
        const view = attachView();
        const loadingPanel = container.querySelector('.deployment-loading-panel');
        assert.ok(loadingPanel, 'loading panel still exists');

        publish('device-info-load', ProgressEventType.START, 'Loading device info', 10);

        assert.notEqual(
            loadingPanel.style.display,
            'none',
            'loading panel shown for its own source'
        );

        view.detach();
    });

    it('ignores file transfer and runtime events entirely', () => {
        const view = attachView();
        const loadingPanel = container.querySelector('.deployment-loading-panel');
        const displayBefore = loadingPanel.style.display;

        publish('file-send-a.py', ProgressEventType.START, 'Sending a.py');
        publish('file-send-a.py', ProgressEventType.UPDATE, 'Sending a.py', 40);
        publish('runtime-install', ProgressEventType.START, 'Installing runtime');
        publish('runtime-install', ProgressEventType.COMPLETE, 'Runtime installed');

        assert.equal(container.querySelector('.deployment-progress-panel'), null);
        assert.equal(container.querySelectorAll('[role="progressbar"]').length, 0);
        assert.equal(loadingPanel.style.display, displayBefore, 'the loading panel is untouched');

        view.detach();
    });

    it('leaves no bus listener behind after detach', () => {
        const view = attachView();
        view.detach();

        assert.doesNotThrow(() => {
            publish('device-info-load', ProgressEventType.START, 'Loading device info', 10);
            publish('collection-sync', ProgressEventType.START, 'Syncing');
        });
        assert.equal(container.querySelector('.deployment-progress-panel'), null);
    });
});

describe('Device tab stylesheet after the panel removal', () => {
    it('drops the panel code from the view as well as its selectors', () => {
        const source = readFileSync(viewPath, 'utf8');

        for (const symbol of [
            '_progressPanel',
            '_progressElements',
            '_createProgressPanel',
            '_createProgressTier',
            'deployment-progress-panel',
        ]) {
            assert.equal(source.includes(symbol), false, `${symbol} removed from the view`);
        }
        assert.match(source, /event\.source === 'device-info-load'/);
    });

    it('drops every panel selector and keeps the rest of the sheet registered', () => {
        const css = readFileSync(cssPath, 'utf8');

        for (const selector of REMOVED_SELECTORS) {
            assert.equal(css.includes(selector), false, `stale selector ${selector}`);
        }
        assert.ok(css.includes('.deployment-loading-panel'), 'loading panel rules stay');
        assert.ok(css.includes('.deployment-empty-state__body'), 'Help pane body rules stay');

        const manifest = JSON.parse(readFileSync(themesPath, 'utf8'));
        assert.ok(manifest.styles.includes('device-deployment-view'));
    });

    it('keeps the determinate bar in the shared detail stylesheet', () => {
        assert.ok(existsSync(detailCssPath), 'detail stylesheet exists');
        const css = readFileSync(detailCssPath, 'utf8');

        assert.ok(css.includes('.progress-detail-view__bar-wrapper'));
        assert.ok(css.includes('.progress-detail-view__bar'));
        assert.ok(css.includes('linear-gradient(90deg'));

        const dialogCss = readFileSync(dialogCssPath, 'utf8');
        assert.equal(dialogCss.includes('__bar'), false, 'the dialog stylesheet owns no bar');
    });
});
