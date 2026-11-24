// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareInventoryPanel } from '../../../src/micro_otter/nodes/html/js/views/firmware-inventory-panel.js';
import { createI18nService, setupDom, teardownDom } from './fixtures.js';
import { IconProvider } from '../../../src/micro_otter/nodes/html/js/views/icon-provider.js';

/**
 * Match a toolbar control by its label, which icon-only buttons keep in `title`
 * and `aria-label` instead of visible text.
 */
function buttonLabel(button) {
    return `${button.textContent} ${button.title} ${button.getAttribute('aria-label') ?? ''}`;
}

function entry(overrides = {}) {
    return {
        path: '/opt/fw/a.bin',
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
        packageVariants: {},
        selection: {},
        channel: '',
        versionSource: null,
        isPrerelease: false,
        isLatest: false,
        isChannelLatest: false,
        ...overrides,
    };
}

describe('FirmwareInventoryPanel', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    function mount(options = {}) {
        const entries = options.entries ?? [];
        const context = options.context ?? {
            requiredPackageIds: ['core'],
            runtimeId: 'general',
            boardId: 'esp32',
        };
        const selected = [];
        const deleted = [];
        let busy = options.busy ?? false;
        let refreshing = options.refreshing ?? false;

        const panel = new FirmwareInventoryPanel({
            i18nService: createI18nService(),
            logger: null,
            getEntries: () => entries,
            getContext: () => context,
            availablePackageIds: () => options.availablePackageIds ?? ['core'],
            hasFeature: (id) => id === 'firmware-compile',
            isBusy: () => busy,
            isRefreshing: () => refreshing,
            isAddonPackage: (packageId) => packageId === 'sample_addon',
            registerControl: () => {},
            onSelect: (value) => selected.push(value),
            onRefresh: () => {},
            onDelete: (value) => deleted.push(value),
        });

        container.appendChild(panel.buildInventorySection());
        panel.renderInventorySection();
        return {
            panel,
            selected,
            deleted,
            setBusy: (value) => (busy = value),
            setRefreshing: (value) => (refreshing = value),
        };
    }

    it('renders the latest badge only on the isLatest row', () => {
        mount({
            entries: [
                entry({ filename: 'old.bin', runtimeFirmwareVersion: '0.12.0' }),
                entry({ filename: 'new.bin', isLatest: true, runtimeFirmwareVersion: '0.13.0' }),
            ],
        });

        const buttons = [...container.querySelectorAll('.firmware-inventory__row-button')];
        assert.equal(buttons.length, 2);
        assert.equal(container.querySelectorAll('.firmware-inventory__badge--latest').length, 1);
        const latestRow = buttons.find((b) => b.textContent.includes('0.13.0'));
        assert.ok(latestRow.querySelector('.firmware-inventory__badge--latest'));
    });

    it('renders the release and dev channel badges and none for a legacy entry', () => {
        mount({
            entries: [
                entry({ filename: 'release.bin', channel: 'release', runtimeFirmwareVersion: '1.0.0' }),
                entry({ filename: 'dev.bin', channel: 'dev', runtimeFirmwareVersion: '1.0.1-dev' }),
                entry({ filename: 'legacy.bin', channel: '', runtimeFirmwareVersion: '0.13.0' }),
            ],
        });

        assert.equal(container.querySelectorAll('.firmware-inventory__badge--release').length, 1);
        assert.equal(container.querySelectorAll('.firmware-inventory__badge--dev').length, 1);
        const buttons = [...container.querySelectorAll('.firmware-inventory__row-button')];
        const legacyRow = buttons.find((b) => b.textContent.includes('0.13.0'));
        assert.equal(legacyRow.querySelector('.firmware-inventory__badge--release'), null);
        assert.equal(legacyRow.querySelector('.firmware-inventory__badge--dev'), null);
    });

    it('splits a dev version into base and dimmed suffix spans', () => {
        mount({
            entries: [entry({ runtimeFirmwareVersion: '1.0.1-dev.7.gabc1234' })],
        });

        const name = container.querySelector('.firmware-inventory__name');
        const suffix = container.querySelector('.firmware-inventory__version-suffix');
        assert.equal(name.textContent, '1.0.1');
        assert.equal(suffix.textContent, 'dev.7.gabc1234');
        assert.equal(container.querySelectorAll('.firmware-inventory__version-suffix').length, 1);
    });

    it('renders no suffix span for a release version', () => {
        mount({ entries: [entry({ runtimeFirmwareVersion: '1.0.0' })] });

        assert.equal(container.querySelector('.firmware-inventory__version-suffix'), null);
    });

    it('marks the other channel leader with the latest-channel badge', () => {
        mount({
            entries: [
                entry({ filename: 'release.bin', channel: 'release', isLatest: true, runtimeFirmwareVersion: '1.0.1-dev' }),
                entry({ filename: 'dev.bin', channel: 'release', isChannelLatest: true, runtimeFirmwareVersion: '1.0.0' }),
            ],
        });

        assert.equal(container.querySelectorAll('.firmware-inventory__badge--latest').length, 1);
        assert.equal(container.querySelectorAll('.firmware-inventory__badge--latest-channel').length, 1);
    });

    it('badges a full build complete and a subset build partial', () => {
        mount({
            availablePackageIds: ['core', 'audio', 'display'],
            entries: [
                entry({
                    filename: 'partial.bin',
                    embeddedPackages: { core: '1.0.0' },
                    runtimeFirmwareVersion: '1.0.0',
                }),
                entry({
                    path: '/opt/fw/full.bin',
                    filename: 'full.bin',
                    embeddedPackages: { core: '1.0.0', audio: '2.0.0', display: '3.0.0' },
                    runtimeFirmwareVersion: '0.14.0',
                }),
            ],
        });

        const buttons = [...container.querySelectorAll('.firmware-inventory__row-button')];
        const subsetRow = buttons.find((b) => b.textContent.includes('1.0.0'));
        const fullRow = buttons.find((b) => b.textContent.includes('0.14.0'));
        assert.ok(subsetRow.querySelector('.firmware-inventory__badge--partial'), 'subset is partial');
        assert.equal(
            subsetRow.querySelector('.firmware-inventory__badge--complete'),
            null,
            'a subset build is never complete'
        );
        assert.ok(fullRow.querySelector('.firmware-inventory__badge--complete'), 'full is complete');
        assert.equal(
            fullRow.querySelector('.firmware-inventory__badge--partial'),
            null,
            'a full build is never partial'
        );
    });

    it('uses the filled circle for complete, the half circle for partial, and a tick for compatible', () => {
        mount({
            availablePackageIds: ['core', 'audio'],
            entries: [
                entry({
                    filename: 'full.bin',
                    embeddedPackages: { core: '1.0.0', audio: '1.0.0' },
                }),
                entry({
                    path: '/opt/fw/sub.bin',
                    filename: 'sub.bin',
                    embeddedPackages: { core: '1.0.0' },
                    runtimeFirmwareVersion: '0.12.0',
                }),
            ],
        });

        const complete = container.querySelector('.firmware-inventory__badge--complete');
        const partial = container.querySelector('.firmware-inventory__badge--partial');
        const compatible = container.querySelector('.firmware-inventory__marker--compatible');
        assert.equal(complete.querySelector('img').getAttribute('src'), IconProvider.get('moonFull'));
        assert.equal(partial.querySelector('img').getAttribute('src'), IconProvider.get('circleHalfFull'));
        assert.equal(compatible.querySelector('img').getAttribute('src'), IconProvider.get('check'));
        assert.equal(complete.title, 'firmwareBuild.inventory.complete');
        assert.equal(partial.title, 'firmwareBuild.inventory.partial');
    });

    it('does not let an embedded add-on make an image partial', () => {
        mount({
            availablePackageIds: ['core'],
            entries: [
                entry({
                    embeddedPackages: { core: '1.0.0' },
                    addonPackages: { sample_addon: '2.0.0' },
                }),
            ],
        });

        assert.equal(container.querySelectorAll('.firmware-inventory__badge--partial').length, 0);
        assert.equal(container.querySelectorAll('.firmware-inventory__badge--complete').length, 1);
        assert.equal(
            container.querySelectorAll('.firmware-inventory__badge--addons').length,
            1,
            'the add-on is reported by its own badge'
        );
    });

    it('shows no coverage badge while the selectable catalog is unknown', () => {
        mount({
            availablePackageIds: [],
            entries: [entry({ embeddedPackages: { core: '1.0.0' } })],
        });

        assert.equal(container.querySelectorAll('.firmware-inventory__badge--partial').length, 0);
        assert.equal(container.querySelectorAll('.firmware-inventory__badge--complete').length, 0);
    });

    it('hides the runtime column when every shown firmware shares one runtime', () => {
        mount({
            entries: [
                entry({ filename: 'a.bin', runtimeFirmwareVersion: '0.13.0' }),
                entry({ filename: 'b.bin', runtimeFirmwareVersion: '0.14.0' }),
            ],
        });

        const headers = [...container.querySelectorAll('.firmware-inventory__list th')];
        const labels = headers.map((th) => th.textContent);
        assert.ok(!labels.includes('firmwareBuild.inventory.runtime'), 'runtime column hidden');
        assert.ok(labels.includes('firmwareBuild.inventory.micropython'), 'MicroPython column kept');
    });

    it('shows the firmware version first and no hash/size/date in the table', () => {
        mount({
            entries: [
                entry({ contentHash: 'abc123', runtimeFirmwareVersion: '0.13.0' }),
                entry({ path: '/opt/fw/b.bin', filename: 'b.bin', contentHash: null, runtimeFirmwareVersion: '0.14.0' }),
            ],
        });

        const table = container.querySelector('.data-table-view');
        assert.ok(table.textContent.includes('0.13.0'), 'firmware version is in the table');
        assert.ok(table.textContent.includes('0.14.0'), 'firmware version is in the table');
        assert.ok(!table.textContent.includes('abc123'), 'hash is not in the table');
        assert.ok(!table.textContent.includes('2026-01-01'), 'modified date is not in the table');
    });

    it('renders all details and a packages table for the selected image', () => {
        mount({
            entries: [
                entry({
                    filename: 'a.bin',
                    contentHash: 'abc123',
                    runtimeFirmwareVersion: '0.13.0',
                    embeddedPackages: { core: '1.0.0', hello: '2.0.0' },
                }),
            ],
        });

        const details = () => container.querySelector('.firmware-inventory__details');
        assert.ok(details().textContent.includes('firmwareBuild.inventory.detailsNoneSelected'));

        container.querySelector('.firmware-inventory__row-button').click();

        const text = details().textContent;
        assert.ok(text.includes('a.bin'), 'details show the filename');
        assert.ok(text.includes('0.13.0'), 'details show the firmware version');
        assert.ok(text.includes('1.27.0'), 'details show the MicroPython version');
        assert.ok(text.includes('general'), 'details show the runtime');
        assert.ok(text.includes('esp32'), 'details show the target');
        assert.ok(text.includes('abc123'), 'details show the hash');

        const packages = container.querySelector('.firmware-inventory__packages');
        assert.ok(packages.textContent.includes('core'), 'packages table shows the package id');
        assert.ok(packages.textContent.includes('1.0.0'), 'packages table shows the version');
        assert.ok(packages.textContent.includes('hello'), 'packages table shows the second package');
        assert.equal(
            container.querySelector('.firmware-inventory__details-hint').hidden,
            false,
            'deploy hint shown for the selected image'
        );
    });

    it('shows Channel, Version source, and Add-ons rows in the details', () => {
        mount({
            entries: [
                entry({
                    filename: 'a.bin',
                    channel: 'release',
                    versionSource: 'git-release-tag',
                    addonPackages: { hello: '0.2.0' },
                }),
            ],
        });
        container.querySelector('.firmware-inventory__row-button').click();

        const text = container.querySelector('.firmware-inventory__details').textContent;
        assert.ok(text.includes('release'), 'details show the channel');
        assert.ok(text.includes('git-release-tag'), 'details show the version source');
        assert.ok(text.includes('hello 0.2.0'), 'details show the add-ons');
    });

    it('appends the frozen variant to the add-ons details row', () => {
        mount({
            entries: [
                entry({
                    filename: 'a.bin',
                    addonPackages: { pulse: '1.2.0' },
                    packageVariants: { pulse: 'viper' },
                }),
            ],
        });
        container.querySelector('.firmware-inventory__row-button').click();

        const text = container.querySelector('.firmware-inventory__details').textContent;
        assert.ok(text.includes('pulse 1.2.0 (viper)'));
    });

    it('renders a Variant column in the packages table', () => {
        mount({
            entries: [
                entry({
                    filename: 'a.bin',
                    embeddedPackages: { core: '1.0.0', pulse: '1.2.0' },
                    packageVariants: { core: 'py', pulse: 'viper' },
                }),
            ],
        });
        container.querySelector('.firmware-inventory__row-button').click();

        const packages = container.querySelector('.firmware-inventory__packages');
        const header = packages.querySelector('tr');
        assert.equal(header.querySelectorAll('th').length, 3);
        assert.ok(header.textContent.includes('firmwareBuild.inventory.detailsVariant'));

        const rows = [...packages.querySelectorAll('tbody tr, tr')].filter(
            (row) => row.querySelectorAll('td').length > 0
        );
        const byPackage = new Map(
            rows.map((row) => {
                const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent);
                return [cells[0], cells];
            })
        );
        assert.deepEqual(byPackage.get('pulse'), ['pulse', '1.2.0', 'viper']);
        assert.deepEqual(byPackage.get('core'), ['core', '1.0.0', 'py']);
    });

    it('leaves the Variant cell empty for an image without a recorded variant', () => {
        mount({
            entries: [entry({ filename: 'a.bin', embeddedPackages: { core: '1.0.0' } })],
        });
        container.querySelector('.firmware-inventory__row-button').click();

        const packages = container.querySelector('.firmware-inventory__packages');
        const rows = [...packages.querySelectorAll('tr')].filter(
            (row) => row.querySelectorAll('td').length > 0
        );
        const cells = [...rows[0].querySelectorAll('td')].map((cell) => cell.textContent);
        assert.deepEqual(cells, ['core', '1.0.0', '']);
    });

    it('renders a compatibility marker for compatible and unknown only', () => {
        mount({
            entries: [
                entry({ filename: 'ok.bin', embeddedPackages: { core: '1.0.0' } }),
                entry({ filename: 'missing.bin', embeddedPackages: {} }),
                entry({ filename: 'nomanifest.bin', hasManifest: false }),
            ],
        });

        const compatible = container.querySelector('.firmware-inventory__marker--compatible');
        const unknown = container.querySelector('.firmware-inventory__marker--unknown');
        assert.ok(compatible, 'compatible marker rendered');
        assert.ok(unknown, 'unknown marker rendered');
        assert.equal(
            container.querySelector('.firmware-inventory__marker--incomplete'),
            null,
            'the incomplete marker is gone'
        );
        assert.equal(
            container.querySelectorAll('.firmware-inventory__marker').length,
            2,
            'the image missing a ticked package carries no marker'
        );
        assert.ok(compatible.closest('button').title.includes('Packages: core 1.0.0'));
    });

    it('marks images that embed an add-on package with the add-ons badge', () => {
        mount({
            entries: [
                entry({ filename: 'plain.bin', embeddedPackages: { core: '1.0.0' } }),
                entry({
                    path: '/opt/fw/addons.bin',
                    filename: 'addons.bin',
                    embeddedPackages: { core: '1.0.0' },
                    addonPackages: { sample_addon: '2.0.0' },
                }),
                entry({
                    path: '/opt/fw/legacy.bin',
                    filename: 'legacy.bin',
                    embeddedPackages: { core: '1.0.0', sample_addon: '2.0.0' },
                }),
                entry({
                    path: '/opt/fw/nomanifest.bin',
                    filename: 'nomanifest.bin',
                    hasManifest: false,
                    embeddedPackages: { sample_addon: '2.0.0' },
                }),
            ],
        });

        const badges = [...container.querySelectorAll('.firmware-inventory__badge--addons')];
        assert.equal(badges.length, 2, 'both manifest images with an add-on are badged');
        const rows = [...container.querySelectorAll('.firmware-inventory__row-button')];
        assert.ok(
            rows[1].querySelector('.firmware-inventory__badge--addons'),
            'the sidecar add-onPackages object is the authoritative signal'
        );
        assert.ok(rows[2].querySelector('.firmware-inventory__badge--addons'));
        assert.equal(rows[3].querySelector('.firmware-inventory__badge--addons'), null);
        assert.equal(badges[0].title, 'firmwareBuild.inventory.badgeAddons');
    });

    it('keeps every glyph control named through title and aria-label', () => {
        mount({ entries: [entry({ isLatest: true })] });

        const refresh = [...container.querySelectorAll('.custom-control__button')].find((b) =>
            buttonLabel(b).includes('firmwareBuild.inventory.refresh')
        );
        assert.equal(refresh.title, 'firmwareBuild.inventory.refresh');
        assert.equal(refresh.getAttribute('aria-label'), 'firmwareBuild.inventory.refresh');
        assert.ok(refresh.querySelector('.custom-control__button-icon'), 'refresh renders an icon');
        assert.equal(refresh.querySelector('.custom-control__button-label'), null);

        const marker = container.querySelector('.firmware-inventory__marker--compatible');
        assert.equal(marker.getAttribute('role'), 'img');
        assert.equal(marker.title, 'firmwareBuild.inventory.compatible');
        assert.equal(marker.getAttribute('aria-label'), 'firmwareBuild.inventory.compatible');
        assert.ok(
            marker.querySelector('img.firmware-inventory__badge-icon'),
            'the marker renders an icon'
        );

        const row = container.querySelector('.firmware-inventory__row-button');
        assert.ok(
            row.getAttribute('aria-label').includes('firmwareBuild.inventory.compatible'),
            'the row label names the compatibility status'
        );
    });

    it('selects a row, exposes the entry, and enables Delete', () => {
        const { selected } = mount({ entries: [entry()] });

        const deleteButton = [...container.querySelectorAll('.custom-control__button')].find((b) =>
            buttonLabel(b).includes('firmwareBuild.inventory.delete')
        );
        assert.equal(deleteButton.disabled, true);

        container.querySelector('.firmware-inventory__row-button').click();

        assert.equal(selected.length, 1);
        assert.equal(selected[0].path, '/opt/fw/a.bin');
        assert.equal(deleteButton.disabled, false);
        assert.ok(container.querySelector('.firmware-inventory__row--selected'));
    });

    it('invokes onDelete for the selected image and never owns a dialog', () => {
        const { deleted } = mount({ entries: [entry()] });

        container.querySelector('.firmware-inventory__row-button').click();
        const deleteButton = [...container.querySelectorAll('.custom-control__button')].find((b) =>
            buttonLabel(b).includes('firmwareBuild.inventory.delete')
        );
        deleteButton.click();

        assert.equal(deleted.length, 1);
        assert.equal(deleted[0].path, '/opt/fw/a.bin');
        assert.equal(
            container.querySelector('.modal-dialog'),
            null,
            'the panel must not render a confirm dialog'
        );
    });

    it('renders the empty and refresh-failed states', () => {
        const { panel } = mount({ entries: [] });
        assert.ok(container.textContent.includes('firmwareBuild.inventory.empty'));

        panel.setRefreshFailed(true);
        assert.ok(container.textContent.includes('firmwareBuild.inventory.refreshFailed'));
    });

    it('disables Refresh while busy', () => {
        const { setBusy, panel } = mount({ entries: [entry()] });
        const refreshButton = [...container.querySelectorAll('.custom-control__button')].find((b) =>
            buttonLabel(b).includes('firmwareBuild.inventory.refresh')
        );
        assert.equal(refreshButton.disabled, false);

        setBusy(true);
        panel.renderInventorySection();
        assert.equal(refreshButton.disabled, true);
    });

    it('shows the in-section progress bar while refreshing and re-renders rows after', () => {
        const { panel, setRefreshing } = mount({ entries: [entry()] });
        const progress = () => container.querySelector('.firmware-inventory__progress');

        assert.equal(progress().hidden, true);

        setRefreshing(true);
        panel.renderInventorySection();
        assert.equal(progress().hidden, false, 'bar visible while refreshing');
        assert.equal(container.querySelectorAll('.firmware-inventory__row-button').length, 0);

        setRefreshing(false);
        panel.renderInventorySection();
        assert.equal(progress().hidden, true, 'bar hidden after refresh');
        assert.equal(container.querySelectorAll('.firmware-inventory__row-button').length, 1);
    });

    it('lists an imported image on the current board even with a different runtime', () => {
        mount({
            entries: [
                entry({
                    path: '/opt/fw/imported.bin',
                    filename: 'imported.bin',
                    runtimeId: 'imported',
                    source: 'imported-binary',
                    runtimeFirmwareVersion: '0.0.0',
                }),
            ],
        });

        assert.equal(container.querySelectorAll('.firmware-inventory__row-button').length, 1);
    });

    it('still hides a build image of another runtime', () => {
        mount({
            entries: [entry({ runtimeId: 'other', runtimeFirmwareVersion: '0.13.0' })],
        });

        assert.equal(container.querySelectorAll('.firmware-inventory__row-button').length, 0);
        assert.ok(container.textContent.includes('firmwareBuild.inventory.empty'));
    });

    it('renders the imported badge with the translated label', () => {
        mount({
            entries: [
                entry({ runtimeId: 'imported', source: 'imported-binary' }),
            ],
        });

        const badge = container.querySelector('.firmware-inventory__badge--imported');
        assert.ok(badge, 'imported badge rendered');
        assert.equal(badge.title, 'firmwareBuild.inventory.imported');
        assert.equal(badge.getAttribute('aria-label'), 'firmwareBuild.inventory.imported');
    });

    it('shows the original file and platform details for an imported image', () => {
        mount({
            entries: [
                entry({
                    runtimeId: 'imported',
                    source: 'imported-binary',
                    originalFilename: 'esp32-20240602.bin',
                    targetId: 'esp32_s3_mini',
                }),
            ],
        });
        container.querySelector('.firmware-inventory__row-button').click();

        const text = container.querySelector('.firmware-inventory__details').textContent;
        assert.ok(text.includes('firmwareBuild.inventory.detailsOriginalFile'));
        assert.ok(text.includes('esp32-20240602.bin'), 'details show the original filename');
        assert.ok(text.includes('firmwareBuild.inventory.detailsImportTarget'));
        assert.ok(text.includes('esp32_s3_mini'), 'details show the import target');
    });

    it('shows notAvailable for a missing original filename on an imported image', () => {
        mount({
            entries: [
                entry({ runtimeId: 'imported', source: 'imported-binary', originalFilename: null }),
            ],
        });
        container.querySelector('.firmware-inventory__row-button').click();

        const text = container.querySelector('.firmware-inventory__details').textContent;
        assert.ok(
            text.includes('firmwareBuild.inventory.notAvailable'),
            'missing original filename falls back to notAvailable'
        );
    });
});

