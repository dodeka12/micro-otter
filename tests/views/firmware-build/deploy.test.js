// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    BOARD_CATALOG,
    EMPTY_BOARD_CATALOG,
    createFakeClient,
    createOptions,
    createRuntime,
    createStore,
    createTarget,
    portFetch,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

describe('FirmwareBuildView deploy flow', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = portFetch([
            {
                device: '/dev/ttyUSB0',
                label: 'usb-Espressif_USB_JTAG-if00',
                display: 'Espressif USB JTAG if00 (usb, /dev/ttyUSB0)',
            },
        ]);
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    const deployButton = () => container.querySelector('.firmware-build-view__deploy > .view-toolbar .custom-control__button');
    const buildButton = () => container.querySelector('.firmware-build-view__build-firmware > .view-toolbar .custom-control__button');
    const portTrigger = () => container.querySelector('.firmware-build-view__dropdown--port');
    const portOptions = () =>
        document.body.querySelectorAll(
            '.firmware-build-view__dropdown-menu--port .dropdown-control__option'
        );
    const rescanButton = () =>
        [...container.querySelectorAll('.firmware-build-view__deploy .custom-control__button')].find(
            (button) => button.title === 'firmwareBuild.deploy.refreshPorts'
        );

    /** Pick a discovered port the way a user does: click its option in the menu. */
    function selectPort(device) {
        document.body
            .querySelector(
                `.firmware-build-view__dropdown-menu--port .dropdown-control__option[data-value="${device}"]`
            )
            .click();
    }

    async function mount(client, store, runtime = createRuntime(), deviceConnection) {
        const view = new FirmwareBuildView(createOptions({ store, runtime, client, deviceConnection }));
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });
        client.sent.length = 0;
        return view;
    }

    it('lists the connected ports by name and deploys to the chosen one', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        const options = [...portOptions()];
        assert.deepEqual(
            options.map((option) => option.getAttribute('data-value')),
            ['/dev/ttyUSB0']
        );
        assert.equal(
            options[0].querySelector('.dropdown-control__option-label').textContent,
            'Espressif USB JTAG if00 (usb, /dev/ttyUSB0)',
            'the option shows the server-formatted display name, not the raw by-id label'
        );
        assert.equal(
            container.querySelector('.firmware-build-view__deploy .custom-control--text'),
            null,
            'the pane no longer offers a manual typed port'
        );
        assert.equal(
            container.querySelector('.firmware-build-view__deploy-port-toolbar .dropdown-control__label')
                .textContent,
            'firmwareBuild.deploy.device',
            'the chooser is titled Device to its left'
        );
        assert.ok(
            portTrigger().textContent.includes('Espressif USB JTAG'),
            'the trigger names the first port, not a placeholder'
        );

        client.sent.length = 0;
        selectPort('/dev/ttyUSB0');
        assert.ok(
            portTrigger().textContent.includes('Espressif USB JTAG'),
            'the trigger names the chosen port'
        );
        deployButton().click();
        await tick();

        assert.equal(client.sent.length, 1);
        assert.equal(client.sent[0].port, '/dev/ttyUSB0');
        view.detach();
    });

    it('falls back to the raw label when the server omits display', async () => {
        global.fetch = portFetch([{ device: '/dev/ttyUSB0', label: 'USB0' }]);
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        assert.equal(
            portOptions()[0].querySelector('.dropdown-control__option-label').textContent,
            'USB0',
            'a pre-display server still yields the raw label'
        );
        view.detach();
    });

    it('drops entries without a usable device path', async () => {
        global.fetch = portFetch([
            { device: '', label: 'ghost' },
            {
                device: '/dev/ttyUSB0',
                label: 'usb-Espressif_USB_JTAG-if00',
                display: 'Espressif USB JTAG if00 (usb, /dev/ttyUSB0)',
            },
            { label: 'no-device' },
            'not-an-object',
        ]);
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        assert.deepEqual(
            [...portOptions()].map((option) => option.getAttribute('data-value')),
            ['/dev/ttyUSB0'],
            'only the entry with a usable device path is offered'
        );
        view.detach();
    });

    it('puts the rescan button beside the port chooser, matching the pane button', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        const trigger = portTrigger();
        const rescan = rescanButton();
        assert.ok(rescan, 'the port row renders a rescan button');
        assert.equal(rescan.title, 'firmwareBuild.deploy.refreshPorts');
        assert.deepEqual(
            [...rescan.classList].sort(),
            [...deployButton().classList].sort(),
            'the rescan button is class-for-class the pane toolbar button'
        );
        assert.ok(
            trigger.compareDocumentPosition(rescan) & window.Node.DOCUMENT_POSITION_FOLLOWING,
            'the rescan button follows the chooser'
        );
        assert.equal(
            trigger.closest('.view-toolbar'),
            rescan.closest('.view-toolbar'),
            'both controls share the pane port row toolbar'
        );
        view.detach();
    });

    it('rescans the serial ports so a newly plugged board appears', async () => {
        let ports = [{ device: '/dev/ttyUSB0', label: 'USB0' }];
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                return { ok: true, status: 200, json: async () => ports };
            }
            return { ok: true, status: 200, json: async () => EMPTY_BOARD_CATALOG };
        };

        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);
        assert.equal(portOptions().length, 1);

        ports = [...ports, { device: '/dev/ttyUSB1', label: 'USB1' }];
        rescanButton().click();
        await tick();
        await tick();

        assert.deepEqual(
            [...portOptions()].map((option) => option.getAttribute('data-value')),
            ['/dev/ttyUSB0', '/dev/ttyUSB1']
        );
        view.detach();
    });

    it('says it is scanning while a rescan is in flight', async () => {
        const ports = [{ device: '/dev/ttyUSB0', label: 'USB0' }];
        let gate = null;
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                if (gate) {
                    await gate;
                }
                return { ok: true, status: 200, json: async () => ports };
            }
            return { ok: true, status: 200, json: async () => EMPTY_BOARD_CATALOG };
        };

        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);
        const status = container.querySelector('.firmware-build-view__deploy-port-status');

        let release = () => {};
        gate = new Promise((resolve) => {
            release = resolve;
        });
        rescanButton().click();
        await tick();

        assert.ok(status.textContent.includes('firmwareBuild.deploy.portsLoading'));
        assert.equal(portOptions().length, 1, 'the known port stays listed during a scan');

        gate = null;
        release();
        await tick();
        await tick();

        assert.ok(!status.textContent.includes('firmwareBuild.deploy.portsLoading'));
        view.detach();
    });

    it('keeps the known ports when a rescan fails', async () => {
        let fail = false;
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                if (fail) {
                    return { ok: false, status: 500, json: async () => ({}) };
                }
                return { ok: true, status: 200, json: async () => [{ device: '/dev/ttyUSB0', label: 'USB0' }] };
            }
            return { ok: true, status: 200, json: async () => EMPTY_BOARD_CATALOG };
        };

        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        fail = true;
        rescanButton().click();
        await tick();
        await tick();

        assert.deepEqual(
            [...portOptions()].map((option) => option.getAttribute('data-value')),
            ['/dev/ttyUSB0'],
            'a failed scan does not empty the chooser'
        );
        assert.ok(
            container
                .querySelector('.firmware-build-view__deploy-port-status')
                .textContent.includes('firmwareBuild.deploy.portsUnavailable')
        );
        view.detach();
    });

    it('keeps Deploy usable with a hint on an empty port list', async () => {
        global.fetch = portFetch([]);
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        const status = container.querySelector('.firmware-build-view__deploy-port-status');
        assert.ok(status.textContent.includes('firmwareBuild.deploy.noPorts'));
        assert.equal(deployButton().disabled, false);
        view.detach();
    });

    it('renders portBusy without disabling Deploy when connected', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store, createRuntime(), { isConnected: () => true });

        const status = container.querySelector('.firmware-build-view__deploy-port-status');
        assert.ok(status.textContent.includes('firmwareBuild.deploy.portBusy'));
        assert.equal(deployButton().disabled, false);
        view.detach();
    });

    it('renders the port rule above the chooser and the busy line while connected', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store, createRuntime(), {
            isConnected: () => true,
            disconnect: async () => {},
        });

        const note = container.querySelector('.firmware-build-view__deploy-port-note');
        const portRow = container.querySelector('.firmware-build-view__deploy-port-toolbar');
        assert.ok(note, 'the Deploy pane explains the port rule');
        assert.ok(note.textContent.includes('firmwareBuild.deploy.portFreeNote'));
        assert.ok(
            note.compareDocumentPosition(portRow) & window.Node.DOCUMENT_POSITION_FOLLOWING,
            'the sentence is read before the chooser'
        );
        assert.ok(
            container
                .querySelector('.firmware-build-view__deploy-port-status')
                .textContent.includes('firmwareBuild.deploy.portBusy')
        );
        view.detach();
    });

    it('releases the app connection before the deploy request', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        let sentAtDisconnect = -1;
        const view = await mount(client, store, createRuntime(), {
            isConnected: () => true,
            disconnect: async () => {
                sentAtDisconnect = client.sent.length;
            },
        });

        selectPort('/dev/ttyUSB0');
        deployButton().click();
        await tick();

        assert.equal(sentAtDisconnect, 0, 'the port is free before Deploy is sent');
        assert.equal(client.sent.length, 1);
        assert.equal(client.sent[0].type, 'deploy.start');
        const log = container.querySelector('.firmware-build-view__deploy-log');
        assert.ok(log.textContent.includes('firmwareBuild.deploy.portReleased'));
        view.detach();
    });

    it('stops before the job when the port release fails', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store, createRuntime(), {
            isConnected: () => true,
            disconnect: async () => {
                throw new Error('device busy');
            },
        });

        selectPort('/dev/ttyUSB0');
        deployButton().click();
        await tick();

        assert.equal(client.sent.length, 0, 'no deploy request is sent');
        assert.equal(view._jobState.busy, false, 'the Deploy group stays idle and re-deployable');
        const log = container.querySelector('.firmware-build-view__deploy-log');
        assert.ok(log.textContent.includes('firmwareBuild.deploy.portReleaseFailed'));
        view.detach();
    });

    it('does not disconnect a port the app does not hold', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        let disconnects = 0;
        const view = await mount(client, store, createRuntime(), {
            isConnected: () => false,
            disconnect: async () => {
                disconnects += 1;
            },
        });

        selectPort('/dev/ttyUSB0');
        deployButton().click();
        await tick();

        assert.equal(disconnects, 0);
        assert.equal(client.sent.length, 1);
        view.detach();
    });

    it('does not disconnect when the capability gate refuses the deploy', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot(['firmware-compile', 'local-package-scan']));
        let disconnects = 0;
        const view = await mount(client, store, createRuntime(), {
            isConnected: () => true,
            disconnect: async () => {
                disconnects += 1;
            },
        });

        selectPort('/dev/ttyUSB0');
        deployButton().click();
        await tick();

        assert.equal(disconnects, 0, 'a refused flash never frees a working device');
        assert.equal(client.sent.length, 0);
        view.detach();
    });

    it('maps the wipe checkbox to wipeFilesystem', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);
        client.sent.length = 0;

        selectPort('/dev/ttyUSB0');
        deployButton().click();
        await tick();
        assert.equal('wipeFilesystem' in client.sent[0], false);

        client.emitFrame({ type: 'result', job: 'deploy', status: 'succeeded', payload: {} });

        const wipe = container.querySelector('.firmware-build-view__wipe .custom-control__checkbox');
        wipe.checked = true;
        wipe.dispatchEvent(new window.Event('change', { bubbles: true }));

        client.sent.length = 0;
        deployButton().click();
        await tick();
        assert.equal(client.sent[0].wipeFilesystem, true);
        view.detach();
    });

    it('leads the Deploy pane with a toolbar holding the button before the wipe checkbox', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        const section = container.querySelector('.firmware-build-view__deploy');
        const toolbar = section.firstElementChild;
        assert.ok(toolbar?.classList.contains('view-toolbar'), 'the pane leads with a ToolbarView');
        assert.equal(
            toolbar.closest('.collapsible-view__header-actions'),
            null,
            'the row is pane content, not a header action'
        );

        const button = toolbar.querySelector('.custom-control__button');
        const wipe = toolbar.querySelector('.firmware-build-view__wipe');
        assert.ok(wipe?.querySelector('.custom-control__checkbox'));
        assert.ok(button?.classList.contains('custom-control__button--icon-only'));
        assert.ok(
            button?.classList.contains('custom-control__button--secondary'),
            'the pane button uses the same variant as the panel toolbars'
        );
        assert.ok(
            button.compareDocumentPosition(wipe) & window.Node.DOCUMENT_POSITION_FOLLOWING,
            'the deploy button precedes the wipe checkbox'
        );

        const panelButton = container.querySelector(
            '.firmware-build-view__packages .custom-control__button'
        );
        assert.deepEqual(
            [...button.classList].sort(),
            [...panelButton.classList].sort(),
            'the pane button is class-for-class the panel toolbar button'
        );

        assert.equal(
            section.querySelector(':scope > .firmware-build-view__wipe'),
            null,
            'the wipe checkbox never becomes a bare row of the pane'
        );
        view.detach();
    });

    it('gives the wipe host the hint as its title', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        const host = container.querySelector('.firmware-build-view__deploy > .view-toolbar .firmware-build-view__wipe');
        assert.equal(host.title, 'firmwareBuild.deploy.wipeHint');
        view.detach();
    });

    it('disables the deploy button but not the wipe checkbox without firmware-deploy', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot(['firmware-compile', 'local-package-scan']));
        const view = await mount(client, store);

        assert.equal(deployButton().disabled, true);
        assert.equal(
            container.querySelector('.firmware-build-view__wipe .custom-control__checkbox').disabled,
            false
        );
        view.detach();
    });

    it('supplies firmwarePath only for a same-target build', async () => {
        const runtime = createRuntime({
            getAvailableTargets: () => [
                createTarget('esp32-test', 'ESP32 Test'),
                createTarget('esp32c3-test', 'ESP32-C3 Test'),
            ],
        });
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store, runtime);
        client.sent.length = 0;

        buildButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'succeeded',
            payload: { paths: { firmwareArtifact: '/x/y.bin' } },
        });

        selectPort('/dev/ttyUSB0');
        client.sent.length = 0;
        deployButton().click();
        await tick();
        assert.equal(client.sent[0].firmwarePath, '/x/y.bin');

        client.emitFrame({ type: 'result', job: 'deploy', status: 'succeeded', payload: {} });
        document.body
            .querySelector('.firmware-build-view__dropdown-menu--target .dropdown-control__option[data-value="esp32c3-test"]')
            .click();
        await tick();

        selectPort('/dev/ttyUSB0');
        client.sent.length = 0;
        deployButton().click();
        await tick();
        assert.equal('firmwarePath' in client.sent[0], false);
        view.detach();
    });

    it('sends nothing when Deploy is clicked while a build runs', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);
        client.sent.length = 0;

        buildButton().click();
        await tick();
        assert.equal(client.sent.length, 1);

        selectPort('/dev/ttyUSB0');
        deployButton().click();
        await tick();
        assert.equal(client.sent.length, 1);
        view.detach();
    });

    it('renders a failed deploy result with code and hint', async () => {
        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);

        selectPort('/dev/ttyUSB0');
        deployButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'deploy',
            status: 'failed',
            payload: { errors: [{ code: 'flash-tool-missing', message: 'x', hint: 'install esptool' }] },
        });

        const log = container.querySelector('.firmware-build-view__deploy-log');
        assert.ok(log.textContent.includes('firmwareBuild.errors.flash-tool-missing'));
        assert.ok(log.textContent.includes('install esptool'));
        view.detach();
    });

    it('sends the selected inventory image as firmwarePath', async () => {
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                return { ok: true, status: 200, json: async () => [{ device: '/dev/ttyUSB0', label: 'USB0' }] };
            }
            return { ok: true, status: 200, json: async () => BOARD_CATALOG };
        };

        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);
        await tick();

        const refresh = [...container.querySelectorAll('.firmware-build-view__inventory .custom-control__button')]
            .find((b) => b.title.includes('firmwareBuild.inventory.refresh'));
        refresh.click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: {
                entries: [
                    {
                        path: '/opt/fw/selected.bin',
                        filename: 'selected.bin',
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
                    },
                ],
            },
        });

        container.querySelector('.firmware-inventory__row-button').click();
        selectPort('/dev/ttyUSB0');
        client.sent.length = 0;
        deployButton().click();
        await tick();

        assert.equal(client.sent[0].firmwarePath, '/opt/fw/selected.bin');
        view.detach();
    });

    it('shows the selected firmware identity, not the filename, in the deploy section', async () => {
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                return { ok: true, status: 200, json: async () => [{ device: '/dev/ttyUSB0', label: 'USB0' }] };
            }
            return { ok: true, status: 200, json: async () => BOARD_CATALOG };
        };

        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);
        await tick();

        const fallback = container.querySelector('.firmware-build-view__deploy-firmware-status');
        assert.equal(fallback.hidden, false);
        assert.ok(fallback.textContent.includes('firmwareBuild.deploy.firmwarePathNewest'));

        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: {
                entries: [
                    {
                        path: '/opt/fw/selected.bin',
                        filename: 'selected.bin',
                        boardId: 'esp32_esp32_esp32',
                        runtimeId: 'general',
                        micropythonVersion: '1.27.0',
                        runtimeFirmwareVersion: '0.13.0',
                        contentHash: 'abc123',
                        sizeBytes: 1024,
                        modifiedAt: '2026-01-01T00:00:00+00:00',
                        hasManifest: true,
                        embeddedPackages: { core: '1.0.0' },
                        notEmbedded: [],
                        isLatest: true,
                    },
                ],
            },
        });
        container.querySelector('.firmware-inventory__row-button').click();

        const identity = container.querySelector('.firmware-build-view__deploy-firmware');
        assert.equal(identity.hidden, false);
        assert.ok(identity.textContent.includes('0.13.0'), 'shows the firmware version');
        assert.ok(identity.textContent.includes('1.27.0'), 'shows the MicroPython version');
        assert.ok(identity.textContent.includes('general'), 'shows the runtime');
        assert.ok(identity.textContent.includes('abc123'), 'shows the hash');
        assert.ok(!identity.textContent.includes('selected.bin'), 'does not show the filename');
        assert.equal(fallback.hidden, true, 'fallback hidden while an image is selected');
        view.detach();
    });

    it('auto-inserts a freshly built image as selected and badged new', async () => {
        global.fetch = async (url) => {
            const path = String(url);
            if (path.includes('/api/serial-ports')) {
                return { ok: true, status: 200, json: async () => [] };
            }
            return { ok: true, status: 200, json: async () => BOARD_CATALOG };
        };

        const client = createFakeClient();
        const store = createStore(readySnapshot());
        const view = await mount(client, store);
        await tick();

        buildButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'succeeded',
            payload: { paths: { firmwarePublishedArtifact: '/opt/fw/new.bin' } },
        });
        await tick();

        const listFrames = client.sent.filter((frame) => frame.type === 'firmware.list');
        assert.equal(listFrames.length, 1, 'a build triggers a firmware.list');

        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: {
                entries: [
                    {
                        path: '/opt/fw/new.bin',
                        filename: 'new.bin',
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
                    },
                ],
            },
        });

        assert.ok(container.querySelector('.firmware-inventory__row--selected'), 'new image is selected');
        assert.ok(container.querySelector('.firmware-inventory__badge--new'), 'new image is badged');
        view.detach();
    });
});
