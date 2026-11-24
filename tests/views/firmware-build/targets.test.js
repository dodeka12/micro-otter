// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    BOARD_CATALOG,
    createOptions,
    createRuntime,
    createStore,
    createTarget,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

describe('FirmwareBuildView targets', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async () => ({ ok: true, status: 200, json: async () => BOARD_CATALOG });
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    async function mount(store, runtime = createRuntime(), collection = null) {
        const view = new FirmwareBuildView(createOptions({ store, runtime, collection }));
        view.attachTo(container);
        await tick();
        await tick();
        return view;
    }

    const label = () =>
        container
            .querySelector('.firmware-build-view__dropdown--target')
            .querySelector('.dropdown-control__button-label').textContent;

    it('lists targets and defaults to the runtime default target', async () => {
        const runtime = createRuntime({
            getAvailableTargets: () => [
                createTarget('esp32-test', 'ESP32 Test'),
                createTarget('esp32c3-test', 'ESP32-C3 Test'),
            ],
        });
        const view = await mount(createStore(readySnapshot()), runtime);

        const button = container.querySelector('.firmware-build-view__dropdown--target');
        assert.equal(button.querySelector('.dropdown-control__button-label').textContent, 'ESP32 Test');

        const options = document.body.querySelectorAll(
            '.firmware-build-view__dropdown-menu--target .dropdown-control__option'
        );
        assert.equal(options.length, 2);

        view.detach();
    });

    it('updates the selection when an option is chosen', async () => {
        const runtime = createRuntime({
            getAvailableTargets: () => [
                createTarget('esp32-test', 'ESP32 Test'),
                createTarget('esp32c3-test', 'ESP32-C3 Test'),
            ],
        });
        const view = await mount(createStore(readySnapshot()), runtime);

        document.body
            .querySelector('.firmware-build-view__dropdown-menu--target .dropdown-control__option[data-value="esp32c3-test"]')
            .click();

        const button = container.querySelector('.firmware-build-view__dropdown--target');
        assert.equal(button.querySelector('.dropdown-control__button-label').textContent, 'ESP32-C3 Test');
        view.detach();
    });

    it('offers only the targets the server can build', async () => {
        const runtime = createRuntime({
            defaultDeviceTargetId: 'generic_micropython',
            getAvailableTargets: () => [
                createTarget('generic_micropython', 'Generic'),
                createTarget('esp32_wroom', 'ESP32-WROOM'),
            ],
            getCompileTarget(targetId) {
                return targetId === 'esp32_wroom' ? { board: 'esp32', port: 'esp32' } : null;
            },
        });
        const view = await mount(createStore(readySnapshot()), runtime);

        const options = document.body.querySelectorAll(
            '.firmware-build-view__dropdown-menu--target .dropdown-control__option'
        );
        assert.deepEqual(
            [...options].map((option) => option.dataset.value),
            ['esp32_wroom']
        );

        // The catalog's default target is the unbuildable one, so the selection
        // falls to the first offered target instead of a hidden id.
        const button = container.querySelector('.firmware-build-view__dropdown--target');
        assert.equal(button.querySelector('.dropdown-control__button-label').textContent, 'ESP32-WROOM');

        view.detach();
    });

    it('offers only the targets the connected board firmware allows', async () => {
        const runtime = createRuntime({
            defaultDeviceTargetId: 'esp32_wroom',
            getAvailableTargets: () => [
                createTarget('esp32_wroom', 'ESP32-WROOM'),
                createTarget('esp32_s3_mini', 'ESP32-S3 Mini'),
            ],
            getCompileTarget(targetId) {
                return targetId === 'esp32_wroom' || targetId === 'esp32_s3_mini'
                    ? { board: 'esp32', port: 'esp32' }
                    : null;
            },
        });
        const view = new FirmwareBuildView(
            createOptions({
                store: createStore(readySnapshot()),
                runtime,
                deviceConnection: {
                    isConnected: () => false,
                    disconnect: async () => {},
                    getAllowedWebTargetIds: () => ['esp32_wroom'],
                },
            })
        );
        view.attachTo(container);
        await tick();
        await tick();

        const options = document.body.querySelectorAll(
            '.firmware-build-view__dropdown-menu--target .dropdown-control__option'
        );
        assert.deepEqual(
            [...options].map((option) => option.dataset.value),
            ['esp32_wroom']
        );

        view.detach();
    });

    it('keeps every target when none of them has a compile mapping', async () => {
        const runtime = createRuntime({
            defaultDeviceTargetId: 'custom',
            getAvailableTargets: () => [
                createTarget('generic_micropython', 'Generic'),
                createTarget('custom', 'Custom Device'),
            ],
            getCompileTarget: () => null,
        });
        const view = await mount(createStore(readySnapshot()), runtime);

        const options = document.body.querySelectorAll(
            '.firmware-build-view__dropdown-menu--target .dropdown-control__option'
        );
        assert.equal(options.length, 2);
        assert.equal(
            container
                .querySelector('.firmware-build-view__dropdown--target')
                .querySelector('.dropdown-control__button-label').textContent,
            'Custom Device'
        );

        // The reason a target cannot be built stays visible instead of an empty chooser.
        const info = container.querySelector('.firmware-build-view__info');
        assert.ok(info.textContent.includes('firmwareBuild.target.noMapping'));

        view.detach();
    });

    it('defaults to the active collection target when it is buildable', async () => {
        const runtime = createRuntime({
            getAvailableTargets: () => [
                createTarget('esp32-test', 'ESP32 Test'),
                createTarget('esp32c3-test', 'ESP32-C3 Test'),
            ],
        });
        const collection = {
            getId: () => 'collection-1',
            getTargetId: () => 'esp32c3-test',
            getDeviceRuntimeId: () => 'general',
        };
        const view = await mount(createStore(readySnapshot()), runtime, collection);

        assert.equal(label(), 'ESP32-C3 Test');

        view.detach();
    });

    it('falls back to the runtime default when the collection target is generic', async () => {
        const runtime = createRuntime({
            getAvailableTargets: () => [
                createTarget('esp32-test', 'ESP32 Test'),
                createTarget('esp32c3-test', 'ESP32-C3 Test'),
            ],
        });
        const collection = {
            getId: () => 'collection-1',
            getTargetId: () => 'generic_micropython',
            getDeviceRuntimeId: () => 'general',
        };
        const view = await mount(createStore(readySnapshot()), runtime, collection);

        assert.equal(label(), 'ESP32 Test');

        view.detach();
    });

    it('keeps an explicit pick when the collection changes', async () => {
        const runtime = createRuntime({
            getAvailableTargets: () => [
                createTarget('esp32-test', 'ESP32 Test'),
                createTarget('esp32c3-test', 'ESP32-C3 Test'),
            ],
        });
        const collection = {
            getId: () => 'collection-1',
            getTargetId: () => 'esp32-test',
            getDeviceRuntimeId: () => 'general',
        };
        const view = await mount(createStore(readySnapshot()), runtime, collection);

        document.body
            .querySelector('.firmware-build-view__dropdown-menu--target .dropdown-control__option[data-value="esp32c3-test"]')
            .click();
        assert.equal(label(), 'ESP32-C3 Test');

        collection.getTargetId = () => 'esp32-test';
        view.render(container);
        await tick();

        assert.equal(label(), 'ESP32-C3 Test', 'an explicit pick survives a collection switch');

        view.detach();
    });

    it('renders no firmware source chooser', async () => {
        const view = await mount(createStore(readySnapshot()));
        assert.equal(container.querySelector('.firmware-build-view__dropdown--source'), null);
        view.detach();
    });
});
