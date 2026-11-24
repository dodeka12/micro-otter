// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    BOARD_CATALOG_URL,
    findBoard,
    findBoardForCompileTarget,
    loadBoardCatalog,
    normalizeBoardSelector,
} from '../../src/micro_otter/nodes/html/js/firmware/board-catalog.js';

const VALID_BOARDS = [
    {
        name: 'ESP32_GENERIC',
        slug: 'esp32_generic',
        displayName: 'ESP32 Dev Module',
        buildBackend: 'esp-idf',
        flashBackend: 'esptool',
        chip: 'esp32',
        build: { port: 'esp32', board: 'ESP32_GENERIC', buildDirName: 'build-ESP32_GENERIC' },
        flash: { offset: '0x0' },
    },
    {
        name: 'ESP32_GENERIC_S3',
        slug: 'esp32_generic_s3',
        displayName: 'ESP32-S3',
        buildBackend: 'esp-idf',
        flashBackend: 'esptool',
        chip: 'esp32s3',
        build: { port: 'esp32', board: 'ESP32_GENERIC_S3', buildDirName: 'build-ESP32_GENERIC_S3' },
        flash: {},
    },
];

function okJson(data) {
    return { ok: true, status: 200, json: async () => data };
}

/** The normalised `FirmwareBoardSpec` shape `loadBoardCatalog` produces. */
const NORMALIZED_BOARDS = [
    {
        name: 'ESP32_GENERIC',
        slug: 'esp32_generic',
        displayName: 'ESP32 Dev Module',
        port: 'esp32',
        chip: 'esp32',
        buildDirName: 'build-ESP32_GENERIC',
        firmwareFlashOffset: '0x0',
        buildBackend: 'esp-idf',
        flashBackend: 'esptool',
    },
    {
        name: 'ESP32_GENERIC_S3',
        slug: 'esp32_generic_s3',
        displayName: 'ESP32-S3',
        port: 'esp32',
        chip: 'esp32s3',
        buildDirName: 'build-ESP32_GENERIC_S3',
        firmwareFlashOffset: null,
        buildBackend: 'esp-idf',
        flashBackend: 'esptool',
    },
];

describe('loadBoardCatalog', () => {
    it('loads and normalises a valid v2 catalog', async () => {
        const catalog = await loadBoardCatalog({
            fetchImpl: async (url) => {
                assert.equal(String(url), BOARD_CATALOG_URL);
                return okJson({ schemaVersion: 2, boards: VALID_BOARDS });
            },
        });
        assert.equal(catalog.length, 2);
        assert.equal(catalog[0].name, 'ESP32_GENERIC');
        assert.equal(catalog[0].slug, 'esp32_generic');
        assert.equal(catalog[0].port, 'esp32');
        assert.equal(catalog[0].firmwareFlashOffset, '0x0');
        assert.equal(catalog[0].buildDirName, 'build-ESP32_GENERIC');
        assert.equal(catalog[1].firmwareFlashOffset, null);
    });

    it('returns [] for a non-2 schemaVersion', async () => {
        const catalog = await loadBoardCatalog({
            fetchImpl: async () => okJson({ schemaVersion: 1, boards: VALID_BOARDS }),
        });
        assert.deepEqual(catalog, []);
    });

    it('skips malformed entries individually', async () => {
        const catalog = await loadBoardCatalog({
            fetchImpl: async () =>
                okJson({
                    schemaVersion: 2,
                    boards: [VALID_BOARDS[0], { name: 'broken' }, null],
                }),
        });
        assert.equal(catalog.length, 1);
        assert.equal(catalog[0].name, 'ESP32_GENERIC');
    });

    it('returns [] for a non-ok response', async () => {
        const catalog = await loadBoardCatalog({
            fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
        });
        assert.deepEqual(catalog, []);
    });

    it('returns [] for a thrown fetch error', async () => {
        const catalog = await loadBoardCatalog({
            fetchImpl: async () => {
                throw new TypeError('network');
            },
        });
        assert.deepEqual(catalog, []);
    });
});

describe('findBoard / normalizeBoardSelector', () => {
    it('lowercases a selector', () => {
        assert.equal(normalizeBoardSelector('ESP32_GENERIC_S3'), 'esp32_generic_s3');
    });

    it('matches by name or slug', () => {
        assert.equal(findBoard(NORMALIZED_BOARDS, 'ESP32_GENERIC').name, 'ESP32_GENERIC');
        assert.equal(findBoard(NORMALIZED_BOARDS, 'esp32_generic_s3').name, 'ESP32_GENERIC_S3');
        assert.equal(findBoard(NORMALIZED_BOARDS, 'nope'), null);
        assert.equal(findBoard(NORMALIZED_BOARDS, ''), null);
    });
});

describe('findBoardForCompileTarget', () => {
    it('matches a board by canonical name', () => {
        const board = findBoardForCompileTarget(NORMALIZED_BOARDS, {
            board: 'ESP32_GENERIC_S3',
            port: 'esp32',
        });
        assert.equal(board.name, 'ESP32_GENERIC_S3');
    });

    it('returns null for an ambiguous or absent mapping', () => {
        assert.equal(findBoardForCompileTarget(NORMALIZED_BOARDS, null), null);
        // Both boards share port "esp32", so an unknown board name is ambiguous.
        assert.equal(
            findBoardForCompileTarget(NORMALIZED_BOARDS, { board: 'unknown', port: 'esp32' }),
            null
        );
        assert.equal(findBoardForCompileTarget(NORMALIZED_BOARDS, { board: 'x', port: 'y' }), null);
    });
});
