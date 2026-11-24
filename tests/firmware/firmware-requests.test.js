// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildAddonInstallRequest,
    buildAddonUninstallRequest,
    buildCompileRequest,
    buildDeployRequest,
    buildFirmwareDeleteRequest,
    buildFirmwareExportRequest,
    buildFirmwareImportBinaryRequest,
    buildFirmwareImportRequest,
    buildFirmwareListRequest,
    buildFsListRequest,
    formatBytes,
    isBinaryFirmwareSource,
    parseFsListResult,
    validateArchiveUrl,
    validateFirmwarePackageSelection,
} from '../../src/micro_otter/nodes/html/js/firmware/firmware-requests.js';

describe('buildCompileRequest', () => {
    it('fixes modulePackagingMode and sends the targetId', () => {
        const request = buildCompileRequest({
            runtimeId: 'general',
            targetId: 'esp32-test',
            packageIds: ['core'],
            cleanBuild: true,
        });
        assert.deepEqual(request, {
            type: 'compile.start',
            runtimeId: 'general',
            targetId: 'esp32-test',
            packageIds: ['core'],
            modulePackagingMode: 'compiled-mpy',
            cleanBuild: true,
        });
        assert.equal('board' in request, false);
    });

    it('omits packageVariants when empty and serializes a non-empty map', () => {
        const empty = buildCompileRequest({
            runtimeId: 'general',
            packageIds: ['pulse'],
            cleanBuild: false,
            packageVariants: {},
        });
        assert.equal('packageVariants' in empty, false);

        const withVariants = buildCompileRequest({
            runtimeId: 'general',
            packageIds: ['pulse'],
            cleanBuild: false,
            packageVariants: { pulse: 'viper' },
        });
        assert.deepEqual(withVariants.packageVariants, { pulse: 'viper' });
    });
});

describe('buildDeployRequest', () => {
    it('omits optional keys unless provided', () => {
        const request = buildDeployRequest({
            targetId: 'esp32-test',
            port: '/dev/ttyUSB0',
            wipeFilesystem: false,
        });
        assert.deepEqual(request, {
            type: 'deploy.start',
            targetId: 'esp32-test',
            port: '/dev/ttyUSB0',
        });
        assert.equal('board' in request, false);
    });

    it('includes firmwarePath and wipeFilesystem when set', () => {
        const request = buildDeployRequest({
            targetId: 'esp32-test',
            port: '/dev/ttyUSB0',
            firmwarePath: '/x.bin',
            wipeFilesystem: true,
            backendId: 'esptool',
        });
        assert.deepEqual(request, {
            type: 'deploy.start',
            targetId: 'esp32-test',
            port: '/dev/ttyUSB0',
            firmwarePath: '/x.bin',
            wipeFilesystem: true,
            backendId: 'esptool',
        });
    });
});

describe('buildFirmwareListRequest', () => {
    it('sends a bare firmware.list frame', () => {
        assert.deepEqual(buildFirmwareListRequest(), { type: 'firmware.list' });
    });
});

describe('buildFirmwareDeleteRequest', () => {
    it('sends the firmware path', () => {
        assert.deepEqual(buildFirmwareDeleteRequest(' /opt/fw/a.bin '), {
            type: 'firmware.delete',
            firmwarePath: '/opt/fw/a.bin',
        });
    });

    it('throws on an empty path', () => {
        assert.throws(() => buildFirmwareDeleteRequest(''), /firmwarePath/);
        assert.throws(() => buildFirmwareDeleteRequest('   '), /firmwarePath/);
    });
});

describe('buildAddonInstallRequest', () => {
    it('sends a path and omits force', () => {
        assert.deepEqual(buildAddonInstallRequest({ path: ' /tmp/a.zip ' }), {
            type: 'addon.install',
            path: '/tmp/a.zip',
        });
    });

    it('sends a url and omits force', () => {
        assert.deepEqual(buildAddonInstallRequest({ url: ' https://x/a.zip ' }), {
            type: 'addon.install',
            url: 'https://x/a.zip',
        });
    });

    it('adds force only when true', () => {
        assert.deepEqual(buildAddonInstallRequest({ path: 'a.zip', force: true }), {
            type: 'addon.install',
            path: 'a.zip',
            force: true,
        });
    });

    it('throws on neither or both of path/url', () => {
        assert.throws(() => buildAddonInstallRequest({}), /path.*url|url.*path/);
        assert.throws(
            () => buildAddonInstallRequest({ path: 'a.zip', url: 'https://x/a.zip' }),
            /path.*url|url.*path/
        );
    });
});

describe('buildAddonUninstallRequest', () => {
    it('trims, drops blanks, and de-duplicates while keeping order', () => {
        assert.deepEqual(
            buildAddonUninstallRequest([' pulse ', '', '  ', 'flashy', 'pulse']),
            { type: 'addon.uninstall', packageIds: ['pulse', 'flashy'] }
        );
    });

    it('throws when nothing remains', () => {
        assert.throws(() => buildAddonUninstallRequest([]), /packageIds/);
        assert.throws(() => buildAddonUninstallRequest(['  ', '']), /packageIds/);
    });
});

describe('formatBytes', () => {
    it('formats with the documented unit list', () => {
        assert.equal(formatBytes(0), '0 B');
        assert.equal(formatBytes(1023), '1023 B');
        assert.equal(formatBytes(1024), '1 KiB');
        assert.equal(formatBytes(2048), '2 KiB');
        assert.equal(formatBytes(1536), '1.5 KiB');
        assert.equal(formatBytes(1048576), '1 MiB');
    });

    it('returns an empty string for invalid input', () => {
        assert.equal(formatBytes(null), '');
        assert.equal(formatBytes(undefined), '');
        assert.equal(formatBytes(-1), '');
        assert.equal(formatBytes(Number.NaN), '');
    });
});

describe('buildFirmwareImportRequest', () => {
    it('sends a path and omits force', () => {
        const request = buildFirmwareImportRequest({ path: ' /tmp/a.firmware.zip ' });
        assert.deepEqual(request, { type: 'firmware.import', path: '/tmp/a.firmware.zip' });
    });

    it('sends a url and omits force', () => {
        const request = buildFirmwareImportRequest({ url: ' https://x/a.firmware.zip ' });
        assert.deepEqual(request, { type: 'firmware.import', url: 'https://x/a.firmware.zip' });
    });

    it('adds force only when true', () => {
        assert.deepEqual(buildFirmwareImportRequest({ path: 'a.zip', force: true }), {
            type: 'firmware.import',
            path: 'a.zip',
            force: true,
        });
    });

    it('throws on neither or both of path/url', () => {
        assert.throws(() => buildFirmwareImportRequest({}), /path.*url|url.*path/);
        assert.throws(
            () => buildFirmwareImportRequest({ path: 'a.zip', url: 'https://x/a.zip' }),
            /path.*url|url.*path/
        );
    });
});

describe('isBinaryFirmwareSource', () => {
    it('routes .bin paths and URLs, ignoring case, query, and fragment', () => {
        assert.equal(isBinaryFirmwareSource('/tmp/esp32.bin'), true);
        assert.equal(isBinaryFirmwareSource('C:\\firmware\\ESP32.BIN'), true);
        assert.equal(isBinaryFirmwareSource('https://host/x.bin?token=1#frag'), true);
    });

    it('keeps the package path for every non-.bin name', () => {
        assert.equal(isBinaryFirmwareSource('x.firmware.zip'), false);
        assert.equal(isBinaryFirmwareSource('x.uf2'), false);
        assert.equal(isBinaryFirmwareSource('bin'), false);
        assert.equal(isBinaryFirmwareSource(''), false);
    });
});

describe('buildFirmwareImportBinaryRequest', () => {
    it('builds the path form and omits force', () => {
        const request = buildFirmwareImportBinaryRequest({ path: ' /tmp/esp32.bin ', targetId: 'esp32' });
        assert.deepEqual(request, {
            type: 'firmware.import-binary',
            targetId: 'esp32',
            path: '/tmp/esp32.bin',
        });
    });

    it('builds the url form', () => {
        const request = buildFirmwareImportBinaryRequest({ url: ' https://x/esp32.bin ', targetId: 'esp32' });
        assert.deepEqual(request, {
            type: 'firmware.import-binary',
            targetId: 'esp32',
            url: 'https://x/esp32.bin',
        });
    });

    it('adds force only when true', () => {
        assert.deepEqual(
            buildFirmwareImportBinaryRequest({ path: 'a.bin', targetId: 'esp32', force: true }),
            { type: 'firmware.import-binary', targetId: 'esp32', path: 'a.bin', force: true }
        );
    });

    it('throws on neither or both of path/url and a blank targetId', () => {
        assert.throws(
            () => buildFirmwareImportBinaryRequest({ targetId: 'esp32' }),
            /path.*url|url.*path/
        );
        assert.throws(
            () => buildFirmwareImportBinaryRequest({ path: 'a.bin', url: 'https://x/a.bin', targetId: 'esp32' }),
            /path.*url|url.*path/
        );
        assert.throws(
            () => buildFirmwareImportBinaryRequest({ path: 'a.bin', targetId: '  ' }),
            /targetId/
        );
    });
});

describe('buildFsListRequest', () => {
    it('sends only type and requestId when everything else is absent', () => {
        assert.deepEqual(buildFsListRequest({ requestId: 'r1' }), {
            type: 'fs.list',
            requestId: 'r1',
        });
    });

    it('sends path, extensions, and showHidden when set', () => {
        assert.deepEqual(
            buildFsListRequest({
                requestId: 'r1',
                path: '/tmp',
                extensions: ['.zip'],
                showHidden: true,
            }),
            { type: 'fs.list', requestId: 'r1', path: '/tmp', extensions: ['.zip'], showHidden: true }
        );
    });

    it('throws on a blank requestId', () => {
        assert.throws(() => buildFsListRequest({ requestId: '  ' }), /requestId/);
    });
});

describe('buildFirmwareExportRequest', () => {
    it('trims paths and omits force', () => {
        assert.deepEqual(
            buildFirmwareExportRequest({ firmwarePath: ' /opt/fw/a.bin ', destinationDir: ' /tmp/out ' }),
            { type: 'firmware.export', firmwarePath: '/opt/fw/a.bin', destinationDir: '/tmp/out' }
        );
    });

    it('adds force only when true', () => {
        assert.deepEqual(
            buildFirmwareExportRequest({ firmwarePath: 'a.bin', destinationDir: '/tmp', force: true }),
            { type: 'firmware.export', firmwarePath: 'a.bin', destinationDir: '/tmp', force: true }
        );
    });

    it('throws on a blank path', () => {
        assert.throws(() => buildFirmwareExportRequest({ firmwarePath: ' ', destinationDir: '/tmp' }), /firmwarePath/);
        assert.throws(() => buildFirmwareExportRequest({ firmwarePath: 'a.bin', destinationDir: ' ' }), /destinationDir/);
    });
});

describe('parseFsListResult', () => {
    it('parses a valid listing', () => {
        const result = parseFsListResult({
            path: '/tmp',
            parent: '/',
            roots: [{ id: 'home', path: '/home' }],
            entries: [
                { name: 'a.zip', path: '/tmp/a.zip', kind: 'file', sizeBytes: 12, modifiedAt: '1.0' },
                { name: 'link', path: '/tmp/link', kind: 'symlink' },
                { name: 'bad', path: '/tmp/bad', kind: 'weird' },
            ],
        });
        assert.equal(result.path, '/tmp');
        assert.equal(result.parent, '/');
        assert.equal(result.entries.length, 2);
        assert.equal(result.entries[0].sizeBytes, 12);
        assert.equal(result.entries[1].sizeBytes, null);
        assert.equal(result.entries[1].modifiedAt, null);
    });

    it('throws on a missing path or entries', () => {
        assert.throws(() => parseFsListResult({}), /path/);
        assert.throws(() => parseFsListResult({ path: '/tmp' }), /entries/);
    });
});

describe('validateFirmwarePackageSelection', () => {
    it('accepts .zip and rejects other suffixes and oversized files', () => {
        assert.equal(validateFirmwarePackageSelection({ name: 'a.zip', size: 10 }), null);
        assert.equal(validateFirmwarePackageSelection({ name: 'A.ZIP', size: 10 }), null);
        assert.ok(validateFirmwarePackageSelection({ name: 'a.bin', size: 10 }));
        assert.ok(validateFirmwarePackageSelection({ name: 'a.zip', size: 5 * 1024 * 1024 }));
    });
});

describe('validateArchiveUrl', () => {
    it('accepts https anywhere and loopback http', () => {
        assert.equal(validateArchiveUrl('https://example.com/x.zip'), true);
        assert.equal(validateArchiveUrl('http://127.0.0.1:8000/x.zip'), true);
        assert.equal(validateArchiveUrl('http://localhost/x.zip'), true);
        assert.equal(validateArchiveUrl('http://[::1]/x.zip'), true);
    });

    it('rejects public http, file URLs, and URLs with credentials', () => {
        assert.equal(validateArchiveUrl('http://example.com/x.zip'), 'firmwareBuild.inventory.urlInvalid');
        assert.equal(validateArchiveUrl('file:///x.zip'), 'firmwareBuild.inventory.urlInvalid');
        assert.equal(validateArchiveUrl('https://user@example.com/x.zip'), 'firmwareBuild.inventory.urlInvalid');
    });
});
