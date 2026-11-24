// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Integration tests for nested menus: a `MenuWindow` whose `menuview` row opens a child
 * `MenuWindow` in the same overlay layer.
 *
 * JSDOM reports zero rectangles and has no layout, so these tests cover structure, lifecycle and
 * event wiring. The pixel placement of the child is covered by `tests/views/overlay-position.test.js`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { MenuView } from '../../src/micro_otter/nodes/html/js/views/menu-view.js';
import { MenuWindow } from '../../src/micro_otter/nodes/html/js/views/menu-window.js';

/**
 * Resolve after `ms` milliseconds, giving deferred listeners and hover timers a chance to run.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Promise resolved after the delay.
 */
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MenuWindow - nested child menus', () => {
    let harness;
    let document;
    let layer;
    let container;

    beforeEach(() => {
        harness = createDomHarness();
        document = harness.document;

        layer = document.createElement('div');
        layer.className = 'overlay-layer';
        // JSDOM has no layout: stub the host bounds OverlayWindow clamps against.
        Object.defineProperty(layer, 'clientWidth', { value: 1024, configurable: true });
        Object.defineProperty(layer, 'clientHeight', { value: 768, configurable: true });
        document.body.appendChild(layer);

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        harness.cleanup();
    });

    /**
     * Row element of an entry id, searching both the parent and any open child menu.
     * @param {string} id - Entry id.
     * @returns {HTMLElement} The rendered row.
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
     * Attach a parent menu window with two `menuview` groups and one plain action row.
     * @param {object} [options] - Options.
     * @param {Function} [options.onSelect] - Selection callback of the parent window.
     * @returns {object} Created parent window and its entry menus.
     */
    function buildParentWindow({ onSelect = null } = {}) {
        const groupA = new MenuView({
            title: 'Graph',
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
                { id: 'plain', label: 'Plain' },
                { type: 'menuview', id: 'group-a', label: 'Group A', menu: groupA },
                { type: 'menuview', id: 'group-b', label: 'Group B', menu: groupB },
            ],
        });

        const window_ = new MenuWindow({ menu, onSelect, x: 10, y: 10 });
        window_.attachTo(layer);

        return { window: window_, menu, groupA, groupB };
    }

    it('opens the child as a sibling overlay inside the same layer', () => {
        const { window: parentWindow } = buildParentWindow();

        assert.equal(overlays().length, 1, 'only the parent window exists initially');

        row('group-a').click();

        const windows = overlays();
        assert.equal(windows.length, 2, 'child window was appended to the layer');
        assert.equal(layer.contains(windows[1]), true, 'child lives in the same overlay layer');

        const childMenuElement = windows[1].querySelector('.menu');
        assert.equal(childMenuElement.getAttribute('aria-label'), 'Graph');
        assert.ok(
            childMenuElement.querySelector('[data-item-id="child-a"]'),
            'child rows rendered'
        );
        assert.equal(
            layer.querySelectorAll('.menu').length,
            2,
            'child menu is not nested in the parent'
        );

        const groupRow = row('group-a');
        assert.equal(groupRow.getAttribute('aria-expanded'), 'true');
        assert.ok(groupRow.classList.contains('menu__item--selected'), 'owning row stays selected');

        parentWindow.close();
    });

    it('bubbles a child selection to the parent callback exactly once and closes the stack', () => {
        const selected = [];
        const { window: parentWindow } = buildParentWindow({
            onSelect: (item) => selected.push(item.id),
        });

        row('group-a').click();
        layer.querySelector('[data-item-id="child-a"]').click();

        assert.deepEqual(selected, ['child-a'], 'parent callback fired once with the child item');
        assert.equal(overlays().length, 0, 'parent and child windows are both removed');
        assert.equal(parentWindow.menu.isAttached, false);
    });

    it('closes the child when the parent window closes', () => {
        const { window: parentWindow } = buildParentWindow();

        row('group-a').click();
        assert.equal(overlays().length, 2);

        parentWindow.close();

        assert.equal(overlays().length, 0, 'no overlay window may be orphaned');
    });

    it('resets aria-expanded after the child closes and re-opens it on the next click', async () => {
        const { window: parentWindow } = buildParentWindow();

        row('group-a').click();
        assert.equal(row('group-a').getAttribute('aria-expanded'), 'true');

        // Wait for the child's deferred click-away listener, then press in the parent menu.
        await wait(5);
        row('plain').dispatchEvent(new harness.window.MouseEvent('mousedown', { bubbles: true }));

        assert.equal(overlays().length, 1, 'the child window is gone');
        assert.equal(row('group-a').getAttribute('aria-expanded'), 'false');

        row('group-a').click();
        assert.equal(overlays().length, 2, 'the row re-opens the child instead of being stuck');
        assert.equal(row('group-a').getAttribute('aria-expanded'), 'true');

        parentWindow.close();
    });

    it('closes the first child before the second one opens on hover', async () => {
        const { window: parentWindow } = buildParentWindow();

        row('group-a').click();
        assert.equal(overlays().length, 2);

        row('group-b').dispatchEvent(new harness.window.MouseEvent('mouseenter'));
        await wait(160);

        const windows = overlays();
        assert.equal(windows.length, 2, 'exactly one child window is open');
        assert.equal(windows[1].querySelector('.menu').getAttribute('aria-label'), 'Data');
        assert.equal(layer.querySelector('[data-item-id="child-a"]'), null, 'first child is gone');
        assert.equal(row('group-a').getAttribute('aria-expanded'), 'false');
        assert.equal(row('group-b').getAttribute('aria-expanded'), 'true');

        parentWindow.close();
    });

    it('keeps the parent open for a mousedown inside the child and closes both outside', async () => {
        const { window: parentWindow } = buildParentWindow();

        row('group-a').click();
        await wait(5);

        row('child-a').dispatchEvent(new harness.window.MouseEvent('mousedown', { bubbles: true }));
        assert.equal(overlays().length, 2, 'click-away inside the child spares the parent');
        assert.equal(parentWindow.menu.isAttached, true);

        document.body.dispatchEvent(new harness.window.MouseEvent('mousedown', { bubbles: true }));
        assert.equal(overlays().length, 0, 'click-away outside both closes the whole stack');
    });

    it('renders menuview rows disabled when no opener is registered', () => {
        const bareMenu = new MenuView({
            items: [
                {
                    type: 'menuview',
                    id: 'group-a',
                    label: 'Group A',
                    menu: new MenuView({ items: [{ id: 'child-a', label: 'Child A' }] }),
                },
            ],
        });
        bareMenu.attachTo(container);

        const groupRow = container.querySelector('.menu__item--submenu');
        assert.ok(
            groupRow.classList.contains('menu__item--disabled'),
            'row is inert without an opener'
        );
        assert.equal(groupRow.getAttribute('aria-disabled'), 'true');
        assert.equal(groupRow.getAttribute('tabindex'), '-1');

        groupRow.click();

        assert.equal(bareMenu.isAttached, true, 'clicking an inert row detaches nothing');
        assert.equal(container.querySelectorAll('.menu').length, 1, 'no child menu was created');

        bareMenu.detach();
    });
});
