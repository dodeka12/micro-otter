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
    createSwitchableI18nService,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

/**
 * A `ready` snapshot advertising every feature except the ones named.
 * @param {...string} missingFeatures Feature ids to drop from the capabilities.
 * @returns {object} A capability snapshot with the remaining features.
 */
function snapshotWithout(...missingFeatures) {
    const features = [
        'firmware-compile',
        'firmware-deploy',
        'local-package-scan',
        'node-package-addons',
    ].filter((id) => !missingFeatures.includes(id));
    return readySnapshot(features);
}

/**
 * A backend descriptor as the capability payload carries it.
 * @param {string} id Backend id, e.g. `esp-idf` or `esptool`.
 * @param {object} [options] Availability overrides.
 * @param {boolean} [options.available] Whether the server can use the backend.
 * @param {string|null} [options.reason] Server-supplied explanation when unavailable.
 * @returns {object} A build/flash backend descriptor.
 */
function backend(id, { available = false, reason = null } = {}) {
    return { id, available, version: null, reason, targets: ['esp32'] };
}

/**
 * Count non-overlapping occurrences of `needle` in `text`.
 * @param {string} text Haystack.
 * @param {string} needle Substring to count.
 * @returns {number} How often `needle` appears.
 */
function countOccurrences(text, needle) {
    return text.split(needle).length - 1;
}

/**
 * The removed header notice is replaced by per-backend diagnostic lines in the
 * Build Firmware log: the log of the group whose controls the missing feature
 * blocks.
 */
describe('FirmwareBuildView capability diagnostics', () => {
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

    /** The Build Firmware toolbar button the diagnostics gate. */
    const buildButton = () =>
        container.querySelector(
            '.firmware-build-view__build-firmware > .view-toolbar .custom-control__button'
        );
    /** The Build Firmware log host. */
    const buildLog = () => container.querySelector('.firmware-build-view__build-log');
    /** The Deploy log host, which must stay free of Build diagnostics. */
    const deployLog = () => container.querySelector('.firmware-build-view__deploy-log');

    /**
     * Attach a view over `snapshot` and flush the probe and the first list frame.
     * @param {object} snapshot Capability snapshot the store reports.
     * @param {object} [i18nService] Optional switchable i18n fake.
     * @returns {Promise<{view: FirmwareBuildView, client: object}>} The mounted view and its client.
     */
    async function mount(snapshot, i18nService = undefined) {
        const client = createFakeClient();
        const view = new FirmwareBuildView(
            createOptions({
                store: createStore(snapshot),
                runtime: createRuntime(),
                client,
                viewManager: createFakeViewManager(),
                ...(i18nService ? { i18nService } : {}),
            })
        );
        view.attachTo(container);
        await tick();
        await tick();
        client.emitFrame({ type: 'result', job: 'list', status: 'succeeded', payload: { entries: [] } });
        client.sent.length = 0;
        return { view, client };
    }

    it('explains a missing compile feature with its backend reason and the hint', async () => {
        const snapshot = snapshotWithout('firmware-compile');
        snapshot.capabilities.buildBackends = [
            backend('esp-idf', { reason: '/opt/esp-idf missing' }),
        ];

        const { view } = await mount(snapshot);
        const text = buildLog().textContent;

        assert.ok(
            text.includes(
                'warning: firmwareBuild.doctor.backend:backend=esp-idf,reason=/opt/esp-idf missing'
            ),
            'the reason string is echoed untranslated'
        );
        assert.ok(text.includes('warning: firmwareBuild.doctor.hint'));
        assert.equal(countOccurrences(text, 'firmwareBuild.doctor.backend'), 1, 'one line per backend');
        assert.equal(countOccurrences(text, 'firmwareBuild.doctor.hint'), 1, 'one hint');
        view.detach();
    });

    it('reports every unavailable backend, then one hint', async () => {
        const snapshot = snapshotWithout('firmware-compile');
        snapshot.capabilities.buildBackends = [
            backend('esp-idf', { reason: 'not installed' }),
            backend('arduino-cli', { reason: 'not installed' }),
            backend('esp-idf-cached', { available: true, version: '5.4' }),
        ];

        const { view } = await mount(snapshot);
        const text = buildLog().textContent;

        assert.equal(countOccurrences(text, 'firmwareBuild.doctor.backend'), 2, 'available backends stay silent');
        assert.ok(text.includes('backend=esp-idf'));
        assert.ok(text.includes('backend=arduino-cli'));
        assert.equal(countOccurrences(text, 'firmwareBuild.doctor.hint'), 1);
        view.detach();
    });

    it('falls back to the noReason text when a backend reports no reason', async () => {
        const snapshot = snapshotWithout('firmware-compile');
        snapshot.capabilities.buildBackends = [backend('esp-idf')];

        const { view } = await mount(snapshot);
        const text = buildLog().textContent;

        assert.ok(text.includes('reason=firmwareBuild.doctor.noReason'));
        view.detach();
    });

    it('falls back to the noBackend text when the list is empty', async () => {
        const snapshot = snapshotWithout('firmware-compile');
        snapshot.capabilities.buildBackends = [];

        const { view } = await mount(snapshot);
        const text = buildLog().textContent;

        assert.ok(text.includes('warning: firmwareBuild.doctor.noBackend'));
        assert.ok(text.includes('warning: firmwareBuild.doctor.hint'));
        view.detach();
    });

    it('writes no diagnostic line while both features are advertised', async () => {
        const snapshot = readySnapshot();
        snapshot.capabilities.buildBackends = [backend('esp-idf', { reason: 'unused' })];

        const { view } = await mount(snapshot);

        assert.equal(
            buildLog()?.textContent.includes('firmwareBuild.doctor'),
            false,
            'advertised features need no explanation'
        );
        view.detach();
    });

    it('reports a missing deploy feature through the flash backend', async () => {
        const snapshot = snapshotWithout('firmware-deploy');
        snapshot.capabilities.flashBackends = [backend('esptool', { reason: 'esptool.py missing' })];

        const { view } = await mount(snapshot);
        const text = buildLog().textContent;

        assert.ok(text.includes('backend=esptool,reason=esptool.py missing'));
        assert.equal(
            deployLog()?.textContent.includes('firmwareBuild.doctor'),
            false,
            'the Build log owns the diagnostics, so one place explains every blocked control'
        );
        view.detach();
    });

    it('does not duplicate the lines across re-renders of the same snapshot', async () => {
        const i18nService = createSwitchableI18nService('en');
        const snapshot = snapshotWithout('firmware-compile');
        snapshot.capabilities.buildBackends = [backend('esp-idf', { reason: 'not installed' })];

        const { view } = await mount(snapshot, i18nService);
        assert.equal(countOccurrences(buildLog().textContent, 'firmwareBuild.doctor.hint'), 1);

        i18nService.setLocale('de');
        await tick();

        const text = buildLog().textContent;
        assert.equal(countOccurrences(text, 'firmwareBuild.doctor.backend'), 1, 'still one line');
        assert.equal(countOccurrences(text, 'firmwareBuild.doctor.hint'), 1, 'still one hint');
        assert.ok(text.includes('de:firmwareBuild.doctor.hint'), 'the line follows the locale');
        view.detach();
    });

    it('keeps the diagnostics ahead of the outcome when a job fails', async () => {
        const snapshot = snapshotWithout('firmware-deploy');
        snapshot.capabilities.flashBackends = [backend('esptool', { reason: 'not installed' })];

        const { view, client } = await mount(snapshot);
        buildButton().click();
        await tick();
        client.emitFrame({
            type: 'result',
            job: 'compile',
            status: 'failed',
            payload: { errors: [{ code: 'internal-error', message: 'x', hint: null }] },
        });
        await tick();

        const text = buildLog().textContent;
        const diagnostic = text.indexOf('warning: firmwareBuild.doctor.backend');
        const outcome = text.indexOf('error: firmwareBuild.errors.internal-error');
        assert.ok(diagnostic >= 0, 'the capability problem survives the log clear a new build performs');
        assert.ok(outcome > diagnostic, 'a capability problem predates the job that failed');
        view.detach();
    });

    it('keeps the offline section free of diagnostics rows for an outage', async () => {
        const { view } = await mount({
            state: 'unavailable',
            capabilities: null,
            reason: 'unreachable',
            detail: 'HTTP 404',
        });

        const offline = container.querySelector('.firmware-build-view__offline');
        assert.equal(offline.hidden, false, 'the outage shows the offline section');
        const section = offline.querySelector('.collapsible-view');
        section.querySelector('.collapsible-view__toggle').click();
        await tick();

        const rows = section.querySelector('.firmware-build-view__diagnostics');
        assert.ok(rows, 'the body carries the diagnostics host');
        assert.equal(rows.hidden, true, 'an outage reports no backend, so the list stays hidden');
        assert.equal(rows.children.length, 0);
        view.detach();
    });
});
