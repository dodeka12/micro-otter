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

/**
 * Every job reports in the log **and** the result of the group that owns its
 * controls; no cross-cutting surface carries job text.
 */
describe('FirmwareBuildView group reporting', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                return { ok: true, status: 200, json: async () => [{ device: '/dev/ttyUSB0', label: 'USB0' }] };
            }
            return { ok: true, status: 200, json: async () => BOARD_CATALOG };
        };
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    const buildButton = () =>
        container.querySelector(
            '.firmware-build-view__build-firmware > .view-toolbar .custom-control__button'
        );
    const deployButton = () =>
        container.querySelector('.firmware-build-view__deploy > .view-toolbar .custom-control__button');
    const buildLog = () => container.querySelector('.firmware-build-view__build-log');
    const deployLog = () => container.querySelector('.firmware-build-view__deploy-log');
    const inventoryLog = () => container.querySelector('.firmware-build-view__inventory-log-lines');
    const deleteButton = () =>
        [...container.querySelectorAll('.firmware-build-view__inventory .custom-control__button')].find(
            (button) => button.title.includes('firmwareBuild.inventory.delete')
        );

    async function mount(
        client = createFakeClient(),
        viewManager = createFakeViewManager(),
        snapshot = readySnapshot()
    ) {
        const view = new FirmwareBuildView(
            createOptions({ store: createStore(snapshot), runtime: createRuntime(), client, viewManager })
        );
        view.attachTo(container);
        await tick();
        await tick();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });
        client.sent.length = 0;
        return view;
    }

    it('reports build warnings in the Build log', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        buildButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'succeeded',
            payload: { paths: { firmwarePublishedArtifact: '/x/y.bin' }, warnings: ['pymalloc shrank'] },
        });

        assert.ok(buildLog().textContent.includes('warning: pymalloc shrank'), 'warning is in the log');
        view.detach();
    });

    it('reports build errors in the Build log and opens it', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        buildButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'failed',
            payload: { errors: [{ code: 'internal-error', message: 'x', hint: 'read the log' }] },
        });

        assert.ok(buildLog().textContent.includes('error: firmwareBuild.errors.internal-error'));
        const pane = container.querySelector('.firmware-build-view__build-firmware').closest('.collapsible-view');
        assert.ok(!pane.classList.contains('is-collapsed'), 'Build Firmware expanded');
        view.detach();
    });

    it('clears the previous Build outcome when a new build starts', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        buildButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'failed',
            payload: { errors: [{ code: 'internal-error', message: 'x', hint: null }] },
        });
        assert.ok(buildLog().textContent.includes('firmwareBuild.errors.internal-error'));

        buildButton().click();
        await tick();

        assert.equal(buildLog().textContent.includes('firmwareBuild.errors.internal-error'), false);
        view.detach();
    });

    it('keeps a job failure in its log and out of the tab chrome', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        buildButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'failed',
            payload: { errors: [{ code: 'internal-error', message: 'x', hint: null }] },
        });
        await tick();
        deployButton().click();
        await tick();

        assert.equal(
            container.querySelector('.firmware-build-view__notice'),
            null,
            'the tab has no notice of its own'
        );
        assert.equal(
            container.querySelector('.firmware-build-view__offline').hidden,
            true,
            'a job failure is not a connection outage'
        );
        assert.ok(buildLog().textContent.includes('firmwareBuild.errors.internal-error'));
        view.detach();
    });

    it('lists a missing compile feature in the Build log, not the Deploy log', async () => {
        const snapshot = readySnapshot(['firmware-deploy', 'local-package-scan', 'node-package-addons']);
        snapshot.capabilities.buildBackends = [
            { id: 'esp-idf', available: false, version: null, reason: 'idf.py missing', targets: ['esp32'] },
        ];
        const client = createFakeClient();
        const view = await mount(client, createFakeViewManager(), snapshot);

        const text = buildLog().textContent;
        assert.ok(
            text.includes('warning: firmwareBuild.doctor.backend:backend=esp-idf,reason=idf.py missing'),
            'the Build log names the backend and its reason'
        );
        assert.equal(
            deployLog()?.textContent.includes('firmwareBuild.doctor'),
            false,
            'the diagnostics suite owns the full line set; reporting only checks its home'
        );
        view.detach();
    });

    it('reports a Deploy refusal in the Deploy log', async () => {
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                return { ok: true, status: 200, json: async () => [] };
            }
            return { ok: true, status: 200, json: async () => BOARD_CATALOG };
        };

        const client = createFakeClient();
        const view = await mount(client);

        deployButton().click();
        await tick();

        assert.equal(client.sent.length, 0, 'no deploy request was sent');
        assert.ok(deployLog().textContent.includes('firmwareBuild.deploy.noPort'));
        view.detach();
    });

    it('reports a failed list in the Local firmware log', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'failed',
            payload: { errors: [{ code: 'internal-error', message: 'x', hint: null }] },
        });

        assert.ok(inventoryLog().textContent.includes('firmwareBuild.inventory.refreshFailed'));
        assert.equal(inventoryLog().hidden, false, 'the inventory log is shown');
        view.detach();
    });

    it('names the deleted image in the Local firmware log', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [ENTRY] } });
        container.querySelector('.firmware-inventory__row-button').click();
        deleteButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'delete',
            status: 'succeeded',
            payload: { entries: [] },
        });

        assert.ok(inventoryLog().textContent.includes('/opt/fw/a.bin'));
        view.detach();
    });

    it('reports a failed delete in the Local firmware log', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [ENTRY] } });
        container.querySelector('.firmware-inventory__row-button').click();
        deleteButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'delete',
            status: 'failed',
            payload: { errors: [{ code: 'firmware-not-found', message: 'x', hint: null }] },
        });

        assert.ok(inventoryLog().textContent.includes('firmwareBuild.errors.firmware-not-found'));
        view.detach();
    });
});
