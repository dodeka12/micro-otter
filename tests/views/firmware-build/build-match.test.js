// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    BOARD_CATALOG,
    createFakeClient,
    createFakeCollection,
    createOptions,
    createRuntime,
    createStore,
    createTwoPackageRuntime,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

/**
 * One published image for the fixture runtime, with overridable contents.
 * @param {object} overrides - Fields to override on the default entry.
 */
function entry(overrides = {}) {
    return {
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
        addonPackages: {},
        selection: {},
        channel: 'dev',
        versionSource: 'git-dev',
        isPrerelease: true,
        isLatest: true,
        isChannelLatest: true,
        ...overrides,
    };
}

describe('FirmwareBuildView existing-firmware line', () => {
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

    /**
     * Attach the view and let the shell, target selection and board catalog settle.
     * @param {object} client - Recording fake job client.
     * @param {object} [options] - Optional fixtures.
     * @param {object} [options.collection] - Fake active collection.
     * @param {object} [options.runtime] - Runtime fixture; defaults to one built-in package.
     */
    async function mount(client, { collection, runtime } = {}) {
        const options = createOptions({
            store: createStore(readySnapshot()),
            runtime: runtime ?? createRuntime(),
            client,
        });
        const view = new FirmwareBuildView({
            ...options,
            collectionManager: collection
                ? { on: () => () => {}, getActiveCollection: () => collection }
                : options.collectionManager,
        });
        view.attachTo(container);
        await tick();
        await tick();
        await tick();
        return view;
    }

    /**
     * Deliver one `firmware.list` result frame.
     * @param {object} client - Recording fake job client.
     * @param {object[]} entries - Inventory entries to deliver.
     */
    function list(client, entries) {
        client.emitFrame({
            type: 'result',
            job: 'list',
            status: 'succeeded',
            payload: { entries },
        });
    }

    const line = () => container.querySelector('.firmware-build-view__build-match');

    it('stays hidden until the inventory has been read', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        assert.equal(line().hidden, true, 'no claim is made before the list arrives');
        view.detach();
    });

    it('names the existing image when it embeds exactly the selection', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        list(client, [entry({ runtimeFirmwareVersion: '0.13.0' })]);
        await tick();

        assert.equal(line().hidden, false);
        assert.equal(line().textContent, 'firmwareBuild.build.matchingFirmware:version=0.13.0');
        assert.ok(line().classList.contains('firmware-build-view__build-match--exists'));
        assert.equal(line().title, 'firmwareBuild.build.matchingFirmwareHint');
        view.detach();
    });

    it('says a superset image *includes* the selection instead of naming an identical one', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        // A published all-packages image also covers a minimal tick: it embeds
        // every selected package, but it is not the firmware this selection
        // would build, so the line must not claim the selection itself exists.
        list(client, [entry({ embeddedPackages: { core: '1.0.0', audio: '2.0.0' } })]);
        await tick();

        assert.equal(line().hidden, false);
        assert.equal(
            line().textContent,
            'firmwareBuild.build.matchingFirmwareSuperset:version=0.13.0',
            'the visible line states the inclusion, not an exact match'
        );
        assert.equal(line().title, 'firmwareBuild.build.matchingFirmwareHintSuperset');
        assert.ok(line().classList.contains('firmware-build-view__build-match--exists'));
        view.detach();
    });

    it('reports that no image exists yet when none embeds the selection', async () => {
        const client = createFakeClient();
        const view = await mount(client);

        list(client, [
            entry({ embeddedPackages: { audio: '2.0.0' } }),
            entry({ path: '/opt/fw/other.bin', boardId: 'esp32_generic_s3' }),
        ]);
        await tick();

        assert.equal(line().hidden, false);
        assert.equal(line().textContent, 'firmwareBuild.build.noMatchingFirmware');
        assert.equal(line().title, 'firmwareBuild.build.noMatchingFirmwareHint');
        assert.equal(
            line().classList.contains('firmware-build-view__build-match--exists'),
            false,
            'a needed build is never marked as existing'
        );
        view.detach();
    });

    it('judges the build line against the ticked packages, not the collection needs', async () => {
        const client = createFakeClient();
        // The collection uses `core` only, but the checklist still ticks the
        // installed add-on `pulse`: the tick answers "does this image run my
        // collection?", this line answers "must I build again?".
        const view = await mount(client, {
            runtime: createTwoPackageRuntime(),
            collection: createFakeCollection([['core.const']]),
        });

        list(client, [entry({ embeddedPackages: { core: '1.0.0' } })]);
        await tick();

        assert.equal(line().hidden, false);
        assert.equal(
            line().textContent,
            'firmwareBuild.build.noMatchingFirmware',
            'the ticked add-on is not embedded, so a build would add it'
        );
        assert.ok(
            container.querySelector('.firmware-inventory__marker--compatible'),
            'the same image is compatible with what the collection needs'
        );
        view.detach();
    });
});
