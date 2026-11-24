// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for DropdownControl component
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up JSDOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.EventTarget = dom.window.EventTarget;
global.CustomEvent = dom.window.CustomEvent;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.Node = dom.window.Node;
global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};
// Mock requestAnimationFrame for Node.js test environment
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

import { DropdownControl } from '../../src/micro_otter/nodes/html/js/views/controls/dropdown-control.js';

describe('DropdownControl', () => {
    let container;
    let dropdown;
    let mockI18nService;
    let testOptions;

    beforeEach(() => {
        // Create container for each test
        container = document.createElement('div');
        document.body.appendChild(container);

        // Mock i18n service
        mockI18nService = {
            currentLocale: 'en',
            t: (key, _params = {}) => {
                // Simple mock that returns the key
                if (key.includes('filter.all')) return 'All messages';
                if (key.includes('info')) return 'Info';
                if (key.includes('error')) return 'Error';
                return key;
            },
            addEventListener: () => {},
            removeEventListener: () => {},
        };

        // Standard test options
        testOptions = [
            { value: 'all', label: 'filter.all', icon: 'filter_list', badge: '(42)' },
            { value: 'info', label: 'filter.info', icon: 'info', badge: '(10)' },
            { value: 'error', label: 'filter.error', icon: 'error', badge: '(5)' },
            { value: 'warning', label: 'filter.warning', icon: 'warning', badge: '(3)', disabled: true },
        ];
    });

    afterEach(() => {
        if (dropdown && dropdown.isAttached) {
            dropdown.detach();
        }
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        // Clean up any dropdown menu elements left in document.body (portal pattern)
        const menus = document.body.querySelectorAll('.dropdown-control__menu');
        menus.forEach(menu => menu.remove());
    });

    describe('Constructor', () => {
        it('should create instance with default options', () => {
            dropdown = new DropdownControl({
                i18nService: mockI18nService,
            });

            assert.ok(dropdown instanceof DropdownControl);
            assert.strictEqual(dropdown._multiSelect, false);
            assert.strictEqual(dropdown._showIcons, true);
            assert.strictEqual(dropdown._isOpen, false);
        });

        it('should accept custom configuration', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                multiSelect: true,
                showIcons: false,
                placeholder: 'Custom Placeholder',
                buttonClassName: 'custom-button',
                menuClassName: 'custom-menu',
                i18nService: mockI18nService,
            });

            // When multiSelect is true, value is normalized to array
            assert.deepStrictEqual(dropdown._value, ['info']);
            assert.strictEqual(dropdown._multiSelect, true);
            assert.strictEqual(dropdown._showIcons, false);
            assert.strictEqual(dropdown._placeholder, 'Custom Placeholder');
            assert.strictEqual(dropdown._buttonClassName, 'custom-button');
            assert.strictEqual(dropdown._menuClassName, 'custom-menu');
        });
    });

    describe('Rendering', () => {
        it('should render dropdown structure with button and menu', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const root = container.querySelector('.dropdown-control');
            assert.ok(root, 'Root element should exist');

            const button = root.querySelector('.dropdown-control__button');
            assert.ok(button, 'Button should exist');

            // Menu is appended to document.body (portal pattern), not to root
            const menu = document.body.querySelector('.dropdown-control__menu');
            assert.ok(menu, 'Menu should exist');
            assert.strictEqual(menu.hidden, true, 'Menu should be hidden initially');
        });

        it('should render button with selected option label', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const label = container.querySelector('.dropdown-control__button-label');
            assert.ok(label, 'Button label should exist');
            assert.strictEqual(label.textContent, 'Info');
        });

        it('should render a title label to the left when a label is given', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                label: 'filter.title',
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const root = container.querySelector('.dropdown-control');
            assert.ok(root.classList.contains('dropdown-control--labeled'), 'the root carries the labeled modifier');
            const title = root.querySelector('.dropdown-control__label');
            assert.ok(title, 'Title label should exist');
            assert.strictEqual(title.textContent, 'filter.title');
            assert.ok(
                root.firstElementChild === title,
                'the title label precedes the trigger button'
            );
        });

        it('should expose both labels as titles for a width-capped host', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const label = container.querySelector('.dropdown-control__button-label');
            assert.strictEqual(label.title, 'Info', 'the trigger label must carry the full text');

            const optionLabel = document.body.querySelector('.dropdown-control__option-label');
            assert.ok(optionLabel, 'Option label should exist');
            assert.strictEqual(optionLabel.title, 'All messages', 'every option label must carry its text');
        });

        it('should render button with placeholder when no selection', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: null,
                placeholder: 'Select option',
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const label = container.querySelector('.dropdown-control__button-label');
            assert.strictEqual(label.textContent, 'Select option');
        });

        it('should render button with icon when showIcons is true', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                showIcons: true,
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const icon = container.querySelector('.dropdown-control__button-icon');
            assert.ok(icon, 'Button icon should exist');
        });

        it('should not render button icon when showIcons is false', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                showIcons: false,
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const icon = container.querySelector('.dropdown-control__button-icon');
            assert.strictEqual(icon, null, 'Button icon should not exist');
        });

        it('should render button with badge', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const badge = container.querySelector('.dropdown-control__button-badge');
            assert.ok(badge, 'Button badge should exist');
            assert.strictEqual(badge.textContent, '(10)');
        });

        it('should render all menu options', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            // Menu is in document.body (portal pattern)
            const options = document.body.querySelectorAll('.dropdown-control__option');
            assert.strictEqual(options.length, testOptions.length);
        });

        it('should mark selected option with aria-selected', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            // Menu is in document.body (portal pattern)
            const selectedOption = document.body.querySelector('[data-value="info"]');
            assert.strictEqual(selectedOption.getAttribute('aria-selected'), 'true');
        });

        it('should mark disabled option with aria-disabled', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            // Menu is in document.body (portal pattern)
            const disabledOption = document.body.querySelector('[data-value="warning"]');
            assert.strictEqual(disabledOption.getAttribute('aria-disabled'), 'true');
            assert.ok(disabledOption.classList.contains('dropdown-control__option--disabled'));
        });

        it('should apply custom CSS classes', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                buttonClassName: 'my-custom-button',
                menuClassName: 'my-custom-menu',
                i18nService: mockI18nService,
            });

            dropdown.render(container);

            const button = container.querySelector('.dropdown-control__button');
            assert.ok(button.classList.contains('my-custom-button'));

            // Menu is in document.body (portal pattern)
            const menu = document.body.querySelector('.dropdown-control__menu');
            assert.ok(menu.classList.contains('my-custom-menu'));
        });
    });

    describe('setValue()', () => {
        beforeEach(() => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                i18nService: mockI18nService,
            });
            dropdown.render(container);
        });

        it('should update selected value', () => {
            dropdown.setValue('info');
            assert.strictEqual(dropdown._value, 'info');
        });

        it('should update button display', () => {
            dropdown.setValue('error');
            
            const label = container.querySelector('.dropdown-control__button-label');
            assert.strictEqual(label.textContent, 'Error');
        });

        it('should update button badge', () => {
            dropdown.setValue('error');
            
            const badge = container.querySelector('.dropdown-control__button-badge');
            assert.strictEqual(badge.textContent, '(5)');
        });
    });

    describe('setOptions()', () => {
        beforeEach(() => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                i18nService: mockI18nService,
            });
            dropdown.render(container);
        });

        it('should replace all options', () => {
            const newOptions = [
                { value: 'opt1', label: 'Option 1' },
                { value: 'opt2', label: 'Option 2' },
            ];

            dropdown.setOptions(newOptions);

            // Menu is in document.body (portal pattern)
            const options = document.body.querySelectorAll('.dropdown-control__option');
            assert.strictEqual(options.length, 2);
        });

        it('should re-render menu with new options', () => {
            const newOptions = [
                { value: 'new1', label: 'New Option 1' },
            ];

            dropdown.setOptions(newOptions);

            // Menu is in document.body (portal pattern)
            const option = document.body.querySelector('[data-value="new1"]');
            assert.ok(option, 'New option should exist in DOM');
        });
    });

    describe('updateOption()', () => {
        beforeEach(() => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                i18nService: mockI18nService,
            });
            dropdown.render(container);
        });

        it('should update option badge in memory', () => {
            dropdown.updateOption('info', { badge: '(99)' });

            const option = dropdown._options.find(opt => opt.value === 'info');
            assert.strictEqual(option.badge, '(99)');
        });

        it('should update option badge in DOM', () => {
            dropdown.updateOption('info', { badge: '(99)' });

            // Menu is in document.body (portal pattern)
            const optionElement = document.body.querySelector('[data-value="info"]');
            const badge = optionElement.querySelector('.dropdown-control__option-badge');
            assert.strictEqual(badge.textContent, '(99)');
        });

        it('should update button display when updating selected option', () => {
            dropdown.setValue('info');
            dropdown.updateOption('info', { badge: '(77)' });

            const buttonBadge = container.querySelector('.dropdown-control__button-badge');
            assert.strictEqual(buttonBadge.textContent, '(77)');
        });
    });

    describe('updateBadges()', () => {
        beforeEach(() => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                i18nService: mockI18nService,
            });
            dropdown.render(container);
        });

        it('should update multiple badges at once', () => {
            dropdown.updateBadges({
                'all': '(100)',
                'info': '(50)',
                'error': '(25)',
            });

            const option1 = dropdown._options.find(opt => opt.value === 'all');
            const option2 = dropdown._options.find(opt => opt.value === 'info');
            const option3 = dropdown._options.find(opt => opt.value === 'error');

            assert.strictEqual(option1.badge, '(100)');
            assert.strictEqual(option2.badge, '(50)');
            assert.strictEqual(option3.badge, '(25)');
        });
    });

    describe('getSelectedValue()', () => {
        it('should return current selected value', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'info',
                i18nService: mockI18nService,
            });

            assert.strictEqual(dropdown.getSelectedValue(), 'info');
        });

        it('should return null when no selection', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: null,
                i18nService: mockI18nService,
            });

            assert.strictEqual(dropdown.getSelectedValue(), null);
        });
    });

    describe('open() and close()', () => {
        beforeEach(() => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);
        });

        it('should open dropdown menu', () => {
            dropdown.open();

            assert.strictEqual(dropdown._isOpen, true);
            
            // Menu is in document.body (portal pattern)
            const menu = document.body.querySelector('.dropdown-control__menu');
            assert.strictEqual(menu.hidden, false);
            
            const button = container.querySelector('.dropdown-control__button');
            assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
        });

        it('should close dropdown menu', () => {
            dropdown.open();
            dropdown.close();

            assert.strictEqual(dropdown._isOpen, false);
            
            // Menu is in document.body (portal pattern)
            const menu = document.body.querySelector('.dropdown-control__menu');
            assert.strictEqual(menu.hidden, true);
            
            const button = container.querySelector('.dropdown-control__button');
            assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
        });

        it('should keep aria-expanded in sync when the value changes while open', () => {
            dropdown.open();

            dropdown.setValue('info');

            const button = container.querySelector('.dropdown-control__button');
            assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
        });
    });

    describe('Option Selection', () => {
        let onChangeCalled;
        let onChangeValue;

        beforeEach(() => {
            onChangeCalled = false;
            onChangeValue = null;

            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                onChange: (value) => {
                    onChangeCalled = true;
                    onChangeValue = value;
                },
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);
        });

        it('should call onChange callback when option selected', () => {
            dropdown._selectOption('info');

            assert.strictEqual(onChangeCalled, true);
            assert.strictEqual(onChangeValue, 'info');
        });

        it('should not select disabled option', () => {
            dropdown._selectOption('warning');

            // Value should not change (warning is disabled)
            assert.strictEqual(dropdown._value, 'all');
            assert.strictEqual(onChangeCalled, false);
        });

        it('should close menu after selection in single-select mode', () => {
            dropdown.open();
            dropdown._selectOption('info');

            assert.strictEqual(dropdown._isOpen, false);
        });

        it('should keep menu open after selection in multi-select mode', () => {
            dropdown._multiSelect = true;
            dropdown.open();
            dropdown._selectOption('info');

            assert.strictEqual(dropdown._isOpen, true);
        });
    });

    describe('Keyboard Handling', () => {
        beforeEach(() => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);
        });

        it('should close menu on Escape key', () => {
            dropdown.open();

            const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
            document.dispatchEvent(event);

            assert.strictEqual(dropdown._isOpen, false);
        });

        it('should not close menu when closed on Escape key', () => {
            // Menu is already closed
            const event = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(event);

            // Should not throw or cause issues
            assert.strictEqual(dropdown._isOpen, false);
        });
    });

    describe('Click Outside Handling', () => {
        beforeEach(() => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);
        });

        it('should close menu when clicking outside', () => {
            dropdown.open();

            // Create and dispatch click event on document body
            const event = new MouseEvent('click', { bubbles: true, cancelable: true });
            document.body.dispatchEvent(event);

            assert.strictEqual(dropdown._isOpen, false);
        });

        it('should not close menu when clicking inside dropdown', () => {
            dropdown.open();

            // Menu is in document.body (portal pattern)
            const menu = document.body.querySelector('.dropdown-control__menu');
            const event = new MouseEvent('click', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'target', { value: menu, enumerable: true });

            // The click-outside handler checks if the click is inside _rootElement
            // So clicking the menu should not close it
            menu.dispatchEvent(event);

            assert.strictEqual(dropdown._isOpen, true);
        });
    });

    describe('Tooltips', () => {
        it('uses the control description for the trigger and its label', () => {
            dropdown = new DropdownControl({
                options: [{ value: 'py', label: 'Py' }],
                value: 'py',
                description: 'Plain MicroPython',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            const label = container.querySelector('.dropdown-control__button-label');
            const button = container.querySelector('button');
            assert.strictEqual(label.title, 'Plain MicroPython');
            assert.strictEqual(button.title, 'Plain MicroPython');
        });

        it('falls back to the selected label without a control description', () => {
            dropdown = new DropdownControl({
                options: [{ value: 'py', label: 'Py' }],
                value: 'py',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            const label = container.querySelector('.dropdown-control__button-label');
            const button = container.querySelector('button');
            assert.strictEqual(label.title, 'Py');
            assert.strictEqual(button.title, 'Py');
        });

        it('uses an option description for its row tooltip', () => {
            dropdown = new DropdownControl({
                options: [{ value: 'py', label: 'Py', description: 'Plain MicroPython' }],
                value: 'py',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);
            dropdown.open();

            const optionLabel = document.body.querySelector('.dropdown-control__option-label');
            assert.strictEqual(optionLabel.title, 'Plain MicroPython');
        });

        it('keeps the label text as the option tooltip without a description', () => {
            dropdown = new DropdownControl({
                options: [{ value: 'py', label: 'Py' }],
                value: 'py',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);
            dropdown.open();

            const optionLabel = document.body.querySelector('.dropdown-control__option-label');
            assert.strictEqual(optionLabel.title, 'Py');
        });

        it('keeps the trigger description after setOptions rebuilds the button', () => {
            dropdown = new DropdownControl({
                options: [{ value: 'py', label: 'Py' }],
                value: 'py',
                description: 'Plain MicroPython',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            dropdown.setOptions([{ value: 'py', label: 'Py', description: 'Plain MicroPython' }]);

            const label = container.querySelector('.dropdown-control__button-label');
            assert.strictEqual(label.title, 'Plain MicroPython');
        });
    });

    describe('Label', () => {
        it('renders no title without a label option', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            assert.equal(container.querySelector('.dropdown-control__label'), null);
            assert.equal(
                container.querySelector('.dropdown-control--labeled'),
                null,
                'the labeled modifier must stay off'
            );
            assert.equal(
                container
                    .querySelector('.dropdown-control__button')
                    .hasAttribute('aria-labelledby'),
                false
            );
        });

        it('renders the translated title before the trigger and associates it', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                label: 'settings.graph.signals.label',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            const root = container.querySelector('.dropdown-control');
            const label = container.querySelectorAll('.dropdown-control__label');
            const button = container.querySelector('.dropdown-control__button');

            assert.ok(root.classList.contains('dropdown-control--labeled'));
            assert.equal(label.length, 1);
            assert.equal(label[0].textContent, 'settings.graph.signals.label');
            assert.strictEqual(button.previousElementSibling, label[0]);
            assert.equal(button.getAttribute('aria-labelledby'), label[0].id);
        });

        it('replaces the title in place after render', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                label: 'Signals',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            const labelBefore = container.querySelector('.dropdown-control__label');
            dropdown.setLabel('Sensors');

            const labelAfter = container.querySelector('.dropdown-control__label');
            const button = container.querySelector('.dropdown-control__button');

            assert.strictEqual(labelAfter, labelBefore);
            assert.equal(labelAfter.textContent, 'Sensors');
            assert.strictEqual(button.previousElementSibling, labelAfter);
            assert.ok(
                container
                    .querySelector('.dropdown-control')
                    .classList.contains('dropdown-control--labeled')
            );
            assert.equal(button.getAttribute('aria-labelledby'), labelAfter.id);
        });

        it('removes the title, modifier and association when cleared', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                label: 'Signals',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            const buttonBefore = container.querySelector('.dropdown-control__button');
            const menuBefore = document.body.querySelector('.dropdown-control__menu');

            dropdown.setLabel('');

            assert.equal(container.querySelector('.dropdown-control__label'), null);
            assert.equal(
                container
                    .querySelector('.dropdown-control')
                    .classList.contains('dropdown-control--labeled'),
                false
            );
            assert.strictEqual(container.querySelector('.dropdown-control__button'), buttonBefore);
            assert.equal(buttonBefore.hasAttribute('aria-labelledby'), false);
            assert.strictEqual(document.body.querySelector('.dropdown-control__menu'), menuBefore);
            assert.equal(menuBefore.hidden, true);
        });

        it('inserts a title first when the control had none', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            const buttonBefore = container.querySelector('.dropdown-control__button');

            dropdown.setLabel('Signals');

            const label = container.querySelector('.dropdown-control__label');
            const root = container.querySelector('.dropdown-control');
            assert.ok(label);
            assert.equal(label.textContent, 'Signals');
            assert.strictEqual(root.firstElementChild, label);
            assert.ok(root.classList.contains('dropdown-control--labeled'));
            assert.strictEqual(container.querySelector('.dropdown-control__button'), buttonBefore);
            assert.equal(buttonBefore.getAttribute('aria-labelledby'), label.id);
        });

        it('stores a title set before render', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                i18nService: mockI18nService,
            });

            dropdown.setLabel('Signals');
            dropdown.attachTo(container);

            const label = container.querySelector('.dropdown-control__label');
            assert.ok(label);
            assert.equal(label.textContent, 'Signals');
        });

        it('keeps the menu path working after a title swap', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            dropdown.setLabel('Signals');
            dropdown.open();

            assert.equal(document.body.querySelector('.dropdown-control__menu').hidden, false);
        });

        it('leaves exactly one title span after repeated calls', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);

            dropdown.setLabel('First');
            dropdown.setLabel('Second');
            dropdown.setLabel('Third');

            const labels = container.querySelectorAll('.dropdown-control__label');
            assert.equal(labels.length, 1);
            assert.equal(labels[0].textContent, 'Third');
        });
    });

    describe('Lifecycle', () => {
        it('should clean up event listeners on detach', () => {
            dropdown = new DropdownControl({
                options: testOptions,
                value: 'all',
                i18nService: mockI18nService,
            });
            dropdown.attachTo(container);
            dropdown.open();

            dropdown.detach();

            // Listeners should be removed
            // Try to trigger click outside - should not crash
            const event = new MouseEvent('click', { bubbles: true });
            document.body.dispatchEvent(event);

            // Should not throw an error
            assert.ok(true);
        });
    });
});
