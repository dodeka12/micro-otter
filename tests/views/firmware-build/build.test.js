// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import { IconProvider } from '../../../src/micro_otter/nodes/html/js/views/icon-provider.js';
import {
    createFakeClient,
    createOptions,
    createRuntime,
    createStore,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

describe('FirmwareBuildView build flow', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, boards: [] }) });
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    const buildButton = () => container.querySelector('.firmware-build-view__build-firmware > .view-toolbar .custom-control__button');
    /** Icon-only controls carry their label as tooltip and accessible name. */
    const buildLabel = () => buildButton().title;
    const buildIcon = () =>
        buildButton().querySelector('.custom-control__button-icon')?.getAttribute('src');

    async function mount(client, store, runtime = createRuntime()) {
        const view = new FirmwareBuildView(createOptions({ store, runtime, client }));
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });
        client.sent.length = 0;
        return view;
    }

    it('sends exactly one compile.start with targetId and no board', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);
        client.sent.length = 0;

        buildButton().click();
        await tick();

        assert.equal(client.sent.length, 1);
        assert.deepEqual(client.sent[0], {
            type: 'compile.start',
            runtimeId: 'general',
            targetId: 'esp32-test',
            packageIds: ['core'],
            modulePackagingMode: 'compiled-mpy',
            cleanBuild: false,
        });
        assert.equal('board' in client.sent[0], false);
        view.detach();
    });

    it('relabels Build to Cancel while running and cancels exactly once', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        buildButton().click();
        await tick();
        assert.equal(buildLabel(), 'firmwareBuild.build.cancel');

        buildButton().click();
        await tick();
        const cancels = client.sent.filter((frame) => frame.type === 'cancel');
        assert.equal(cancels.length, 1);
        assert.equal(buildLabel(), 'firmwareBuild.build.cancelling');
        view.detach();
    });

    it('renders the build glyph icon-only with the label as accessible name', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        assert.equal(buildIcon(), IconProvider.get('deployedCode'));
        assert.equal(buildLabel(), 'firmwareBuild.build.start');

        const button = buildButton();
        assert.equal(button.querySelector('.custom-control__button-label'), null);
        assert.ok(button.classList.contains('custom-control__button--icon-only'));
        assert.ok(
            button.classList.contains('custom-control__button--secondary'),
            'the pane button uses the same variant as the panel toolbars'
        );
        assert.equal(button.getAttribute('aria-label'), 'firmwareBuild.build.start');
        view.detach();
    });

    it('leads the Build Firmware pane with a toolbar holding the button before the checkbox', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        const section = container.querySelector('.firmware-build-view__build-firmware');
        const toolbar = section.firstElementChild;
        assert.ok(toolbar?.classList.contains('view-toolbar'), 'the pane leads with a ToolbarView');
        assert.equal(
            toolbar.closest('.collapsible-view__header-actions'),
            null,
            'the row is pane content, not a header action'
        );

        const button = toolbar.querySelector('.custom-control__button');
        const checkbox = toolbar.querySelector('.custom-control--checkbox');
        assert.ok(button && checkbox);
        assert.ok(
            button.compareDocumentPosition(checkbox) & window.Node.DOCUMENT_POSITION_FOLLOWING,
            'the build button precedes the clean-build checkbox'
        );

        const panelButton = container.querySelector(
            '.firmware-build-view__packages .custom-control__button'
        );
        assert.deepEqual(
            [...button.classList].sort(),
            [...panelButton.classList].sort(),
            'the pane button is class-for-class the panel toolbar button'
        );
        view.detach();
    });

    it('swaps the glyph to close while running and keeps it while cancelling', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        buildButton().click();
        await tick();
        assert.equal(buildIcon(), IconProvider.get('close'));
        assert.equal(buildLabel(), 'firmwareBuild.build.cancel');

        buildButton().click();
        await tick();
        assert.equal(buildIcon(), IconProvider.get('close'));
        assert.equal(buildLabel(), 'firmwareBuild.build.cancelling');
        view.detach();
    });

    it('restores the build glyph after a successful compile', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        buildButton().click();
        await tick();
        client.emitFrame({ type: 'result', job: 'compile', status: 'succeeded', payload: {} });

        assert.equal(buildIcon(), IconProvider.get('deployedCode'));
        assert.equal(buildLabel(), 'firmwareBuild.build.start');
        view.detach();
    });

    it('restores the build glyph after a failed compile', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        buildButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'failed',
            payload: { error: { code: 'compile-failed', message: 'boom' } },
        });

        assert.equal(buildIcon(), IconProvider.get('deployedCode'));
        assert.equal(buildLabel(), 'firmwareBuild.build.start');
        view.detach();
    });

    it('maps the clean-build checkbox to the request', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        const clean = container.querySelector('.firmware-build-view__build-firmware > .view-toolbar .custom-control__checkbox');
        clean.checked = true;
        clean.dispatchEvent(new window.Event('change', { bubbles: true }));
        client.sent.length = 0;

        buildButton().click();
        await tick();
        assert.equal(client.sent[0].cleanBuild, true);
        view.detach();
    });

    it('refreshes stale capabilities once before sending', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot(), { stale: true });
        const view = await mount(client, store);
        const before = store.refreshCalls;
        client.sent.length = 0;

        buildButton().click();
        await tick();
        assert.equal(store.refreshCalls, before + 1);
        assert.equal(client.sent.length, 1);
        view.detach();
    });

    it('sends nothing when the stale refresh fails', async () => {
        const client = createFakeClient();
        const unavailable = { state: 'unavailable', capabilities: null, reason: 'unreachable', detail: null };
        const store = createStore(readySnapshot(), { stale: true, refreshResult: unavailable });
        const view = await mount(client, store);
        client.sent.length = 0;

        buildButton().click();
        await tick();
        assert.equal(client.sent.length, 0);
        view.detach();
    });

    it('disables Build but not Deploy or Refresh when compile is unavailable', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot(['firmware-deploy', 'local-package-scan', 'node-package-addons']));
        const view = await mount(client, store);

        assert.equal(buildButton().disabled, true);
        assert.equal(container.querySelector('.firmware-build-view__deploy > .view-toolbar .custom-control__button').disabled, false);
        assert.equal(
            [...container.querySelectorAll('.firmware-build-view__packages .custom-control__button')]
                .find((b) => b.title.includes('firmwareBuild.packages.refresh')).disabled,
            false
        );
        view.detach();
    });
});
