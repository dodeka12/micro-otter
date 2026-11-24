/**
 * Unit tests for MenuView checkbox functionality
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { MenuView } from '../../src/micro_otter/nodes/html/js/views/menu-view.js';

describe('MenuView - Checkbox Support', () => {
    let dom, document, container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        document = dom.window.document;
        global.document = document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
        global.cancelAnimationFrame = (id) => clearTimeout(id);

        container = document.createElement('div');
        container.style.width = '1024px';
        container.style.height = '768px';
        document.body.appendChild(container);
    });

    afterEach(async () => {
        // Wait for any pending setTimeout callbacks to complete
        await new Promise((resolve) => setTimeout(resolve, 10));

        if (global.document) {
            global.document = undefined;
        }
        if (global.window) {
            global.window = undefined;
        }
        if (global.HTMLElement) {
            global.HTMLElement = undefined;
        }
    });

    it('should render menu item with checked checkbox', () => {
        const items = [
            { id: 'option1', label: 'Option 1', checked: true },
            { id: 'option2', label: 'Option 2', checked: false },
        ];

        const menu = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        menu.attachTo(container);

        const menuItems = container.querySelectorAll('.menu__item');
        assert.strictEqual(menuItems.length, 2, 'Should render two menu items');

        // Check first item (checked)
        const checkbox1 = menuItems[0].querySelector('.menu__checkbox');
        assert.ok(checkbox1, 'First item should have checkbox element');
        assert.strictEqual(checkbox1.textContent, '☑', 'First checkbox should show checked');

        // Check second item (unchecked)
        const checkbox2 = menuItems[1].querySelector('.menu__checkbox');
        assert.ok(checkbox2, 'Second item should have checkbox element');
        assert.strictEqual(checkbox2.textContent, '☐', 'Second checkbox should show unchecked');

        menu.detach();
    });

    it('should render menu item without checkbox when checked is undefined', () => {
        const items = [
            { id: 'option1', label: 'Option 1' },
            { id: 'option2', label: 'Option 2', checked: true },
        ];

        const menu = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        menu.attachTo(container);

        const menuItems = container.querySelectorAll('.menu__item');
        assert.strictEqual(menuItems.length, 2, 'Should render two menu items');

        // Check first item (no checkbox)
        const checkbox1 = menuItems[0].querySelector('.menu__checkbox');
        assert.strictEqual(checkbox1, null, 'First item should not have checkbox');

        // Check second item (has checkbox)
        const checkbox2 = menuItems[1].querySelector('.menu__checkbox');
        assert.ok(checkbox2, 'Second item should have checkbox element');

        menu.detach();
    });

    it('should render checkbox before icon when both are present', () => {
        const items = [{ id: 'option1', label: 'Option 1', checked: true, icon: '📄' }];

        const menu = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        menu.attachTo(container);

        const menuItem = container.querySelector('.menu__item');
        assert.ok(menuItem, 'Menu item should exist');

        const checkbox = menuItem.querySelector('.menu__checkbox');
        const icon = menuItem.querySelector('.menu__icon');
        const label = menuItem.querySelector('.menu__label');

        assert.ok(checkbox, 'Checkbox should exist');
        assert.ok(icon, 'Icon should exist');
        assert.ok(label, 'Label should exist');

        // Verify order: checkbox, icon, label
        const children = Array.from(menuItem.children);
        const checkboxIndex = children.indexOf(checkbox);
        const iconIndex = children.indexOf(icon);
        const labelIndex = children.indexOf(label);

        assert.ok(checkboxIndex < iconIndex, 'Checkbox should appear before icon');
        assert.ok(iconIndex < labelIndex, 'Icon should appear before label');

        menu.detach();
    });

    it('should handle checkbox with shortcut', () => {
        const items = [{ id: 'option1', label: 'Option 1', checked: true, shortcut: 'Ctrl+1' }];

        const menu = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        menu.attachTo(container);

        const menuItem = container.querySelector('.menu__item');
        const checkbox = menuItem.querySelector('.menu__checkbox');
        const shortcut = menuItem.querySelector('.menu__shortcut');

        assert.ok(checkbox, 'Checkbox should exist');
        assert.ok(shortcut, 'Shortcut should exist');
        assert.strictEqual(shortcut.textContent, 'Ctrl+1', 'Shortcut should match');

        menu.detach();
    });

    it('should handle checkbox with separator', () => {
        const items = [
            { id: 'option1', label: 'Option 1', checked: true },
            { type: 'separator' },
            { id: 'option2', label: 'Option 2', checked: false },
        ];

        const menu = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        menu.attachTo(container);

        const menuItems = container.querySelectorAll('.menu__item');
        const separator = container.querySelector('.menu__separator');

        assert.strictEqual(menuItems.length, 2, 'Should render two menu items');
        assert.ok(separator, 'Separator should exist');

        // Check checkboxes still render on both sides of separator
        const checkbox1 = menuItems[0].querySelector('.menu__checkbox');
        const checkbox2 = menuItems[1].querySelector('.menu__checkbox');

        assert.ok(checkbox1, 'First item should have checkbox');
        assert.ok(checkbox2, 'Second item should have checkbox');

        menu.detach();
    });

    it('should handle disabled item with checkbox', () => {
        const items = [{ id: 'option1', label: 'Option 1', checked: true, disabled: true }];

        const menu = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        menu.attachTo(container);

        const menuItem = container.querySelector('.menu__item');
        const checkbox = menuItem.querySelector('.menu__checkbox');

        assert.ok(checkbox, 'Checkbox should exist');
        assert.ok(
            menuItem.classList.contains('menu__item--disabled'),
            'Item should have disabled class'
        );
        assert.strictEqual(
            menuItem.getAttribute('aria-disabled'),
            'true',
            'Item should have aria-disabled'
        );

        menu.detach();
    });

    it('should trigger onSelect callback when checkbox item is clicked', () => {
        let selectedItem = null;
        const items = [{ id: 'option1', label: 'Option 1', checked: true }];

        const menu = new MenuView({
            items,
            position: { x: 0, y: 0 },
            onSelect: (item) => {
                selectedItem = item;
            },
        });

        menu.attachTo(container);

        const menuItem = container.querySelector('.menu__item');
        menuItem.click();

        assert.ok(selectedItem, 'Callback should be triggered');
        assert.strictEqual(selectedItem.id, 'option1', 'Selected item ID should match');
        assert.strictEqual(selectedItem.checked, true, 'Selected item checked state should match');
    });

    it('should handle multiple items with mixed checkbox states', () => {
        const items = [
            { id: 'opt1', label: 'Option 1', checked: true },
            { id: 'opt2', label: 'Option 2' },
            { id: 'opt3', label: 'Option 3', checked: false },
            { id: 'opt4', label: 'Option 4', icon: '📄' },
            { id: 'opt5', label: 'Option 5', checked: true, icon: '🔧' },
        ];

        const menu = new MenuView({
            items,
            position: { x: 0, y: 0 },
        });

        menu.attachTo(container);

        const menuItems = container.querySelectorAll('.menu__item');
        assert.strictEqual(menuItems.length, 5, 'Should render five menu items');

        // Verify checkbox states
        const checkbox1 = menuItems[0].querySelector('.menu__checkbox');
        const checkbox2 = menuItems[1].querySelector('.menu__checkbox');
        const checkbox3 = menuItems[2].querySelector('.menu__checkbox');
        const checkbox4 = menuItems[3].querySelector('.menu__checkbox');
        const checkbox5 = menuItems[4].querySelector('.menu__checkbox');

        assert.ok(checkbox1, 'Item 1 should have checkbox');
        assert.strictEqual(checkbox1.textContent, '☑', 'Item 1 should be checked');

        assert.strictEqual(checkbox2, null, 'Item 2 should not have checkbox');

        assert.ok(checkbox3, 'Item 3 should have checkbox');
        assert.strictEqual(checkbox3.textContent, '☐', 'Item 3 should be unchecked');

        assert.strictEqual(checkbox4, null, 'Item 4 should not have checkbox');

        assert.ok(checkbox5, 'Item 5 should have checkbox');
        assert.strictEqual(checkbox5.textContent, '☑', 'Item 5 should be checked');

        menu.detach();
    });
});
