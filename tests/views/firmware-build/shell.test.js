// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import { ViewFactory } from '../../../src/micro_otter/nodes/html/js/views/view-factory.js';
import { IconProvider } from '../../../src/micro_otter/nodes/html/js/views/icon-provider.js';
import {
    createFakeViewManager,
    createI18nService,
    createOptions,
    createRuntime,
    createStore,
    createSwitchableI18nService,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

function factoryServices() {
    return {
        i18nService: createI18nService(),
        deviceConnection: { isConnected: () => false },
        runtimeCollection: { getRuntime: () => null, async load() {} },
        collectionManager: { on: () => () => {}, getActiveCollection: () => null },
        viewManager: createFakeViewManager(),
    };
}

describe('FirmwareBuildView shell', () => {
    it('exposes the metadata TabbedView needs', () => {
        const view = new FirmwareBuildView(createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() }));
        const metadata = view.getMetadata();
        assert.equal(metadata.title, 'Firmware');
        assert.equal(metadata.icon, IconProvider.memory);
        assert.ok(metadata.id);
    });

    it('serializes with the FirmwareBuildView type discriminator', () => {
        const view = new FirmwareBuildView(createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() }));
        const serialized = view.serialize();
        assert.equal(serialized.type, 'FirmwareBuildView');
        assert.equal(serialized.title, 'Firmware');
        assert.equal(serialized.icon, IconProvider.memory);
    });

    it('restores through the ViewFactory with the runtime services', () => {
        const view = new FirmwareBuildView(createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() }));
        const serialized = view.serialize();

        const factory = new ViewFactory(factoryServices());
        const restored = factory.create(serialized);

        assert.ok(restored instanceof FirmwareBuildView);
        assert.equal(restored.getMetadata().title, 'Firmware');
        assert.equal(restored.getMetadata().icon, IconProvider.memory);
    });

    it('names the missing service when collectionManager is absent', () => {
        const services = factoryServices();
        const factory = new ViewFactory({
            i18nService: services.i18nService,
            deviceConnection: services.deviceConnection,
            runtimeCollection: services.runtimeCollection,
        });
        assert.throws(
            () => factory.create({ type: 'FirmwareBuildView' }),
            /collectionManager/
        );
    });

    describe('rendered shell', () => {
        let dom;
        let container;

        beforeEach(() => {
            ({ dom, container } = setupDom());
            global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, boards: [] }) });
        });

        afterEach(() => {
            teardownDom({ dom, container });
        });

        it('renders a flex shell with a split host over the panes', async () => {
            const view = new FirmwareBuildView(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() })
            );
            view.attachTo(container);
            await tick();

            const root = container.querySelector('.firmware-build-view');
            assert.ok(root);
            assert.equal(root.children[0]?.className, 'firmware-build-view__content');
            assert.equal(root.children[1]?.className, 'firmware-build-view__offline');

            const content = root.querySelector('.firmware-build-view__content');
            const splitHost = content.querySelector('.firmware-build-view__split-host');
            assert.ok(splitHost, 'the panes live in the split host');
            assert.ok(splitHost.querySelector('.split-view'));
            assert.ok(splitHost.querySelectorAll('.split-view__pane').length > 0);

            assert.equal(content.querySelector('.firmware-build-view__body'), null, 'the old body host is gone');

            view.detach();
        });

        it('re-renders the Help text when the language changes', async () => {
            const i18nService = createSwitchableI18nService('en');
            const view = new FirmwareBuildView(
                createOptions({
                    store: createStore(readySnapshot()),
                    runtime: createRuntime(),
                    i18nService,
                })
            );
            view.attachTo(container);
            await tick();

            const markdown = () =>
                container
                    .querySelector('.firmware-build-view__help')
                    .querySelector('.view-markdown');

            assert.equal(markdown().textContent, 'en:firmwareBuild.help.body');

            i18nService.setLocale('de');
            await tick();

            assert.equal(markdown().textContent, 'de:firmwareBuild.help.body');

            view.detach();
        });

        it('keeps the server chrome out of the shell', async () => {
            const view = new FirmwareBuildView(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() })
            );
            view.attachTo(container);
            await tick();

            for (const suffix of [
                '__header',
                '__badge',
                '__server-version',
                '__notice',
                '__header-actions',
            ]) {
                assert.equal(
                    container.querySelector(`.firmware-build-view${suffix}`),
                    null,
                    `.firmware-build-view${suffix} belongs to the shared connection controller`
                );
            }

            const root = container.querySelector('.firmware-build-view');
            assert.equal(
                root.querySelectorAll(':scope > *').length,
                2,
                'the shell holds the panes and the offline host only'
            );

            const offline = root.querySelector('.firmware-build-view__offline');
            assert.ok(offline, 'a ready snapshot still builds the offline host');
            assert.equal(offline.hidden, true, 'the offline host is hidden while the server is ready');

            view.detach();
        });

        it('empties the host on detach', () => {
            const view = new FirmwareBuildView(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() })
            );
            view.attachTo(container);
            view.detach();
            assert.equal(container.children.length, 0);
        });
    });
});
