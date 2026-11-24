// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Rendering tests for `MenuView` entries of kind `menuview` (nested menus).
 *
 * Pixel-accurate geometry is JSDOM-blind: `getBoundingClientRect()` returns zeros there, so the
 * placement of a child menu is covered by the position-math tests in
 * `tests/views/overlay-position.test.js` and by the manual browser check described in
 * `docs/dev/view-system/menu-system.md`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDomHarness } from '../helpers/dom-harness.js';
import { MenuView } from '../../src/micro_otter/nodes/html/js/views/menu-view.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MENU_CSS = path.resolve(HERE, '../../src/micro_otter/nodes/html/styles/standard/menu.css');

function createChildMenu(items) {
    return new MenuView({
        title: 'menu.group.test',
        items,
        position: { x: 0, y: 0 },
    });
}

describe('MenuView - menuview entry rendering', () => {
    let harness;
    let document;
    let container;

    beforeEach(() => {
        harness = createDomHarness();
        document = harness.document;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        harness.cleanup();
    });

    it('renders one submenu row with a chevron and no rows of the child menu', () => {
        const childMenu = createChildMenu([
            { id: 'child-a', label: 'Child A' },
            { id: 'child-b', label: 'Child B' },
        ]);
        const menu = new MenuView({
            items: [{ type: 'menuview', id: 'group-a', label: 'Group A', menu: childMenu }],
            position: { x: 10, y: 10 },
        });

        menu.attachTo(container);

        const rows = container.querySelectorAll('.menu__item');
        assert.equal(rows.length, 1, 'only the group row is rendered');
        const row = rows[0];
        assert.ok(row.classList.contains('menu__item--submenu'), 'row carries the submenu class');
        assert.equal(row.dataset.itemId, 'group-a');

        const arrow = row.querySelector('.menu__submenu-arrow');
        assert.ok(arrow, 'submenu row has a chevron');
        assert.equal(arrow.textContent, '▸');
        assert.equal(arrow.getAttribute('aria-hidden'), 'true');

        assert.equal(container.querySelectorAll('.menu').length, 1, 'child menu is not nested in the parent');
        assert.equal(container.querySelector('[data-item-id="child-a"]'), null, 'child rows are not rendered');

        menu.detach();
    });

    it('marks a submenu row as a collapsed popup menu', () => {
        const menu = new MenuView({
            items: [
                { type: 'menuview', id: 'group-a', label: 'Group A', menu: createChildMenu([]) },
            ],
            position: { x: 10, y: 10 },
        });

        menu.attachTo(container);

        const row = container.querySelector('.menu__item--submenu');
        assert.equal(row.getAttribute('role'), 'menuitem');
        assert.equal(row.getAttribute('aria-haspopup'), 'menu');
        assert.equal(row.getAttribute('aria-expanded'), 'false');

        menu.detach();
    });

    it('does not draw a chevron on action rows', () => {
        const menu = new MenuView({
            items: [{ id: 'plain', label: 'Plain' }],
            position: { x: 10, y: 10 },
        });

        menu.attachTo(container);

        const row = container.querySelector('.menu__item');
        assert.equal(row.querySelector('.menu__submenu-arrow'), null);
        assert.equal(row.getAttribute('aria-haspopup'), null);
        assert.equal(row.classList.contains('menu__item--submenu'), false);

        menu.detach();
    });

    it('renders an entry without a type as a plain action row', () => {
        const menu = new MenuView({
            items: [{ id: 'plain', label: 'Plain' }],
            position: { x: 10, y: 10 },
        });

        menu.attachTo(container);

        const rows = container.querySelectorAll('.menu__item');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].classList.contains('menu__item--submenu'), false);
        assert.equal(rows[0].querySelector('.menu__label').textContent, 'Plain');

        menu.detach();
    });

    it('keeps the declared order of action, separator and submenu entries', () => {
        const menu = new MenuView({
            items: [
                { id: 'first', label: 'First' },
                { type: 'separator' },
                { type: 'menuview', id: 'group', label: 'Group', menu: createChildMenu([]) },
                { id: 'last', label: 'Last' },
            ],
            position: { x: 10, y: 10 },
        });

        menu.attachTo(container);

        const menuElement = container.querySelector('.menu');
        const shape = Array.from(menuElement.children).map((element) =>
            element.classList.contains('menu__separator') ? 'separator' : element.dataset.itemId
        );
        assert.deepEqual(shape, ['first', 'separator', 'group', 'last']);
        assert.equal(container.querySelectorAll('.menu__item').length, 3);
        assert.equal(container.querySelectorAll('.menu__separator').length, 1);

        menu.detach();
    });

    it('renders a disabled submenu row as disabled', () => {
        const menu = new MenuView({
            items: [
                {
                    type: 'menuview',
                    id: 'group',
                    label: 'Group',
                    disabled: true,
                    menu: createChildMenu([]),
                },
            ],
            position: { x: 10, y: 10 },
        });

        menu.attachTo(container);

        const row = container.querySelector('.menu__item--submenu');
        assert.ok(row.classList.contains('menu__item--disabled'));
        assert.equal(row.getAttribute('aria-disabled'), 'true');
        assert.equal(row.getAttribute('tabindex'), '-1');

        menu.detach();
    });

    it('does not select a submenu row and does not close the menu on click', () => {
        const selected = [];
        const menu = new MenuView({
            items: [{ type: 'menuview', id: 'group', label: 'Group', menu: createChildMenu([]) }],
            position: { x: 10, y: 10 },
            onSelect: (item) => selected.push(item.id),
        });

        menu.attachTo(container);
        container.querySelector('.menu__item--submenu').click();

        assert.deepEqual(selected, [], 'onSelect is not called for a group row');
        assert.equal(menu.isAttached, true, 'the menu stays open');

        menu.detach();
    });

    it('returns numeric preferred dimensions and tolerates an empty item list', () => {
        const menu = new MenuView({
            items: [
                { id: 'first', label: 'First' },
                { type: 'menuview', id: 'group', label: 'Group', menu: createChildMenu([]) },
            ],
            position: { x: 10, y: 10 },
        });

        const size = menu.getPreferredSize();
        assert.equal(typeof size.width, 'number');
        assert.equal(typeof size.height, 'number');

        const emptySize = new MenuView({ items: [] }).getPreferredSize();
        assert.equal(typeof emptySize.width, 'number');
        assert.equal(typeof emptySize.height, 'number');
    });

    it('applies the title option as aria-label and defaults to Menu', () => {
        const labelled = new MenuView({
            title: 'menu.group.database',
            items: [{ id: 'first', label: 'First' }],
            position: { x: 10, y: 10 },
        });
        labelled.attachTo(container);
        assert.equal(
            container.querySelector('.menu').getAttribute('aria-label'),
            'menu.group.database'
        );
        labelled.detach();
        container.replaceChildren();

        const unlabelled = new MenuView({
            items: [{ id: 'first', label: 'First' }],
            position: { x: 10, y: 10 },
        });
        unlabelled.attachTo(container);
        assert.equal(container.querySelector('.menu').getAttribute('aria-label'), 'Menu');
        unlabelled.detach();
    });

    it('still wraps ArrowDown onto the first action row', () => {
        const menu = new MenuView({
            items: [
                { id: 'first', label: 'First' },
                { type: 'menuview', id: 'group', label: 'Group', menu: createChildMenu([]) },
            ],
            position: { x: 10, y: 10 },
        });

        menu.attachTo(container);

        const menuElement = container.querySelector('.menu');
        document.dispatchEvent(
            new harness.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
        );

        const selectedRow = menuElement.querySelector('.menu__item--selected');
        assert.equal(selectedRow.dataset.itemId, 'first');
        assert.equal(
            menuElement
                .querySelector('.menu__item--submenu')
                .classList.contains('menu__item--selected'),
            false
        );

        menu.detach();
    });
});

describe('MenuView - submenu stylesheet', () => {
    it('defines the chevron and the expanded-row rule', () => {
        const css = fs.readFileSync(MENU_CSS, 'utf8');
        assert.match(css, /\.menu__submenu-arrow\s*\{/);
        assert.match(css, /\[aria-expanded=['"]true['"]\]/);
    });
});
