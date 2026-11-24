// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { MarkdownEditorControl } from '../../src/micro_otter/nodes/html/js/views/controls/markdown-editor-control.js';

const require = createRequire(import.meta.url);
const marked = require(path.resolve('src/micro_otter/nodes/html/vendor/marked/marked.umd.js'));

function makeControl(options = {}) {
    return new MarkdownEditorControl({
        editLabel: 'Edit',
        doneLabel: 'Done',
        emptyText: 'No description yet.',
        ...options,
    });
}

describe('MarkdownEditorControl', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        dom.window.marked = marked;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        dom?.window?.close();
    });

    it('renders a Markdown preview for a non-empty value', () => {
        const control = makeControl({ value: '**bold** and `code`' });
        control.render(container);

        const preview = container.querySelector('.markdown-editor__preview');
        assert.ok(preview, 'renders the preview element');
        assert.equal(preview.hidden, false, 'preview is visible');
        assert.ok(preview.querySelector('strong'), 'renders strong emphasis');
        assert.ok(preview.querySelector('code'), 'renders inline code');
        assert.equal(container.querySelector('.markdown-editor__empty').hidden, true);
    });

    it('shows the empty hint and hides the preview for an empty value', () => {
        const control = makeControl({ value: '' });
        control.render(container);

        assert.equal(container.querySelector('.markdown-editor__preview').hidden, true);
        assert.equal(container.querySelector('.markdown-editor__empty').hidden, false);
    });

    it('swaps the preview for a textarea and Done button on Edit', () => {
        const control = makeControl({ value: '# One' });
        control.render(container);

        const editButton = container.querySelector('button[aria-label="Edit"]');
        const doneButton = container.querySelector('button[aria-label="Done"]');
        const textarea = container.querySelector('textarea');

        assert.ok(editButton, 'renders the Edit button');
        assert.ok(doneButton, 'renders the Done button');
        assert.equal(textarea.hidden, true, 'textarea starts hidden');
        assert.equal(doneButton.closest('.markdown-editor__action').hidden, true);

        editButton.click();

        assert.equal(textarea.hidden, false, 'textarea is shown while editing');
        assert.equal(textarea.value, '# One', 'textarea is seeded with the current value');
        assert.equal(doneButton.closest('.markdown-editor__action').hidden, false);
        assert.equal(container.querySelector('.markdown-editor__preview').hidden, true);
    });

    it('commits typed text exactly once via Done', () => {
        const control = makeControl({ value: '# One' });
        const changes = [];
        control.onChange((value) => changes.push(value));
        control.render(container);

        container.querySelector('button[aria-label="Edit"]').click();

        const textarea = container.querySelector('textarea');
        textarea.value = '## Two';
        container.querySelector('button[aria-label="Done"]').click();

        assert.deepEqual(changes, ['## Two']);
        assert.equal(control.getValue(), '## Two');
        assert.equal(textarea.hidden, true, 'textarea hidden after commit');
    });

    it('commits on Ctrl/Cmd+Enter and cancels on Escape', () => {
        const control = makeControl({ value: 'original' });
        const changes = [];
        control.onChange((value) => changes.push(value));
        control.render(container);

        container.querySelector('button[aria-label="Edit"]').click();
        const textarea = container.querySelector('textarea');

        textarea.value = 'first draft';
        textarea.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
        );
        assert.deepEqual(changes, ['first draft'], 'Ctrl+Enter commits');
        assert.equal(control.getValue(), 'first draft');

        container.querySelector('button[aria-label="Edit"]').click();
        textarea.value = 'abandoned';
        textarea.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        assert.deepEqual(changes, ['first draft'], 'Escape does not commit');
        assert.equal(control.getValue(), 'first draft');
    });

    it('setValue re-renders the preview without firing onChange', () => {
        const control = makeControl({ value: '# One' });
        const changes = [];
        control.onChange((value) => changes.push(value));
        control.render(container);

        control.setValue('**bold**');

        assert.deepEqual(changes, [], 'setValue never fires onChange');
        assert.ok(container.querySelector('.markdown-editor__preview strong'));
        assert.equal(control.getValue(), '**bold**');
    });
});
