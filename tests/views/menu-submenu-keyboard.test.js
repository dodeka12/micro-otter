// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Keyboard and accessibility behaviour of nested menus: arrow keys walk `menuview` rows,
 * `ArrowRight` opens a child, `ArrowLeft` returns to the owning row and `Escape` unwinds the stack.
 *
 * JSDOM reports zero rectangles and has no layout, so these tests cover the selection model, the
 * focus contract and the ARIA state. Pixel placement is covered by `overlay-position.test.js`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { MenuView } from '../../src/micro_otter/nodes/html/js/views/menu-view.js';
import { MenuWindow } from '../../src/micro_otter/nodes/html/js/views/menu-window.js';

describe('MenuView - submenu keyboard navigation', () => {
    let harness;
    let document;
    let layer;

    beforeEach(() => {
        harness = createDomHarness();
        document = harness.document;

        layer = document.createElement('div');
        layer.className = 'overlay-layer';
        // JSDOM has no layout: stub the host bounds OverlayWindow clamps against.
        Object.defineProperty(layer, 'clientWidth', { value: 1024, configurable: true });
        Object.defineProperty(layer, 'clientHeight', { value: 768, configurable: true });
        document.body.appendChild(layer);
    });

    afterEach(() => {
        harness.cleanup();
    });

    /**
     * Dispatch a `keydown` event on `target`; the menu listens on `document` in the capture phase.
     * @param {string} key - Value for `KeyboardEvent.key`.
     * @param {EventTarget} [target] - Event target, defaults to `document.body`.
     * @returns {KeyboardEvent} The dispatched event.
     */
    function press(key, target = document.body) {
        const event = new harness.window.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        target.dispatchEvent(event);
        return event;
    }

    /**
     * Row element of an entry id, searching the parent and any open child menu.
     * @param {string} id - Entry id.
     * @returns {HTMLElement|null} The rendered row.
     */
    function row(id) {
        return layer.querySelector(`[data-item-id="${id}"]`);
    }

    /**
     * All overlay windows currently in the layer, in DOM order.
     * @returns {HTMLElement[]} Overlay window elements.
     */
    function overlays() {
        return Array.from(layer.querySelectorAll('.overlay-window'));
    }

    /**
     * The parent menu element (child menus are sibling overlays).
     * @returns {HTMLElement} Menu element of the parent window.
     */
    function parentMenuElement() {
        return overlays()[0].querySelector('.menu');
    }

    /**
     * Id of the row that currently carries the visual selection of `menuElement`.
     * @param {HTMLElement} menuElement - Menu element to inspect.
     * @returns {string|null} Selected item id, or null when nothing is selected.
     */
    function selectedId(menuElement) {
        const selected = menuElement.querySelector('.menu__item--selected');
        return selected instanceof HTMLElement ? selected.dataset.itemId : null;
    }

    /**
     * Attach a parent menu window with two submenus, one action row above and below them and a
     * leading separator (so `Home`/`End` have something to skip).
     * @param {object} [options] - Options.
     * @param {Function} [options.onSelect] - Selection callback of the parent window.
     * @param {string} [options.groupATitle] - Title (translation key) of the first child menu.
     * @param {object} [options.i18nService] - I18n service for the first child menu.
     * @returns {object} Parent window, its menu and the child menus.
     */
    function buildParentWindow({
        onSelect = null,
        groupATitle = 'Graph',
        i18nService = null,
    } = {}) {
        const groupA = new MenuView({
            title: groupATitle,
            i18nService,
            items: [
                { id: 'child-a', label: 'Child A' },
                { id: 'child-b', label: 'Child B' },
            ],
        });
        const groupB = new MenuView({
            title: 'Data',
            items: [{ id: 'child-c', label: 'Child C' }],
        });
        const menu = new MenuView({
            items: [
                { type: 'separator' },
                { id: 'plain', label: 'Plain' },
                { type: 'menuview', id: 'group-a', label: 'Group A', menu: groupA },
                { type: 'menuview', id: 'group-b', label: 'Group B', menu: groupB },
                { id: 'last', label: 'Last' },
            ],
        });

        const window_ = new MenuWindow({ menu, onSelect, x: 10, y: 10 });
        window_.attachTo(layer);

        return { window: window_, menu, groupA, groupB };
    }

    it('walks the selection over menuview rows without emitting a selection', () => {
        const selectedIds = [];
        const { window: parentWindow } = buildParentWindow({
            onSelect: (item) => selectedIds.push(item.id),
        });

        assert.equal(selectedId(parentMenuElement()), 'plain', 'the first row is selected');

        press('ArrowDown');
        assert.equal(
            selectedId(parentMenuElement()),
            'group-a',
            'ArrowDown lands on a menuview row instead of skipping it'
        );
        assert.equal(row('group-a').getAttribute('aria-selected'), 'true');

        press('ArrowDown');
        assert.equal(selectedId(parentMenuElement()), 'group-b', 'the second menuview row follows');

        press('ArrowUp');
        assert.equal(
            selectedId(parentMenuElement()),
            'group-a',
            'ArrowUp returns to the group row'
        );

        press('End');
        assert.equal(selectedId(parentMenuElement()), 'last', 'End skips the separator');

        press('Home');
        assert.equal(selectedId(parentMenuElement()), 'plain', 'Home skips the separator');

        assert.deepEqual(selectedIds, [], 'moving the selection never selects an item');

        parentWindow.close();
    });

    it('opens the child on ArrowRight and moves the focus into it', () => {
        const { window: parentWindow } = buildParentWindow();

        press('ArrowDown');
        press('ArrowRight');

        const windows = overlays();
        assert.equal(windows.length, 2, 'the child opened as a sibling overlay');

        const childMenuElement = windows[1].querySelector('.menu');
        assert.equal(row('group-a').getAttribute('aria-expanded'), 'true');
        assert.equal(
            document.activeElement,
            childMenuElement.querySelector('[data-item-id="child-a"]'),
            'the first selectable child row holds the focus'
        );
        assert.equal(
            selectedId(childMenuElement),
            'child-a',
            'the child row is selected as well as focused'
        );

        parentWindow.close();
    });

    it('moves the focus into an already open child on a second ArrowRight', () => {
        const { window: parentWindow } = buildParentWindow();

        press('ArrowDown');
        press('ArrowRight');

        const childMenuElement = overlays()[1].querySelector('.menu');
        childMenuElement.querySelector('[data-item-id="child-b"]').focus();

        press('ArrowRight', row('group-a'));

        assert.equal(overlays().length, 2, 'no second child window was created');
        assert.equal(
            document.activeElement,
            childMenuElement.querySelector('[data-item-id="child-a"]'),
            'ArrowRight always ends with the focus inside the child'
        );

        parentWindow.close();
    });

    it('does not open a child on ArrowRight for an action row', () => {
        const { window: parentWindow } = buildParentWindow();

        press('Home');
        press('ArrowRight');

        assert.equal(overlays().length, 1, 'no child window was created');
        assert.equal(
            parentMenuElement().querySelector('[aria-expanded="true"]'),
            null,
            'no row claims an open child'
        );

        parentWindow.close();
    });

    it('closes the open child when ArrowRight lands on an action row', () => {
        const { window: parentWindow } = buildParentWindow();

        press('ArrowDown');
        press('ArrowRight');
        assert.equal(overlays().length, 2);

        press('ArrowDown', row('group-a'));
        assert.equal(selectedId(parentMenuElement()), 'group-b', 'the owning row moved on');

        press('ArrowDown', row('group-b'));
        assert.equal(selectedId(parentMenuElement()), 'last', 'the selection is on an action row');

        press('ArrowRight', row('last'));

        assert.equal(overlays().length, 1, 'the child of the previous row is closed');
        assert.equal(row('group-a').getAttribute('aria-expanded'), 'false');

        parentWindow.close();
    });

    it('opens the child on Enter instead of selecting the owning row', () => {
        const selectedIds = [];
        const { window: parentWindow } = buildParentWindow({
            onSelect: (item) => selectedIds.push(item.id),
        });

        press('ArrowDown');
        press('Enter');

        assert.equal(overlays().length, 2, 'Enter opened the child');
        assert.equal(row('group-a').getAttribute('aria-expanded'), 'true');
        assert.deepEqual(selectedIds, [], 'onSelect was not called for a menuview row');
        assert.equal(parentWindow.menu.isAttached, true, 'the parent menu stays open');

        parentWindow.close();
    });

    it('opens the child on Space instead of selecting the owning row', () => {
        const selectedIds = [];
        const { window: parentWindow } = buildParentWindow({
            onSelect: (item) => selectedIds.push(item.id),
        });

        press('ArrowDown');
        press(' ');

        assert.equal(overlays().length, 2, 'Space opened the child');
        assert.deepEqual(selectedIds, [], 'onSelect was not called for a menuview row');

        parentWindow.close();
    });

    it('selects and closes on Enter on an action row', () => {
        const selectedIds = [];
        buildParentWindow({ onSelect: (item) => selectedIds.push(item.id) });

        press('Home');
        press('Enter');

        assert.deepEqual(selectedIds, ['plain'], 'Enter still selects an action row');
        assert.equal(overlays().length, 0, 'the menu closed');
    });

    it('returns to the owning row on ArrowLeft inside the child', () => {
        const { window: parentWindow } = buildParentWindow();

        press('ArrowDown');
        press('ArrowRight');

        const childRow = row('child-b');
        childRow.focus();

        press('ArrowLeft', childRow);

        assert.equal(overlays().length, 1, 'the child window closed');
        assert.equal(parentWindow.menu.isAttached, true, 'the parent menu stays open');

        const groupRow = row('group-a');
        assert.equal(document.activeElement, groupRow, 'the focus returned to the owning row');
        assert.equal(groupRow.getAttribute('aria-expanded'), 'false');
        assert.equal(groupRow.getAttribute('aria-selected'), 'true');
        assert.ok(groupRow.classList.contains('menu__item--selected'));

        parentWindow.close();
    });

    it('ignores ArrowLeft on the root menu', () => {
        const { window: parentWindow } = buildParentWindow();

        const event = press('ArrowLeft');

        assert.equal(event.defaultPrevented, false, 'the root menu does not consume ArrowLeft');
        assert.equal(overlays().length, 1, 'the root menu stays open');
        assert.equal(parentWindow.menu.isAttached, true);

        parentWindow.close();
    });

    it('closes both levels on Escape inside the child', () => {
        const selectedIds = [];
        const { window: parentWindow } = buildParentWindow({
            onSelect: (item) => selectedIds.push(item.id),
        });

        press('ArrowDown');
        press('ArrowRight');
        assert.equal(overlays().length, 2);

        press('Escape', row('child-a'));

        assert.equal(overlays().length, 0, 'no overlay window is left');
        assert.deepEqual(selectedIds, [], 'onSelect was never called');
        assert.equal(parentWindow.menu.isAttached, false);

        parentWindow.close();
    });

    it('closes only the root menu on Escape there', () => {
        const { window: parentWindow } = buildParentWindow();

        press('Escape');

        assert.equal(overlays().length, 0, 'the root menu closed');
        assert.equal(parentWindow.menu.isAttached, false);

        parentWindow.close();
    });

    it('exposes haspopup, expanded and menu roles on both levels', () => {
        const { window: parentWindow } = buildParentWindow({
            groupATitle: 'menu.group.graph',
            i18nService: {
                t: (key) => (key === 'menu.group.graph' ? 'Graph' : key),
            },
        });

        for (const id of ['group-a', 'group-b']) {
            const groupRow = row(id);
            assert.equal(groupRow.getAttribute('role'), 'menuitem');
            assert.equal(groupRow.getAttribute('aria-haspopup'), 'menu');
            assert.equal(groupRow.getAttribute('aria-expanded'), 'false');
            assert.equal(groupRow.getAttribute('tabindex'), '0');
        }

        const rootMenuElement = parentMenuElement();
        assert.equal(rootMenuElement.getAttribute('role'), 'menu');

        press('ArrowDown');
        press('ArrowRight');

        assert.equal(row('group-a').getAttribute('aria-expanded'), 'true');
        assert.equal(row('group-b').getAttribute('aria-expanded'), 'false');

        const childMenuElement = overlays()[1].querySelector('.menu');
        assert.equal(childMenuElement.getAttribute('role'), 'menu');
        assert.equal(
            childMenuElement.getAttribute('aria-label'),
            'Graph',
            'the child announces its translated title'
        );

        parentWindow.close();
    });
});
