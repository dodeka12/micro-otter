// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * The single add-ons view suite: selection, visibility, the Install/Remove actions,
 * both confirmation flows, and the reporting of an add-on job. Install now flows
 * through the server-side picker or the *from URL…* dialog, so no file bytes are
 * read in the browser.
 */

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
    unavailableSnapshot,
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

/** A runtime with one built-in package and one installed add-on. */
function addonsRuntime() {
    return createRuntime({
        nodePackages: [
            { id: 'core', name: 'Core', version: '1.0.0', requiredCapabilities: null },
            { id: 'sample_addon', name: 'Addon', version: '1.0.0', requiredCapabilities: null },
        ],
        nodePackagesGlobal: ['core'],
        nodePackagesLocal: [],
        nodePackagesAddons: ['sample_addon'],
        nodePackagesOptional: [],
        isOptionalPackage: () => false,
        packageProvenance: (id) => (id === 'sample_addon' ? 'addon' : 'builtin'),
    });
}

/** A ready snapshot that also advertises `local-file-access`, for picker flows. */
function pickerSnapshot() {
    return readySnapshot([
        'firmware-compile',
        'firmware-deploy',
        'local-package-scan',
        'node-package-addons',
        'local-file-access',
    ]);
}

describe('FirmwareBuildView installed add-ons', () => {
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

    const addonsSub = () => container.querySelector('.firmware-build-view__addons-sub');
    const buildLog = () => container.querySelector('.firmware-build-view__build-log');
    const addonsButtons = () => [
        ...container.querySelectorAll('.firmware-build-view__addons .custom-control__button'),
    ];
    const addonsButton = (label) => addonsButtons().find((button) => button.title === label);

    function confirmPicker(viewManager, result) {
        const modal = viewManager.modals[0];
        modal.dialog.emit('confirm', new FakeConfirmPayload(result));
    }

    function cancelPicker(viewManager) {
        const modal = viewManager.modals[0];
        modal.dialog.emit('cancel', new FakeCancelPayload());
    }

    async function mount({
        runtime = addonsRuntime(),
        client = createFakeClient(),
        viewManager = createFakeViewManager(),
        store = createStore(pickerSnapshot()),
        collectionManager,
        loadCounter,
    } = {}) {
        const options = createOptions({ store, runtime, client, viewManager });
        if (collectionManager) {
            options.collectionManager = collectionManager;
        }
        if (loadCounter) {
            options.runtimeCollection = {
                getRuntime: () => runtime,
                async load() {
                    loadCounter.count += 1;
                },
            };
        }
        const view = new FirmwareBuildView(options);
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: { entries: [] },
        });
        client.sent.length = 0;
        return view;
    }

    const installFrames = (client) =>
        client.sent.filter((frame) => frame.type === 'addon.install');


    it('lists installed add-ons in their own table', async () => {
        const view = await mount();
        const addonTable = container.querySelector('.firmware-build-view__addons-list');
        assert.ok(addonTable.textContent.includes('sample_addon'));
        view.detach();
    });

    it('renders Install, Install-from-URL, and Remove buttons, icon-only', async () => {
        const view = await mount();
        const titles = addonsButtons().map((button) => button.title);
        assert.deepEqual(titles, [
            'firmwareBuild.addons.selectAll',
            'firmwareBuild.addons.clear',
            'firmwareBuild.addons.refresh',
            'firmwareBuild.addons.install',
            'firmwareBuild.addons.installFromUrl',
            'firmwareBuild.addons.remove',
        ]);
        view.detach();
    });

    it('installs a picked path through the server-side picker', async () => {
        const client = createFakeClient();
        const viewManager = createFakeViewManager();
        const view = await mount({ client, viewManager });

        addonsButton('firmwareBuild.addons.install').click();
        await tick();
        assert.equal(viewManager.modals.length, 1, 'the path Install opens the picker');
        confirmPicker(viewManager, { path: '/tmp/my-nodes.zip', kind: 'file' });
        await tick();
        await tick();

        const frames = installFrames(client);
        assert.equal(frames.length, 1);
        assert.deepEqual(frames[0], { type: 'addon.install', path: '/tmp/my-nodes.zip' });
        view.detach();
    });

    it('installs from a URL through the form dialog', async () => {
        const client = createFakeClient();
        const viewManager = createFakeViewManager({
            formDialogResult: { confirmed: true, formData: { url: 'https://x/my-nodes.zip' } },
        });
        const view = await mount({ client, viewManager });

        addonsButton('firmwareBuild.addons.installFromUrl').click();
        await tick();
        await tick();

        const frames = installFrames(client);
        assert.equal(frames.length, 1);
        assert.deepEqual(frames[0], { type: 'addon.install', url: 'https://x/my-nodes.zip' });
        view.detach();
    });

    it('sends nothing when the picker is cancelled', async () => {
        const client = createFakeClient();
        const viewManager = createFakeViewManager();
        const view = await mount({ client, viewManager });

        addonsButton('firmwareBuild.addons.install').click();
        await tick();
        cancelPicker(viewManager);
        await tick();

        assert.equal(installFrames(client).length, 0);
        view.detach();
    });

    it('re-sends with force when the replace is confirmed', async () => {
        const client = createFakeClient();
        const viewManager = createFakeViewManager({ confirmResult: true });
        const view = await mount({ client, viewManager });

        addonsButton('firmwareBuild.addons.install').click();
        await tick();
        confirmPicker(viewManager, { path: '/tmp/my-nodes.zip', kind: 'file' });
        await tick();
        await tick();
        client.emitFrame({
            type: 'error',
            job: 'addon-install',
            code: 'addon-already-installed',
            message: 'already installed',
        });
        await tick();
        await tick();

        const frames = installFrames(client);
        assert.equal(frames.length, 2);
        assert.deepEqual(frames[1], {
            type: 'addon.install',
            path: '/tmp/my-nodes.zip',
            force: true,
        });
        view.detach();
    });

    it('reports a failed add-on job without refreshing', async () => {
        const client = createFakeClient();
        const store = createStore(pickerSnapshot());
        const loadCounter = { count: 0 };
        const viewManager = createFakeViewManager();
        const view = await mount({ client, store, viewManager, loadCounter });
        const refreshBase = store.refreshCalls;
        const loadBase = loadCounter.count;

        addonsButton('firmwareBuild.addons.install').click();
        await tick();
        confirmPicker(viewManager, { path: '/tmp/my-nodes.zip', kind: 'file' });
        await tick();
        await tick();
        client.emitFrame({
            type: 'error',
            job: 'addon-install',
            code: 'addon-archive-invalid',
            message: 'not a zip',
        });
        await tick();
        await tick();

        assert.ok(
            buildLog().textContent.includes('error: firmwareBuild.errors.addon-archive-invalid')
        );
        assert.equal(store.refreshCalls, refreshBase);
        assert.equal(loadCounter.count, loadBase);
        view.detach();
    });

    it('keeps the sub-section visible on a ready snapshot without node-package-addons', async () => {
        const view = await mount({
            store: createStore(
                readySnapshot(['firmware-compile', 'local-package-scan', 'local-file-access'])
            ),
        });
        assert.equal(addonsSub().hidden, false);
        assert.equal(addonsButton('firmwareBuild.addons.installFromUrl').disabled, false);
        view.detach();
    });

    it('shows the offline explainer instead of the content when unavailable', async () => {
        const offline = () => container.querySelector('.firmware-build-view__offline');
        const content = () => container.querySelector('.firmware-build-view__content');

        const unavailable = await mount({ store: createStore(unavailableSnapshot('offline')) });
        assert.equal(content().hidden, true);
        assert.equal(offline().hidden, false);
        unavailable.detach();
    });
});

