// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file NodeTypeUi icon classification: semantic `mdi:` values paint a webfont glyph,
 * registered names paint an image, and foreign/unknown values degrade without an `<img>`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import NodeTypeUi from '../../src/micro_otter/nodes/html/js/nodes/node-type-ui.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';
import { resetMdiIconIndexCache } from '../../src/micro_otter/nodes/html/js/data/mdi-icons.js';

const ICON_INDEX_FIXTURE = {
    version: '7.4.47',
    icons: {
        function: 'F0204',
        thermometer: 'F050F',
    },
    aliases: {},
};

/** Glyph of `thermometer` in the vendored webfont. */
const THERMOMETER_GLYPH = String.fromCodePoint(0xf050f);

/**
 * Wait for the lazily loaded MDI index to settle.
 * @returns {Promise<void>} Resolves on the next macrotask.
 */
function flushPendingLoads() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('NodeTypeUi icon classification', () => {
    let harness;
    let originalFetch;

    beforeEach(() => {
        harness = createDomHarness();
        resetMdiIconIndexCache();
        originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, json: async () => ICON_INDEX_FIXTURE });
    });

    afterEach(async () => {
        await flushPendingLoads();
        globalThis.fetch = originalFetch;
        resetMdiIconIndexCache();
        harness.cleanup();
    });

    /**
     * Render one palette card and return its NodeTypeUi instance.
     * @param {object} nodeType - Palette node type payload.
     * @returns {NodeTypeUi} The rendered card.
     */
    function createCard(nodeType) {
        const ui = new NodeTypeUi(nodeType, 'small', { iconProvider: null });
        ui.render();
        return ui;
    }

    it('renders a registered icon name as an image', () => {
        const ui = createCard({ id: 'core.foo', icon: 'codeGenerator' });
        const img = ui.iconElement.querySelector('.node-type-ui__icon-img');

        assert.ok(img, 'the icon renders as an image');
        assert.equal(img.getAttribute('src'), IconProvider.codeGenerator);

        ui.destroy();
    });

    it('renders an mdi value as a webfont glyph once the index loads', async () => {
        const ui = createCard({ id: 'function_graph.fn-1', icon: 'mdi:thermometer' });
        const glyph = ui.iconElement.querySelector('.node-type-ui__icon-glyph');

        assert.ok(glyph, 'the icon renders as a glyph span');
        assert.equal(glyph.textContent, '');

        await flushPendingLoads();

        assert.equal(glyph.textContent, THERMOMETER_GLYPH);

        ui.destroy();
    });

    it('renders a foreign icon set value as text', () => {
        const ui = createCard({ id: 'core.foo', icon: 'ph:house' });
        const glyph = ui.iconElement.querySelector('.node-type-ui__icon-glyph');

        assert.ok(glyph, 'the icon renders as a glyph span');
        assert.equal(glyph.textContent, 'ph:house');

        ui.destroy();
    });

    it('falls back to the placeholder for an unknown mdi value', async () => {
        const ui = createCard({ id: 'function_graph.fn-1', icon: 'mdi:does-not-exist' });

        await flushPendingLoads();

        assert.equal(ui.iconElement.querySelector('.node-type-ui__icon-glyph'), null);
        assert.ok(ui.iconElement.querySelector('.node-type-ui__icon-fallback'));

        ui.destroy();
    });

    it('renders the fallback when the node type has no icon', () => {
        const ui = createCard({ id: 'core.foo' });

        assert.ok(ui.iconElement.querySelector('.node-type-ui__icon-fallback'));

        ui.destroy();
    });
});
