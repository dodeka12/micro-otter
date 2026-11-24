// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { AppPayload } from '../../../src/micro_otter/nodes/html/js/core/app-event.js';
import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    createFakeClient,
    createFakeViewManager,
    createOptions,
    createRuntime,
    createStore,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
    importedEntry,
} from './fixtures.js';

class FakeConfirmPayload extends AppPayload {
    constructor(params) {
        super('ModalDialogView.Confirm.v1');
        Object.assign(this, params);
    }
}

function pickerSnapshot() {
    return readySnapshot([
        'firmware-compile',
        'firmware-deploy',
        'local-package-scan',
        'node-package-addons',
        'local-file-access',
    ]);
}

/** A view manager whose `showFormDialog` returns the given results in order. */
function dialogResults(...results) {
    const manager = createFakeViewManager();
    const queue = [...results];
    manager.showFormDialog = async (options) => {
        manager.formDialogs.push(options);
        return queue.length ? queue.shift() : { confirmed: false, formData: {} };
    };
    return manager;
}

describe('FirmwareBuildView import', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ schemaVersion: 1, boards: [] }),
        });
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    async function mount(viewManager = createFakeViewManager()) {
        const client = createFakeClient();
        const store = createStore(pickerSnapshot());
        const view = new FirmwareBuildView(
            createOptions({
                store,
                runtime: createRuntime(),
                client,
                viewManager,
            })
        );
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: { entries: [] },
        });
        await tick();
        await tick();
        client.sent.length = 0;
        return { client, viewManager, view };
    }

    function confirmPicker(viewManager, result) {
        viewManager.modals[0].dialog.emit('confirm', new FakeConfirmPayload(result));
    }

    it('routes a .bin pick to the binary frame after one platform prompt', async () => {
        const viewManager = dialogResults({
            confirmed: true,
            formData: { targetId: 'esp32-test' },
        });
        const { client, view } = await mount(viewManager);

        void view._importFirmwarePackageFromPath();
        await tick();
        confirmPicker(viewManager, { path: '/tmp/esp32.bin' });
        await tick();
        await tick();

        assert.equal(viewManager.formDialogs.length, 1);
        const binaryFrames = client.sent.filter((f) => f.type === 'firmware.import-binary');
        const packageFrames = client.sent.filter((f) => f.type === 'firmware.import');
        assert.equal(binaryFrames.length, 1);
        assert.equal(packageFrames.length, 0);
        assert.deepEqual(binaryFrames[0], {
            type: 'firmware.import-binary',
            path: '/tmp/esp32.bin',
            targetId: 'esp32-test',
        });
        view.detach();
    });

    it('routes a .firmware.zip pick to the package frame with no dialog', async () => {
        const viewManager = createFakeViewManager();
        const { client, view } = await mount(viewManager);

        void view._importFirmwarePackageFromPath();
        await tick();
        confirmPicker(viewManager, { path: '/tmp/pkg.firmware.zip' });
        await tick();
        await tick();

        assert.equal(viewManager.formDialogs.length, 0);
        const binaryFrames = client.sent.filter((f) => f.type === 'firmware.import-binary');
        const packageFrames = client.sent.filter((f) => f.type === 'firmware.import');
        assert.equal(binaryFrames.length, 0);
        assert.equal(packageFrames.length, 1);
        assert.deepEqual(packageFrames[0], { type: 'firmware.import', path: '/tmp/pkg.firmware.zip' });
        view.detach();
    });

    it('routes a .bin URL with a query string to the binary frame', async () => {
        const viewManager = dialogResults(
            { confirmed: true, formData: { url: 'https://host/x.bin?token=1' } },
            { confirmed: true, formData: { targetId: 'esp32-test' } }
        );
        const { client, view } = await mount(viewManager);

        void view._importFirmwarePackageFromUrl();
        await tick();
        await tick();
        await tick();

        const binaryFrames = client.sent.filter((f) => f.type === 'firmware.import-binary');
        assert.equal(binaryFrames.length, 1);
        assert.deepEqual(binaryFrames[0], {
            type: 'firmware.import-binary',
            url: 'https://host/x.bin?token=1',
            targetId: 'esp32-test',
        });
        view.detach();
    });

    it('routes a .uf2 URL to the package frame (the server refuses it)', async () => {
        const viewManager = dialogResults({
            confirmed: true,
            formData: { url: 'https://host/x.uf2' },
        });
        const { client, view } = await mount(viewManager);

        void view._importFirmwarePackageFromUrl();
        await tick();
        await tick();

        assert.equal(viewManager.formDialogs.length, 1);
        const packageFrames = client.sent.filter((f) => f.type === 'firmware.import');
        assert.equal(packageFrames.length, 1);
        assert.deepEqual(packageFrames[0], { type: 'firmware.import', url: 'https://host/x.uf2' });
        view.detach();
    });

    it('sends nothing and leaves the job idle when the platform dialog is cancelled', async () => {
        const viewManager = dialogResults({ confirmed: false, formData: {} });
        const { client, view } = await mount(viewManager);

        void view._importFirmwarePackageFromPath();
        await tick();
        confirmPicker(viewManager, { path: '/tmp/esp32.bin' });
        await tick();
        await tick();

        assert.equal(client.sent.filter((f) => f.type === 'firmware.import-binary').length, 0);
        assert.equal(view._jobState.busy, false);
        view.detach();
    });

    it('re-sends a binary import with force after confirming and never sends kind', async () => {
        const viewManager = dialogResults({
            confirmed: true,
            formData: { targetId: 'esp32-test' },
        });
        const { client, view } = await mount(viewManager);

        void view._importFirmwarePackageFromPath();
        await tick();
        confirmPicker(viewManager, { path: '/tmp/esp32.bin' });
        await tick();
        await tick();

        client.emitFrame({
            type: 'error',
            job: 'import',
            code: 'firmware-import-exists',
            message: 'already exists',
        });
        await tick();
        await tick();

        const binaryFrames = client.sent.filter((f) => f.type === 'firmware.import-binary');
        assert.equal(binaryFrames.length, 2);
        assert.deepEqual(binaryFrames[1], {
            type: 'firmware.import-binary',
            path: '/tmp/esp32.bin',
            targetId: 'esp32-test',
            force: true,
        });
        assert.ok(binaryFrames.every((f) => !('kind' in f)));
        view.detach();
    });

    it('appends the imported hint once for a binary import and never for a package', async () => {
        const viewManager = dialogResults({
            confirmed: true,
            formData: { targetId: 'esp32-test' },
        });
        const { client, view } = await mount(viewManager);

        void view._importFirmwarePackageFromPath();
        await tick();
        confirmPicker(viewManager, { path: '/tmp/esp32.bin' });
        await tick();
        await tick();

        client.emitFrame({
            type: 'result',
            job: 'import',
            status: 'succeeded',
            payload: {
                entries: [importedEntry()],
                imported: {
                    status: 'installed',
                    filename: importedEntry().filename,
                    source: 'imported-binary',
                    targetId: 'esp32-test',
                },
            },
        });
        await tick();
        await tick();

        const lines = view._buildGroupLogLines('inventory', view._inventoryLogLines);
        const hintLines = lines.filter((l) => l.text.includes('firmwareBuild.inventory.importedHint'));
        assert.equal(hintLines.length, 1);
        view.detach();
    });

    it('appends no imported hint for a package import', async () => {
        const viewManager = createFakeViewManager();
        const { client, view } = await mount(viewManager);

        void view._importFirmwarePackageFromPath();
        await tick();
        confirmPicker(viewManager, { path: '/tmp/pkg.firmware.zip' });
        await tick();
        await tick();

        client.emitFrame({
            type: 'result',
            job: 'import',
            status: 'succeeded',
            payload: {
                entries: [],
                imported: { status: 'installed', filename: 'pkg.bin' },
            },
        });
        await tick();
        await tick();

        const lines = view._buildGroupLogLines('inventory', view._inventoryLogLines);
        const hintLines = lines.filter((l) => l.text.includes('firmwareBuild.inventory.importedHint'));
        assert.equal(hintLines.length, 0);
        view.detach();
    });
});

