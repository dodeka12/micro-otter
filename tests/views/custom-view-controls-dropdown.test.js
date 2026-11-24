import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { DropdownControl } from '../../src/micro_otter/nodes/html/js/views/custom-view-controls.js';

function createDom() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    return () => {
        delete global.document;
        delete global.HTMLElement;
    };
}

describe('DropdownControl value normalization', () => {
    it('maps lowercase value to matching option value case-insensitively', () => {
        const cleanup = createDom();

        const control = new DropdownControl({
            label: 'WiFi Mode',
            options: [
                { value: 'STA', label: 'Station' },
                { value: 'AP', label: 'Access Point' },
            ],
            defaultValue: 'STA',
        });

        const container = document.createElement('div');
        control.render(container);

        control.setValue('sta');

        assert.equal(control.getValue(), 'STA');
        assert.equal(control.element.value, 'STA');

        cleanup();
    });

    it('keeps unknown values unchanged when no option matches', () => {
        const cleanup = createDom();

        const control = new DropdownControl({
            label: 'WiFi Mode',
            options: [
                { value: 'STA', label: 'Station' },
                { value: 'AP', label: 'Access Point' },
            ],
            defaultValue: 'STA',
        });

        const container = document.createElement('div');
        control.render(container);

        control.setValue('APSTA');

        assert.equal(control.getValue(), 'APSTA');

        cleanup();
    });
});
