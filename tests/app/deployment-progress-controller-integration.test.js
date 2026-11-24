// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// End-to-end check with the real view system: a real ViewManager, the real
// DeploymentProgressDialogView and the production ProgressEventBus subscription. The linger is
// driven by an injected scheduler so the suite does not wait for wall-clock time.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ViewManager } from '../../src/micro_otter/nodes/html/js/views/view-manager.js';
import { DeploymentProgressDialogView } from '../../src/micro_otter/nodes/html/js/views/deployment-progress-dialog-view.js';
import {
    ProgressEvent,
    ProgressEventBus,
    ProgressEventType,
} from '../../src/micro_otter/nodes/html/js/core/progress-events.js';
import { startDeploymentProgressController } from '../../src/micro_otter/nodes/html/js/app/deployment-progress-controller.js';

const LOCALES = {
    en: JSON.parse(
        readFileSync(
            new URL('../../src/micro_otter/nodes/html/locales/en.json', import.meta.url),
            'utf8'
        )
    ),
};

/**
 * Resolve a dotted key in a locale tree.
 * @param {object} tree Locale document.
 * @param {string} key Dotted key.
 */
function lookup(tree, key) {
    return key.split('.').reduce((node, part) => (node == null ? node : node[part]), tree);
}

/** i18n double over the shipped English locale. */
const i18nService = {
    currentLocale: 'en',
    availableLocales: ['en'],
    t(key) {
        const value = lookup(LOCALES.en, key);
        return typeof value === 'string' ? value : key;
    },
    /** `ViewManager` loads the manifest on construction. */
    async load() {},
    addEventListener() {},
    removeEventListener() {},
};

describe('deployment progress integration', () => {
    let dom;
    let container;
    let manager;
    let stop;
    let timers;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
        manager = new ViewManager({ mount: container, i18nService, logEvents: false });

        timers = new Map();
        let nextId = 0;
        stop = startDeploymentProgressController({
            viewManager: manager,
            createDialog: (title) => new DeploymentProgressDialogView({ title, i18nService }),
            subscribe: (listener) => {
                ProgressEventBus.subscribe(listener);
                return () => ProgressEventBus.unsubscribe(listener);
            },
            t: (key) => i18nService.t(key),
            setTimeout: (handler, ms) => {
                nextId += 1;
                timers.set(nextId, { handler, ms });
                return nextId;
            },
            clearTimeout: (handle) => timers.delete(handle),
        });
    });

    afterEach(() => {
        stop?.();
        stop = null;
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
    });

    /**
     * Publish one real progress event on the production bus.
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

    const modal = () => container.querySelector('.modal-dialog');
    const bars = () => container.querySelectorAll('[role="progressbar"]');

    it('shows the dialog for a title-bar deploy through the real bus', () => {
        publish('collection-deploy', ProgressEventType.START, 'Deploying collection: Demo');

        assert.equal(container.querySelectorAll('.modal-dialog').length, 1);
        assert.equal(modal().getAttribute('aria-label'), 'Deploy Collection');
        assert.equal(bars().length, 2);
        assert.equal(manager.modalView instanceof DeploymentProgressDialogView, true);
    });

    it('drives both tiers and survives a file-send burst with the same dialog', () => {
        publish('collection-sync', ProgressEventType.START, 'Syncing collection: Demo');
        const shown = modal();

        publish('collection-sync', ProgressEventType.UPDATE, 'Writing 2/4', 40);
        publish('file-send-main.py', ProgressEventType.START, 'Sending main.py');
        publish('file-send-main.py', ProgressEventType.UPDATE, 'Sending main.py', 70);
        publish('file-send-main.py', ProgressEventType.COMPLETE, 'main.py sent');

        assert.equal(bars()[0].getAttribute('aria-valuenow'), '40');
        assert.equal(bars()[1].getAttribute('aria-valuenow'), '100');
        assert.equal(modal(), shown, 'no second dialog during the file burst');
        assert.equal(timers.size, 0, 'a file complete arms no linger');
    });

    it('closes the dialog after the completion linger', () => {
        publish('runtime-upgrade', ProgressEventType.START, 'Upgrading runtime');
        publish('runtime-upgrade', ProgressEventType.COMPLETE, 'Runtime upgraded');

        assert.equal(manager.modalView instanceof DeploymentProgressDialogView, true);
        assert.equal(timers.size, 1);

        for (const timer of [...timers.values()]) {
            timer.handler();
        }

        assert.equal(manager.modalView, null);
        assert.equal(modal(), null);
    });

    it('leaves the modal layer empty for unrelated progress sources', () => {
        publish('transpiler', ProgressEventType.START, 'Transpiling');
        publish('device-info-load', ProgressEventType.START, 'Loading device info');
        publish('transpiler', ProgressEventType.UPDATE, 'Transpiling', 50);

        assert.equal(manager.modalView, null);
        assert.equal(modal(), null);
    });
});
