// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

const ICON_PROVIDER_PATH = path.resolve('src/micro_otter/nodes/html/js/views/icon-provider.ts');
const ICONS_DIR = path.resolve('src/micro_otter/nodes/html/icons');

/** Every SVG file name the registry mentions, in first-seen order. */
function registeredFiles() {
    const source = readFileSync(ICON_PROVIDER_PATH, 'utf8');
    const matches = source.matchAll(/'([a-z0-9_]+\.svg)'/g);
    return [...new Set([...matches].map((match) => match[1]))];
}

describe('IconProvider app icon assets', () => {
    it('registers at least one icon and points every key at an existing file', () => {
        const files = registeredFiles();
        assert.ok(files.length > 0, 'ICON_REGISTRY must register SVG files');
        for (const file of files) {
            assert.ok(existsSync(path.join(ICONS_DIR, file)), `missing icon asset ${file}`);
        }
    });

    it('ships every app icon normalized to the theme glyph colour', () => {
        for (const file of registeredFiles()) {
            const svg = readFileSync(path.join(ICONS_DIR, file), 'utf8');
            assert.match(svg, /<svg\b/, `${file} must be an SVG document`);
            assert.match(svg, /#e3e3e3/i, `${file} must declare the #e3e3e3 glyph fill`);
        }
    });

    it('resolves the firmware glyph keys added for the compact toolbars and badges', () => {
        const expected = {
            refresh: 'refresh_24dp.svg',
            reload: 'reload_24dp.svg',
            deleteImage: 'delete_image_24dp.svg',
            trayArrowUp: 'tray_arrow_up_24dp.svg',
            checkboxMultipleMarked: 'checkbox_multiple_marked_24dp.svg',
            checkboxMultipleBlankOutline: 'checkbox_multiple_blank_outline_24dp.svg',
            filterMinusOutline: 'filter_minus_outline_24dp.svg',
            filterList: 'filter_list_24dp.svg',
            arrowUpBold: 'arrow_up_bold_24dp.svg',
            formatSize: 'format_size_24dp.svg',
            newBox: 'new_box_24dp.svg',
            moonFull: 'moon_full_24dp.svg',
            circleHalfFull: 'circle_half_full_24dp.svg',
            progressQuestion: 'progress_question_24dp.svg',
            plusCircleOutline: 'plus_circle_outline_24dp.svg',
            check: 'check_24dp.svg',
            deployedCode: 'deployed_code_24dp.svg',
        };

        for (const [key, file] of Object.entries(expected)) {
            assert.equal(IconProvider.has(key), true, `${key} must be registered`);
            assert.equal(
                IconProvider.get(key).startsWith('data:image/svg+xml;base64,'),
                true,
                `${key} must answer an inlined SVG data URI`
            );
            assert.equal(IconProvider.getPath(key), `/html/icons/${file}`);
        }
    });

    it('resolves the cloud_off glyph the server-offline badge uses', () => {
        assert.equal(IconProvider.has('cloudOff'), true, 'cloudOff must be registered');
        assert.equal(
            IconProvider.cloudOff.startsWith('data:image/svg+xml;base64,'),
            true,
            'cloudOff must answer an inlined SVG data URI, so the badge renders during an outage'
        );
        assert.equal(IconProvider.getPath('cloudOff'), '/html/icons/cloud_off_24dp.svg');
        assert.equal(IconProvider.has('cloudDownload'), true, 'the cloud family stays registered');
    });

    it('inlines the exact bytes of the registered SVG file', () => {
        const encoded = IconProvider.get('add').split(',')[1];
        assert.equal(encoded.length > 0, true, 'the inlined URI must carry a base64 payload');
        assert.deepEqual(
            Buffer.from(encoded, 'base64'),
            readFileSync(path.join(ICONS_DIR, 'add_24dp.svg'))
        );
    });

    it('keeps the PNG/ICO brand images URL based', () => {
        for (const key of ['otterHead64Png', 'otterHead64Ico', 'otterHeadPng']) {
            assert.equal(
                IconProvider.get(key).startsWith('/html/icons/'),
                true,
                `${key} must stay a served URL`
            );
            assert.equal(IconProvider.get(key), IconProvider.getPath(key));
        }
    });

    it('applies a custom base path to getPath() but never to an inlined URI', () => {
        const inlined = IconProvider.get('add');
        IconProvider.setBasePath('/custom/icons');
        try {
            assert.equal(IconProvider.getPath('add'), '/custom/icons/add_24dp.svg');
            assert.equal(IconProvider.get('add'), inlined);
            assert.equal(IconProvider.get('otterHead64Png'), '/custom/icons/micro-otter-head-64px.png');
        } finally {
            IconProvider.setBasePath('/html/icons');
        }
    });
});

describe('IconProvider image-source classification', () => {
    it('classifies the values get() and getPath() answer as images', () => {
        assert.equal(IconProvider.isImageSource(IconProvider.get('add')), true);
        assert.equal(IconProvider.isImageSource(IconProvider.getPath('add')), true);
        assert.equal(IconProvider.isImageSource(IconProvider.get('otterHead64Png')), true);
    });

    it('classifies other URI and path forms as images', () => {
        const values = [
            'data:image/png;base64,iVBORw0KGgo=',
            'https://example.test/icons/add.svg',
            '//cdn.example.test/icons/add.svg',
            'blob:http://localhost/9f8e7d',
            'icons/add_24dp.svg',
            './icons/add_24dp.svg',
            '../icons/add_24dp.svg',
            '/html/icons/add_24dp.svg?v=2#glyph',
            'micro-otter-head-64px.ICO',
        ];
        for (const value of values) {
            assert.equal(IconProvider.isImageSource(value), true, `${value} must be an image`);
        }
    });

    it('keeps text and emoji glyphs out of the image branch', () => {
        const values = ['+', '🌙', 'info', '', '   ', '1.5 kg', 'not-a-path'];
        for (const value of values) {
            assert.equal(IconProvider.isImageSource(value), false, `${value} must stay text`);
        }
        assert.equal(IconProvider.isImageSource(undefined), false);
    });
});

