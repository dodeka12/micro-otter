// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    createFakeClient,
    createOptions,
    createRuntime,
    createStore,
    portFetch,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

describe('FirmwareBuildView split logs', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = portFetch([{ device: '/dev/ttyUSB0', label: 'USB0' }]);
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    const buildButton = () => container.querySelector('.firmware-build-view__build-firmware > .view-toolbar .custom-control__button');
    const deployButton = () => container.querySelector('.firmware-build-view__deploy > .view-toolbar .custom-control__button');

    /** Pick the discovered deploy port the way a user does. */
    function selectPort(port = '/dev/ttyUSB0') {
        document.body
            .querySelector(
                `.firmware-build-view__dropdown-menu--port .dropdown-control__option[data-value="${port}"]`
            )
            .click();
    }

    async function mount(client = createFakeClient(), store = createStore(readySnapshot())) {
        const view = new FirmwareBuildView(createOptions({ store, runtime: createRuntime(), client }));
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });
        client.sent.length = 0;
        return view;
    }

    it('keeps the build log when a deploy runs and vice versa', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        buildButton().click();
        await tick();
        client.emitFrame({ type: 'output', job: 'compile', stream: 'stdout', text: 'build line\n' });
        client.emitFrame({ type: 'result', job: 'compile', status: 'succeeded', payload: {} });

        const buildLog = container.querySelector('.firmware-build-view__build-log');
        assert.equal(buildLog.hidden, false);
        assert.ok(buildLog.textContent.includes('build line'));

        selectPort();
        deployButton().click();
        await tick();
        client.emitFrame({ type: 'output', job: 'deploy', stream: 'stdout', text: 'deploy line\n' });
        client.emitFrame({ type: 'result', job: 'deploy', status: 'succeeded', payload: {} });

        const deployLog = container.querySelector('.firmware-build-view__deploy-log');
        assert.equal(deployLog.hidden, false);
        assert.ok(deployLog.textContent.includes('deploy line'));
        assert.ok(buildLog.textContent.includes('build line'), 'build log survives a deploy');
        view.detach();
    });

    it('expands Build Firmware and the Build log on a compile failure and leaves Deploy collapsed', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        const build = container.querySelector('.firmware-build-view__build-firmware').closest('.collapsible-view');
        const logSub = [...container.querySelectorAll('.firmware-build-view__build-firmware .collapsible-view')]
            .find((c) => c.querySelector('.collapsible-view__title').textContent === 'firmwareBuild.buildFirmware.buildLog');
        const deploy = container.querySelector('.firmware-build-view__deploy').closest('.collapsible-view');
        build.querySelector('.collapsible-view__toggle').click();
        deploy.querySelector('.collapsible-view__toggle').click();
        assert.ok(build.classList.contains('is-collapsed'));
        assert.ok(logSub.classList.contains('is-collapsed'), 'build log sub starts collapsed');

        buildButton().click();
        await tick();
        client.emitFrame({ type: 'output', job: 'compile', stream: 'stdout', text: 'boom\n' });
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'failed',
            payload: { errors: [{ code: 'internal-error', message: 'x', hint: null }] },
        });

        assert.ok(!build.classList.contains('is-collapsed'), 'Build Firmware section expanded on failure');
        assert.ok(!logSub.classList.contains('is-collapsed'), 'build log sub-section expanded on failure');
        assert.ok(deploy.classList.contains('is-collapsed'), 'deploy section stays collapsed');
        const deployLogSub = [...container.querySelectorAll('.firmware-build-view__deploy .collapsible-view')]
            .find((c) => c.querySelector('.collapsible-view__title').textContent === 'firmwareBuild.deploy.log');
        assert.ok(deployLogSub.classList.contains('is-collapsed'), 'deploy log stays collapsed');
        view.detach();
    });

    it('expands the Deploy section on a deploy failure and leaves the Build log collapsed', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        const build = container.querySelector('.firmware-build-view__build-firmware').closest('.collapsible-view');
        const logSub = [...container.querySelectorAll('.firmware-build-view__build-firmware .collapsible-view')]
            .find((c) => c.querySelector('.collapsible-view__title').textContent === 'firmwareBuild.buildFirmware.buildLog');
        const deploy = container.querySelector('.firmware-build-view__deploy').closest('.collapsible-view');
        build.querySelector('.collapsible-view__toggle').click();
        deploy.querySelector('.collapsible-view__toggle').click();
        assert.ok(deploy.classList.contains('is-collapsed'));

        selectPort();
        deployButton().click();
        await tick();
        client.emitFrame({ type: 'output', job: 'deploy', stream: 'stderr', text: 'flash fail\n' });
        client.emitFrame({
            type: 'result',
            job: 'deploy',
            status: 'failed',
            payload: { errors: [{ code: 'flash-command', message: 'x', hint: null }] },
        });

        assert.ok(logSub.classList.contains('is-collapsed'), 'build log stays collapsed');
        assert.ok(!deploy.classList.contains('is-collapsed'), 'deploy section expanded on failure');
        const deployLogSub = [...container.querySelectorAll('.firmware-build-view__deploy .collapsible-view')]
            .find((c) => c.querySelector('.collapsible-view__title').textContent === 'firmwareBuild.deploy.log');
        assert.ok(deployLogSub, 'the Deploy log is a nested sub-section');
        assert.ok(!deployLogSub.classList.contains('is-collapsed'), 'deploy log sub-section expanded');
        view.detach();
    });

    it('keeps the newest deploy output in view while the log grows', async () => {
        // jsdom has no layout, so the reported geometry has to come from the
        // rendered text: four pixels per character in a 200 px viewport.
        Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get() {
                return (this.textContent?.length ?? 0) * 4;
            },
        });
        Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get: () => 200,
        });

        const client = createFakeClient();
        const view = await mount(client);

        selectPort();
        deployButton().click();
        await tick();
        for (const line of [
            'Flash will be erased from 0x00000000 to 0x001ebfff...\n',
            'Writing at 0x00000000 [>          ]  50.0% 1000000/2000000 bytes... \n',
        ]) {
            client.emitFrame({ type: 'output', job: 'deploy', stream: 'stdout', text: line });
        }

        const scroller = container.querySelector(
            '.firmware-build-view__deploy-log .view-code__scroll-wrapper'
        );
        assert.ok(scroller, 'the deploy log renders a scroll wrapper');
        assert.ok(
            scroller.textContent.includes('Writing at 0x00000000'),
            'the log holds the streamed lines'
        );
        assert.equal(
            scroller.scrollTop,
            scroller.scrollHeight,
            'the tail of the log stays in view instead of jumping back to its first line'
        );
        client.emitFrame({ type: 'result', job: 'deploy', status: 'succeeded', payload: {} });
        view.detach();
    });

    it('advances a redrawn progress line instead of printing one line per update', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        selectPort();
        deployButton().click();
        await tick();
        for (let percent = 0; percent <= 100; percent += 10) {
            client.emitFrame({
                type: 'output',
                job: 'deploy',
                stream: 'stdout',
                text: `\rWriting at 0x00100000 [==>       ] ${percent.toFixed(1)}% 1000/20000 bytes... \n`,
            });
        }

        const scroller = container.querySelector(
            '.firmware-build-view__deploy-log .view-code__scroll-wrapper'
        );
        assert.ok(scroller, 'the deploy log renders a scroll wrapper');
        const rendered = scroller.textContent;
        assert.equal(
            (rendered.match(/Writing at 0x00100000/g) ?? []).length,
            1,
            'the bar is one line, not one line per update'
        );
        assert.ok(rendered.includes('100.0%'), 'that line shows the newest update');
        assert.ok(!rendered.includes('\r'), 'the redraw marker never reaches the rendered text');
        client.emitFrame({ type: 'result', job: 'deploy', status: 'succeeded', payload: {} });
        view.detach();
    });

    it('does not clear the build log for list/delete/scan jobs', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        buildButton().click();
        await tick();
        client.emitFrame({ type: 'output', job: 'compile', stream: 'stdout', text: 'kept\n' });
        client.emitFrame({ type: 'result', job: 'compile', status: 'succeeded', payload: {} });

        const refresh = [...container.querySelectorAll('.firmware-build-view__inventory .custom-control__button')]
            .find((b) => b.title.includes('firmwareBuild.inventory.refresh'));
        refresh.click();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });

        const buildLog = container.querySelector('.firmware-build-view__build-log');
        assert.ok(buildLog.textContent.includes('kept'), 'build log survives a list job');
        view.detach();
    });
});
