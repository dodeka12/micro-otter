// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
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

function packagesRuntime() {
    return createRuntime({
        nodePackages: [
            { id: 'core', name: 'Core', version: '1.0.0', requiredCapabilities: null },
            { id: 'sample_addon', name: 'Addon', version: '1.0.0', requiredCapabilities: null },
            { id: 'opt_pkg', name: 'Optional', version: '1.0.0', requiredCapabilities: null },
            { id: 'local_pkg', name: 'Local', version: '1.0.0', requiredCapabilities: null },
            { id: 'heavy_pkg', name: 'Heavy', version: '1.0.0', requiredCapabilities: ['uart'] },
        ],
        nodePackagesGlobal: ['core', 'opt_pkg', 'heavy_pkg'],
        nodePackagesLocal: ['local_pkg'],
        nodePackagesAddons: ['sample_addon'],
        nodePackagesOptional: ['opt_pkg'],
        isOptionalPackage: (id) => id === 'opt_pkg',
        packageProvenance: (id) => (id === 'sample_addon' ? 'addon' : 'builtin'),
    });
}

function builtinsOnlyRuntime() {
    return createRuntime({
        nodePackages: [
            { id: 'core', name: 'Core', version: '1.0.0', requiredCapabilities: null },
            { id: 'opt_pkg', name: 'Optional', version: '1.0.0', requiredCapabilities: null },
        ],
        nodePackagesGlobal: ['core', 'opt_pkg'],
        nodePackagesLocal: [],
        nodePackagesAddons: [],
        nodePackagesOptional: ['opt_pkg'],
        isOptionalPackage: (id) => id === 'opt_pkg',
        packageProvenance: () => 'builtin',
    });
}

describe('FirmwareBuildView packages', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, boards: [] }) });
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    const checkboxFor = (id) => container.querySelector(`input[data-package-id="${id}"]`);

    function buttonByText(text) {
        return [...container.querySelectorAll('.firmware-build-view__packages .custom-control__button')]
            .find((b) => b.title.includes(text));
    }

    async function mount(client = createFakeClient(), store = createStore(readySnapshot()), runtime = packagesRuntime()) {
        const view = new FirmwareBuildView(createOptions({ store, runtime, client }));
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });
        client.sent.length = 0;
        return view;
    }

    it('defaults to selectable, capable, non-optional packages', async () => {
        const view = await mount();
        assert.equal(checkboxFor('core').checked, true);
        assert.equal(checkboxFor('sample_addon').checked, true);
        assert.equal(checkboxFor('opt_pkg').checked, false);
        assert.equal(checkboxFor('local_pkg').checked, false);
        assert.equal(checkboxFor('heavy_pkg').checked, false);
        view.detach();
    });

    it('disables local and incapable packages with a note', async () => {
        const view = await mount();
        const local = checkboxFor('local_pkg');
        const heavy = checkboxFor('heavy_pkg');
        assert.equal(local.disabled, true);
        assert.ok(local.title.includes('firmwareBuild.packages.localNotStaged'));
        assert.equal(heavy.disabled, true);
        assert.ok(heavy.title.includes('firmwareBuild.packages.missingCapabilities'));
        view.detach();
    });

    it('badges the add-on package and updates the count', async () => {
        const view = await mount();
        const addonRow = checkboxFor('sample_addon').closest('tr');
        assert.ok(addonRow.textContent.includes('firmwareBuild.packages.addon'));
        const count = container.querySelector('.firmware-build-view__package-count');
        assert.ok(count.textContent.includes('selected=1,total=2'));
        const addonsCount = container.querySelector('.firmware-build-view__addons-count');
        assert.ok(addonsCount.textContent.includes('selected=1,total=1'));
        view.detach();
    });

    it('keeps the add-on section visible on a ready snapshot without node-package-addons', async () => {
        const view = await mount(
            createFakeClient(),
            createStore(readySnapshot(['firmware-compile', 'local-package-scan']))
        );
        // The section must stay reachable: the server advertises `node-package-addons`
        // only *while* an add-on is installed, so gating the section on it would make
        // the first install impossible. Only the tickable rows stay gated.
        assert.equal(container.querySelector('.firmware-build-view__addons-sub').hidden, false);
        assert.equal(checkboxFor('sample_addon'), null);
        assert.equal(checkboxFor('core').checked, true);
        view.detach();
    });

    it('select all and clear affect built-in packages only', async () => {
        const view = await mount();
        buttonByText('firmwareBuild.packages.selectAll').click();
        assert.equal(checkboxFor('opt_pkg').checked, true);
        assert.equal(checkboxFor('heavy_pkg').checked, false);

        buttonByText('firmwareBuild.packages.clear').click();
        assert.equal(checkboxFor('core').checked, false);
        assert.equal(checkboxFor('opt_pkg').checked, false);
        assert.equal(checkboxFor('sample_addon').checked, true);
        view.detach();
    });

    it('toggles a single package and refreshes the count without re-rendering others', async () => {
        const view = await mount();
        const opt = checkboxFor('opt_pkg');
        opt.checked = true;
        opt.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(checkboxFor('opt_pkg').checked, true);
        const count = container.querySelector('.firmware-build-view__package-count');
        assert.ok(count.textContent.includes('selected=2,total=2'));
        view.detach();
    });

    it('renders the empty key when there are no packages', async () => {
        const runtime = createRuntime({ nodePackages: [] });
        const view = await mount(createFakeClient(), createStore(readySnapshot()), runtime);
        const table = container.querySelector('.firmware-build-view__packages-list .data-table-view');
        assert.ok(table.textContent.includes('firmwareBuild.packages.empty'));
        view.detach();
    });

    it('excludes add-ons from Select all when the add-on feature is absent', async () => {
        const store = createStore(
            readySnapshot(['firmware-compile', 'firmware-deploy', 'local-package-scan'])
        );
        const view = await mount(createFakeClient(), store);

        assert.equal(checkboxFor('sample_addon'), null);

        buttonByText('firmwareBuild.packages.selectAll').click();
        await tick();

        assert.equal(checkboxFor('core').checked, true);
        assert.equal(checkboxFor('opt_pkg').checked, true);
        assert.equal(checkboxFor('sample_addon'), null);
        view.detach();
    });

    it('disables the Build button once the selection is cleared', async () => {
        const view = await mount(
            createFakeClient(),
            createStore(readySnapshot()),
            builtinsOnlyRuntime()
        );
        const buildButton = () => container.querySelector('.firmware-build-view__build-firmware > .view-toolbar .custom-control__button');

        assert.equal(buildButton().disabled, false);

        buttonByText('firmwareBuild.packages.clear').click();
        await tick();

        assert.equal(buildButton().disabled, true);
        view.detach();
    });

    it('re-enables the Build button when a package is selected again', async () => {
        const view = await mount(
            createFakeClient(),
            createStore(readySnapshot()),
            builtinsOnlyRuntime()
        );
        const buildButton = () => container.querySelector('.firmware-build-view__build-firmware > .view-toolbar .custom-control__button');

        buttonByText('firmwareBuild.packages.clear').click();
        await tick();
        assert.equal(buildButton().disabled, true);

        const opt = checkboxFor('opt_pkg');
        opt.checked = true;
        opt.dispatchEvent(new window.Event('change', { bubbles: true }));
        await tick();

        assert.equal(buildButton().disabled, false);
        view.detach();
    });

    describe('scan-local refresh', () => {
        it('sends scan-local with the runtimeId', async () => {
            const client = createFakeClient();
            const view = await mount(client);
            client.sent.length = 0;

            buttonByText('firmwareBuild.packages.refresh').click();
            await tick();
            assert.deepEqual(client.sent[0], { type: 'scan-local', runtimeId: 'general' });
            view.detach();
        });

        it('reloads the runtime collection on success', async () => {
            const client = createFakeClient();
            const store = createStore(readySnapshot());
            const runtime = packagesRuntime();
            let loads = 0;
            const options = createOptions({ store, runtime, client });
            options.runtimeCollection = { getRuntime: () => runtime, async load() { loads += 1; } };
            const view = new FirmwareBuildView(options);
            view.attachTo(container);
            await tick();
            await tick();
            client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });

            buttonByText('firmwareBuild.packages.refresh').click();
            await tick();
            client.emitFrame({ type: 'result', job: 'scan', status: 'succeeded', payload: { warnings: [] } });
            await tick();
            assert.equal(loads, 1);
            view.detach();
        });

        it('renders an error frame and leaves the checklist in place', async () => {
            const client = createFakeClient();
            const view = await mount(client);

            buttonByText('firmwareBuild.packages.refresh').click();
            await tick();
            client.emitFrame({ type: 'error', code: 'runtime-not-found', message: 'x', hint: null });

            const log = container.querySelector('.firmware-build-view__build-log');
            assert.ok(log.textContent.includes('firmwareBuild.errors.runtime-not-found'));
            assert.ok(checkboxFor('core'));
            view.detach();
        });

        it('refuses a scan while a build runs', async () => {
            const client = createFakeClient();
            const view = await mount(client);
            client.sent.length = 0;

            container.querySelector('.firmware-build-view__build-firmware > .view-toolbar .custom-control__button').click();
            await tick();
            assert.equal(client.sent.length, 1);

            buttonByText('firmwareBuild.packages.refresh').click();
            await tick();
            assert.equal(client.sent.filter((frame) => frame.type === 'scan-local').length, 0);
            view.detach();
        });
    });
});
