// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { FilePickerDialogView } from '../../src/micro_otter/nodes/html/js/views/file-picker-dialog-view.js';

function entry(name, path, kind, sizeBytes = null) {
    return { name, path, kind, sizeBytes, modifiedAt: null };
}

const TREE = {
    '/pkg': {
        path: '/pkg',
        parent: '/',
        roots: [{ id: 'home', path: '/home' }],
        entries: [
            entry('sub', '/pkg/sub', 'directory'),
            entry('a.firmware.zip', '/pkg/a.firmware.zip', 'file', 12),
            entry('b.txt', '/pkg/b.txt', 'file', 4),
            entry('link', '/pkg/link', 'symlink'),
        ],
    },
    '/pkg/sub': {
        path: '/pkg/sub',
        parent: '/pkg',
        roots: [{ id: 'home', path: '/home' }],
        entries: [],
    },
};

describe('FilePickerDialogView', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
    });

    async function attach(listDirectory, options = {}) {
        const dialog = new FilePickerDialogView({ path: '/pkg', listDirectory, ...options });
        dialog.attachTo(container);
        await new Promise((resolve) => setTimeout(resolve, 0));
        return dialog;
    }

    it('lists the injected path and filters to the returned entries', async () => {
        const calls = [];
        await attach(async (request) => {
            calls.push(request);
            return TREE[request.path];
        });

        assert.equal(calls[0].path, '/pkg');
        const names = [...container.querySelectorAll('.file-picker-dialog__entry-name')].map(
            (el) => el.textContent
        );
        assert.deepEqual(names, ['sub', 'a.firmware.zip', 'b.txt', 'link']);
    });

    it('navigates on a directory row with absolute paths', async () => {
        const calls = [];
        await attach(async (request) => {
            calls.push(request);
            return TREE[request.path];
        });
        const dirButton = [...container.querySelectorAll('.file-picker-dialog__entry')].find(
            (el) => el.dataset.path === '/pkg/sub'
        );
        dirButton.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls[1].path, '/pkg/sub');
    });

    it('refuses a confirm without a selection in file mode', async () => {
        const dialog = await attach(async (request) => TREE[request.path]);
        const events = [];
        dialog.on('confirm', (event) => events.push(event.detail));
        dialog.confirm();
        assert.equal(events.length, 0);
        assert.ok(container.querySelector('.file-picker-dialog__error').style.display !== 'none');
    });

    it('confirms the selected file path', async () => {
        const dialog = await attach(async (request) => TREE[request.path]);
        const fileButton = [...container.querySelectorAll('.file-picker-dialog__entry')].find(
            (el) => el.dataset.path === '/pkg/a.firmware.zip'
        );
        fileButton.click();
        const events = [];
        dialog.on('confirm', (event) => events.push(event.detail));
        dialog.confirm();
        assert.equal(events.length, 1);
        assert.equal(events[0].path, '/pkg/a.firmware.zip');
        assert.equal(events[0].kind, 'file');
    });

    it('confirms the current directory in directory mode', async () => {
        const dialog = await attach(async (request) => TREE[request.path], { mode: 'directory' });
        const events = [];
        dialog.on('confirm', (event) => events.push(event.detail));
        dialog.confirm();
        assert.equal(events[0].path, '/pkg');
        assert.equal(events[0].kind, 'directory');
    });

    it('shows the code on a rejected listing', async () => {
        await attach(async () => {
            const error = new Error('does not exist');
            error.code = 'fs-not-found';
            throw error;
        });
        const error = container.querySelector('.file-picker-dialog__error');
        assert.ok(error.textContent.includes('fs-not-found'));
    });

    it('serializes and deserializes its mode, extensions, and path', async () => {
        const dialog = await attach(async (request) => TREE[request.path], {
            extensions: ['.firmware.zip'],
        });
        const restored = FilePickerDialogView.deserialize(dialog.serialize());
        assert.equal(restored.serialize().type, 'FilePickerDialogView');
        assert.equal(restored.mode, 'file');
        assert.deepEqual(restored.extensions, ['.firmware.zip']);
        assert.equal(restored.path, '/pkg');
    });
});
