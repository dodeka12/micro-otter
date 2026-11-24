// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

import { DropdownControl } from '../../src/micro_otter/nodes/html/js/views/controls/dropdown-control.js';

const OPTIONS = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B', disabled: true },
];

describe('DropdownControl.setDisabled', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        document.body.querySelectorAll('.dropdown-control__menu').forEach((menu) => menu.remove());
    });

    function render(options = {}) {
        const dropdown = new DropdownControl({ options: OPTIONS, ...options });
        dropdown.attachTo(container);
        return dropdown;
    }

    it('disables the button and prevents open()', () => {
        const dropdown = render();
        const button = container.querySelector('.dropdown-control__button');

        dropdown.setDisabled(true);

        assert.equal(button.disabled, true);
        assert.ok(container.querySelector('.dropdown-control').classList.contains('dropdown-control--disabled'));

        dropdown.open();
        assert.equal(document.body.querySelector('.dropdown-control__menu').hidden, true);
        dropdown.detach();
    });

    it('closes an open menu when disabled', () => {
        const dropdown = render();
        dropdown.open();
        assert.equal(document.body.querySelector('.dropdown-control__menu').hidden, false);

        dropdown.setDisabled(true);
        assert.equal(document.body.querySelector('.dropdown-control__menu').hidden, true);
        dropdown.detach();
    });

    it('restores the control on setDisabled(false)', () => {
        const dropdown = render();
        const button = container.querySelector('.dropdown-control__button');

        dropdown.setDisabled(true);
        dropdown.setDisabled(false);

        assert.equal(button.disabled, false);
        assert.ok(!container.querySelector('.dropdown-control').classList.contains('dropdown-control--disabled'));

        dropdown.open();
        assert.equal(document.body.querySelector('.dropdown-control__menu').hidden, false);
        dropdown.detach();
    });

    it('honors the disabled option on render', () => {
        const dropdown = render({ disabled: true });
        const button = container.querySelector('.dropdown-control__button');
        assert.equal(button.disabled, true);
        assert.ok(container.querySelector('.dropdown-control').classList.contains('dropdown-control--disabled'));
        dropdown.detach();
    });

    it('detach removes the body-mounted menu', () => {
        const dropdown = render();
        assert.equal(document.body.querySelectorAll('.dropdown-control__menu').length, 1);
        dropdown.detach();
        assert.equal(document.body.querySelectorAll('.dropdown-control__menu').length, 0);
    });
});
