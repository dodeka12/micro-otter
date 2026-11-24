// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    classifyFirmwareCompatibility,
    decodeFirmwareInventoryResult,
    findFirmwareSelectionMatch,
    firmwareChannelBadge,
    firmwareDisplayName,
    firmwarePackageCoverage,
    firmwarePackageLabel,
    firmwareTooltipLines,
    firmwareVersionParts,
    isImportedFirmware,
} from '../../src/micro_otter/nodes/html/js/firmware/firmware-inventory.js';

function entry(overrides = {}) {
    return {
        path: '/opt/micro_otter/firmware/a.bin',
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
        channel: '',
        versionSource: null,
        isPrerelease: false,
        isLatest: false,
        ...overrides,
    };
}

describe('decodeFirmwareInventoryResult', () => {
    it('decodes a valid entries payload', () => {
        const decoded = decodeFirmwareInventoryResult({
            schemaVersion: 1,
            entries: [entry({ isLatest: true })],
        });
        assert.equal(decoded.length, 1);
        assert.equal(decoded[0].path, '/opt/micro_otter/firmware/a.bin');
        assert.equal(decoded[0].isLatest, true);
        assert.deepEqual(decoded[0].embeddedPackages, { core: '1.0.0' });
    });

    it('returns an empty list for malformed payloads', () => {
        assert.deepEqual(decodeFirmwareInventoryResult(null), []);
        assert.deepEqual(decodeFirmwareInventoryResult(undefined), []);
        assert.deepEqual(decodeFirmwareInventoryResult('nope'), []);
        assert.deepEqual(decodeFirmwareInventoryResult([1, 2]), []);
        assert.deepEqual(decodeFirmwareInventoryResult({}), []);
        assert.deepEqual(decodeFirmwareInventoryResult({ entries: 'nope' }), []);
    });

    it('drops entries without a string path', () => {
        const decoded = decodeFirmwareInventoryResult({
            entries: [entry(), { filename: 'no-path.bin' }],
        });
        assert.equal(decoded.length, 1);
    });

    it('coerces optional fields defensively', () => {
        const decoded = decodeFirmwareInventoryResult({
            entries: [
                {
                    path: '/x.bin',
                    boardId: 'esp32',
                    runtimeId: 'general',
                    sizeBytes: 'not-a-number',
                    embeddedPackages: { core: 42 },
                    notEmbedded: ['a', 1],
                },
            ],
        });
        assert.equal(decoded[0].sizeBytes, 0);
        assert.deepEqual(decoded[0].embeddedPackages, {});
        assert.deepEqual(decoded[0].notEmbedded, ['a']);
        assert.equal(decoded[0].contentHash, null);
        assert.equal(decoded[0].hasManifest, false);
    });

    it('decodes selection defensively', () => {
        const decoded = decodeFirmwareInventoryResult({
            entries: [entry({ selection: { packageIds: ['core', 'audio'] } })],
        });
        assert.deepEqual(decoded[0].selection, { packageIds: ['core', 'audio'] });
        assert.deepEqual(decodeFirmwareInventoryResult({ entries: [entry()] })[0].selection, {});
    });

    it('decodes import provenance fields and defaults them for legacy payloads', () => {
        const decoded = decodeFirmwareInventoryResult({
            entries: [
                entry({
                    source: 'imported-binary',
                    targetId: 'esp32_s3_mini',
                    originalFilename: 'esp32.bin',
                }),
            ],
        });
        assert.equal(decoded[0].source, 'imported-binary');
        assert.equal(decoded[0].targetId, 'esp32_s3_mini');
        assert.equal(decoded[0].originalFilename, 'esp32.bin');

        const legacy = decodeFirmwareInventoryResult({ entries: [entry()] });
        assert.equal(legacy[0].source, '');
        assert.equal(legacy[0].targetId, null);
        assert.equal(legacy[0].originalFilename, null);
    });
});

describe('isImportedFirmware', () => {
    it('is true for the imported runtime id or the source marker alone', () => {
        assert.equal(isImportedFirmware(entry({ runtimeId: 'imported' })), true);
        assert.equal(isImportedFirmware(entry({ source: 'imported-binary' })), true);
        assert.equal(isImportedFirmware(entry({ runtimeId: 'imported', source: 'imported-binary' })), true);
    });

    it('is false for a build image', () => {
        assert.equal(isImportedFirmware(entry()), false);
    });
});

describe('classifyFirmwareCompatibility', () => {
    const context = { requiredPackageIds: ['core'], runtimeId: 'general', boardId: 'esp32' };

    it('marks a different target as otherTarget', () => {
        const result = classifyFirmwareCompatibility(entry({ boardId: 'esp32_generic_s3' }), context);
        assert.equal(result.status, 'otherTarget');
        assert.equal(result.otherTarget, true);
    });

    it('marks a missing manifest as unknown', () => {
        const result = classifyFirmwareCompatibility(entry({ hasManifest: false }), context);
        assert.equal(result.status, 'unknown');
    });

    it('marks a needed package the image lacks as incomplete with the ids', () => {
        const result = classifyFirmwareCompatibility(entry({ embeddedPackages: {} }), {
            ...context,
            requiredPackageIds: ['core', 'pulse'],
        });
        assert.equal(result.status, 'incomplete');
        assert.deepEqual(result.missingPackageIds, ['core', 'pulse']);
    });

    it('marks fully covered requirements as compatible', () => {
        const result = classifyFirmwareCompatibility(entry(), context);
        assert.equal(result.status, 'compatible');
        assert.deepEqual(result.missingPackageIds, []);
    });

    it('treats an empty requirement list as satisfied', () => {
        // A collection without node packages needs nothing from an image, so the
        // classification is `compatible`; the list still draws no marker for it.
        const result = classifyFirmwareCompatibility(entry({ embeddedPackages: {} }), {
            ...context,
            requiredPackageIds: [],
        });
        assert.equal(result.status, 'compatible');
        assert.deepEqual(result.missingPackageIds, []);
    });

    it('counts an embedded add-on as content for a needed add-on', () => {
        // A v2 sidecar keeps built-ins and add-ons apart, so a needed add-on lives
        // in `addonPackages`, never in `embeddedPackages`.
        const result = classifyFirmwareCompatibility(
            entry({ embeddedPackages: { core: '1.0.0' }, addonPackages: { pulse: '0.1.0' } }),
            { ...context, requiredPackageIds: ['core', 'pulse'] }
        );
        assert.equal(result.status, 'compatible');
        assert.deepEqual(result.missingPackageIds, []);
    });

    it('still reports a needed add-on the image does not carry', () => {
        const result = classifyFirmwareCompatibility(
            entry({ addonPackages: { other: '2.0.0' } }),
            { ...context, requiredPackageIds: ['core', 'pulse'] }
        );
        assert.equal(result.status, 'incomplete');
        assert.deepEqual(result.missingPackageIds, ['pulse']);
    });

    it('ignores packages beyond what the collection needs', () => {
        // The bug this guards: an image built from a slim "Minimal" selection is
        // perfectly usable while every package is still ticked for the next build.
        const result = classifyFirmwareCompatibility(
            entry({ embeddedPackages: { core: '1.0.0' } }),
            { requiredPackageIds: ['core'], runtimeId: 'general', boardId: 'esp32' }
        );
        assert.equal(result.status, 'compatible');
        assert.deepEqual(result.missingPackageIds, []);
    });

    it('reports unknown for an imported image on the same board', () => {
        const result = classifyFirmwareCompatibility(
            entry({ runtimeId: 'imported', hasManifest: false }),
            context
        );
        assert.equal(result.status, 'unknown');
        assert.equal(result.otherTarget, false);
        assert.deepEqual(result.missingPackageIds, []);
    });

    it('still reports otherTarget for an imported image on another board', () => {
        const result = classifyFirmwareCompatibility(
            entry({ runtimeId: 'imported', boardId: 'esp32_generic_s3' }),
            context
        );
        assert.equal(result.status, 'otherTarget');
        assert.equal(result.otherTarget, true);
    });
});

describe('firmwareDisplayName and firmwareTooltipLines', () => {
    it('uses the filename as the display name', () => {
        assert.equal(firmwareDisplayName(entry()), 'a.bin');
    });

    it('produces stable tooltip lines for a manifest-bearing image', () => {
        assert.deepEqual(firmwareTooltipLines(entry()), [
            'Target: esp32/general',
            'MicroPython: 1.27.0',
            'Runtime firmware: 0.13.0',
            'Packages: core 1.0.0',
        ]);
    });

    it('notes a missing manifest in the tooltip', () => {
        assert.deepEqual(firmwareTooltipLines(entry({ hasManifest: false })), [
            'Target: esp32/general',
            'MicroPython: 1.27.0',
            'Runtime firmware: 0.13.0',
            'Contents: no manifest',
        ]);
    });

    it('names embedded add-ons in the tooltip', () => {
        assert.deepEqual(firmwareTooltipLines(entry({ addonPackages: { pulse: '0.1.0' } })), [
            'Target: esp32/general',
            'MicroPython: 1.27.0',
            'Runtime firmware: 0.13.0',
            'Packages: core 1.0.0',
            'Add-ons: pulse 0.1.0',
        ]);
    });

    it('includes channel, version source, and hash lines only when present', () => {
        assert.deepEqual(
            firmwareTooltipLines(
                entry({ channel: 'release', versionSource: 'git-release-tag', contentHash: 'abc123' })
            ),
            [
                'Target: esp32/general',
                'MicroPython: 1.27.0',
                'Runtime firmware: 0.13.0',
                'Channel: release',
                'Version source: git-release-tag',
                'Hash: abc123',
                'Packages: core 1.0.0',
            ]
        );
    });
});

describe('firmwarePackageVariantLabels', () => {
    it('appends a recorded variant to the package label', () => {
        assert.equal(
            firmwarePackageLabel(entry({ packageVariants: { pulse: 'viper' } }), 'pulse', '1.2.0'),
            'pulse 1.2.0 (viper)'
        );
    });

    it('keeps the plain label when no variant is recorded', () => {
        assert.equal(firmwarePackageLabel(entry(), 'pulse', '1.2.0'), 'pulse 1.2.0');
        assert.equal(
            firmwarePackageLabel(entry({ packageVariants: { pulse: '' } }), 'pulse', '1.2.0'),
            'pulse 1.2.0'
        );
    });

    it('appends the variant to the tooltip package and add-on lines', () => {
        const lines = firmwareTooltipLines(
            entry({
                embeddedPackages: { pulse: '1.2.0' },
                addonPackages: { hello: '0.2.0' },
                packageVariants: { pulse: 'viper', hello: 'py' },
            })
        );
        assert.deepEqual(lines, [
            'Target: esp32/general',
            'MicroPython: 1.27.0',
            'Runtime firmware: 0.13.0',
            'Packages: pulse 1.2.0 (viper)',
            'Add-ons: hello 0.2.0 (py)',
        ]);
    });

    it('decodes a v3 packageVariants map', () => {
        const [decoded] = decodeFirmwareInventoryResult({
            entries: [entry({ packageVariants: { pulse: 'viper' } })],
        });
        assert.deepEqual(decoded.packageVariants, { pulse: 'viper' });
    });

    it('degrades a missing or garbage map to an empty object', () => {
        const decoded = decodeFirmwareInventoryResult({
            entries: [
                entry({ path: '/opt/a.bin', packageVariants: undefined }),
                entry({ path: '/opt/b.bin', packageVariants: [] }),
                entry({ path: '/opt/c.bin', packageVariants: { pulse: 7 } }),
            ],
        });
        assert.deepEqual(decoded[0].packageVariants, {});
        assert.deepEqual(decoded[1].packageVariants, {});
        assert.deepEqual(decoded[2].packageVariants, {});
    });
});

describe('firmwareChannelBadge', () => {
    it('returns release and dev for those channels and null for empty', () => {
        assert.equal(firmwareChannelBadge(entry({ channel: 'release' })), 'release');
        assert.equal(firmwareChannelBadge(entry({ channel: 'dev' })), 'dev');
        assert.equal(firmwareChannelBadge(entry({ channel: '' })), null);
        assert.equal(firmwareChannelBadge(entry({ channel: 'legacy' })), null);
    });

    it('returns null for an imported image even with a release channel', () => {
        assert.equal(
            firmwareChannelBadge(entry({ runtimeId: 'imported', channel: 'release' })),
            null
        );
    });

    it('decodes channel, versionSource, and isPrerelease defensively', () => {
        const decoded = decodeFirmwareInventoryResult({
            entries: [entry({ channel: 'dev', versionSource: 'git-dev', isPrerelease: true })],
        });
        assert.equal(decoded[0].channel, 'dev');
        assert.equal(decoded[0].versionSource, 'git-dev');
        assert.equal(decoded[0].isPrerelease, true);

        const legacy = decodeFirmwareInventoryResult({ entries: [entry()] });
        assert.equal(legacy[0].channel, '');
        assert.equal(legacy[0].versionSource, null);
        assert.equal(legacy[0].isPrerelease, false);
    });

    it('marks the channel leaders from latestByChannel', () => {
        const decoded = decodeFirmwareInventoryResult({
            entries: [
                entry({ path: '/opt/fw/a.bin', channel: 'release' }),
                entry({ path: '/opt/fw/b.bin', channel: 'dev' }),
                entry({ path: '/opt/fw/c.bin', channel: 'dev' }),
            ],
            latestByChannel: {
                'esp32:general': {
                    release: '/opt/fw/a.bin',
                    dev: '/opt/fw/b.bin',
                },
            },
        });
        assert.equal(decoded.find((e) => e.path === '/opt/fw/a.bin').isChannelLatest, true);
        assert.equal(decoded.find((e) => e.path === '/opt/fw/b.bin').isChannelLatest, true);
        assert.equal(decoded.find((e) => e.path === '/opt/fw/c.bin').isChannelLatest, false);
    });

    it('leaves every entry non-leader for a v1 payload', () => {
        const decoded = decodeFirmwareInventoryResult({ entries: [entry()] });
        assert.equal(decoded[0].isChannelLatest, false);
    });

    it('decodes addonPackages defensively', () => {
        const decoded = decodeFirmwareInventoryResult({
            entries: [entry({ addonPackages: { hello: '0.2.0' } })],
        });
        assert.deepEqual(decoded[0].addonPackages, { hello: '0.2.0' });
        assert.deepEqual(decodeFirmwareInventoryResult({ entries: [entry()] })[0].addonPackages, {});
    });
});

describe('firmwareVersionParts', () => {
    it('splits at the first hyphen and keeps the full tail', () => {
        assert.deepEqual(firmwareVersionParts('1.0.0'), { base: '1.0.0', preRelease: null });
        assert.deepEqual(firmwareVersionParts('1.0.1-dev.7.gabc1234'), {
            base: '1.0.1',
            preRelease: 'dev.7.gabc1234',
        });
        assert.deepEqual(firmwareVersionParts('1.0.1-dev.7.gabc1234+build.7'), {
            base: '1.0.1',
            preRelease: 'dev.7.gabc1234+build.7',
        });
        assert.deepEqual(firmwareVersionParts('0.22.0.3'), { base: '0.22.0.3', preRelease: null });
        assert.deepEqual(firmwareVersionParts(''), { base: '', preRelease: null });
    });
});

describe('firmwarePackageCoverage', () => {
    const available = ['core', 'audio', 'display'];
    const all = { core: '1.0.0', audio: '2.0.0', display: '3.0.0' };

    it('is complete when the image embeds every available package', () => {
        assert.equal(firmwarePackageCoverage(entry({ embeddedPackages: all }), available), 'complete');
    });

    it('reads the contents union, so an embedded add-on counts as frozen content', () => {
        assert.equal(
            firmwarePackageCoverage(
                entry({
                    embeddedPackages: { core: '1.0.0', audio: '2.0.0' },
                    addonPackages: { display: '3.0.0' },
                }),
                available
            ),
            'complete'
        );
        assert.equal(
            firmwarePackageCoverage(
                entry({ embeddedPackages: all, addonPackages: { hello: '0.2.0' } }),
                available
            ),
            'complete',
            'an add-on beyond the catalog is extra content, not a gap'
        );
    });

    it('is complete for a superset the catalog no longer offers', () => {
        assert.equal(
            firmwarePackageCoverage(
                entry({ embeddedPackages: { ...all, legacy: '0.1.0' } }),
                available
            ),
            'complete'
        );
    });

    it('is partial as soon as one available package is missing', () => {
        assert.equal(firmwarePackageCoverage(entry({ embeddedPackages: { core: '1.0.0' } }), available), 'partial');
        assert.equal(
            firmwarePackageCoverage(entry({ embeddedPackages: { core: '1.0.0', audio: '2.0.0' } }), available),
            'partial'
        );
    });

    it('reads the frozen contents, not the recorded selection', () => {
        assert.equal(
            firmwarePackageCoverage(
                entry({ selection: { packageIds: ['core'] }, embeddedPackages: all }),
                available
            ),
            'complete',
            'a complete image stays complete even when the recorded request was narrow'
        );
        assert.equal(
            firmwarePackageCoverage(
                entry({ selection: { packageIds: [...available] }, embeddedPackages: { core: '1.0.0' } }),
                available
            ),
            'partial',
            'a request for everything that staged less is still a subset build'
        );
    });

    it('answers unknown without a manifest, without contents, or without a catalog', () => {
        assert.equal(firmwarePackageCoverage(entry({ hasManifest: false }), available), 'unknown');
        assert.equal(firmwarePackageCoverage(entry({ embeddedPackages: {} }), available), 'unknown');
        assert.equal(
            firmwarePackageCoverage(entry({ embeddedPackages: all }), []),
            'unknown',
            'an unknown catalog never judges an image'
        );
    });
});

describe('findFirmwareSelectionMatch', () => {
    const context = { packageIds: ['core', 'audio'], runtimeId: 'general', boardId: 'esp32' };

    it('returns the image whose packages are exactly the selection', () => {
        const exact = entry({
            path: '/opt/fw/exact.bin',
            embeddedPackages: { core: '1.0.0', audio: '2.0.0' },
        });
        const superset = entry({
            path: '/opt/fw/super.bin',
            embeddedPackages: { core: '1.0.0', audio: '2.0.0', display: '3.0.0' },
        });

        const match = findFirmwareSelectionMatch([superset, exact], context);
        assert.equal(match?.entry.path, '/opt/fw/exact.bin');
        assert.equal(match?.exact, true);
    });

    it('returns a covering image when no image matches exactly', () => {
        const superset = entry({
            path: '/opt/fw/super.bin',
            embeddedPackages: { core: '1.0.0', audio: '2.0.0', display: '3.0.0' },
        });

        const match = findFirmwareSelectionMatch([superset], context);
        assert.equal(match?.entry.path, '/opt/fw/super.bin');
        assert.equal(match?.exact, false);
    });

    it('counts an add-on package recorded in addonPackages', () => {
        const withAddon = entry({
            path: '/opt/fw/addon.bin',
            embeddedPackages: { core: '1.0.0' },
            addonPackages: { audio: '2.0.0' },
        });

        const match = findFirmwareSelectionMatch([withAddon], context);
        assert.equal(match?.entry.path, '/opt/fw/addon.bin');
        assert.equal(match?.exact, true);
    });

    it('prefers the latest image among equally good matches', () => {
        const older = entry({ path: '/opt/fw/old.bin' });
        const newer = entry({ path: '/opt/fw/new.bin', isLatest: true });

        const match = findFirmwareSelectionMatch([older, newer], {
            ...context,
            packageIds: ['core'],
        });
        assert.equal(match?.entry.path, '/opt/fw/new.bin');
    });

    it('ignores another target, a missing manifest, and images lacking a package', () => {
        assert.equal(
            findFirmwareSelectionMatch([entry({ boardId: 'esp32_generic_s3' })], context),
            null
        );
        assert.equal(
            findFirmwareSelectionMatch([entry({ runtimeId: 'audio' })], context),
            null
        );
        assert.equal(
            findFirmwareSelectionMatch([entry({ hasManifest: false })], context),
            null
        );
        assert.equal(
            findFirmwareSelectionMatch([entry({ embeddedPackages: { core: '1.0.0' } })], context),
            null,
            'a missing selected package disqualifies the image'
        );
    });

    it('matches nothing for an empty selection', () => {
        assert.equal(
            findFirmwareSelectionMatch([entry()], { ...context, packageIds: [] }),
            null
        );
    });
});

