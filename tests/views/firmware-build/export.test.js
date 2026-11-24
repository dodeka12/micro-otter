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
} from './fixtures.js';

class FakeConfirmPayload extends AppPayload {
    constructor(params) {
        super('ModalDialogView.Confirm.v1');
        Object.assign(this, params);
    }
}

class FakeCancelPayload extends AppPayload {
    constructor(params = {}) {
        super('ModalDialogView.Cancel.v1');
        Object.assign(this, params);
    }
}

function entry(path = '/opt/fw/a.bin') {
    return {
        path,
        filename: 'a.bin',
        boardId: 'esp32',
        runtimeId: 'general',
        micropythonVersion: '1.27.0',
        runtimeFirmwareVersion: '0.13.0',
        contentHash: null,
        sizeBytes: 1024,
        modifiedAt: '2026-01-01T00:00:00+00:00',
        hasManifest: true,
        embeddedPackages: { core: '1.0.0' },
        notEmbedded: [],
        addonPackages: {},
        selection: {},
        channel: '',
        versionSource: null,
        isPrerelease: false,
        isLatest: false,
        isChannelLatest: false,
    };
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

describe('FirmwareBuildView export', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, boards: [] }) });
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    async function mount() {
        const client = createFakeClient();
        const viewManager = createFakeViewManager();
        const store = createStore(pickerSnapshot());
        const view = new FirmwareBuildView(
            createOptions({ store, runtime: createRuntime(), client, viewManager })
        );
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: { entries: [entry()] },
        });
        await tick();
        await tick();
        client.sent.length = 0;
        return { client, viewManager, view };
    }

    function confirmPicker(viewManager, result) {
        viewManager.modals[0].dialog.emit('confirm', new FakeConfirmPayload(result));
    }

    function cancelPicker(viewManager) {
        viewManager.modals[0].dialog.emit('cancel', new FakeCancelPayload());
    }

    it('opens the folder picker and sends firmware.export', async () => {
        const { client, viewManager, view } = await mount();
        void view._exportFirmwarePackage(entry());
        await tick();
        assert.equal(viewManager.modals.length, 1);
        confirmPicker(viewManager, { path: '/tmp/out', kind: 'directory' });
        await tick();
        await tick();

        const frames = client.sent.filter((frame) => frame.type === 'firmware.export');
        assert.equal(frames.length, 1);
        assert.deepEqual(frames[0], {
            type: 'firmware.export',
            firmwarePath: '/opt/fw/a.bin',
            destinationDir: '/tmp/out',
        });
        view.detach();
    });

    it('sends nothing when the folder picker is cancelled', async () => {
        const { client, viewManager, view } = await mount();
        void view._exportFirmwarePackage(entry());
        await tick();
        cancelPicker(viewManager);
        await tick();

        const frames = client.sent.filter((frame) => frame.type === 'firmware.export');
        assert.equal(frames.length, 0);
        view.detach();
    });

    it('re-sends with force after confirming the overwrite', async () => {
        const { client, viewManager, view } = await mount();
        void view._exportFirmwarePackage(entry());
        await tick();
        confirmPicker(viewManager, { path: '/tmp/out', kind: 'directory' });
        await tick();
        await tick();
        client.emitFrame({
            type: 'error',
            job: 'export',
            code: 'firmware-export-exists',
            message: 'already exists',
        });
        await tick();
        await tick();

        const frames = client.sent.filter((frame) => frame.type === 'firmware.export');
        assert.equal(frames.length, 2);
        assert.deepEqual(frames[1], {
            type: 'firmware.export',
            firmwarePath: '/opt/fw/a.bin',
            destinationDir: '/tmp/out',
            force: true,
        });
        view.detach();
    });
});
