// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    BOARD_CATALOG,
    createFakeClient,
    createFakeViewManager,
    createOptions,
    createRuntime,
    createStore,
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
    embeddedPackages: { core: '1.0.0' },
    notEmbedded: [],
    isLatest: true,
};

describe('FirmwareBuildView delete confirmation', () => {
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

    async function mount(client, viewManager) {
        const view = new FirmwareBuildView(
            createOptions({
                store: createStore(readySnapshot()),
                runtime: createRuntime(),
                client,
                viewManager,
            })
        );
        view.attachTo(container);
        await tick();
        await tick();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [ENTRY] } });
        container.querySelector('.firmware-inventory__row-button').click();
        client.sent.length = 0;
        return view;
    }

    const deleteButton = () =>
        [...container.querySelectorAll('.firmware-build-view__inventory .custom-control__button')].find((b) =>
            b.title.includes('firmwareBuild.inventory.delete')
        );

    it('shows a destructive whole-app confirmation and deletes on confirm', async () => {
        const client = createFakeClient();
        const viewManager = createFakeViewManager();
        const view = await mount(client, viewManager);

        deleteButton().click();
        await tick();

        assert.equal(viewManager.confirmations.length, 1, 'showConfirmation called once');
        assert.equal(viewManager.confirmations[0].destructive, true);
        assert.equal(viewManager.confirmations[0].detail, '/opt/fw/a.bin');
        assert.ok(
            client.sent.some((frame) => frame.type === 'firmware.delete'),
            'delete sent after confirm'
        );
        view.detach();
    });

    it('does not delete when the confirmation is cancelled', async () => {
        const client = createFakeClient();
        const viewManager = createFakeViewManager({ confirmResult: false });
        const view = await mount(client, viewManager);

        deleteButton().click();
        await tick();

        assert.equal(viewManager.confirmations.length, 1);
        assert.equal(
            client.sent.some((frame) => frame.type === 'firmware.delete'),
            false,
            'no delete sent when cancelled'
        );
        view.detach();
    });
});
