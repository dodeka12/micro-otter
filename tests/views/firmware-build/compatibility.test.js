// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    BOARD_CATALOG,
    createFakeClient,
    createFakeCollection,
    createOptions,
    createStore,
    createTwoPackageRuntime,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

const ENTRY = {
    path: '/opt/fw/a.bin',
    filename: 'a.bin',
    boardId: 'esp32_esp32_esp32',
    runtimeId: 'general',
    micropythonVersion: '1.27.0',
    runtimeFirmwareVersion: '0.13.0',
    contentHash: null,
    sizeBytes: 1024,
    modifiedAt: '2026-01-01T00:00:00+00:00',
    hasManifest: true,
    embeddedPackages: {},
    notEmbedded: [],
    isLatest: true,
};

describe('FirmwareBuildView compatibility classification', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                return { ok: true, status: 200, json: async () => [] };
            }
            return { ok: true, status: 200, json: async () => BOARD_CATALOG };
        };
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    /**
     * Mount the view against *collection* and let the shell, target and board
     * catalog settle.
     * @param {object} client - Recording fake job client.
     * @param {object} collection - Fake active collection.
     * @param {object} [runtime] - Runtime fixture; defaults to two packages.
     */
    async function mount(client, collection, runtime = createTwoPackageRuntime()) {
        const view = new FirmwareBuildView({
            ...createOptions({
                store: createStore(readySnapshot()),
                runtime,
                client,
            }),
            collectionManager: {
                on: () => () => {},
                getActiveCollection: () => collection,
            },
        });
        view.attachTo(container);
        await tick();
        await tick();
        await tick();
        return view;
    }

    /**
     * Deliver one `firmware.list` result frame.
     * @param {object} client - Recording fake job client.
     * @param {object[]} entries - Inventory entries to deliver.
     */
    function list(client, entries) {
        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: { entries },
        });
    }

    /** Return the rendered inventory row buttons, in payload order. */
    const rows = () => [...container.querySelectorAll('.firmware-inventory__row-button')];


    it('ticks an image that supplies what the collection needs, though more stays ticked', async () => {
        const client = createFakeClient();
        // The collection uses `core` only; the checklist still ticks the installed
        // add-on `pulse`, because add-ons are selected by default.
        const view = await mount(client, createFakeCollection([['core.const']]));

        const addonCheckbox = container.querySelector('input[data-package-id="pulse"]');
        assert.ok(addonCheckbox, 'the add-on row is rendered');
        assert.equal(addonCheckbox.checked, true, 'the add-on is part of the build selection');

        list(client, [
            {
                ...ENTRY,
                path: '/opt/fw/slim.bin',
                filename: 'slim.bin',
                embeddedPackages: { core: '1.0.0' },
            },
        ]);
        await tick();

        assert.ok(
            rows()[0].querySelector('.firmware-inventory__marker--compatible'),
            'an image built from the Minimal selection is compatible with the collection'
        );
        view.detach();
    });

    it('leaves an image without a needed package unticked and names the status', async () => {
        const client = createFakeClient();
        // Now the collection needs the add-on too, so the slim image is short.
        const view = await mount(
            client,
            createFakeCollection([['core.const', 'pulse.pulse-output']])
        );

        list(client, [
            {
                ...ENTRY,
                path: '/opt/fw/without-addon.bin',
                filename: 'without-addon.bin',
                embeddedPackages: { core: '1.0.0' },
            },
        ]);
        await tick();

        const row = rows()[0];
        assert.equal(
            row.querySelector('.firmware-inventory__marker--incomplete'),
            null,
            'the incomplete marker is not rendered'
        );
        assert.equal(
            row.querySelector('.firmware-inventory__marker--compatible'),
            null,
            'nothing is marked compatible'
        );
        assert.ok(
            row.getAttribute('aria-label').includes('firmwareBuild.inventory.incomplete'),
            'the row label still names the status'
        );
        view.detach();
    });

    it('drops the tick when a node needing another package is added to the collection', async () => {
        const client = createFakeClient();
        const graphs = [['core.const']];
        const collection = createFakeCollection(graphs);
        const view = await mount(client, collection);

        list(client, [
            {
                ...ENTRY,
                path: '/opt/fw/slim.bin',
                filename: 'slim.bin',
                embeddedPackages: { core: '1.0.0' },
            },
        ]);
        await tick();
        assert.ok(
            rows()[0].querySelector('.firmware-inventory__marker--compatible'),
            'the slim image covers the collection before the node is added'
        );

        graphs[0].push('pulse.pulse-output');
        collection.emitGraphEvent('node-added');
        await tick();

        assert.equal(
            rows()[0]?.querySelector('.firmware-inventory__marker--compatible') ?? null,
            null,
            'the row is re-judged against the extended collection'
        );
        view.detach();
        assert.equal(collection.listenerCount(), 0, 'the graph subscription is released');
    });

    it('draws no marker when the collection needs no package', async () => {
        const client = createFakeClient();
        const view = await mount(client, createFakeCollection([]));

        list(client, [{ ...ENTRY, embeddedPackages: { core: '1.0.0' } }]);
        await tick();

        const row = rows()[0];
        assert.equal(
            row.querySelectorAll('.firmware-inventory__marker').length,
            0,
            'a collection without packages claims nothing about any image'
        );
        assert.equal(
            row.getAttribute('aria-label').includes('firmwareBuild.inventory.compatible'),
            false,
            'the row label does not claim a status either'
        );
        view.detach();
    });
});
