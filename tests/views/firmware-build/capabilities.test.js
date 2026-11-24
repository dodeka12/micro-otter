// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    createOptions,
    createRuntime,
    createStore,
    createSwitchableI18nService,
    readySnapshot,
    unavailableSnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

function firingI18nService() {
    const listeners = [];
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
        addEventListener(type, handler) {
            if (type === 'languagechange') {
                listeners.push(handler);
            }
        },
        removeEventListener() {},
        fireLanguageChange() {
            for (const handler of listeners) {
                handler();
            }
        },
    };
}

describe('FirmwareBuildView capabilities', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, boards: [] }) });
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    /** The Build pane's icon-only Build control. */
    const buildButton = () =>
        container.querySelector(
            '.firmware-build-view__build-firmware > .view-toolbar .custom-control__button'
        );
    /** The Deploy pane's icon-only Deploy control. */
    const deployButton = () =>
        container.querySelector('.firmware-build-view__deploy > .view-toolbar .custom-control__button');
    /** The one offline host the tab renders beside its content. */
    const offline = () => container.querySelector('.firmware-build-view__offline');

    /** The Build pane's clean-build checkbox, a control no job state touches. */
    const cleanBuildControl = () =>
        container.querySelector(
            '.firmware-build-view__build-firmware .custom-control__checkbox'
        );

    it('renders probing synchronously, then ready after the probe resolves', async () => {
        const store = createStore(readySnapshot());
        const view = new FirmwareBuildView(createOptions({ store, runtime: createRuntime() }));
        view.attachTo(container);

        const root = container.querySelector('.firmware-build-view');
        assert.equal(root.children[0].className, 'firmware-build-view__content');
        assert.equal(offline().hidden, true, 'no offline section while the first probe runs');
        assert.equal(cleanBuildControl().disabled, true, 'controls are disabled while probing');
        assert.equal(deployButton().disabled, true, 'controls are disabled while probing');

        await tick();
        assert.equal(cleanBuildControl().disabled, false);
        assert.equal(deployButton().disabled, false);
        assert.equal(buildButton().disabled, false);
        assert.equal(offline().hidden, true, 'a ready snapshot keeps the panes');
        view.detach();
    });

    it('renders ready with the five panes and no server chrome', async () => {
        const store = createStore(readySnapshot());
        const view = new FirmwareBuildView(createOptions({ store, runtime: createRuntime() }));
        view.attachTo(container);
        await tick();

        for (const suffix of ['__header', '__badge', '__server-version', '__notice', '__header-actions']) {
            assert.equal(
                container.querySelector(`.firmware-build-view${suffix}`),
                null,
                `.firmware-build-view${suffix} must not exist`
            );
        }

        const root = container.querySelector('.firmware-build-view');
        assert.equal(root.children.length, 2, 'content plus the offline host');
        for (const child of root.children) {
            assert.equal(
                [...child.children].some((el) => el.tagName === 'BUTTON'),
                false,
                'no shell-level control sits above the panes'
            );
        }

        assert.equal(root.querySelectorAll('.split-view__pane > .collapsible-view').length, 5);
        view.detach();
    });

    it('renders each unavailable reason as one expanded Help section', async () => {
        for (const reason of ['unreachable', 'not-micro-otter', 'malformed']) {
            const store = createStore(unavailableSnapshot(reason, 'HTTP 404'));
            const view = new FirmwareBuildView(createOptions({ store, runtime: createRuntime() }));
            view.attachTo(container);
            await tick();

            const host = offline();
            assert.equal(host.hidden, false, `${reason}: the offline section is shown`);
            assert.equal(
                container.querySelector('.firmware-build-view__content').hidden,
                true,
                `${reason}: the panes are hidden`
            );

            const section = host.querySelector('.collapsible-view');
            assert.ok(section, `${reason}: the offline host holds one collapsible`);
            assert.equal(
                section.querySelector('.collapsible-view__title').textContent,
                'firmwareBuild.help.title'
            );
            assert.equal(
                section.classList.contains('is-collapsed'),
                false,
                `${reason}: an outage shows the recovery text without a click`
            );
            assert.equal(
                section.querySelector('.collapsible-view__content').style.display,
                '',
                `${reason}: an expanded section shows its body`
            );
            assert.equal(
                section.querySelector('.view-markdown').textContent,
                'firmwareBuild.offline.body',
                `${reason}: the explainer is the body`
            );
            view.detach();
        }
    });

    it('keeps an offline Help section the user folded away', async () => {
        const store = createStore(unavailableSnapshot('unreachable'));
        const view = new FirmwareBuildView(createOptions({ store, runtime: createRuntime() }));
        view.attachTo(container);
        await tick();

        const section = offline().querySelector('.collapsible-view');
        assert.equal(section.classList.contains('is-collapsed'), false, 'the outage expands it');

        section.querySelector('.collapsible-view__toggle').click();
        assert.equal(section.classList.contains('is-collapsed'), true, 'the user folded it away');

        store.listeners.forEach((listener) => listener());
        await tick();

        assert.equal(
            section.classList.contains('is-collapsed'),
            true,
            'an unrelated re-render does not re-expand it'
        );
        view.detach();
    });

    it('issues no forced refresh when the snapshot is unavailable', async () => {
        const store = createStore(unavailableSnapshot('unreachable'));
        const view = new FirmwareBuildView(createOptions({ store, runtime: createRuntime() }));
        view.attachTo(container);
        await tick();
        await tick();

        assert.equal(store.refreshCalls, 1, 'only the probe the view runs on attach');
        assert.equal(
            offline().querySelector('.custom-control__button'),
            null,
            'the tab offers no Retry of its own'
        );
        view.detach();
    });

    it('does not re-probe on a locale change', async () => {
        const i18n = firingI18nService();
        const store = createStore(readySnapshot());
        const view = new FirmwareBuildView({
            ...createOptions({ store, runtime: createRuntime() }),
            i18nService: i18n,
        });
        view.attachTo(container);
        await tick();
        const before = store.refreshCalls;

        i18n.fireLanguageChange();
        assert.equal(store.refreshCalls, before);
        view.detach();
    });

    it('re-renders the offline Help section in the new language', async () => {
        const i18nService = createSwitchableI18nService('en');
        const store = createStore(unavailableSnapshot('unreachable'));
        const view = new FirmwareBuildView({
            ...createOptions({ store, runtime: createRuntime() }),
            i18nService,
        });
        view.attachTo(container);
        await tick();

        const host = offline();
        assert.equal(
            host.querySelector('.collapsible-view__title').textContent,
            'en:firmwareBuild.help.title'
        );

        i18nService.setLocale('de');
        await tick();

        assert.equal(
            host.querySelector('.collapsible-view__title').textContent,
            'de:firmwareBuild.help.title'
        );
        assert.equal(host.querySelector('.view-markdown').textContent, 'de:firmwareBuild.offline.body');
        view.detach();
    });

    it('unsubscribes from the store on detach', async () => {
        const store = createStore(readySnapshot());
        const view = new FirmwareBuildView(createOptions({ store, runtime: createRuntime() }));
        view.attachTo(container);
        await tick();
        assert.equal(store.listeners.size, 1);

        view.detach();
        assert.equal(store.listeners.size, 0);
    });
});
