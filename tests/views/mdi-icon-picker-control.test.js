import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { MdiIconPickerControl } from '../../src/micro_otter/nodes/html/js/views/controls/mdi-icon-picker-control.js';
import { resetMdiIconIndexCache } from '../../src/micro_otter/nodes/html/js/data/mdi-icons.js';

/**
 * Minimal MDI index standing in for the generated `vendor/mdi/icon-index.json`.
 */
const ICON_INDEX_FIXTURE = {
    version: '7.4.47',
    icons: {
        lightbulb: 'F0335',
        thermometer: 'F050F',
        'thermometer-lines': 'F10A2',
    },
    aliases: {
        temperature: 'thermometer',
    },
};

/** Glyph of `lightbulb` in the vendored webfont. */
const LIGHTBULB_GLYPH = String.fromCodePoint(0xf0335);

/** Translation stub: returns the rendered English string for the picker keys. */
const I18N = {
    /**
     * Resolve one picker string.
     * @param {string} key - Locale key.
     * @param {object} params - Interpolation parameters.
     * @returns {string} The rendered string, or the key when unknown.
     */
    t(key, params = {}) {
        const strings = {
            'controls.iconPicker.hint': 'Type to filter, e.g. thermometer',
            'controls.iconPicker.loading': 'Loading icons…',
            'controls.iconPicker.unavailable': 'Icon list unavailable — type the name',
            'controls.iconPicker.noMatches': `No icons match "${params.query}"`,
            'controls.iconPicker.count': `${params.shown} of ${params.total} icons`,
            'controls.iconPicker.clear': 'Clear',
            'controls.iconPicker.showMore': `Show ${params.count} more`,
            'controls.iconPicker.unknown': `Not in bundled MDI ${params.version}`,
        };
        return strings[key] ?? key;
    },
};

/**
 * Wait for the lazily loaded icon index to settle.
 * @returns {Promise<void>} Resolves on the next macrotask.
 */
function flushPendingLoads() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Build an index with `count` alphabetically ordered icons, for the paging tests.
 * @param {number} count - Number of icons.
 * @returns {object} Index payload accepted by `loadMdiIconIndex`.
 */
function buildLargeIndex(count) {
    const icons = {};
    for (let index = 0; index < count; index += 1) {
        const name = `icon-${String(index).padStart(3, '0')}`;
        icons[name] = (0xf0000 + index).toString(16).toUpperCase();
    }

    return { version: '7.4.47', icons, aliases: {} };
}

describe('MdiIconPickerControl', () => {
    let harness;
    let originalFetch;
    let picks;

    beforeEach(() => {
        harness = createDomHarness();
        resetMdiIconIndexCache();
        picks = [];
        originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, json: async () => ICON_INDEX_FIXTURE });
    });

    afterEach(async () => {
        for (const picker of picks) {
            picker.control.detach();
        }
        await flushPendingLoads();
        globalThis.fetch = originalFetch;
        resetMdiIconIndexCache();
        harness.cleanup();
    });

    /**
     * Render one picker into a fresh container and collect its parts.
     * @param {object} options - Constructor options plus an optional `onChange`.
     * @returns {object} Control, container, field, popover and recorded changes.
     */
    function createPicker(options = {}) {
        const changes = [];
        const container = document.createElement('div');
        document.body.appendChild(container);

        const control = new MdiIconPickerControl({
            i18nService: I18N,
            ...options,
            onChange: (value) => {
                changes.push(value);
                if (typeof options.onChange === 'function') {
                    options.onChange(value);
                }
            },
        });
        control.attachTo(container);
        picks.push({ control });

        const input = container.querySelector('.mdi-icon-picker__input');
        const popover =
            options.portal === 'inline'
                ? container.querySelector('.icon-control__popover')
                : document.body.querySelector('.mdi-icon-picker__popover');

        return { control, container, input, popover, changes };
    }

    /**
     * Focus the field and wait for the index, which is the picker's open gesture.
     * @param {object} picker - Control returned by `createPicker`.
     * @returns {Promise<object>} The same picker.
     */
    async function openPicker(picker) {
        picker.input.focus();
        await flushPendingLoads();
        return picker;
    }

    /**
     * Tiles currently rendered in the popover.
     * @param {object} picker - Control returned by `createPicker`.
     * @returns {HTMLButtonElement[]} Rendered tiles.
     */
    function tilesOf(picker) {
        return [...picker.popover.querySelectorAll('.icon-control__tile')];
    }

    /**
     * Dispatch a keydown through the picker's field.
     * @param {object} picker - Control returned by `createPicker`.
     * @param {string} key - Value of `KeyboardEvent.key`.
     */
    function pressKey(picker, key) {
        picker.input.dispatchEvent(
            new harness.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        );
    }

    it('renders a labelled field and portals the popover to the body by default', () => {
        const picker = createPicker({ label: 'Icon', value: 'mdi:lightbulb' });
        const root = picker.container.querySelector('.mdi-icon-picker');
        const label = root.querySelector('.mdi-icon-picker__label');

        assert.ok(root.classList.contains('icon-control'), 'the root reuses the icon-control host');
        assert.equal(label.textContent, 'Icon');
        assert.equal(picker.input.value, 'mdi:lightbulb');
        assert.equal(picker.input.placeholder, 'Type to filter, e.g. thermometer');
        assert.equal(picker.input.getAttribute('aria-labelledby'), label.id);
        assert.equal(picker.input.getAttribute('aria-expanded'), 'false');
        assert.equal(picker.popover.parentElement, document.body);
        assert.equal(root.contains(picker.popover), false);
        assert.equal(picker.popover.hidden, true);
    });

    it('keeps the popover inside the wrapper for the inline portal', () => {
        const picker = createPicker({ portal: 'inline' });
        const root = picker.container.querySelector('.mdi-icon-picker');

        assert.equal(picker.popover.parentElement, root);
        assert.equal(document.body.querySelectorAll('.mdi-icon-picker__popover').length, 1);
    });

    it('opens on focus, loads the index lazily and paints one tile per icon', async () => {
        let fetchCount = 0;
        globalThis.fetch = async () => {
            fetchCount += 1;
            return { ok: true, json: async () => ICON_INDEX_FIXTURE };
        };

        const picker = createPicker();
        assert.equal(fetchCount, 0, 'the index is not requested before the picker opens');

        picker.input.focus();

        assert.equal(picker.popover.hidden, false);
        assert.equal(picker.input.getAttribute('aria-expanded'), 'true');
        assert.equal(
            picker.popover.querySelector('.icon-control__status').textContent,
            'Loading icons…'
        );

        await flushPendingLoads();

        assert.equal(fetchCount, 1);
        const tiles = tilesOf(picker);
        assert.equal(tiles.length, 3);
        assert.equal(tiles[0].dataset.iconName, 'lightbulb');
        assert.equal(tiles[0].querySelector('.icon-control__glyph').textContent, LIGHTBULB_GLYPH);
        assert.equal(
            picker.popover.querySelector('.icon-control__status').textContent,
            '3 of 3 icons'
        );
    });

    it('narrows the grid while typing and formats a tile click as mdi:<name>', async () => {
        const picker = await openPicker(createPicker());

        picker.input.value = 'therm';
        picker.input.dispatchEvent(new harness.window.Event('input', { bubbles: true }));

        assert.deepEqual(
            tilesOf(picker).map((tile) => tile.dataset.iconName),
            ['thermometer', 'thermometer-lines']
        );
        assert.equal(
            picker.popover.querySelector('.icon-control__status').textContent,
            '2 of 2 icons'
        );

        tilesOf(picker)
            .find((tile) => tile.dataset.iconName === 'thermometer')
            .click();

        assert.equal(picker.input.value, 'mdi:thermometer');
        assert.equal(picker.control.getValue(), 'mdi:thermometer');
        assert.deepEqual(picker.changes, ['mdi:thermometer']);
        assert.equal(picker.popover.hidden, false, 'a tile click keeps the picker open');
        assert.equal(
            tilesOf(picker)
                .find((tile) => tile.dataset.iconName === 'thermometer')
                .getAttribute('aria-selected'),
            'true'
        );
    });

    it('pages through the remaining hits with Show more', async () => {
        globalThis.fetch = async () => ({ ok: true, json: async () => buildLargeIndex(305) });
        const picker = await openPicker(createPicker());

        assert.equal(tilesOf(picker).length, 300);

        const more = picker.popover.querySelector('.icon-control__more');
        assert.equal(more.hidden, false);
        assert.equal(more.textContent, 'Show 5 more');

        more.click();

        assert.equal(tilesOf(picker).length, 305);
        assert.equal(more.hidden, true);
        assert.equal(
            picker.popover.querySelector('.icon-control__status').textContent,
            '305 of 305 icons'
        );
    });

    it('clears the value through the footer without closing the popover', async () => {
        const picker = await openPicker(createPicker({ value: 'mdi:thermometer' }));
        const clear = picker.popover.querySelector('.icon-control__clear');

        assert.equal(clear.hidden, false);
        clear.click();

        assert.equal(picker.input.value, '');
        assert.equal(picker.control.getValue(), '');
        assert.deepEqual(picker.changes, ['']);
        assert.equal(clear.hidden, true);
        assert.equal(picker.popover.hidden, false);
    });

    it('navigates with the arrow keys, commits with Enter and closes with Escape', async () => {
        const picker = await openPicker(createPicker());

        pressKey(picker, 'ArrowDown');

        assert.equal(tilesOf(picker)[1].tabIndex, 0, 'the second tile owns the roving tabindex');

        pressKey(picker, 'Enter');

        assert.equal(picker.input.value, 'mdi:thermometer');
        assert.deepEqual(picker.changes, ['mdi:thermometer']);
        assert.equal(picker.popover.hidden, true);

        picker.input.blur();
        picker.input.focus();
        assert.equal(picker.popover.hidden, false);

        pressKey(picker, 'Escape');
        assert.equal(picker.popover.hidden, true);
        assert.equal(picker.input.getAttribute('aria-expanded'), 'false');
    });

    it('commits free text on blur and keeps foreign icon sets unchanged', async () => {
        const picker = await openPicker(createPicker());

        picker.input.value = 'ph:house';
        picker.input.blur();

        assert.equal(picker.control.getValue(), 'ph:house');
        assert.deepEqual(picker.changes, ['ph:house']);
        assert.equal(picker.popover.hidden, true);
    });

    it('degrades to a plain text field when the index cannot be loaded', async () => {
        globalThis.fetch = async () => {
            throw new Error('offline');
        };

        const picker = await openPicker(createPicker({ value: 'mdi:thermometer' }));

        assert.equal(
            picker.popover.querySelector('.icon-control__status').textContent,
            'Icon list unavailable — type the name'
        );
        assert.equal(tilesOf(picker).length, 0);
        assert.equal(picker.input.disabled, false, 'the field stays editable');

        picker.input.value = 'mdi:unknown';
        picker.input.blur();
        assert.equal(picker.control.getValue(), 'mdi:unknown');
    });

    it('reflects setValue and refuses to open while disabled', async () => {
        const picker = createPicker();
        const root = picker.container.querySelector('.mdi-icon-picker');

        picker.control.setValue('mdi:lightbulb');
        assert.equal(picker.input.value, 'mdi:lightbulb');

        picker.control.setDisabled(true);
        assert.equal(picker.input.disabled, true);
        assert.ok(root.classList.contains('mdi-icon-picker--disabled'));

        picker.control.open();
        assert.equal(picker.popover.hidden, true);

        picker.control.setDisabled(false);
        assert.equal(picker.input.disabled, false);
        assert.equal(root.classList.contains('mdi-icon-picker--disabled'), false);
    });

    it('closes on a click outside the field and the popover', async () => {
        const picker = await openPicker(createPicker());

        document.body.dispatchEvent(
            new harness.window.MouseEvent('click', { bubbles: true, cancelable: true })
        );

        assert.equal(picker.popover.hidden, true);
    });

    it('removes the portalled popover and its listeners on detach', async () => {
        const picker = await openPicker(createPicker());
        const popover = picker.popover;

        picker.control.detach();

        assert.equal(popover.parentElement, null);
        assert.equal(document.body.querySelectorAll('.mdi-icon-picker__popover').length, 0);

        document.body.dispatchEvent(
            new harness.window.MouseEvent('click', { bubbles: true, cancelable: true })
        );
        assert.equal(popover.hidden, true, 'no listener survives the detach');
    });

    it('paints the selected icon as a glyph preview inside the field', async () => {
        const picker = createPicker({ value: 'mdi:thermometer' });
        const preview = picker.container.querySelector('.mdi-icon-picker__preview');

        assert.ok(preview, 'the field has a glyph preview');
        assert.equal(preview.hidden, true, 'no glyph is shown before the index loads');

        picker.input.focus();
        await flushPendingLoads();

        assert.equal(preview.hidden, false);
        assert.equal(preview.textContent, String.fromCodePoint(0xf050f));
    });

    it('anchors the body popover to the field instead of the top of the viewport', async () => {
        const hadInnerWidth = Object.prototype.hasOwnProperty.call(globalThis, 'innerWidth');
        const hadInnerHeight = Object.prototype.hasOwnProperty.call(globalThis, 'innerHeight');
        const previousWidth = globalThis.innerWidth;
        const previousHeight = globalThis.innerHeight;
        globalThis.innerWidth = 800;
        globalThis.innerHeight = 600;

        try {
            const picker = createPicker({ value: 'mdi:thermometer' });
            const root = picker.container.querySelector('.mdi-icon-picker');

            picker.input.getBoundingClientRect = () => ({
                top: 200,
                bottom: 232,
                left: 100,
                right: 260,
                width: 160,
                height: 32,
            });
            root.getBoundingClientRect = () => ({
                top: 200,
                bottom: 232,
                left: 0,
                right: 200,
                width: 200,
                height: 32,
            });

            picker.input.focus();
            await flushPendingLoads();

            assert.equal(picker.popover.style.position, 'fixed');
            assert.equal(picker.popover.style.left, '100px');
            assert.equal(picker.popover.style.top, '236px');
        } finally {
            if (hadInnerWidth) {
                globalThis.innerWidth = previousWidth;
            } else {
                delete globalThis.innerWidth;
            }
            if (hadInnerHeight) {
                globalThis.innerHeight = previousHeight;
            } else {
                delete globalThis.innerHeight;
            }
        }
    });
});
