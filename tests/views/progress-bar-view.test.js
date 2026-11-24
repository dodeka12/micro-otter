// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { ProgressBarView } from '../../src/micro_otter/nodes/html/js/views/progress-bar-view.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const themesPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'styles', 'themes.json');
const cssPath = path.join(
    repoRoot,
    'src',
    'micro_otter',
    'nodes',
    'html',
    'styles',
    'standard',
    'progress-bar-view.css'
);

const elapsedFormatter = (seconds) => `${seconds}s elapsed`;

describe('ProgressBarView', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.HTMLButtonElement = dom.window.HTMLButtonElement;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        global.HTMLButtonElement = undefined;
        dom.window.close();
    });

    const mount = (options = {}) => {
        const bar = new ProgressBarView({ elapsedFormatter, ...options });
        bar.attachTo(container);
        return bar;
    };
    const root = () => container.querySelector('.progress-bar-view');
    const statusEl = () => container.querySelector('.progress-bar-view__status');
    const elapsedEl = () => container.querySelector('.progress-bar-view__elapsed');
    const cancelHost = () => container.querySelector('.progress-bar-view__cancel');
    const cancelButton = () => cancelHost().querySelector('.custom-control__button');

    it('renders a hidden text-only readout with no progress bar element', () => {
        mount({ label: 'Building', status: 'precompile', cancelLabel: 'Cancel' });

        assert.ok(root(), 'root rendered');
        assert.equal(root().hidden, true, 'hidden until shown');
        assert.equal(root().getAttribute('role'), 'status');
        assert.equal(root().getAttribute('aria-live'), 'polite');
        assert.equal(
            container.querySelector('progress'),
            null,
            'no <progress> element: a styled native bar is invisible (Blink/WebKit) or full (Gecko)'
        );
        assert.equal(container.querySelector('.progress-bar-view__bar'), null, 'no bar element at all');
        assert.equal(
            container.querySelector('.progress-bar-view__label').textContent,
            'Building'
        );
        assert.equal(statusEl().textContent, 'precompile');
        assert.equal(statusEl().hidden, false);
        assert.equal(elapsedEl().hidden, true, 'no elapsed line before show()');
        assert.equal(cancelHost().hidden, true, 'no cancel button unless cancelable');
    });

    it('shows the readout and ticks the elapsed line while visible', (t) => {
        t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
        const bar = mount();

        bar.show('Deploying');

        assert.equal(bar.isVisible(), true);
        assert.equal(root().hidden, false);
        assert.equal(
            container.querySelector('.progress-bar-view__label').textContent,
            'Deploying'
        );
        assert.equal(elapsedEl().textContent, '0s elapsed');
        assert.equal(elapsedEl().hidden, false);

        t.mock.timers.tick(3000);
        assert.equal(elapsedEl().textContent, '3s elapsed');
    });

    it('freezes the elapsed line after hide() and restarts it on the next show()', (t) => {
        t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
        const bar = mount();

        bar.show('Building');
        t.mock.timers.tick(2000);
        assert.equal(elapsedEl().textContent, '2s elapsed');

        bar.hide();
        assert.equal(bar.isVisible(), false);
        assert.equal(root().hidden, true);
        assert.equal(elapsedEl().textContent, '', 'elapsed line cleared');
        assert.equal(elapsedEl().hidden, true);

        t.mock.timers.tick(5000);
        assert.equal(elapsedEl().textContent, '', 'timer stopped while hidden');

        bar.show();
        assert.equal(elapsedEl().textContent, '0s elapsed', 'timer restarted');
        assert.equal(
            container.querySelector('.progress-bar-view__label').textContent,
            'Building',
            'label kept when show() has no argument'
        );
    });

    it('hides the status line again when it is cleared', () => {
        const bar = mount({ status: 'precompile' });
        assert.equal(statusEl().hidden, false);

        bar.setStatus(null);
        assert.equal(statusEl().textContent, '');
        assert.equal(statusEl().hidden, true);

        bar.setStatus('publishing');
        assert.equal(statusEl().textContent, 'publishing');
        assert.equal(statusEl().hidden, false);
    });

    it('offers a Cancel button only when cancelable and reports clicks', () => {
        const bar = mount({ cancelable: true, cancelLabel: 'Cancel' });
        let cancelled = 0;
        bar.onCancel(() => {
            cancelled += 1;
        });

        assert.equal(cancelHost().hidden, false);
        assert.equal(cancelButton().disabled, false);
        cancelButton().click();
        assert.equal(cancelled, 1, 'cancel callback invoked');

        bar.setCancelLabel('Cancelling…');
        assert.equal(cancelButton().textContent.includes('Cancelling…'), true);

        bar.setCancelEnabled(false);
        assert.equal(cancelButton().disabled, true);

        bar.setCancelable(false);
        assert.equal(cancelHost().hidden, true);
    });

    it('stops the elapsed timer when the view is detached', (t) => {
        t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
        const bar = mount();
        bar.show('Building');

        bar.detach();

        assert.equal(bar.isAttached, false);
        assert.doesNotThrow(() => t.mock.timers.tick(5000), 'no tick after detach');
    });

    it('registers its stylesheet in the standard theme manifest', () => {
        const manifest = JSON.parse(readFileSync(themesPath, 'utf8'));
        assert.ok(manifest.styles.includes('progress-bar-view'));
        assert.ok(existsSync(cssPath));
    });

    it('keeps the stylesheet text-only: no bar rules, text lines styled', () => {
        const css = readFileSync(cssPath, 'utf8');

        assert.equal(/\.progress-bar-view__bar\b/.test(css), false, 'no bar selector');
        assert.equal(/::-webkit-progress|::-moz-progress/.test(css), false, 'no progress pseudo-elements');
        assert.ok(css.includes('.progress-bar-view__label'), 'label styled');
        assert.ok(css.includes('.progress-bar-view__status'), 'status styled');
        assert.ok(css.includes('.progress-bar-view__elapsed'), 'elapsed line styled');
        assert.ok(css.includes('.progress-bar-view[hidden]'), 'hidden override kept for the flex root');
    });
});
