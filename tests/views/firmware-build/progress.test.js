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

describe('FirmwareBuildView progress readouts', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = portFetch([{ device: '/dev/ttyUSB0', label: 'USB0' }]);
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    const buildButton = () =>
        container.querySelector('.firmware-build-view__build-firmware > .view-toolbar .custom-control__button');
    const deployButton = () =>
        container.querySelector('.firmware-build-view__deploy > .view-toolbar .custom-control__button');
    /** Pick the discovered deploy port the way a user does. */
    const selectPort = (port = '/dev/ttyUSB0') =>
        document.body
            .querySelector(
                `.firmware-build-view__dropdown-menu--port .dropdown-control__option[data-value="${port}"]`
            )
            .click();
    const buildReadout = () =>
        container.querySelector('.firmware-build-view__build-progress .progress-bar-view');
    const deployReadout = () =>
        container.querySelector('.firmware-build-view__deploy-progress .progress-bar-view');
    const buildGroup = () =>
        container.querySelector('.firmware-build-view__build-firmware').closest('.collapsible-view');
    const deployGroup = () =>
        container.querySelector('.firmware-build-view__deploy').closest('.collapsible-view');
    const part = (root, className) => root.querySelector(`.progress-bar-view__${className}`);

    async function mount(client = createFakeClient(), store = createStore(readySnapshot())) {
        const view = new FirmwareBuildView(createOptions({ store, runtime: createRuntime(), client }));
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });
        client.sent.length = 0;
        return view;
    }

    async function startBuild() {
        buildButton().click();
        await tick();
        await tick();
    }

    async function startDeploy() {
        selectPort();
        deployButton().click();
        await tick();
        await tick();
    }

    it('shows only the build readout while a compile runs', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        assert.equal(buildReadout().hidden, true, 'hidden before the build starts');
        assert.equal(deployReadout().hidden, true);

        await startBuild();

        assert.equal(buildReadout().hidden, false, 'build readout visible while compiling');
        assert.equal(deployReadout().hidden, true, 'deploy readout stays hidden');
        assert.equal(part(buildReadout(), 'label').textContent, 'firmwareBuild.progress.building');
        assert.equal(
            part(buildReadout(), 'bar'),
            null,
            'the readout draws no bar: the WS protocol carries no percentage'
        );
        assert.equal(part(buildReadout(), 'elapsed').hidden, false, 'the elapsed line is the progress cue');
        view.detach();
    });

    it('shows only the deploy readout while a deploy runs, without a Cancel button', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        await startDeploy();

        assert.equal(deployReadout().hidden, false, 'deploy readout visible while flashing');
        assert.equal(buildReadout().hidden, true, 'build readout stays hidden');
        assert.equal(part(deployReadout(), 'label').textContent, 'firmwareBuild.progress.deploying');
        assert.equal(
            part(deployReadout(), 'cancel').hidden,
            true,
            'a deploy cannot be cancelled: the server runs the flash to completion'
        );
        view.detach();
    });

    it('renders a reported stage, and then the message, as the status line', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        await startBuild();
        client.emitFrame({ type: 'status', state: 'running', stage: 'precompile' });
        assert.equal(part(buildReadout(), 'status').textContent, 'precompile');

        client.emitFrame({ type: 'status', state: 'running', message: 'Compiling application' });
        assert.equal(
            part(buildReadout(), 'status').textContent,
            'Compiling application',
            'the message wins over the stage'
        );
        view.detach();
    });

    it('shows the deploy stage line beside the elapsed cue, exactly like a build', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        await startDeploy();
        client.emitFrame({ type: 'status', job: 'deploy', state: 'running', stage: 'write-start' });

        assert.equal(
            part(deployReadout(), 'status').textContent,
            'write-start',
            'the stage names the step; the tool output itself belongs in the log'
        );
        assert.equal(
            part(deployReadout(), 'elapsed').hidden,
            false,
            'the elapsed line is the liveness cue for a deploy too'
        );
        assert.equal(
            part(deployReadout(), 'bar'),
            null,
            'the readout stays text-only: no determinate bar is drawn'
        );
        view.detach();
    });

    it('cancels from the readout and keeps it visible until the terminal frame', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        await startBuild();

        const cancel = part(buildReadout(), 'cancel').querySelector('.custom-control__button');
        assert.ok(cancel, 'cancel button rendered for a compile');
        assert.equal(cancel.disabled, false);
        cancel.click();

        assert.ok(client.sent.some((frame) => frame.type === 'cancel'), 'cancel sent to the client');
        assert.equal(
            part(buildReadout(), 'cancel').querySelector('.custom-control__button').textContent,
            'firmwareBuild.build.cancelling',
            'the cancel button reports the pending cancellation'
        );
        assert.equal(
            part(buildReadout(), 'cancel').querySelector('.custom-control__button').disabled,
            true,
            'the cancel button cannot be pressed twice'
        );
        assert.equal(buildReadout().hidden, false, 'the readout stays until the job answers');

        client.emitFrame({ type: 'result', job: 'compile', status: 'cancelled', payload: {} });
        assert.equal(buildReadout().hidden, true, 'hidden on the terminal frame');
        view.detach();
    });

    it('hides both readouts when the job answers', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        await startBuild();
        assert.equal(buildReadout().hidden, false);

        client.emitFrame({ type: 'result', job: 'compile', status: 'succeeded', payload: {} });

        assert.equal(buildReadout().hidden, true);
        assert.equal(deployReadout().hidden, true);
        view.detach();
    });

    it('shows no progress readout for a list refresh and keeps the inventory bar', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        const refresh = [...container.querySelectorAll('.firmware-build-view__inventory .custom-control__button')]
            .find((b) => b.title.includes('firmwareBuild.inventory.refresh'));
        refresh.click();
        await tick();

        assert.equal(buildReadout().hidden, true, 'no build readout for the list job');
        assert.equal(deployReadout().hidden, true, 'no deploy readout for the list job');
        assert.equal(
            container.querySelector('.firmware-inventory__progress').hidden,
            false,
            'in-section inventory progress bar visible while listing'
        );

        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });
        assert.equal(container.querySelector('.firmware-inventory__progress').hidden, true);
        view.detach();
    });

    it('expands the owning group when its job starts', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        buildGroup().querySelector('.collapsible-view__toggle').click();
        deployGroup().querySelector('.collapsible-view__toggle').click();
        assert.equal(buildGroup().classList.contains('is-collapsed'), true, 'group collapsed by hand');
        assert.equal(deployGroup().classList.contains('is-collapsed'), true, 'group collapsed by hand');

        await startBuild();

        assert.equal(
            buildGroup().classList.contains('is-collapsed'),
            false,
            'the group expands so the readout is visible'
        );
        assert.equal(buildReadout().hidden, false);
        view.detach();
    });

    it('expands the deploy group when a deploy starts', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        deployGroup().querySelector('.collapsible-view__toggle').click();
        assert.equal(deployGroup().classList.contains('is-collapsed'), true, 'group collapsed by hand');

        await startDeploy();

        assert.equal(
            deployGroup().classList.contains('is-collapsed'),
            false,
            'the deploy group expands so the readout is visible'
        );
        assert.equal(deployReadout().hidden, false);
        view.detach();
    });
});
